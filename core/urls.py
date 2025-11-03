from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("register/", views.register, name="register"),
    path("profile/", views.profile, name="profile"),
    path("dashboard/", views.dashboard, name="account_dashboard"),
    path("disconnect-google/<int:pk>/", views.disconnect_google, name="disconnect_google"),
]
