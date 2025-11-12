from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
import json
import requests
from datetime import timedelta
from django.utils.timezone import now
from allauth.socialaccount.models import SocialAccount, SocialToken
from core.google_api import _refresh_access_token


# ----------------------------------------------------------------
# Helper: get or refresh a Google access token for a specific account
# ----------------------------------------------------------------
def _get_google_token_for(request, account_id=None):
    try:
        if account_id:
            social_account = SocialAccount.objects.get(id=account_id, user=request.user, provider="google")
        else:
            social_account = SocialAccount.objects.filter(user=request.user, provider="google").first()
            if not social_account:
                raise SocialAccount.DoesNotExist
    except SocialAccount.DoesNotExist:
        return None, JsonResponse({
            "error": "No linked Google account found for this user.",
            "redirect_url": "/accounts/google/login/",
        }, status=401)

    token_obj = SocialToken.objects.filter(account=social_account).first()
    if not token_obj:
        return None, JsonResponse({
            "error": "Google token missing. Please reconnect Google Drive access."
        }, status=401)

    # Token expiry check
    def _expired(t):
        if not t.expires_at:
            return False
        return t.expires_at <= now() + timedelta(seconds=60)

    if _expired(token_obj):
        try:
            token_obj = _refresh_access_token(token_obj)
        except Exception as e:
            return None, JsonResponse({
                "error": "Failed to refresh token.",
                "details": str(e)
            }, status=401)

    return token_obj.token, None


# ----------------------------------------------------------------
# Create a resumable Google Drive upload session
# ----------------------------------------------------------------
@login_required
def create_upload_session(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    file_name = data.get("file_name")
    mime_type = data.get("mime_type", "application/octet-stream")
    account_id = data.get("account_id")

    if not (file_name and account_id):
        return JsonResponse({"error": "file_name and account_id are required."}, status=400)

    access_token, error_resp = _get_google_token_for(request, account_id)
    if error_resp:
        return error_resp

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type,
    }

    body = {"name": file_name}

    try:
        resp = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
            headers=headers,
            data=json.dumps(body),
            timeout=30,
        )
    except Exception as e:
        return JsonResponse({"error": "Network error creating session.", "details": str(e)}, status=500)

    if resp.status_code not in (200, 201):
        return JsonResponse({
            "error": f"Drive API responded {resp.status_code}",
            "details": resp.text[:500],
        }, status=resp.status_code)

    upload_url = resp.headers.get("Location")
    file_id = None
    try:
        file_id = resp.json().get("id")
    except Exception:
        pass

    if not upload_url:
        return JsonResponse({"error": "No upload URL returned from Drive."}, status=500)

    return JsonResponse({
        "upload_url": upload_url,
        "file_id": file_id,
        "message": "Upload session created."
    })


# ----------------------------------------------------------------
# Proxy chunks (browser → Django → Google)
# ----------------------------------------------------------------
@login_required
def proxy_resumable_chunk(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)

    upload_url = request.GET.get("upload_url")
    account_id = request.GET.get("account_id")
    start, end, total = request.GET.get("start"), request.GET.get("end"), request.GET.get("total")
    mime = request.GET.get("mime", "application/octet-stream")

    if not all([upload_url, account_id, start, end, total]):
        return JsonResponse({"error": "Missing parameters."}, status=400)

    try:
        start, end, total = int(start), int(end), int(total)
    except ValueError:
        return JsonResponse({"error": "start/end/total must be integers."}, status=400)

    access_token, error_resp = _get_google_token_for(request, account_id)
    if error_resp:
        return error_resp

    chunk_bytes = request.body or b""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": mime,
        "Content-Range": f"bytes {start}-{end}/{total}",
    }

    try:
        gresp = requests.put(upload_url, headers=headers, data=chunk_bytes, timeout=120)
    except Exception as e:
        return JsonResponse({"error": "Network error forwarding chunk.", "details": str(e)}, status=500)

    return HttpResponse(
        gresp.content,
        status=gresp.status_code,
        content_type=gresp.headers.get("Content-Type", "text/plain")
    )


# ----------------------------------------------------------------
# Render upload UI with Google accounts
# ----------------------------------------------------------------
@login_required
def uploads_view(request):
    accounts = SocialAccount.objects.filter(user=request.user, provider="google")
    return render(request, "drive_integration/uploads.html", {"google_accounts": accounts})
