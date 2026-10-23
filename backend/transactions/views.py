from datetime import timedelta

from django.conf import settings as django_settings
from django.db.models import Count, Exists, OuterRef, Prefetch, Q, Sum
from django.http import Http404
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from core import sharing, whatsapp, whatsapp_desktop
from core.bulk import MAX_BULK_DELETE, error_text
from core.dates import fmt_date, resolve_period, today
from core.exports import pdf_response, safe_filename
from core.files import optimize_image, safe_basename, stream_file, validate_upload
from core.mixins import BusinessScopedMixin, query_bool
from core.money import fmt_money, money_str
from parties.reminders import share_links

from . import documents, services
from .models import (
    Attachment, PaymentIn, PaymentOut, Purchase, PurchaseAllocation, PurchaseItem, Sale, SaleAllocation, SaleItem,
)
from .serializers import (
    AttachmentSerializer, BillDetailSerializer, BillListSerializer, BillWriteSerializer, PaymentDetailSerializer,
    PaymentListSerializer, PaymentWriteSerializer,
)

PDF_FORMATS = ('a4', 'a5', 'thermal80', 'thermal58')


def _date_range(qs, params, default='all'):
    start, end = resolve_period(params.get('period'), params.get('date_from'), params.get('date_to'), default=default)
    if start:
        qs = qs.filter(date__gte=start)
    if end:
        qs = qs.filter(date__lte=end)
    return qs


def filter_bills(qs, params):
    line_model = SaleItem if qs.model is Sale else PurchaseItem
    fk = 'sale' if qs.model is Sale else 'purchase'
    search = (params.get('search') or '').strip()
    if search:
        has_item = Exists(line_model.objects.filter(**{fk: OuterRef('pk')}, name__icontains=search))
        qs = qs.filter(Q(number__icontains=search) | Q(party_name__icontains=search)
                       | Q(party_phone__contains=search) | has_item)
    state = params.get('status')
    if state in ('unpaid', 'partial', 'paid'):
        qs = qs.filter(payment_status=state)
    elif state == 'pending':
        qs = qs.filter(balance_due__gt=0)
    elif state == 'overdue':
        qs = qs.filter(balance_due__gt=0, due_date__lt=today())
    mode = params.get('mode')
    if mode in ('cash', 'credit'):
        qs = qs.filter(mode=mode)
    party = params.get('party')
    if party:
        qs = qs.filter(party_id=party)
    item = params.get('item')
    if item:
        qs = qs.filter(Exists(line_model.objects.filter(**{fk: OuterRef('pk')}, item_id=item)))
    qs = _date_range(qs, params)
    orderings = {
        '-date': ['-date', '-seq', '-id'], 'date': ['date', 'seq', 'id'], '-total': ['-total', '-id'],
        '-balance_due': ['-balance_due', '-date'], 'number': ['prefix', 'seq', 'number'],
        '-created_at': ['-created_at'],
    }
    return qs.order_by(*orderings.get(params.get('ordering'), orderings['-date']))


def filter_payments(qs, params, kind):
    search = (params.get('search') or '').strip()
    if search:
        qs = qs.filter(Q(number__icontains=search) | Q(party_name__icontains=search)
                       | Q(reference_no__icontains=search) | Q(notes__icontains=search))
    account = params.get('account')
    if account:
        qs = qs.filter(account_id=account)
    account_kind = params.get('account_kind')
    if account_kind in ('cash', 'bank'):
        qs = qs.filter(account__kind=account_kind)
    party = params.get('party')
    if party:
        qs = qs.filter(party_id=party)
    qs = _date_range(qs, params)
    orderings = {'-date': ['-date', '-seq', '-id'], 'date': ['date', 'seq', 'id'], '-amount': ['-amount', '-id']}
    return qs.order_by(*orderings.get(params.get('ordering'), orderings['-date']))


