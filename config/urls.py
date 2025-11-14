from django.contrib import admin
from django.urls import path, include
from core import views as core_views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("core.urls")),
    path("accounts/login/", core_views.google_login_redirect, name="account_login_redirect"),
    path("accounts/signup/", core_views.google_login_redirect, name="account_signup_redirect"),
    path("accounts/3rdparty/login/cancelled/", core_views.google_cancel_redirect, name="thirdparty_cancel_redirect"),
    path("accounts/", include("allauth.urls")),  # << allauth routes (login, logout, social)
]
