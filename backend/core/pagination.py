from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 200

    def paginate_queryset(self, queryset, request, view=None):
        self.summary = getattr(view, 'list_summary', None)
        return super().paginate_queryset(queryset, request, view)

    def get_paginated_response(self, data):
        payload = {
            'count': self.page.paginator.count,
            'page': self.page.number,
            'page_size': self.get_page_size(self.request),
            'num_pages': self.page.paginator.num_pages,
            'next': self.page.next_page_number() if self.page.has_next() else None,
            'previous': self.page.previous_page_number() if self.page.has_previous() else None,
            'results': data,
        }
        if self.summary is not None:
            payload['summary'] = self.summary
        return Response(payload)
