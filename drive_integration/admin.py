from django.contrib import admin
from .models import DriveManifest

@admin.register(DriveManifest)
class DriveManifestAdmin(admin.ModelAdmin):
    list_display = ("file_name", "user", "total_size", "total_chunks", "created_at")
    search_fields = ("file_name", "user__username")
