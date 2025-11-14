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

async function hashBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

let manifestListEl = null;
let emptyStateEl = null;
let downloadSelectedBtn = null;
let selectAllBtn = null;
let clearSelectedBtn = null;
const manifestControllers = new Map();
const manifestDataMap = new Map();
const selectedManifests = new Set();

function updateBulkDownloadState() {
  if (!downloadSelectedBtn) return;
  downloadSelectedBtn.disabled = selectedManifests.size === 0;
}

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
  updateBulkDownloadState();
}

function renderManifestCard(manifest) {
  const card = document.createElement("div");
  card.className = "manifest-card";

  const header = document.createElement("div");
  header.className = "manifest-header";

  const selectBox = document.createElement("input");
  selectBox.type = "checkbox";
  selectBox.className = "manifest-select";
  selectBox.addEventListener("change", e => {
    if (e.target.checked) {
      selectedManifests.add(manifest.id);
    } else {
      selectedManifests.delete(manifest.id);
    }
    updateBulkDownloadState();
  });

  const title = document.createElement("h2");
  title.textContent = manifest.file_name;

  header.appendChild(selectBox);
  header.appendChild(title);
  card.appendChild(header);

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

  const checksumMeta = document.createElement("div");
  checksumMeta.textContent = `File hash: ${manifest.file_checksum || "N/A"}`;
  meta.appendChild(checksumMeta);

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

  const healthBtn = document.createElement("button");
  healthBtn.type = "button";
  healthBtn.textContent = "Check Health";
  healthBtn.classList.add("health");
  actions.appendChild(healthBtn);

  const healthBlock = document.createElement("div");
  healthBlock.className = "health-block hidden";

  const healthSummary = document.createElement("div");
  healthSummary.className = "health-summary";
  healthSummary.textContent = "Run health check to verify chunks.";

  const healthBar = document.createElement("div");
  healthBar.className = "health-bar";
  const healthBarFill = document.createElement("div");
  healthBarFill.className = "health-bar-fill";
  healthBar.appendChild(healthBarFill);

  const healthIssues = document.createElement("div");
  healthIssues.className = "health-issues";
  healthIssues.textContent = "No health data yet.";

  healthBlock.appendChild(healthSummary);
  healthBlock.appendChild(healthBar);
  healthBlock.appendChild(healthIssues);

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
      buttons: [downloadBtn, deleteBtn, healthBtn],
    });
  });

  healthBtn.addEventListener("click", () => {
    checkManifestHealth(manifest, {
      button: healthBtn,
      status,
      block: healthBlock,
      summaryEl: healthSummary,
      barFill: healthBarFill,
      issuesEl: healthIssues,
    });
  });

  card.appendChild(actions);
  card.appendChild(healthBlock);

  manifestControllers.set(manifest.id, {
    card,
    button: downloadBtn,
    progressFill,
    status,
    selectBox,
  });

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

    const expectedFileHash = manifest.file_checksum || "";
    if (expectedFileHash) {
      ui.status.textContent = "Verifying file checksum...";
      let computedHash = "";
      try {
        computedHash = await hashBlob(blob);
      } catch (error) {
        console.error("Final checksum failed", error);
        const force = window.confirm("Unable to verify the merged file checksum. Download anyway?");
        if (!force) {
          ui.status.textContent = "Download cancelled.";
          return;
        }
        ui.status.textContent = "Integrity check skipped. Preparing download...";
      }

      if (computedHash && computedHash !== expectedFileHash) {
        ui.status.textContent = "Checksum mismatch detected.";
        const force = window.confirm("File integrity check failed. Force the download anyway?");
        if (!force) {
          ui.status.textContent = "Download cancelled due to checksum mismatch.";
          return;
        }
        ui.status.textContent = "Forcing download despite checksum mismatch.";
      } else if (computedHash && computedHash === expectedFileHash) {
        ui.status.textContent = "Integrity verified. Preparing download...";
      }
    }

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
    selectedManifests.delete(manifest.id);
    const controller = manifestControllers.get(manifest.id);
    if (controller?.selectBox) controller.selectBox.checked = false;
    manifestControllers.delete(manifest.id);
    manifestDataMap.delete(manifest.id);
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

