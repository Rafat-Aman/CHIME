# core/views.py
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.conf import settings

# ⬇️ ADD THESE imports (SocialApp was missing)
from allauth.socialaccount.models import SocialAccount, SocialApp

from .forms import SignUpForm  # keep if you have it
# from .google_api import get_storage_quota, GoogleAPIError  # keep if you use Drive quota

def home(request):
    # Guard: only show the Google button if a SocialApp for this Site exists
    has_google_app = SocialApp.objects.filter(
        provider="google",
        sites__id=getattr(settings, "SITE_ID", 1),
    ).exists()
    return render(request, "home.html", {"title": "Welcome", "has_google_app": has_google_app})

# --- keep your other views below ---
@login_required
def profile(request):
    return render(request, "profile.html")

def register(request):
    if request.method == "POST":
        form = SignUpForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, "Your account was created. You can sign in now.")
            return redirect("account_login")
        messages.error(request, "Please correct the errors below.")
    else:
        form = SignUpForm()
    return render(request, "registration/register.html", {"form": form})

@login_required
def dashboard(request):
    google_accounts = SocialAccount.objects.filter(user=request.user, provider="google")
    return render(request, "dashboard.html", {"google_accounts": google_accounts})

@login_required
def disconnect_google(request, pk: int):
    sa = get_object_or_404(SocialAccount, pk=pk, user=request.user, provider="google")
    if request.method == "POST":
        sa.delete()
        messages.success(request, "Disconnected Google account.")
        return redirect("dashboard")
    messages.error(request, "Invalid request.")
    return redirect("dashboard")
