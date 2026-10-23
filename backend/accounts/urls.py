from django.urls import path

from . import views

urlpatterns = [
    path('auth/session/', views.SessionView.as_view()),
    path('auth/login/', views.LoginView.as_view()),
    path('auth/register/', views.RegisterView.as_view()),
    path('auth/logout/', views.LogoutView.as_view()),
    path('auth/profile/', views.ProfileView.as_view()),
    path('auth/change-password/', views.ChangePasswordView.as_view()),
    path('business/', views.BusinessView.as_view()),
    path('business/logo/', views.BusinessLogoView.as_view()),
    path('business/reset-share-links/', views.ResetShareLinksView.as_view()),
    path('settings/', views.SettingsView.as_view()),
    path('next-number/', views.NextNumberView.as_view()),
]
