from django.urls import path
from . import views

urlpatterns = [
    path("create-upload-session/", views.create_upload_session, name="create_upload_session"),
    path("proxy-chunk/", views.proxy_resumable_chunk, name="proxy_resumable_chunk"),
    path("uploads/", views.uploads_view, name="uploads"),
    path("save-manifest/", views.save_manifest, name="save_manifest"),
    path("downloads/", views.downloads_view, name="downloads"),
    path("download-chunk/", views.download_chunk, name="download_chunk"),
    path("delete-manifest/", views.delete_manifest, name="delete_manifest"),
    path("manifest-health/", views.manifest_health, name="manifest_health"),
]
