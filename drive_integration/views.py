from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
import json
import requests
from datetime import timedelta
from django.utils.timezone import now
from allauth.socialaccount.models import SocialAccount, SocialToken
from core.google_api import _refresh_access_token

# ---------- Helpers shared by both endpoints ----------

def _get_google_token_for(request, account_id=None):
    """
    Return a fresh access token (refreshing if needed) for the given SocialAccount.
    If account_id is None, try to pick the first google account for the user.
    Returns (access_token: str, None) on success, or (None, JsonResponse) on error.
    """
    try:
        if account_id:
            social_account = SocialAccount.objects.get(id=account_id, user=request.user, provider='google')
        else:
            social_account = SocialAccount.objects.filter(user=request.user, provider='google').first()
            if not social_account:
                raise SocialAccount.DoesNotExist
    except SocialAccount.DoesNotExist:
        return None, JsonResponse({
            "error": "Google account not linked to this user. Please connect Google.",
            "redirect_url": "/accounts/google/login/",
        }, status=401)

    token_obj = SocialToken.objects.filter(account=social_account).first()
    if not token_obj:
        return None, JsonResponse({
            "error": "No Google token found for this account. Reconnect Google (need offline access).",
            "hint": "Revoke the app in your Google Account permissions, then sign in again.",
        }, status=401)

    # Some allauth versions lack .is_expired(); compute locally
    def _token_is_expired(tok: SocialToken) -> bool:
        if not tok.expires_at:
            return False
        return tok.expires_at <= now() + timedelta(seconds=60)

    if _token_is_expired(token_obj):
        try:
            token_obj = _refresh_access_token(token_obj)
        except Exception as e:
            return None, JsonResponse({
                "error": "Failed to refresh Google token. Please log in again.",
                "details": str(e),
                "redirect_url": "/accounts/google/login/",
            }, status=401)

    return token_obj.token, None


# ---------- 1) Create a resumable upload session ----------

@login_required
def create_upload_session(request):
    """
    POST JSON:
      { "file_name": "...", "mime_type": "...", "account_id": <id> }
    Returns:
      { "upload_url": "https://www.googleapis.com/..." }
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    file_name = data.get("file_name")
    mime_type = data.get("mime_type", "application/octet-stream")
    account_id = data.get("account_id")  # required for multi-account uploads

    if not file_name:
        return JsonResponse({"error": "file_name is required"}, status=400)
    if not account_id:
        return JsonResponse({"error": "account_id is required"}, status=400)

    access_token, error_resp = _get_google_token_for(request, account_id=account_id)
    if error_resp:
        return error_resp

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type,
    }
    body = {"name": file_name}

    resp = requests.post(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
        headers=headers,
        data=json.dumps(body),
        timeout=30,
    )

    # If unauthorized, try one-time refresh & retry
    if resp.status_code == 401:
        access_token, error_resp = _get_google_token_for(request, account_id=account_id)
        if error_resp:
            return error_resp
        headers["Authorization"] = f"Bearer {access_token}"
        resp = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
            headers=headers,
            data=json.dumps(body),
            timeout=30,
        )

    if resp.status_code not in (200, 201):
        return JsonResponse({
            "error": f"Google Drive API error: {resp.status_code}",
            "details": resp.text,
        }, status=500)

    upload_url = resp.headers.get("Location")
    if not upload_url:
        return JsonResponse({"error": "No upload URL returned from Google Drive."}, status=500)

    return JsonResponse({"upload_url": upload_url})


# ---------- 2) Proxy a chunk PUT to Google (avoids browser CORS) ----------

@login_required
def proxy_resumable_chunk(request):
    """
    Browser calls:
      POST /drive_integration/proxy-chunk/?upload_url=<...>&start=0&end=524287&total=1234567&mime=video/mp4&account_id=123
      Body = raw binary (the chunk)
    We forward it to Google with a PUT and return status+body.
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)

    account_id = request.GET.get("account_id")
    upload_url = request.GET.get("upload_url")
    start = request.GET.get("start")
    end = request.GET.get("end")
    total = request.GET.get("total")
    mime = request.GET.get("mime", "application/octet-stream")

    if not (upload_url and start is not None and end is not None and total is not None and account_id):
        return JsonResponse({"error": "Missing upload_url/start/end/total/account_id"}, status=400)

    try:
        start_i = int(start)
        end_i = int(end)
        total_i = int(total)
    except ValueError:
        return JsonResponse({"error": "start/end/total must be integers"}, status=400)

    access_token, error_resp = _get_google_token_for(request, account_id=account_id)
    if error_resp:
        return error_resp

    chunk_bytes = request.body or b""
    expected = end_i - start_i + 1
    if len(chunk_bytes) != expected:
        return JsonResponse({
            "error": "Chunk length mismatch",
            "details": f"received={len(chunk_bytes)} expected={expected}"
        }, status=400)

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": mime,
        "Content-Range": f"bytes {start_i}-{end_i}/{total_i}",
    }

    gresp = requests.put(upload_url, headers=headers, data=chunk_bytes, timeout=120)

    return HttpResponse(gresp.content, status=gresp.status_code, content_type=gresp.headers.get("Content-Type", "text/plain"))


# ---------- 3) Page view (renders accounts as checkboxes) ----------

@login_required
def uploads_view(request):
    # get all google social accounts for the logged-in user
    accounts = SocialAccount.objects.filter(user=request.user, provider='google')
    # pass accounts to the template; account.extra_data likely has email
    return render(request, 'drive_integration/uploads.html', {"google_accounts": accounts})
