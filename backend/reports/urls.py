from django.urls import path

from . import views

urlpatterns = [
    path('dashboard/', views.DashboardView.as_view()),
    path('dashboard/chart/', views.DashboardChartView.as_view()),
    path('search/', views.SearchView.as_view()),
    path('reports/', views.ReportListView.as_view()),
    path('reports/<slug:key>/', views.ReportView.as_view()),
    path('reports/<slug:key>/pdf/', views.ReportPdfView.as_view()),
    path('reports/<slug:key>/xlsx/', views.ReportXlsxView.as_view()),
]
