from django.db.models import Q, Sum
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.dates import resolve_period
from core.exports import pdf_response, xlsx_response
from core.mixins import BusinessScopedMixin
from core.money import ZERO, money_str

from . import services
from .models import BankAccount, BankAdjustment
from .serializers import BankAccountSerializer, BankAdjustmentSerializer
from .statement import build_account_statement, statement_json, statement_report


class BankAccountViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    model = BankAccount
    serializer_class = BankAccountSerializer
    pagination_class = None

    def scope_queryset(self, qs):
        kind = self.request.query_params.get('kind')
        if self.action == 'list' and kind in (BankAccount.KIND_CASH, BankAccount.KIND_BANK):
            qs = qs.filter(kind=kind)
        return qs.order_by('kind', '-is_default', 'name')

    def list(self, request, *args, **kwargs):
        from transactions.services import cash_account

        cash_account(self.business)  # make sure Cash in Hand exists
        accounts = list(self.get_queryset())
        agg = BankAccount.objects.filter(business=self.business).aggregate(
            cash=Sum('current_balance', filter=Q(kind=BankAccount.KIND_CASH)),
            bank=Sum('current_balance', filter=Q(kind=BankAccount.KIND_BANK)),
        )
        cash = agg['cash'] or ZERO
        bank = agg['bank'] or ZERO
        return Response({
            'results': self.get_serializer(accounts, many=True).data,
            'summary': {'cash_balance': money_str(cash), 'bank_balance': money_str(bank),
                        'total_balance': money_str(cash + bank)},
        })

    def create(self, request, *args, **kwargs):
        raise ValidationError({'detail': f'Only one bank account ({services.BANK_NAME}) is allowed. Edit it instead.'})

    def perform_update(self, serializer):
        account = serializer.instance
        for key, value in serializer.validated_data.items():
            setattr(account, key, value)
        serializer.instance = services.save_account(account)

    def destroy(self, request, *args, **kwargs):
        account = self.get_object()
        if account.kind == BankAccount.KIND_BANK:
            raise ValidationError({'detail': f'Bank account {account.name} cannot be deleted.'})
        move_to = None
        move_to_id = request.query_params.get('move_to')
        if move_to_id:
            move_to = BankAccount.objects.filter(business=self.business, id=move_to_id).first()
            if move_to is None:
                raise ValidationError({'move_to': 'The account to move transactions to was not found.'})
        services.delete_account(account, move_to=move_to)
        return Response(status=204)

    @action(detail=True, methods=['get'])
    def usage(self, request, pk=None):
        account = self.get_object()
        usage = services.account_usage(account)
        return Response({**usage, 'can_delete_directly': not (
            usage['payments_in'] or usage['payments_out'] or usage['adjustments'])})

    def _statement(self, request):
        account = self.get_object()
        params = request.query_params
        start, end = resolve_period(params.get('period'), params.get('date_from'), params.get('date_to'),
                                    default='all')
        direction = params.get('direction') if params.get('direction') in ('in', 'out') else None
        return account, build_account_statement(account, start, end, direction, params.get('type') or None)

    @action(detail=True, methods=['get'])
    def transactions(self, request, pk=None):
        account, statement = self._statement(request)
        data = statement_json(statement)
        data['account'] = BankAccountSerializer(account, context=self.get_serializer_context()).data
        return Response(data)

    @action(detail=True, methods=['get'], url_path='transactions/pdf')
    def transactions_pdf(self, request, pk=None):
        from core.pdf import render_report_pdf

        account, statement = self._statement(request)
        report = statement_report(statement, self.business)
        filename = report.pop('filename')
        inline = request.query_params.get('download') not in ('1', 'true')
        return pdf_response(render_report_pdf(report), filename, inline=inline)

    @action(detail=True, methods=['get'], url_path='transactions/xlsx')
    def transactions_xlsx(self, request, pk=None):
        from core.excel import render_report_xlsx

        account, statement = self._statement(request)
        report = statement_report(statement, self.business)
        filename = report.pop('filename')
        return xlsx_response(render_report_xlsx(report), filename)


class BankAdjustmentViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    model = BankAdjustment
    serializer_class = BankAdjustmentSerializer

    def scope_queryset(self, qs):
        qs = qs.select_related('from_account', 'to_account')
        account = self.request.query_params.get('account')
        if account:
            qs = qs.filter(Q(from_account_id=account) | Q(to_account_id=account))
        return qs.order_by('-date', '-id')

    def perform_create(self, serializer):
        adjustment = BankAdjustment(business=self.business, created_by=self.request.user,
                                    **serializer.validated_data)
        serializer.instance = services.save_adjustment(adjustment)

    def perform_update(self, serializer):
        adjustment = serializer.instance
        for key, value in serializer.validated_data.items():
            setattr(adjustment, key, value)
        serializer.instance = services.save_adjustment(adjustment)

    def perform_destroy(self, instance):
        services.delete_adjustment(instance)
