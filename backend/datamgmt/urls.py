from django.urls import path

from . import views

urlpatterns = [
    path('data/backup/', views.BackupView.as_view()),
    path('data/safety-backups/', views.SafetyBackupListView.as_view()),
    path('data/safety-backups/<str:name>/', views.SafetyBackupFileView.as_view()),
    path('data/safety-backups/<str:name>/restore/', views.SavedBackupRestoreView.as_view()),
    path('data/backup-status/', views.BackupStatusView.as_view()),
    path('data/backup-now/', views.BackupNowView.as_view()),
    path('data/backup-folder/', views.BackupFolderView.as_view()),
    path('data/restore/', views.RestoreView.as_view()),
    path('data/export-xlsx/', views.ExportExcelView.as_view()),
    path('data/cleanup/preview/', views.CleanupPreviewView.as_view()),
    path('data/cleanup/', views.CleanupView.as_view()),
    path('data/reset/', views.ResetView.as_view()),
    path('data/rebuild/', views.RebuildView.as_view()),
]
