import re
from datetime import timedelta

from django.db.models import Count, Exists, F, OuterRef, Q, Sum
from django.db.models.functions import Abs, Lower
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.bulk import MAX_BULK_DELETE, error_text
from core.dates import parse_date, resolve_period, today
from core.exports import pdf_response, xlsx_response
from core.mixins import BusinessScopedMixin
from core.money import ZERO, fmt_money, money_str

from . import reminders as reminder_utils
from . import services
from .models import Party, Reminder
from .serializers import PartyListSerializer, PartySerializer, ReminderSerializer
from .statement import build_statement, statement_json, statement_report


def party_search_q(search):
    from transactions.models import PaymentIn, PaymentOut, Purchase, Sale

    q = Q(name__icontains=search) | Q(gstin__icontains=search) | Q(city__icontains=search)
    digits = re.sub(r'\D', '', search)
    if len(digits) >= 3:
        q |= Q(phone__contains=digits) | Q(phone_alt__contains=digits)
    for model in (Sale, Purchase, PaymentIn, PaymentOut):
        q |= Exists(model.objects.filter(party=OuterRef('pk'), number__icontains=search))
    return q


class PartyViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    model = Party
    serializer_class = PartySerializer

    ORDERINGS = {
        'name': [Lower('name')],
        'amount': [Abs('balance').desc(), Lower('name')],  # biggest balance first, to get or to pay
        '-balance': ['-balance', Lower('name')],
        'balance': ['balance', Lower('name')],
        '-last_txn_date': [F('last_txn_date').desc(nulls_last=True), Lower('name')],
        '-created_at': ['-created_at'],
    }

    def get_serializer_class(self):
        return PartyListSerializer if self.action == 'list' else PartySerializer

    def scope_queryset(self, qs):
        if self.action != 'list':
            return qs
        params = self.request.query_params
        party_type = params.get('type')
        if party_type == 'customer':
            qs = qs.filter(party_type__in=[Party.TYPE_CUSTOMER, Party.TYPE_BOTH])
        elif party_type == 'supplier':
            qs = qs.filter(party_type__in=[Party.TYPE_SUPPLIER, Party.TYPE_BOTH])
        balance_filter = params.get('filter')
        if balance_filter == 'receivable':
            qs = qs.filter(balance__gt=0)
        elif balance_filter == 'payable':
            qs = qs.filter(balance__lt=0)
        elif balance_filter == 'zero':
            qs = qs.filter(balance=0)
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(party_search_q(search))
        ordering = self.ORDERINGS.get(params.get('ordering'), self.ORDERINGS['name'])
        return qs.order_by(*ordering)

    def list(self, request, *args, **kwargs):
        agg = Party.objects.filter(business=self.business).aggregate(
            receivable=Sum('balance', filter=Q(balance__gt=0)),
            payable=Sum('balance', filter=Q(balance__lt=0)),
            count=Count('id'),
            count_receivable=Count('id', filter=Q(balance__gt=0)),
            count_payable=Count('id', filter=Q(balance__lt=0)),
        )
        self.list_summary = {
            'receivable': money_str(agg['receivable']),
            'payable': money_str(-(agg['payable'] or ZERO)),
            'count': agg['count'],
            'count_receivable': agg['count_receivable'],
            'count_payable': agg['count_payable'],
            'count_zero': agg['count'] - agg['count_receivable'] - agg['count_payable'],
        }
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        party = self.get_object()
        data = PartySerializer(party, context=self.get_serializer_context()).data
        data['stats'] = self._stats(party)
        return Response(data)

    def _stats(self, party):
        from transactions.models import PaymentIn, PaymentOut, Purchase, Sale

        t = today()
        sales = Sale.objects.filter(party=party).aggregate(
            count=Count('id'), total=Sum('total'), pending=Sum('balance_due', filter=Q(balance_due__gt=0)),
            overdue=Sum('balance_due', filter=Q(balance_due__gt=0, due_date__lt=t)),
            pending_count=Count('id', filter=Q(balance_due__gt=0)))
        purchases = Purchase.objects.filter(party=party).aggregate(
            count=Count('id'), total=Sum('total'), pending=Sum('balance_due', filter=Q(balance_due__gt=0)),
            pending_count=Count('id', filter=Q(balance_due__gt=0)))
        payments_in = PaymentIn.objects.filter(party=party).aggregate(count=Count('id'), total=Sum('amount'))
        payments_out = PaymentOut.objects.filter(party=party).aggregate(count=Count('id'), total=Sum('amount'))
        next_reminder = party.reminders.filter(status=Reminder.STATUS_PENDING).order_by('due_date').first()

        money = money_str
        return {
            'sales_count': sales['count'], 'sales_total': money(sales['total']),
            'sales_pending': money(sales['pending']), 'sales_overdue': money(sales['overdue']),
            'sales_pending_count': sales['pending_count'],
            'purchases_count': purchases['count'], 'purchases_total': money(purchases['total']),
            'purchases_pending': money(purchases['pending']), 'purchases_pending_count': purchases['pending_count'],
            'payments_in_count': payments_in['count'], 'payments_in_total': money(payments_in['total']),
            'payments_out_count': payments_out['count'], 'payments_out_total': money(payments_out['total']),
            'next_reminder': ReminderSerializer(next_reminder, context=self.get_serializer_context()).data
            if next_reminder else None,
        }

    def perform_create(self, serializer):
        party = Party(business=self.business, **serializer.validated_data)
        serializer.instance = services.save_party(party)

    def perform_update(self, serializer):
        party = serializer.instance
        for key, value in serializer.validated_data.items():
            setattr(party, key, value)
        serializer.instance = services.save_party(party)

    def perform_destroy(self, instance):
        services.delete_party(instance, with_transactions=True)

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        """Delete the ticked parties in one go.

        A party's bills and payments are deleted with it, as with a single
        delete; a party that still cannot go comes back in `kept` with the reason.
        """
        ids = request.data.get('ids')
        if not isinstance(ids, list) or not ids:
            raise ValidationError({'ids': 'Choose at least one party to delete.'})
        if len(ids) > MAX_BULK_DELETE:
            raise ValidationError({'ids': f'Delete at most {MAX_BULK_DELETE} parties at a time.'})
        deleted, kept = 0, []
        for party in Party.objects.filter(business=self.business, id__in=ids):
            try:
                services.delete_party(party, with_transactions=True)
                deleted += 1
            except ValidationError as error:
                kept.append({'id': party.id, 'name': party.name, 'reason': error_text(error)})
        return Response({'deleted': deleted, 'kept': kept})

    # ------------------------------------------------------------------ related records

    @action(detail=True, methods=['get'])
    def bills(self, request, pk=None):
        from transactions.models import Purchase, Sale
        from transactions.serializers import BillListSerializer
        from transactions.views import filter_bills

        party = self.get_object()
        kind = request.query_params.get('kind')
        if kind not in ('sale', 'purchase'):
            kind = 'purchase' if party.party_type == Party.TYPE_SUPPLIER else 'sale'
        model = Sale if kind == 'sale' else Purchase
        qs = filter_bills(model.objects.filter(business=self.business, party=party), request.query_params)
        page = self.paginate_queryset(qs)
        data = BillListSerializer(page, many=True, context={'kind': kind}).data
        return self.get_paginated_response(data)

    @action(detail=True, methods=['get'])
    def payments(self, request, pk=None):
        from transactions.models import PaymentIn, PaymentOut
        from transactions.serializers import PaymentListSerializer
        from transactions.views import filter_payments

        party = self.get_object()
        kind = request.query_params.get('kind')
        if kind not in ('in', 'out'):
            kind = 'out' if party.party_type == Party.TYPE_SUPPLIER else 'in'
        model = PaymentIn if kind == 'in' else PaymentOut
        qs = filter_payments(model.objects.filter(business=self.business, party=party), request.query_params, kind)
        page = self.paginate_queryset(qs)
        data = PaymentListSerializer(page, many=True, context={'kind': kind}).data
        return self.get_paginated_response(data)

    @action(detail=True, methods=['get'])
    def transactions(self, request, pk=None):
        """Bills and payments of one party in a single list, newest first.

        ?filter=all|bills|payments, and with bills ?status=unpaid|partial|paid|overdue.
        Rows carry `type` (sale, purchase, payment_in, payment_out) plus the fields of the
        bill or payment list serializers.
        """
        from django.db.models import CharField, Prefetch, Value

        from transactions.models import PaymentIn, PaymentOut, Purchase, PurchaseAllocation, Sale, SaleAllocation
        from transactions.serializers import BillListSerializer, PaymentListSerializer

        party = self.get_object()
        params = request.query_params
        view = params.get('filter') if params.get('filter') in ('bills', 'payments') else 'all'
        status = params.get('status') if view == 'bills' else ''

        def rows(model, kind):
            qs = model.objects.filter(business=self.business, party=party)
            if model in (Sale, Purchase):
                if status in ('unpaid', 'partial', 'paid'):
                    qs = qs.filter(payment_status=status)
                elif status == 'overdue':
                    qs = qs.filter(balance_due__gt=0, due_date__lt=today())
            # order_by() drops the models' default ordering, which SQL does not allow inside a UNION
            return (qs.annotate(kind=Value(kind, output_field=CharField()))
                    .values('kind', 'id', 'date', 'created_at').order_by())

        parts = []
        if view in ('all', 'bills'):
            parts += [rows(Sale, 'sale'), rows(Purchase, 'purchase')]
        if view in ('all', 'payments'):
            parts += [rows(PaymentIn, 'payment_in'), rows(PaymentOut, 'payment_out')]
        merged = parts[0].union(*parts[1:], all=True).order_by('-date', '-created_at', '-id')
        page = self.paginate_queryset(merged)

        wanted = {}
        for entry in page:
            wanted.setdefault(entry['kind'], []).append(entry['id'])
        loaders = {
            'sale': lambda ids: Sale.objects.filter(id__in=ids).prefetch_related('items'),
            'purchase': lambda ids: Purchase.objects.filter(id__in=ids).prefetch_related('items'),
            'payment_in': lambda ids: PaymentIn.objects.filter(id__in=ids).select_related('account').prefetch_related(
                Prefetch('allocations', queryset=SaleAllocation.objects.select_related('sale')), 'attachments'),
            'payment_out': lambda ids: PaymentOut.objects.filter(id__in=ids).select_related('account').prefetch_related(
                Prefetch('allocations', queryset=PurchaseAllocation.objects.select_related('purchase')), 'attachments'),
        }
        serialized = {}
        for kind, ids in wanted.items():
            records = loaders[kind](ids)
            if kind in ('sale', 'purchase'):
                data = BillListSerializer(records, many=True, context={'kind': kind}).data
            else:
                data = PaymentListSerializer(records, many=True, context={'kind': 'in' if kind == 'payment_in' else 'out'}).data
            for row in data:
                serialized[(kind, row['id'])] = {'type': kind, **row}
        results = [serialized[(entry['kind'], entry['id'])] for entry in page
                   if (entry['kind'], entry['id']) in serialized]
        return self.get_paginated_response(results)

    @action(detail=True, methods=['get'], url_path='pending-bills')
    def pending_bills(self, request, pk=None):
        from transactions import services as txn_services
        from transactions.models import PaymentIn, PaymentOut

        party = self.get_object()
        kind = request.query_params.get('kind', 'in')
        if kind not in ('in', 'out'):
            raise ValidationError({'kind': 'Use "in" or "out".'})
        payment = None
        payment_id = request.query_params.get('payment')
        if payment_id:
            model = PaymentIn if kind == 'in' else PaymentOut
            payment = model.objects.filter(business=self.business, id=payment_id).first()
        rows = txn_services.pending_bills(kind, party, payment)
        outstanding = txn_services.party_outstanding(kind, party, payment)
        return Response({
            'party': {'id': party.id, 'name': party.name, 'balance': str(party.balance)},
            'outstanding': str(max(outstanding, ZERO)),
            'results': [{**row, 'total': str(row['total']), 'paid_amount': str(row['paid_amount']),
                         'balance_due': str(row['balance_due']), 'allocated': str(row['allocated'])}
                        for row in rows],
        })

    # ------------------------------------------------------------------ statement

    def _statement(self, request):
        party = self.get_object()
        start, end = resolve_period(request.query_params.get('period'), request.query_params.get('date_from'),
                                    request.query_params.get('date_to'), default='all')
        return party, build_statement(party, start, end)

    @action(detail=True, methods=['get'])
    def statement(self, request, pk=None):
        party, statement = self._statement(request)
        data = statement_json(statement)
        closing = statement['closing_balance']
        text = (f'Statement of account for {party.name}\n{statement["period_label"]}\n'
                f'Closing balance: {fmt_money(abs(closing))} ({statement["closing_label"]})\n– {self.business.name}')
        data['share'] = reminder_utils.share_links(party.phone, text)
        return Response(data)

    @action(detail=True, methods=['get'], url_path='statement/pdf')
    def statement_pdf(self, request, pk=None):
        from core.pdf import render_report_pdf

        party, statement = self._statement(request)
        report = statement_report(statement, self.business)
        filename = report.pop('filename')
        inline = request.query_params.get('download') not in ('1', 'true')
        return pdf_response(render_report_pdf(report), filename, inline=inline)

    @action(detail=True, methods=['get'], url_path='statement/xlsx')
    def statement_xlsx(self, request, pk=None):
        from core.excel import render_report_xlsx

        party, statement = self._statement(request)
        report = statement_report(statement, self.business)
        filename = report.pop('filename')
        return xlsx_response(render_report_xlsx(report), filename)

    @action(detail=True, methods=['get'], url_path='reminder-message')
    def reminder_message(self, request, pk=None):
        party = self.get_object()
        amount = max(party.balance, ZERO)
        due = parse_date(request.query_params.get('due_date')) or today() + timedelta(
            days=self.business.settings.reminder_lead_days or 0)
        text = reminder_utils.render_message(self.business, party, amount, due)
        return Response({'amount': str(amount), 'due_date': due, **reminder_utils.share_links(party.phone, text)})


class ReminderViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    model = Reminder
    serializer_class = ReminderSerializer

    def scope_queryset(self, qs):
        qs = qs.select_related('party')
        if self.action != 'list':
            return qs
        params = self.request.query_params
        status = params.get('status', 'pending')
        if status in (Reminder.STATUS_PENDING, Reminder.STATUS_DONE):
            qs = qs.filter(status=status)
        party = params.get('party')
        if party:
            qs = qs.filter(party_id=party)
        due = params.get('due')
        t = today()
        if due == 'overdue':
            qs = qs.filter(due_date__lt=t)
        elif due == 'today':
            qs = qs.filter(due_date=t)
        elif due == 'upcoming':
            qs = qs.filter(due_date__gt=t)
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(Q(party__name__icontains=search) | Q(party__phone__contains=search))
        if status == Reminder.STATUS_DONE:
            return qs.order_by('-updated_at')
        return qs.order_by('due_date', 'id')

    def perform_create(self, serializer):
        data = serializer.validated_data
        party = data['party']
        message = data.get('message') or reminder_utils.render_message(
            self.business, party, data['amount'], data['due_date'])
        serializer.save(business=self.business, message=message)

    def perform_update(self, serializer):
        data = serializer.validated_data
        instance = serializer.instance
        if 'message' in data and not data['message']:
            data['message'] = reminder_utils.render_message(
                self.business, data.get('party', instance.party), data.get('amount', instance.amount),
                data.get('due_date', instance.due_date))
        serializer.save()

    def retrieve(self, request, *args, **kwargs):
        reminder = self.get_object()
        data = self.get_serializer(reminder).data
        data['share'] = reminder_utils.share_links(reminder.party.phone, reminder.message)
        return Response(data)

    @action(detail=True, methods=['post'], url_path='mark-sent')
    def mark_sent(self, request, pk=None):
        reminder = self.get_object()
        reminder.sent_count = F('sent_count') + 1
        reminder.last_sent_at = timezone.now()
        reminder.save(update_fields=['sent_count', 'last_sent_at', 'updated_at'])
        reminder.refresh_from_db()
        return Response(self.get_serializer(reminder).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        reminder = self.get_object()
        reminder.status = Reminder.STATUS_DONE
        reminder.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(reminder).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        reminder = self.get_object()
        reminder.status = Reminder.STATUS_PENDING
        reminder.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(reminder).data)

    @action(detail=False, methods=['get'])
    def suggestions(self, request):
        """Customers with money pending and no open reminder, largest first."""
        from transactions.models import Sale

        t = today()
        open_reminders = Reminder.objects.filter(party=OuterRef('pk'), status=Reminder.STATUS_PENDING)
        overdue = Sale.objects.filter(party=OuterRef('pk'), balance_due__gt=0, due_date__lt=t)
        qs = (Party.objects.filter(business=self.business, balance__gt=0)
              .annotate(has_reminder=Exists(open_reminders), has_overdue=Exists(overdue))
              .filter(has_reminder=False)
              .order_by('-has_overdue', '-balance')[:50])
        return Response({'results': [{
            'party': p.id, 'party_name': p.name, 'party_phone': p.phone, 'amount': str(p.balance),
            'has_overdue': p.has_overdue, 'last_txn_date': p.last_txn_date,
        } for p in qs]})
