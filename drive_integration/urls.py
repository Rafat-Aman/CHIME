# drive_integration/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('uploads/', views.uploads_view, name='uploads'),
]
