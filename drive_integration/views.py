from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
from django.conf import settings
import json, requests, hashlib
from datetime import timedelta
from django.utils.timezone import now
from allauth.socialaccount.models import SocialAccount, SocialToken
from core.google_api import _refresh_access_token, get_storage_quota
from .models import DriveFileManifest
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

# --------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------
def _get_google_token_for(request, account_id=None):
    try:
        if account_id:
            sa = SocialAccount.objects.get(id=account_id, user=request.user, provider="google")
        else:
            sa = SocialAccount.objects.filter(user=request.user, provider="google").first()
            if not sa:
                raise SocialAccount.DoesNotExist
    except SocialAccount.DoesNotExist:
        return None, JsonResponse({"error": "Google account not found."}, status=404)

    token_obj = SocialToken.objects.filter(account=sa).first()
    if not token_obj:
        return None, JsonResponse({"error": "No token for this account."}, status=401)

    if token_obj.expires_at and token_obj.expires_at <= now() + timedelta(seconds=60):
        try:
            token_obj = _refresh_access_token(token_obj)
        except Exception as e:
            return None, JsonResponse({"error": f"Token refresh failed: {e}"}, status=401)

    return token_obj.token, None


# --------------------------------------------------------------------
# View: Upload page with Drive quotas
# --------------------------------------------------------------------
@login_required
def uploads_view(request):
    accounts = (
        SocialAccount.objects.filter(user=request.user, provider="google")
        .select_related("user")
        [: settings.MAX_DRIVE_ACCOUNTS]
    )

    account_data = []
    for acc in accounts:
        quota = {}
        try:
            quota = get_storage_quota(acc) or {}
        except Exception:
            quota = {"remaining": "N/A"}
        account_data.append({
            "id": acc.id,
            "email": acc.extra_data.get("email", acc.uid),
            "remaining": quota.get("remaining", "N/A"),
        })

    return render(
        request,
        "drive_integration/uploads.html",
        {
            "google_accounts": account_data,
            "max_accounts": settings.MAX_DRIVE_ACCOUNTS,
        },
    )


# --------------------------------------------------------------------
# API: Create resumable upload session per chunk/account
# --------------------------------------------------------------------
@login_required
def create_upload_session(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    file_name = data.get("file_name")
    mime_type = data.get("mime_type", "application/octet-stream")
    account_id = data.get("account_id")
    chunk_index = data.get("chunk_index")

    if not all([file_name, account_id]):
        return JsonResponse({"error": "Missing file_name or account_id"}, status=400)

    access_token, err = _get_google_token_for(request, account_id)
    if err:
        return err

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type,
    }
    name = f"{file_name}.part.{str(chunk_index).zfill(4)}"
    body = {"name": name}

    try:
        resp = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
            headers=headers,
            data=json.dumps(body),
            timeout=30,
        )
    except Exception as e:
        return JsonResponse({"error": f"Network error: {e}"}, status=500)

    if resp.status_code not in (200, 201):
        return JsonResponse(
            {"error": f"Drive API error {resp.status_code}", "details": resp.text[:500]},
            status=resp.status_code,
        )

    upload_url = resp.headers.get("Location")
    return JsonResponse({"upload_url": upload_url})


# --------------------------------------------------------------------
# API: Proxy chunk upload
# --------------------------------------------------------------------


@csrf_exempt
@login_required
def proxy_resumable_chunk(request):
    """
    Handles raw binary uploads safely under runserver.
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)

    upload_url = request.GET.get("upload_url")
    account_id = request.GET.get("account_id")
    start = request.GET.get("start")
    end = request.GET.get("end")
    total = request.GET.get("total")
    mime = request.GET.get("mime", "application/octet-stream")

    if not (upload_url and account_id and start is not None and end is not None):
        return JsonResponse({"error": "Missing upload_url/account_id/start/end"}, status=400)

    try:
        start_i, end_i = int(start), int(end)
    except ValueError:
        return JsonResponse({"error": "start/end must be integers"}, status=400)

    # Read raw binary body safely
    chunk_bytes = request.META["wsgi.input"].read()
    if not chunk_bytes:
        return JsonResponse({"error": "Empty chunk body"}, status=400)

    # Compute size
    length = end_i - start_i + 1
    if len(chunk_bytes) != length:
        print(f"[WARN] Body size {len(chunk_bytes)} != expected {length}")

    access_token, err = _get_google_token_for(request, account_id)
    if err:
        return err

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": mime,
        "Content-Range": f"bytes 0-{len(chunk_bytes)-1}/{len(chunk_bytes)}",
    }

    try:
        gresp = requests.put(upload_url, headers=headers, data=chunk_bytes, timeout=120)
    except Exception as e:
        return JsonResponse({"error": f"Network error: {e}"}, status=500)

    return HttpResponse(
        gresp.content,
        status=gresp.status_code,
        content_type=gresp.headers.get("Content-Type", "text/plain"),
    )



# --------------------------------------------------------------------
# API: Save manifest after upload
# --------------------------------------------------------------------
@login_required
def save_manifest(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    manifest = DriveFileManifest.objects.create(
        user=request.user,
        file_name=data.get("file_name"),
        total_size=data.get("total_size", 0),
        chunk_size=data.get("chunk_size", 0),
        total_chunks=data.get("total_chunks", 0),
        manifest_data=data.get("chunks", []),
    )
    return JsonResponse({"message": "Manifest saved", "id": manifest.id})