async function checkManifestHealth(manifest, ui) {
  ui.button.disabled = true;
  ui.block.classList.remove("hidden");
  ui.status.textContent = "Checking health...";
  ui.summaryEl.textContent = "Running integrity checks...";
  ui.barFill.style.width = "0%";
  ui.issuesEl.textContent = "";

  const params = new URLSearchParams({ manifest_id: manifest.id });

  try {
    const res = await fetch(`${MANIFEST_HEALTH_URL}?${params.toString()}`, {
      headers: { "X-CSRFToken": csrf() },
    });

    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(errTxt || "Health check failed");
    }

    const data = await res.json();
    const summary = data.summary || {};
    const ok = summary.ok || 0;
    const total = summary.total || 0;
    const percent = total ? Math.round((ok / total) * 100) : 0;

    ui.barFill.style.width = `${percent}%`;
    ui.summaryEl.textContent = `${ok}/${total} chunks healthy (${percent}%)`;

    const issues = (data.chunks || []).filter(chunk => chunk.status !== "ok");
    if (!issues.length) {
      ui.issuesEl.textContent = "All chunks verified.";
    } else {
      ui.issuesEl.textContent = "";
      issues.forEach(issue => {
        const pill = document.createElement("span");
        pill.className = `chunk-pill ${issue.status || "error"}`;
        const labelMap = {
          missing: "Missing",
          missing_metadata: "Metadata missing",
          mismatch: "Hash mismatch",
          error: "Error",
        };
        const label = labelMap[issue.status] || "Issue";
        const indexLabel = Number.isFinite(issue.index) ? `Chunk ${issue.index}` : "Chunk";
        pill.textContent = `${indexLabel}: ${label}`;
        pill.title = [
          issue.expected_md5 ? `Expected: ${issue.expected_md5}` : null,
          issue.actual_md5 ? `Actual: ${issue.actual_md5}` : null,
          issue.message || null,
        ]
          .filter(Boolean)
          .join("\n");
        ui.issuesEl.appendChild(pill);
      });
    }

    ui.status.textContent = "Health check complete.";
  } catch (error) {
    console.error(error);
    ui.status.textContent = `Health check failed: ${error.message}`;
    ui.summaryEl.textContent = "Unable to compute health.";
    ui.issuesEl.textContent = "Try again later.";
  } finally {
    ui.button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const script = document.getElementById("manifest-data");
  const manifests = script ? JSON.parse(script.textContent) : [];
  manifestListEl = document.getElementById("manifestList");
  emptyStateEl = document.getElementById("emptyState");
  downloadSelectedBtn = document.getElementById("downloadSelected");

  selectAllBtn = document.getElementById("selectAllManifests");
  clearSelectedBtn = document.getElementById("clearSelectedManifests");

  selectAllBtn?.addEventListener("click", () => {
    manifestControllers.forEach((ctrl, id) => {
      if (ctrl.selectBox) {
        ctrl.selectBox.checked = true;
        selectedManifests.add(id);
      }
    });
    updateBulkDownloadState();
  });

  clearSelectedBtn?.addEventListener("click", () => {
    manifestControllers.forEach(ctrl => {
      if (ctrl.selectBox) ctrl.selectBox.checked = false;
    });
    selectedManifests.clear();
    updateBulkDownloadState();
  });

  downloadSelectedBtn?.addEventListener("click", async () => {
    if (!selectedManifests.size) return;
    downloadSelectedBtn.disabled = true;
    for (const id of Array.from(selectedManifests)) {
      const manifest = manifestDataMap.get(id);
      const controller = manifestControllers.get(id);
      if (!manifest || !controller) continue;
      try {
        await downloadManifest(manifest, controller);
      } catch (error) {
        console.error("Batch download failed", error);
      }
    }
    selectedManifests.clear();
    manifestControllers.forEach(ctrl => {
      if (ctrl.selectBox) ctrl.selectBox.checked = false;
    });
    downloadSelectedBtn.disabled = false;
    updateBulkDownloadState();
  });

  if (!manifests.length) {
    handleEmptyState();
    return;
  }

  manifestListEl.classList.remove("hidden");
  emptyStateEl.classList.add("hidden");
  manifests.forEach(manifest => {
    manifestDataMap.set(manifest.id, manifest);
    manifestListEl.appendChild(renderManifestCard(manifest));
  });
});
