// ------------------------------
// CSRF TOKEN HELPER
// ------------------------------
function getCSRFToken() {
  const name = "csrftoken=";
  const decoded = decodeURIComponent(document.cookie).split(";");
  for (let c of decoded) {
    let s = c.trim();
    if (s.startsWith(name)) {
      return s.substring(name.length);
    }
  }
  return "";
}

// ------------------------------
// PROGRESS BAR HELPER
// ------------------------------
function updateProgress(percent) {
  const bar = document.getElementById("bar");
  if (bar) bar.style.width = percent + "%";
}

// ------------------------------
// Create upload session for specific account
// ------------------------------
async function createSessionForAccount(fileName, mimeType, accountId) {
  const res = await fetch("{% url 'create_upload_session' %}".replace(/%7B%7D/,""), { // placeholder; will be replaced by server-side url tag in template
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCSRFToken(),
    },
    body: JSON.stringify({
      file_name: fileName,
      mime_type: mimeType,
      account_id: accountId
    }),
  });

  if (!res.ok) {
    let text = await res.text();
    try {
      const e = await res.json();
      throw new Error(JSON.stringify(e));
    } catch (e) {
      throw new Error(`Failed to create upload session: ${res.status}\n${text}`);
    }
  }

  const data = await res.json();
  return data.upload_url;
}

// ------------------------------
// Upload helper: chunk and POST to proxy which will PUT to Google
// ------------------------------
async function uploadChunkedToUrl(file, chunkSizeMB, uploadUrl, accountId) {
  const chunkSize = Math.max(1, Number(chunkSizeMB) || 5) * 1024 * 1024;
  let uploaded = 0;

  updateProgress(0);

  while (uploaded < file.size) {
    const end = Math.min(uploaded + chunkSize, file.size);
    const chunk = file.slice(uploaded, end);

    const qs = new URLSearchParams({
      upload_url: uploadUrl,
      start: String(uploaded),
      end: String(end - 1),
      total: String(file.size),
      mime: file.type || "application/octet-stream",
      account_id: String(accountId),
    });

    const response = await fetch(`/drive_integration/proxy-chunk/?${qs.toString()}`, {
      method: "POST",
      headers: {
        "X-CSRFToken": getCSRFToken(),
      },
      body: chunk,
    });

    // Google responds with 308 (resume), or 200/201 when done
    if (response.status === 308) {
      uploaded = end;
      updateProgress((uploaded / file.size) * 100);
      continue;
    }

    if (response.status === 200 || response.status === 201) {
      updateProgress(100);
      return;
    }

    const bodyText = await response.text();
    throw new Error(`Upload failed: ${response.status}\n${bodyText}`);
  }
}

// ------------------------------
// Top-level: create session and upload for a specific account
// ------------------------------
async function uploadToAccount(file, chunkSizeMB, accountId) {
  if (!file) {
    throw new Error("No file selected");
  }

  // Obtain a resumable upload URL for this specific account:
  const uploadUrl = await (async () => {
    // We cannot use Django template tags here because this file is static.
    // We'll request the create-upload-session endpoint by path.
    const res = await fetch("/drive_integration/create-upload-session/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCSRFToken(),
      },
      body: JSON.stringify({
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        account_id: accountId
      }),
    });

    if (!res.ok) {
      let text = await res.text();
      try {
        const e = await res.json();
        throw new Error(JSON.stringify(e));
      } catch (e) {
        throw new Error(`Failed to create upload session: ${res.status}\n${text}`);
      }
    }

    const data = await res.json();
    return data.upload_url;
  })();

  if (!uploadUrl) {
    throw new Error("No upload URL returned from server.");
  }

  // Now upload chunked via proxy endpoint (which will use account_id to select token)
  await uploadChunkedToUrl(file, chunkSizeMB, uploadUrl, accountId);
}

// expose functions for inline usage in the template
window.uploadToAccount = uploadToAccount;
window.updateProgress = updateProgress;
