# core/views.py
from __future__ import annotations

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login as auth_login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.shortcuts import render, redirect, get_object_or_404

# allauth
from allauth.socialaccount.models import SocialAccount, SocialApp, SocialToken

# Optional local SignUpForm; we’ll fallback to Django’s UserCreationForm if missing
try:
    from .forms import SignUpForm  # type: ignore
except Exception:
    SignUpForm = None  # type: ignore


# ---------- Utilities ----------

def _site_has_google_app() -> bool:
    """Return True if a Google SocialApp is attached to this SITE_ID."""
    try:
        return SocialApp.objects.filter(
            provider="google",
            sites__id=getattr(settings, "SITE_ID", 1),
        ).exists()
    except Exception:
        return SocialApp.objects.filter(provider="google").exists()


def _humanize_bytes(n: int | None) -> str:
    if n is None:
        return "unlimited"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    n = float(n)
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024.0
        i += 1
    return f"{n:.1f} {units[i]}" if i else f"{int(n)} {units[i]}"


def _build_drive_quota_for_account(acc: SocialAccount) -> tuple[dict | None, str | None]:
    """
    Given a SocialAccount (Google), return (quota_dict, error_message).
    quota: {"usage","limit","remaining"} (humanized strings)
    """
    # Lazy-import Google libs so manage.py check won't crash if deps not installed
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from google.auth.transport.requests import Request
    except Exception:
        return None, (
            "Google API client not installed. "
            "Run: pip install google-api-python-client google-auth google-auth-httplib2 google-auth-oauthlib"
        )

    tok = (
        SocialToken.objects
        .filter(account=acc)
        .order_by("-id")
        .first()
    )
    if not tok:
        return None, "No OAuth token stored for this account."

    try:
        app = SocialApp.objects.get(provider="google")
        client_id, client_secret = app.client_id, app.secret
    except SocialApp.DoesNotExist:
        return None, "Google SocialApp not configured for this site."

    try:
        # allauth stores refresh_token in token_secret for OAuth2
        creds = Credentials(
            token=tok.token,
            refresh_token=tok.token_secret,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=[
                "https://www.googleapis.com/auth/drive.metadata.readonly",
                "openid", "email", "profile",
            ],
        )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            if creds.token and creds.token != tok.token:
                tok.token = creds.token
                tok.save(update_fields=["token"])

        service = build("drive", "v3", credentials=creds)
        about = service.about().get(fields="storageQuota").execute()
        sq = about.get("storageQuota", {})
        usage = int(sq.get("usage", 0))
        limit = int(sq.get("limit", 0)) or None
        remaining = (limit - usage) if limit else None

        quota = {
            "usage": _humanize_bytes(usage),
            "limit": _humanize_bytes(limit) if limit else "unlimited",
            "remaining": _humanize_bytes(remaining) if remaining is not None else None,
        }
        return quota, None
    except Exception as e:
        return None, str(e)


# ---------- Views ----------

def home(request):
    """Landing page."""
    context = {"has_google_app": _site_has_google_app()}
    return render(request, "home.html", context)


@login_required
def dashboard(request):
    """
    Build the `items` list your dashboard template expects:
      items = [{ "account": SocialAccount, "quota": {...} | None, "error": str | None }]
    """
    accounts = (
        SocialAccount.objects
        .filter(user=request.user, provider="google")
        .select_related("user")
    )

    items = []
    for acc in accounts:
        quota, error = _build_drive_quota_for_account(acc)
        items.append({"account": acc, "quota": quota, "error": error})

    return render(request, "dashboard.html", {"items": items})


@login_required
def disconnect_google(request, pk: int):
    """Remove a linked Google account from the current user."""
    sa = get_object_or_404(SocialAccount, pk=pk, user=request.user, provider="google")
    if request.method == "POST":
        sa.delete()
        messages.success(request, "Disconnected Google account.")
        return redirect("dashboard")

    messages.error(request, "Invalid request.")
    return redirect("dashboard")


# --------- Auth helpers expected by your urls.py ---------

def register(request):
    """
    Register a new user.
    Uses your local SignUpForm if present; otherwise falls back to Django's UserCreationForm.
    """
    FormClass = SignUpForm if SignUpForm else UserCreationForm

    if request.method == "POST":
        form = FormClass(request.POST)
        if form.is_valid():
            user = form.save()
            auth_login(request, user)
            messages.success(request, "Registration successful. Welcome!")
            return redirect("dashboard")
    else:
        form = FormClass()

    # Use your existing template; adjust name if yours differs
    return render(request, "register.html", {"form": form})


