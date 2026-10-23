from rest_framework.response import Response
from rest_framework.views import APIView

from core.exports import pdf_response, xlsx_response

from . import builders
from .dashboard import chart_data, dashboard_summary
from .search import global_search


class DashboardView(APIView):
    def get(self, request):
        return Response(dashboard_summary(request.user.business))


class DashboardChartView(APIView):
    def get(self, request):
        params = request.query_params
        return Response(chart_data(request.user.business, params.get('period'), params.get('date_from'),
                                   params.get('date_to')))


class SearchView(APIView):
    def get(self, request):
        return Response(global_search(request.user.business, request.query_params.get('q')))


class ReportListView(APIView):
    def get(self, request):
        return Response({'results': builders.definitions()})


class ReportView(APIView):
    def get(self, request, key):
        report = builders.build_report(key, request.user.business, request.query_params)
        return Response(builders.report_json(report, builders.REPORTS[key]))


def _export_name(report):
    return f'{report["title"]} - {report["subtitle"]}'.replace('Period: ', '').replace('Date: ', '').replace('/', '-')


class ReportPdfView(APIView):
    def get(self, request, key):
        from core.pdf import render_report_pdf

        report = builders.build_report(key, request.user.business, request.query_params)
        inline = request.query_params.get('download') not in ('1', 'true')
        return pdf_response(render_report_pdf(report), _export_name(report), inline=inline)


class ReportXlsxView(APIView):
    def get(self, request, key):
        from core.excel import render_report_xlsx

        report = builders.build_report(key, request.user.business, request.query_params)
        return xlsx_response(render_report_xlsx(report), _export_name(report))
