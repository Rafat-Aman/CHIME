function csrf() {
  const name = "csrftoken=";
  for (const cookie of document.cookie.split(";")) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(name)) {
      return trimmed.slice(name.length);
    }
  }
  return "";
}

const formatBytes = bytes => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatDate = iso => {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

let manifestListEl = null;
let emptyStateEl = null;

function handleEmptyState() {
  if (!manifestListEl || !emptyStateEl) return;
  const hasCards = manifestListEl.querySelector(".manifest-card");
  if (hasCards) {
    manifestListEl.classList.remove("hidden");
    emptyStateEl.classList.add("hidden");
  } else {
    manifestListEl.classList.add("hidden");
    emptyStateEl.classList.remove("hidden");
  }
}

function renderManifestCard(manifest) {
  const card = document.createElement("div");
  card.className = "manifest-card";

  const title = document.createElement("h2");
  title.textContent = manifest.file_name;
  card.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "manifest-meta";

  const size = document.createElement("div");
  size.textContent = `Size: ${formatBytes(manifest.total_size)}`;
  meta.appendChild(size);

  const chunks = document.createElement("div");
  chunks.textContent = `Chunks: ${manifest.total_chunks}`;
  meta.appendChild(chunks);

  const created = document.createElement("div");
  created.textContent = `Uploaded: ${formatDate(manifest.created_at)}`;
  meta.appendChild(created);

  card.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "manifest-actions";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.textContent = "Download";
  actions.appendChild(downloadBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.classList.add("delete");
  actions.appendChild(deleteBtn);

  const progressTrack = document.createElement("div");
  progressTrack.className = "progress-track";

  const progressFill = document.createElement("div");
  progressFill.className = "progress-fill";
  progressTrack.appendChild(progressFill);
  actions.appendChild(progressTrack);

  const status = document.createElement("span");
  status.className = "status-text";
  status.textContent = "Idle";
  actions.appendChild(status);

  downloadBtn.addEventListener("click", () => {
    downloadManifest(manifest, { button: downloadBtn, progressFill, status });
  });

  deleteBtn.addEventListener("click", () => {
    deleteManifest(manifest, {
      card,
      status,
      buttons: [downloadBtn, deleteBtn],
    });
  });

  card.appendChild(actions);
  return card;
}

async function downloadManifest(manifest, ui) {
  if (!manifest.chunks || !manifest.chunks.length) {
    ui.status.textContent = "No chunks recorded for this file.";
    return;
  }

  const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);
  let downloadedBytes = 0;
  const totalBytes = manifest.total_size || 0;
  const blobParts = [];

  ui.button.disabled = true;
  ui.progressFill.style.width = "0%";
  ui.status.textContent = "Starting download...";

  try {
    for (let i = 0; i < sortedChunks.length; i += 1) {
      const chunk = sortedChunks[i];
      ui.status.textContent = `Fetching chunk ${i + 1} of ${sortedChunks.length}`;

      const params = new URLSearchParams({
        manifest_id: manifest.id,
        chunk_index: chunk.index,
      });

      const res = await fetch(`${DOWNLOAD_CHUNK_URL}?${params.toString()}`, {
        headers: { "X-CSRFToken": csrf() },
      });

      if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`Chunk request failed: ${errTxt || res.status}`);
      }

      const buffer = await res.arrayBuffer();
      blobParts.push(buffer);
      downloadedBytes += buffer.byteLength;

      const percent = totalBytes
        ? Math.min(100, (downloadedBytes / totalBytes) * 100)
        : ((i + 1) / sortedChunks.length) * 100;
      ui.progressFill.style.width = `${percent}%`;
    }

    ui.status.textContent = "Merging chunks...";
    const mimeType = manifest.mime_type || "application/octet-stream";
    const blob = new Blob(blobParts, { type: mimeType });
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = manifest.file_name || "download.bin";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    ui.progressFill.style.width = "100%";
    ui.status.textContent = "Download ready.";
  } catch (error) {
    console.error(error);
    ui.status.textContent = `Failed: ${error.message}`;
  } finally {
    ui.button.disabled = false;
  }
}

async function deleteManifest(manifest, ui) {
  const confirmed = window.confirm(`Delete "${manifest.file_name}" and all Drive chunks?`);
  if (!confirmed) return;

  ui.buttons.forEach(btn => {
    // eslint-disable-next-line no-param-reassign
    btn.disabled = true;
  });
  ui.status.textContent = "Deleting...";

  try {
    const res = await fetch(DELETE_MANIFEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrf(),
      },
      body: JSON.stringify({ manifest_id: manifest.id }),
    });

    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(errTxt || "Delete failed");
    }

    ui.status.textContent = "Deleted.";
    ui.card.remove();
    handleEmptyState();
  } catch (error) {
    console.error(error);
    ui.status.textContent = `Delete failed: ${error.message}`;
    ui.buttons.forEach(btn => {
      // eslint-disable-next-line no-param-reassign
      btn.disabled = false;
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const script = document.getElementById("manifest-data");
  const manifests = script ? JSON.parse(script.textContent) : [];
  manifestListEl = document.getElementById("manifestList");
  emptyStateEl = document.getElementById("emptyState");

  if (!manifests.length) {
    handleEmptyState();
    return;
  }

  manifestListEl.classList.remove("hidden");
  emptyStateEl.classList.add("hidden");
  manifests.forEach(manifest => {
    manifestListEl.appendChild(renderManifestCard(manifest));
  });
});