@login_required
def profile(request):
    """
    Minimal profile view so links in navbar/urls resolve.
    Extend with whatever context your template expects.
    """
    return render(request, "profile.html", {})


# --- keep all your existing imports + helpers as-is ---

def _build_drive_quota_for_account(acc: SocialAccount) -> tuple[dict | None, str | None]:
    """
    Given a SocialAccount (Google), return (quota_dict, error_message).

    quota (humanized): {"usage","limit","remaining"}
    quota_raw (bytes): {"usage","limit","remaining"}  (limit/remaining may be None for unlimited)
    """
    # Lazy-import Google libs so manage.py check won't crash if deps not installed
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from google.auth.transport.requests import Request
    except Exception:
        return None, (
            "Google API client not installed. "
            "Run: pip install google-api-python-client google-auth google-auth-httplib2 google-auth-oauthlib"
        )

    tok = (
        SocialToken.objects
        .filter(account=acc)
        .order_by("-id")
        .first()
    )
    if not tok:
        return None, "No OAuth token stored for this account."

    try:
        app = SocialApp.objects.get(provider="google")
        client_id, client_secret = app.client_id, app.secret
    except SocialApp.DoesNotExist:
        return None, "Google SocialApp not configured for this site."

    try:
        # allauth stores refresh_token in token_secret for OAuth2
        creds = Credentials(
            token=tok.token,
            refresh_token=tok.token_secret,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=[
                "https://www.googleapis.com/auth/drive.metadata.readonly",
                "openid", "email", "profile",
            ],
        )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            if creds.token and creds.token != tok.token:
                tok.token = creds.token
                tok.save(update_fields=["token"])

        service = build("drive", "v3", credentials=creds)
        about = service.about().get(fields="storageQuota").execute()
        sq = about.get("storageQuota", {})

        usage_b = int(sq.get("usage", 0))
        limit_b = int(sq.get("limit", 0)) or None  # None ⇒ unlimited
        remaining_b = (limit_b - usage_b) if limit_b else None

        quota = {
            "usage": _humanize_bytes(usage_b),
            "limit": _humanize_bytes(limit_b) if limit_b else "unlimited",
            "remaining": _humanize_bytes(remaining_b) if remaining_b is not None else None,
        }
        # add raw bytes for aggregation
        quota["quota_raw"] = {
            "usage": usage_b,
            "limit": limit_b,
            "remaining": remaining_b,
        }

        return quota, None
    except Exception as e:
        return None, str(e)


@login_required
def dashboard(request):
    """
    Build the `items` list your dashboard template expects and also compute
    the cross-account totals for the big donut.
    """
    accounts = (
        SocialAccount.objects
        .filter(user=request.user, provider="google")
        .select_related("user")
    )

    items = []
    for acc in accounts:
        quota, error = _build_drive_quota_for_account(acc)
        items.append({"account": acc, "quota": quota, "error": error})

    # ---- Aggregate totals across accounts ----
    # Sum used; sum limits only if *all* are finite. If any unlimited, overall is unlimited.
    used_sum = 0
    all_finite = True
    limit_sum = 0

    for it in items:
        q = (it.get("quota") or {}).get("quota_raw")
        if not q:
            # If we can't read this account, skip it for totals
            continue
        used_sum += int(q.get("usage") or 0)
        limit_v = q.get("limit")
        if limit_v is None:
            all_finite = False
        else:
            limit_sum += int(limit_v)

    total_limit_b = limit_sum if (items and all_finite) else None
    total_used_b = used_sum
    total_avail_b = (total_limit_b - total_used_b) if total_limit_b is not None else None

    total = {
        "used_bytes": total_used_b,
        "limit_bytes": total_limit_b,            # None ⇒ unlimited
        "avail_bytes": total_avail_b,            # None if unlimited
        "used_h": _humanize_bytes(total_used_b),
        "limit_h": _humanize_bytes(total_limit_b) if total_limit_b is not None else "unlimited",
        "avail_h": _humanize_bytes(total_avail_b) if total_avail_b is not None else None,
        "pct_used": (int(round((total_used_b / total_limit_b) * 100)) if total_limit_b else None),
    }

    return render(request, "dashboard.html", {"items": items, "total": total})
