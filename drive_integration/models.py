from django.db import models
from django.contrib.auth.models import User


class DriveFileManifest(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    file_name = models.CharField(max_length=255)
    total_size = models.BigIntegerField()
    chunk_size = models.BigIntegerField()
    total_chunks = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    manifest_data = models.JSONField()

    def __str__(self):
        return f"{self.file_name} ({self.user.username})"
