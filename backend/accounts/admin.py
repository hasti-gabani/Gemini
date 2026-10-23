from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Business, BusinessSettings, LoginGuard, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['username', 'email', 'phone', 'business', 'role', 'is_active', 'last_login']
    list_filter = ['role', 'is_active', 'is_staff']
    fieldsets = BaseUserAdmin.fieldsets + (('Business', {'fields': ('business', 'phone', 'role')}),)


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'city', 'gstin', 'created_at']
    search_fields = ['name', 'phone', 'gstin']


@admin.register(BusinessSettings)
class BusinessSettingsAdmin(admin.ModelAdmin):
    list_display = ['business', 'sale_prefix', 'purchase_prefix', 'print_format', 'language']


@admin.register(LoginGuard)
class LoginGuardAdmin(admin.ModelAdmin):
    list_display = ['key', 'failures', 'locked_until', 'updated_at']
    search_fields = ['key']
