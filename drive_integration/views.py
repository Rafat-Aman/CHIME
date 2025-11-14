import json
import requests
from datetime import timedelta
from django.utils.timezone import now
from django.conf import settings
from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from allauth.socialaccount.models import SocialAccount, SocialToken

from .models import DriveManifest
from core.google_api import _refresh_access_token, get_storage_quota

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

    # refresh if it is about to expire
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
        [: getattr(settings, "MAX_DRIVE_ACCOUNTS", 5)]
    )

    account_data = []
    for acc in accounts:
        quota = {}
        try:
            q = get_storage_quota(acc) or {}
            # Expect get_storage_quota to return {"remaining": "X MB" or "Y GB"}
            remaining = q.get("remaining", "0 MB")
        except Exception:
            remaining = "0 MB"
        account_data.append({
            "id": acc.id,
            "email": acc.extra_data.get("email", acc.uid),
            "remaining": remaining,
        })

    return render(
        request,
        "drive_integration/uploads.html",
        {
            "google_accounts": account_data,
            "max_accounts": getattr(settings, "MAX_DRIVE_ACCOUNTS", 5),
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
    chunk_index = data.get("chunk_index", 0)

    if not all([file_name, account_id is not None]):
        return JsonResponse({"error": "Missing file_name or account_id"}, status=400)

    access_token, err = _get_google_token_for(request, account_id)
    if err:
        return err

    # use name pattern so chunks are identifiable
    name = f"{file_name}.part.{str(chunk_index).zfill(4)}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type,
    }
    # include fields=id so final PUT returns file id as JSON
    url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id"
    body = {"name": name}

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=30)
    except Exception as e:
        return JsonResponse({"error": f"Network error: {e}"}, status=500)

    if resp.status_code not in (200, 201):
        return JsonResponse({"error": f"Drive API error {resp.status_code}", "details": resp.text[:500]}, status=resp.status_code)

    upload_url = resp.headers.get("Location")
    if not upload_url:
        return JsonResponse({"error": "No upload URL returned from Drive."}, status=500)

    return JsonResponse({"upload_url": upload_url})


# --------------------------------------------------------------------
# API: Proxy chunk upload (raw body) — allow large body via wsgi.input read
# --------------------------------------------------------------------
@csrf_exempt
@login_required
def proxy_resumable_chunk(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)

    upload_url = request.GET.get("upload_url")
    account_id = request.GET.get("account_id")
    start = request.GET.get("start")
    end = request.GET.get("end")
    mime = request.GET.get("mime", "application/octet-stream")

    if not (upload_url and account_id and start is not None and end is not None):
        return JsonResponse({"error": "Missing required params"}, status=400)

    try:
        start_i = int(start)
        end_i = int(end)
    except ValueError:
        return JsonResponse({"error": "start/end must be integers"}, status=400)

    # Read raw body
    body_bytes = request.META.get("wsgi.input").read()
    if not body_bytes:
        return JsonResponse({"error": "Empty body"}, status=400)

    access_token, err = _get_google_token_for(request, account_id)
    if err:
        return err

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": mime,
        # chunk uploaded as independent file: 0-(len-1)/len
        "Content-Range": f"bytes 0-{len(body_bytes)-1}/{len(body_bytes)}",
    }

    try:
        gresp = requests.put(upload_url, headers=headers, data=body_bytes, timeout=120)
    except Exception as e:
        return JsonResponse({"error": f"Network error: {e}"}, status=500)

    content_type = gresp.headers.get("Content-Type", "text/plain")
    return HttpResponse(gresp.content, status=gresp.status_code, content_type=content_type)


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

    required = ["file_name", "total_size", "chunk_size", "total_chunks", "chunks"]
    if not all(k in data for k in required):
        return JsonResponse({"error": "Missing manifest fields"}, status=400)

    manifest = DriveManifest.objects.create(
        user=request.user,
        file_name=data.get("file_name"),
        total_size=int(data.get("total_size", 0)),
        chunk_size=int(data.get("chunk_size", 0)),
        total_chunks=int(data.get("total_chunks", 0)),
        manifest_data=data.get("chunks", []),
    )
    return JsonResponse({"message": "Manifest saved", "id": manifest.id})


# --------------------------------------------------------------------
# View: Downloads page showing saved manifests
# --------------------------------------------------------------------
@login_required
def downloads_view(request):
    manifests = []
    qs = DriveManifest.objects.filter(user=request.user).order_by("-created_at")
    for manifest in qs:
        manifests.append({
            "id": manifest.id,
            "file_name": manifest.file_name,
            "mime_type": getattr(manifest, "mime_type", None),
            "total_size": manifest.total_size,
            "chunk_size": manifest.chunk_size,
            "total_chunks": manifest.total_chunks,
            "created_at": manifest.created_at.isoformat(),
            "chunks": manifest.manifest_data or [],
        })

    return render(
        request,
        "drive_integration/downloads.html",
        {"manifests": manifests},
    )


# --------------------------------------------------------------------
# API: Download an individual chunk and proxy it back to the client
# --------------------------------------------------------------------
@login_required
def download_chunk(request):
    if request.method != "GET":
        return JsonResponse({"error": "GET only"}, status=405)

    manifest_id = request.GET.get("manifest_id")
    chunk_index = request.GET.get("chunk_index")

    if manifest_id is None or chunk_index is None:
        return JsonResponse({"error": "manifest_id and chunk_index are required"}, status=400)

    try:
        chunk_index = int(chunk_index)
    except ValueError:
        return JsonResponse({"error": "chunk_index must be an integer"}, status=400)

    manifest = get_object_or_404(DriveManifest, id=manifest_id, user=request.user)
    chunk = next((c for c in (manifest.manifest_data or []) if c.get("index") == chunk_index), None)
    if not chunk:
        return JsonResponse({"error": "Chunk not found"}, status=404)

    account_id = chunk.get("account_id")
    drive_file_id = chunk.get("drive_file_id")
    if account_id is None or not drive_file_id:
        return JsonResponse({"error": "Chunk metadata incomplete"}, status=400)

    access_token, err = _get_google_token_for(request, account_id)
    if err:
        return err

    url = f"https://www.googleapis.com/drive/v3/files/{drive_file_id}?alt=media"
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = requests.get(url, headers=headers, timeout=120)
    except Exception as e:
        return JsonResponse({"error": f"Network error: {e}"}, status=500)

    if resp.status_code != 200:
        return JsonResponse({"error": "Drive download failed", "details": resp.text[:200]}, status=resp.status_code)

    content_type = resp.headers.get("Content-Type", "application/octet-stream")
    response = HttpResponse(resp.content, content_type=content_type)
    response["Content-Length"] = str(len(resp.content))
    return response