def _share_url(request, token):
    # PUBLIC_BASE_URL (e.g. https://billing.example.com) keeps links valid for customers even when
    # the owner is using the app through localhost or a LAN address.
    base = django_settings.PUBLIC_BASE_URL
    return f'{base}/v/{token}' if base else request.build_absolute_uri(f'/v/{token}')



def _whatsapp_sends_pdf():
    """The WhatsApp button sends the PDF itself: Business API, the linked WhatsApp, or WhatsApp Desktop."""
    return whatsapp.is_configured() or whatsapp_desktop.is_available()


def _send_whatsapp(phone, content, filename, values, account=None):
    if not whatsapp.is_configured() and whatsapp_desktop.is_available():
        return whatsapp_desktop.send_pdf(phone, content, filename)
    return whatsapp.send_pdf(phone, content, filename, values, account)  # the API, or "not set up"

class BillViewSet(BusinessScopedMixin, viewsets.ViewSet):
    """Shared implementation for sales (kind='sale') and purchases (kind='purchase')."""

    kind = 'sale'
    model = Sale
    allocation_model = SaleAllocation

    def get_queryset(self):
        return self.model.objects.filter(business=self.business)

    def get_object(self):
        try:
            return self.get_queryset().select_related('party', 'business__settings').get(pk=self.kwargs['pk'])
        except (self.model.DoesNotExist, ValueError, TypeError):
            raise Http404

    def _detail(self, bill):
        return BillDetailSerializer(bill, context={'kind': self.kind}).data

    def list(self, request):
        qs = filter_bills(self.get_queryset(), request.query_params)
        agg = qs.aggregate(count=Count('id'), total=Sum('total'), paid=Sum('paid_amount'),
                           pending=Sum('balance_due'))
        self.list_summary = {'count': agg['count'], 'total': money_str(agg['total']),
                             'paid': money_str(agg['paid']), 'pending': money_str(agg['pending'])}
        paginator = self.paginator
        page = paginator.paginate_queryset(qs.prefetch_related('items'), request, view=self)
        data = BillListSerializer(page, many=True, context={'kind': self.kind}).data
        return paginator.get_paginated_response(data)

    @property
    def paginator(self):
        if not hasattr(self, '_paginator'):
            from core.pagination import StandardPagination
            self._paginator = StandardPagination()
        return self._paginator

    def retrieve(self, request, pk=None):
        return Response(self._detail(self.get_object()))

    def _save(self, request, instance=None):
        serializer = BillWriteSerializer(data=request.data, context={'business': self.business, 'request': request,
                                                                     'kind': self.kind})
        serializer.is_valid(raise_exception=True)
        bill = services.save_bill(self.kind, self.business, request.user, serializer.validated_data, instance)
        return bill

    def create(self, request):
        bill = self._save(request)
        return Response(self._detail(bill), status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        bill = self._save(request, self.get_object())
        return Response(self._detail(bill))

    partial_update = update

    def destroy(self, request, pk=None):
        bill = self.get_object()
        services.delete_bill(self.kind, bill, delete_linked_payments=query_bool(request, 'delete_linked_payments'))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], url_path='delete-preview')
    def delete_preview(self, request, pk=None):
        return Response(services.bill_delete_preview(self.kind, self.get_object()))

    @action(detail=True, methods=['get'])
    def document(self, request, pk=None):
        bill = self.get_object()
        return Response(documents.document_json(documents.bill_document(bill), logo_url='/api/business/logo/'))

    def _pdf(self, request, bill):
        from core.pdf import render_invoice_pdf

        fmt = request.query_params.get('format') or request.data.get('format') or bill.business.settings.print_format
        fmt = fmt if fmt in PDF_FORMATS else 'a4'
        content = render_invoice_pdf(documents.bill_document(bill), fmt)
        return content, f'{"Invoice" if self.kind == "sale" else "Purchase"} {bill.number} - {bill.party_name}'

    @action(detail=True, methods=['get'])
    def pdf(self, request, pk=None):
        content, name = self._pdf(request, self.get_object())
        return pdf_response(content, name, inline=not query_bool(request, 'download'))

    @action(detail=True, methods=['post'])
    def whatsapp(self, request, pk=None):
        """Send the bill PDF straight to the party's WhatsApp number."""
        bill = self.get_object()
        content, name = self._pdf(request, bill)
        account = request.data.get('account') or None  # this device's linked WhatsApp
        number = _send_whatsapp(bill.party_phone, content, safe_filename(name, 'pdf'), {
            'party': bill.party_name, 'number': bill.number, 'amount': fmt_money(bill.total),
            'balance': fmt_money(bill.balance_due), 'date': fmt_date(bill.date), 'business': bill.business.name,
            'caption': f'{name} · {fmt_money(bill.total)} – {bill.business.name}',
        }, account)
        return Response({'detail': f'PDF sent on WhatsApp to +{number}.'})

    @action(detail=True, methods=['get'])
    def share(self, request, pk=None):
        bill = self.get_object()
        token = sharing.make_token(self.kind, bill)
        url = _share_url(request, token)
        text = documents.bill_share_text(bill, url)
        return Response({'token': token, 'url': url, 'whatsapp_api': _whatsapp_sends_pdf(),
                         **share_links(bill.party_phone, text)})


