# core/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("register/", views.register, name="register"),
    path("profile/", views.profile, name="profile"),
]
# core/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("register/", views.register, name="register"),
    path("profile/", views.profile, name="profile"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("disconnect-google/<int:pk>/", views.disconnect_google, name="disconnect_google"),
    path("upload/", views.upload_view, name="upload_page"),
    path("create-upload-session/", views.create_upload_session, name="create_upload_session"),
    path("drive/", views.upload_view, name="upload_view"),
    path('drive_integration/', include('drive_integration.urls')),  # ✅ add this line
    
]
