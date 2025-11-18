from django.db import models
from django.contrib.auth.models import User


class DriveManifest(models.Model):
    """
    Stores metadata about a distributed upload across multiple Google Drive accounts.
    Each record corresponds to one complete user-uploaded file.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="drive_manifests")
    file_name = models.CharField(max_length=255)
    file_checksum = models.CharField(max_length=128, blank=True, default="", help_text="SHA-256 hash of the full file")
    total_size = models.BigIntegerField()
    chunk_size = models.BigIntegerField()
    total_chunks = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    manifest_data = models.JSONField(help_text="List of chunk metadata including account, drive_file_id, checksum and size")

    def __str__(self):
        return f"{self.file_name} ({self.user.username})"

    class Meta:
        ordering = ["-created_at"]
