# core/google_api.py
from __future__ import annotations
import requests
from typing import Dict, Optional
from allauth.socialaccount.models import SocialApp, SocialToken, SocialAccount
from django.conf import settings
from django.utils.timezone import now

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=storageQuota"

class GoogleAPIError(Exception):
    pass

def _get_social_app() -> SocialApp:
    # Use the Sites framework to find the active SocialApp
    app = SocialApp.objects.filter(provider="google", sites__id=settings.SITE_ID).first()
    if not app:
        raise GoogleAPIError("Google SocialApp not configured in admin.")
    return app

def _refresh_access_token(token_obj: SocialToken) -> SocialToken:
    """
    Refresh an expired/invalid access token using the refresh token stored by allauth.
    allauth stores refresh token in token_obj.token_secret for Google.
    """
    app = _get_social_app()
    refresh_token = token_obj.token_secret
    if not refresh_token:
        raise GoogleAPIError("No refresh token available for this Google account.")

    data = {
        "client_id": app.client_id,
        "client_secret": app.secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    resp = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=20)
    if resp.status_code != 200:
        raise GoogleAPIError(f"Failed to refresh token: {resp.status_code} {resp.text}")

    payload = resp.json()
    access_token = payload.get("access_token")
    expires_in = payload.get("expires_in")

    if not access_token:
        raise GoogleAPIError(f"Refresh response missing access_token: {payload}")

    # Save new access token and (if provided) new refresh token
    token_obj.token = access_token
    new_refresh = payload.get("refresh_token")
    if new_refresh:
        token_obj.token_secret = new_refresh
    if expires_in:
        # allauth’s SocialToken has expires_at; saving None is okay too
        token_obj.expires_at = now() + settings.timedelta(seconds=int(expires_in)) if hasattr(settings, "timedelta") else token_obj.expires_at
        # we don’t strictly need to compute expires_at; access token will work until 401 anyway
    token_obj.save()
    return token_obj

def _authorized_get(access_token: str, url: str) -> requests.Response:
    headers = {"Authorization": f"Bearer {access_token}"}
    return requests.get(url, headers=headers, timeout=20)

def get_storage_quota(sa: SocialAccount) -> Optional[Dict[str, str]]:
    """
    Returns a dict like:
      {"limit": "15.0 GB", "usage": "4.2 GB", "remaining": "10.8 GB"}
    or None if not available.
    """
    try:
        token_obj = SocialToken.objects.get(account=sa)
    except SocialToken.DoesNotExist:
        raise GoogleAPIError("No token found for this Google account.")

    # Try with current token
    resp = _authorized_get(token_obj.token, DRIVE_ABOUT_URL)

    # If unauthorized, try refreshing
    if resp.status_code == 401:
        token_obj = _refresh_access_token(token_obj)
        resp = _authorized_get(token_obj.token, DRIVE_ABOUT_URL)

    if resp.status_code != 200:
        raise GoogleAPIError(f"Drive API error: {resp.status_code} {resp.text}")

    data = resp.json()
    quota = data.get("storageQuota") or {}
    # Fields may be strings of integers (bytes). Convert to human readable.
    def _fmt(b: Optional[str]) -> Optional[str]:
        try:
            v = int(b)
        except Exception:
            return None
        # Format as GB with 1 decimal
        gb = v / (1024**3)
        return f"{gb:.1f} GB"

    limit = quota.get("limit")           # total alloc
    usage = quota.get("usage")           # total used
    # Some accounts can return "0" or omit limit (unlimited); handle gracefully
    limit_gb = _fmt(limit) if limit and limit != "0" else None
    usage_gb = _fmt(usage) if usage else None

    remaining_gb = None
    if limit and limit != "0" and usage:
        try:
            remaining_gb = f"{(int(limit) - int(usage)) / (1024**3):.1f} GB"
        except Exception:
            remaining_gb = None

    return {
        "limit": limit_gb or "Unlimited",
        "usage": usage_gb or (quota.get("usage") or "N/A"),
        "remaining": remaining_gb or ("N/A" if limit_gb is None else remaining_gb),
    }