class SaleViewSet(BillViewSet):
    kind = 'sale'
    model = Sale
    allocation_model = SaleAllocation


class PurchaseViewSet(BillViewSet):
    kind = 'purchase'
    model = Purchase
    allocation_model = PurchaseAllocation


class PaymentViewSet(BusinessScopedMixin, viewsets.ViewSet):
    kind = 'in'
    model = PaymentIn

    def get_queryset(self):
        return self.model.objects.filter(business=self.business)

    def get_object(self):
        try:
            return self.get_queryset().select_related('party', 'account', 'business__settings').get(
                pk=self.kwargs['pk'])
        except (self.model.DoesNotExist, ValueError, TypeError):
            raise Http404

    @property
    def paginator(self):
        if not hasattr(self, '_paginator'):
            from core.pagination import StandardPagination
            self._paginator = StandardPagination()
        return self._paginator

    def _detail(self, payment):
        return PaymentDetailSerializer(payment, context={'kind': self.kind}).data

    def list(self, request):
        qs = filter_payments(self.get_queryset(), request.query_params, self.kind)
        agg = qs.aggregate(count=Count('id'), total=Sum('amount'),
                           cash=Sum('amount', filter=Q(account__kind='cash')),
                           bank=Sum('amount', filter=Q(account__kind='bank')))
        self.list_summary = {'count': agg['count'], 'total': money_str(agg['total']),
                             'cash': money_str(agg['cash']), 'bank': money_str(agg['bank'])}
        bill_attr = 'sale' if self.kind == 'in' else 'purchase'
        qs = qs.select_related('account').prefetch_related(
            Prefetch('allocations', queryset=(SaleAllocation if self.kind == 'in' else PurchaseAllocation)
                     .objects.select_related(bill_attr)),
            'attachments')
        page = self.paginator.paginate_queryset(qs, request, view=self)
        data = PaymentListSerializer(page, many=True, context={'kind': self.kind}).data
        return self.paginator.get_paginated_response(data)

    def retrieve(self, request, pk=None):
        return Response(self._detail(self.get_object()))

    def _save(self, request, instance=None):
        serializer = PaymentWriteSerializer(data=request.data, context={
            'business': self.business, 'request': request, 'kind': self.kind})
        serializer.is_valid(raise_exception=True)
        return services.save_payment(self.kind, self.business, request.user, serializer.validated_data, instance)

    def create(self, request):
        return Response(self._detail(self._save(request)), status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        return Response(self._detail(self._save(request, self.get_object())))

    partial_update = update

    def destroy(self, request, pk=None):
        services.delete_payment(self.kind, self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'])
    def document(self, request, pk=None):
        payment = self.get_object()
        return Response(documents.document_json(documents.payment_document(payment),
                                                logo_url='/api/business/logo/'))

    def _pdf(self, request, payment):
        from core.pdf import render_receipt_pdf

        fmt = request.query_params.get('format') or request.data.get('format') or payment.business.settings.print_format
        fmt = fmt if fmt in PDF_FORMATS else 'a4'
        content = render_receipt_pdf(documents.payment_document(payment), fmt)
        return content, f'{"Receipt" if self.kind == "in" else "Payment"} {payment.number} - {payment.party_name}'

    @action(detail=True, methods=['get'])
    def pdf(self, request, pk=None):
        content, name = self._pdf(request, self.get_object())
        return pdf_response(content, name, inline=not query_bool(request, 'download'))

    @action(detail=True, methods=['post'])
    def whatsapp(self, request, pk=None):
        """Send the receipt / voucher PDF straight to the party's WhatsApp number."""
        payment = self.get_object()
        content, name = self._pdf(request, payment)
        phone = payment.party.phone if payment.party_id else ''
        account = request.data.get('account') or None  # this device's linked WhatsApp
        number = _send_whatsapp(phone, content, safe_filename(name, 'pdf'), {
            'party': payment.party_name, 'number': payment.number, 'amount': fmt_money(payment.amount),
            'balance': '', 'date': fmt_date(payment.date), 'business': payment.business.name,
            'caption': f'{name} · {fmt_money(payment.amount)} – {payment.business.name}',
        }, account)
        return Response({'detail': f'PDF sent on WhatsApp to +{number}.'})

    @action(detail=True, methods=['get'])
    def share(self, request, pk=None):
        payment = self.get_object()
        token = sharing.make_token('payment_in' if self.kind == 'in' else 'payment_out', payment)
        url = _share_url(request, token)
        text = documents.payment_share_text(payment, url)
        phone = payment.party.phone if payment.party_id else ''
        return Response({'token': token, 'url': url, 'whatsapp_api': _whatsapp_sends_pdf(),
                         **share_links(phone, text)})


class PaymentInViewSet(PaymentViewSet):
    kind = 'in'
    model = PaymentIn


class PaymentOutViewSet(PaymentViewSet):
    kind = 'out'
    model = PaymentOut


BULK_DELETE_KINDS = {
    'sale': ('sale', Sale),
    'purchase': ('purchase', Purchase),
    'payment_in': ('in', PaymentIn),
    'payment_out': ('out', PaymentOut),
}


class BulkDeleteView(APIView):
    """Delete the bills and payments ticked on a party's Transactions tab, in one go.

    Bills go first, because deleting a cash bill takes the payment it created with it: a payment
    ticked next to its own bill is simply gone by the time its turn comes. Payments made against a
    deleted bill stay and become advances, exactly as when deleting that bill on its own. Balances
    are recalculated by the same services the single delete uses.
    """

    def post(self, request):
        business = request.user.business
        items = request.data.get('items')
        if not isinstance(items, list) or not items:
            raise ValidationError({'items': 'Choose at least one bill or payment to delete.'})
        if len(items) > MAX_BULK_DELETE:
            raise ValidationError({'items': f'Delete at most {MAX_BULK_DELETE} records at a time.'})
        order = list(BULK_DELETE_KINDS)
        rows = []
        for item in items:
            kind = item.get('type') if isinstance(item, dict) else None
            if kind not in BULK_DELETE_KINDS:
                raise ValidationError({'items': 'Every row needs a type of sale, purchase, payment_in or payment_out.'})
            rows.append((order.index(kind), kind, item.get('id')))

        deleted, kept = 0, []
        for _, kind, pk in sorted(rows, key=lambda row: row[0]):
            key, model = BULK_DELETE_KINDS[kind]
            record = model.objects.filter(business=business, id=pk).first()
            if record is None:
                continue  # gone already, most likely with a cash bill ticked in the same batch
            try:
                if kind in ('sale', 'purchase'):
                    services.delete_bill(key, record)
                else:
                    services.delete_payment(key, record)
                deleted += 1
            except ValidationError as error:
                kept.append({'type': kind, 'id': record.id, 'number': record.number, 'reason': error_text(error)})
        return Response({'deleted': deleted, 'kept': kept})


class AttachmentViewSet(BusinessScopedMixin, viewsets.GenericViewSet):
    model = Attachment
    serializer_class = AttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def create(self, request):
        upload = request.FILES.get('file')
        kind = validate_upload(upload)
        # Drop abandoned uploads (never linked to a record) older than a day.
        stale = Attachment.objects.filter(
            business=self.business, sale__isnull=True, purchase__isnull=True, payment_in__isnull=True,
            payment_out__isnull=True, created_at__lt=timezone.now() - timedelta(days=1))
        for old in stale[:50]:
            old.delete()
        name = safe_basename(upload.name, 'attachment')
        if kind == 'image':
            content, content_type, ext = optimize_image(upload)
            stem = name.rsplit('.', 1)[0] if '.' in name else name
            name = f'{stem}{ext}'
        else:
            upload.seek(0)
            from django.core.files.base import ContentFile
            content, content_type = ContentFile(upload.read()), 'application/pdf'
            if not name.lower().endswith('.pdf'):
                name = f'{name}.pdf'
        attachment = Attachment(business=self.business, original_name=name[:150], content_type=content_type,
                                kind=Attachment.KIND_PDF if kind == 'pdf' else Attachment.KIND_IMAGE,
                                uploaded_by=request.user)
        attachment.file.save(name, content, save=False)
        attachment.size = attachment.file.size
        attachment.save()
        return Response(AttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def file(self, request, pk=None):
        attachment = self.get_object()
        response = stream_file(attachment.file, filename=attachment.original_name,
                               content_type=attachment.content_type, as_attachment=query_bool(request, 'download'))
        response['X-Frame-Options'] = 'SAMEORIGIN'  # the app previews PDF proofs in a frame
        return response

    def destroy(self, request, pk=None):
        attachment = self.get_object()
        if attachment.is_linked:
            raise ValidationError({'detail': 'Remove this attachment from its record and save the record instead.'})
        attachment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- public share links

class PublicThrottle(AnonRateThrottle):
    rate = '120/min'


def _resolve_shared(token):
    parsed = sharing.parse_token(token)
    if parsed is None:
        raise Http404
    kind, record_id, signature = parsed
    model = {'sale': Sale, 'purchase': Purchase, 'payment_in': PaymentIn, 'payment_out': PaymentOut}[kind]
    record = model.objects.select_related('business__settings').filter(id=record_id).first()
    if record is None or not sharing.verify(kind, record, signature):
        raise Http404
    return kind, record


class PublicDocumentView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [PublicThrottle]

    def get(self, request, token):
        kind, record = _resolve_shared(token)
        if kind in ('sale', 'purchase'):
            doc = documents.bill_document(record)
        else:
            doc = documents.payment_document(record)
        data = documents.document_json(doc, logo_url=f'/api/public/documents/{token}/logo/')
        return Response({'kind': kind, 'document': data, 'pdf_url': f'/api/public/documents/{token}/pdf/',
                         'app_name': django_settings.APP_NAME})


class PublicDocumentPdfView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [PublicThrottle]

    def get(self, request, token):
        from core.pdf import render_invoice_pdf, render_receipt_pdf

        kind, record = _resolve_shared(token)
        fmt = request.query_params.get('format') or record.business.settings.print_format
        fmt = fmt if fmt in PDF_FORMATS else 'a4'
        if kind in ('sale', 'purchase'):
            content = render_invoice_pdf(documents.bill_document(record), fmt)
            name = f'Invoice {record.number}'
        else:
            content = render_receipt_pdf(documents.payment_document(record), fmt)
            name = f'Receipt {record.number}'
        return pdf_response(content, name, inline=not query_bool(request, 'download'))


class PublicLogoView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [PublicThrottle]

    def get(self, request, token):
        _kind, record = _resolve_shared(token)
        return stream_file(record.business.logo)
