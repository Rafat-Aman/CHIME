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
// MAIN UPLOAD FUNCTION
// ------------------------------
async function uploadFile(file, chunkSizeMB, sessionUrlEndpoint) {
  if (!file) {
    alert("Select a file first.");
    return;
  }

  // 1) CREATE UPLOAD SESSION (Django endpoint)
  let res = await fetch(sessionUrlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCSRFToken(),
    },
    body: JSON.stringify({
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
    }),
  });

  if (!res.ok) {
    try {
      const err = await res.json();
      alert(`Failed to create upload session:\n${err.error || res.status}\n${err.details || ""}`);
    } catch (e) {
      const text = await res.text();
      alert(`Failed to create upload session: ${res.status}\n${text}`);
    }
    return;
  }

  const { upload_url: uploadUrl } = await res.json();
  if (!uploadUrl) {
    alert("Upload URL missing. Server error.");
    return;
  }

  // 2) CHUNK UPLOAD (via server proxy to avoid browser CORS)
  const chunkSize = Math.max(1, Number(chunkSizeMB) || 5) * 1024 * 1024; // MB -> bytes
  let uploaded = 0;

  while (uploaded < file.size) {
    const end = Math.min(uploaded + chunkSize, file.size);
    const chunk = file.slice(uploaded, end);

    // Send to our proxy; it will PUT to Google
    const qs = new URLSearchParams({
      upload_url: uploadUrl,
      start: String(uploaded),
      end: String(end - 1),
      total: String(file.size),
      mime: file.type || "application/octet-stream",
    });

    const response = await fetch(`/drive_integration/proxy-chunk/?${qs.toString()}`, {
      method: "POST",
      headers: {
        "X-CSRFToken": getCSRFToken(),
        // Content-Type will be auto-set for binary body; do not override
      },
      body: chunk,
    });

    if (response.status === 308) {
      uploaded = end;
      updateProgress((uploaded / file.size) * 100);
      continue;
    }

    if (response.status === 200 || response.status === 201) {
      updateProgress(100);
      alert("Upload finished!");
      return;
    }

    const bodyText = await response.text();
    alert(`Upload failed: ${response.status}\n${bodyText}`);
    return;
  }
}

// expose for inline handlers
window.uploadFile = uploadFile;
