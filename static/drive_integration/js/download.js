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

// Keep hashing memory-safe for large merged downloads
const HASH_STREAM_CHUNK = 4 * 1024 * 1024; // 4MB per read
const HASH_BUFFER_THRESHOLD = 128 * 1024 * 1024; // up to 128MB use arrayBuffer, above stream

function sha256ToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

class Sha256 {
  constructor() {
    this._state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this._buffer = new Uint8Array(64);
    this._bufferLength = 0;
    this._bytesHashed = 0;
    this._finished = false;
    this._work = new Uint32Array(64);
  }

  _rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  _compress(chunk) {
    const w = this._work;
    for (let i = 0; i < 16; i += 1) {
      w[i] = (
        (chunk[i * 4] << 24) |
        (chunk[i * 4 + 1] << 16) |
        (chunk[i * 4 + 2] << 8) |
        (chunk[i * 4 + 3])
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (this._rotr(w[i - 15], 7) ^ this._rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (this._rotr(w[i - 2], 17) ^ this._rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this._state;
    const k = Sha256.K;
    for (let i = 0; i < 64; i += 1) {
      const S1 = (this._rotr(e, 6) ^ this._rotr(e, 11) ^ this._rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + k[i] + w[i]) >>> 0;
      const S0 = (this._rotr(a, 2) ^ this._rotr(a, 13) ^ this._rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this._state[0] = (this._state[0] + a) >>> 0;
    this._state[1] = (this._state[1] + b) >>> 0;
    this._state[2] = (this._state[2] + c) >>> 0;
    this._state[3] = (this._state[3] + d) >>> 0;
    this._state[4] = (this._state[4] + e) >>> 0;
    this._state[5] = (this._state[5] + f) >>> 0;
    this._state[6] = (this._state[6] + g) >>> 0;
    this._state[7] = (this._state[7] + h) >>> 0;
  }

  update(data) {
    if (this._finished) throw new Error("SHA256: can't update finished hash");
    let offset = 0;
    while (offset < data.length) {
      const space = 64 - this._bufferLength;
      const take = Math.min(space, data.length - offset);
      this._buffer.set(data.subarray(offset, offset + take), this._bufferLength);
      this._bufferLength += take;
      offset += take;
      if (this._bufferLength === 64) {
        this._compress(this._buffer);
        this._bytesHashed += 64;
        this._bufferLength = 0;
      }
    }
    return this;
  }

  digest() {
    if (this._finished) throw new Error("SHA256: digest already called");
    this._bytesHashed += this._bufferLength;

    this._buffer[this._bufferLength] = 0x80;
    this._bufferLength += 1;

    if (this._bufferLength > 56) {
      this._buffer.fill(0, this._bufferLength, 64);
      this._compress(this._buffer);
      this._bufferLength = 0;
    }

    this._buffer.fill(0, this._bufferLength, 56);
    const bitsHi = Math.floor(this._bytesHashed / 0x20000000);
    const bitsLo = (this._bytesHashed << 3) >>> 0;
    const view = new DataView(this._buffer.buffer);
    view.setUint32(56, bitsHi >>> 0, false);
    view.setUint32(60, bitsLo, false);
    this._compress(this._buffer);

    this._finished = true;
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i += 1) {
      out[i * 4] = this._state[i] >>> 24;
      out[i * 4 + 1] = (this._state[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this._state[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this._state[i] & 0xff;
    }
    return out;
  }
}

Sha256.K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

async function hashBlobStream(blob) {
  const total = blob.size || 0;
  const hasher = new Sha256();
  let offset = 0;
  while (offset < total) {
    const slice = blob.slice(offset, offset + HASH_STREAM_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const buf = await slice.arrayBuffer();
    hasher.update(new Uint8Array(buf));
    offset += buf.byteLength;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(requestAnimationFrame);
  }
  return sha256ToHex(hasher.digest());
}

async function hashBlob(blob) {
  try {
    if (blob.size <= HASH_BUFFER_THRESHOLD) {
      const buffer = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      return sha256ToHex(digest);
    }
    return await hashBlobStream(blob);
  } catch (err) {
    console.error("Checksum computation failed", err);
    if (blob.size > HASH_BUFFER_THRESHOLD) return "";
    try {
      return await hashBlobStream(blob);
    } catch (streamErr) {
      console.error("Streaming checksum also failed", streamErr);
      return "";
    }
  }
}

const manifestControllers = new Map();
const manifestDataMap = new Map();
const selectedManifests = new Set();
let manifestData = [];

let manifestListEl = null;
let emptyStateEl = null;
let downloadSelectedBtn = null;
let deleteSelectedBtn = null;
let healthSelectedBtn = null;
let selectAllBtn = null;
let clearSelectedBtn = null;
let sortSelect = null;
let groupSelect = null;
const downloadStatusBanner = document.getElementById("downloadStatus");
const downloadStatusText = document.getElementById("downloadStatusText");
let downloadsActive = 0;
let downloadsHadErrors = false;

let currentSort = "newest";
let currentGroup = "none";

function setDownloadStatus(state, message) {
  if (!downloadStatusBanner || !downloadStatusText) return;
  downloadStatusBanner.classList.remove("hidden", "active", "success", "error");
  if (state === "active") {
    downloadStatusBanner.classList.add("active");
  } else if (state === "success") {
    downloadStatusBanner.classList.add("success");
  } else if (state === "error") {
    downloadStatusBanner.classList.add("error");
  }
  const fallback = {
    idle: "Idle",
    active: "Downloading...",
    success: "All downloads complete.",
    error: "Downloads finished with issues.",
  };
  downloadStatusText.textContent = message || fallback[state] || "Status";
  downloadStatusBanner.classList.remove("hidden");
}

function beginDownloadStatus() {
  downloadsActive += 1;
  setDownloadStatus("active", "Downloading...");
}

function endDownloadStatus(success) {
  downloadsActive = Math.max(0, downloadsActive - 1);
  if (!success) downloadsHadErrors = true;
  if (downloadsActive === 0) {
    setDownloadStatus(
      downloadsHadErrors ? "error" : "success",
      downloadsHadErrors ? "Some downloads failed." : "All downloads complete."
    );
    downloadsHadErrors = false;
  } else {
    setDownloadStatus("active", "Downloading...");
  }
}

setDownloadStatus("idle", "Idle");

window.addEventListener("beforeunload", event => {
  if (downloadsActive > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
});

const SORTERS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  name_asc: (a, b) => a.file_name.localeCompare(b.file_name),
  name_desc: (a, b) => b.file_name.localeCompare(a.file_name),
  size_desc: (a, b) => (b.total_size || 0) - (a.total_size || 0),
  size_asc: (a, b) => (a.total_size || 0) - (b.total_size || 0),
  type_asc: (a, b) => getFileExtension(a).localeCompare(getFileExtension(b)),
  type_desc: (a, b) => getFileExtension(b).localeCompare(getFileExtension(a)),
};

function getFileExtension(manifest) {
  const name = manifest?.file_name || "";
  const idx = name.lastIndexOf(".");
  if (idx === -1) return "unknown";
  return name.substring(idx + 1).toLowerCase() || "unknown";
}

function updateBulkButtons() {
  const hasSelection = selectedManifests.size > 0;
  if (downloadSelectedBtn) downloadSelectedBtn.disabled = !hasSelection;
  if (deleteSelectedBtn) deleteSelectedBtn.disabled = !hasSelection;
  if (healthSelectedBtn) healthSelectedBtn.disabled = !hasSelection;
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
  updateBulkButtons();
}

function getGroupKey(manifest) {
  if (currentGroup === "type") return getFileExtension(manifest);
  if (currentGroup === "date") {
    const date = new Date(manifest.created_at);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleDateString();
  }
  return null;
}

function createGroupHeader(label) {
  const div = document.createElement("div");
  div.className = "manifest-group";
  div.textContent = label;
  return div;
}

function renderManifestCard(manifest) {
  const card = document.createElement("div");
  card.className = "manifest-card";

  const header = document.createElement("div");
  header.className = "manifest-header";

  const selectBox = document.createElement("input");
  selectBox.type = "checkbox";
  selectBox.className = "manifest-select";
  selectBox.checked = selectedManifests.has(manifest.id);
  selectBox.addEventListener("change", e => {
    if (e.target.checked) {
      selectedManifests.add(manifest.id);
    } else {
      selectedManifests.delete(manifest.id);
    }
    updateBulkButtons();
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
      buttons: [downloadBtn, deleteBtn, healthBtn],
      status,
    });
  });

  healthBtn.addEventListener("click", () => {
    checkManifestHealth(manifest, {
      button: healthBtn,
      block: healthBlock,
      status,
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
    healthButton: healthBtn,
    healthBlock,
    healthSummary,
    healthBarFill,
    healthIssues,
    buttons: [downloadBtn, deleteBtn, healthBtn],
  });

  return card;
}

function renderManifestList() {
  if (!manifestListEl) return;
  manifestListEl.innerHTML = "";
  manifestControllers.clear();
  manifestDataMap.clear();

  const sorter = SORTERS[currentSort] || SORTERS.newest;
  const sorted = [...manifestData].sort(sorter);

  let lastGroup = null;
  sorted.forEach(manifest => {
    manifestDataMap.set(manifest.id, manifest);
    const groupKey = getGroupKey(manifest);
    if (groupKey && groupKey !== lastGroup) {
      manifestListEl.appendChild(createGroupHeader(groupKey));
      lastGroup = groupKey;
    }
    manifestListEl.appendChild(renderManifestCard(manifest));
  });

  handleEmptyState();
}

async function downloadManifest(manifest, ui) {
  if (!manifest.chunks || !manifest.chunks.length) {
    ui.status.textContent = "No chunks recorded for this file.";
    return;
  }

  beginDownloadStatus();
  let downloadSucceeded = false;

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
      } else if (computedHash) {
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
    downloadSucceeded = true;
  } catch (error) {
    console.error(error);
    ui.status.textContent = `Failed: ${error.message}`;
    downloadSucceeded = false;
  } finally {
    ui.button.disabled = false;
    endDownloadStatus(downloadSucceeded);
  }
}

function removeManifestFromState(manifestId) {
  manifestData = manifestData.filter(m => m.id !== manifestId);
  manifestDataMap.delete(manifestId);
  manifestControllers.delete(manifestId);
  selectedManifests.delete(manifestId);
}

async function deleteManifest(manifest, ui, opts = {}) {
  if (!opts.skipConfirm) {
    const confirmed = window.confirm(`Delete "${manifest.file_name}" and all Drive chunks?`);
    if (!confirmed) return false;
  }

  (ui.buttons || []).forEach(btn => {
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

    removeManifestFromState(manifest.id);
    if (!opts.suppressRender) {
      renderManifestList();
    } else {
      updateBulkButtons();
    }
    return true;
  } catch (error) {
    console.error(error);
    ui.status.textContent = `Delete failed: ${error.message}`;
    (ui.buttons || []).forEach(btn => {
      // eslint-disable-next-line no-param-reassign
      btn.disabled = false;
    });
    return false;
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
  manifestData = script ? JSON.parse(script.textContent) : [];

  manifestListEl = document.getElementById("manifestList");
  emptyStateEl = document.getElementById("emptyState");
  downloadSelectedBtn = document.getElementById("downloadSelected");
  deleteSelectedBtn = document.getElementById("deleteSelected");
  healthSelectedBtn = document.getElementById("healthSelected");
  selectAllBtn = document.getElementById("selectAllManifests");
  clearSelectedBtn = document.getElementById("clearSelectedManifests");
  sortSelect = document.getElementById("sortManifests");
  groupSelect = document.getElementById("groupManifests");

  selectAllBtn?.addEventListener("click", () => {
    manifestControllers.forEach((ctrl, id) => {
      if (ctrl.selectBox) {
        ctrl.selectBox.checked = true;
        selectedManifests.add(id);
      }
    });
    updateBulkButtons();
  });

  clearSelectedBtn?.addEventListener("click", () => {
    manifestControllers.forEach(ctrl => {
      if (ctrl.selectBox) ctrl.selectBox.checked = false;
    });
    selectedManifests.clear();
    updateBulkButtons();
  });

  sortSelect?.addEventListener("change", e => {
    currentSort = e.target.value;
    renderManifestList();
  });

  groupSelect?.addEventListener("change", e => {
    currentGroup = e.target.value;
    renderManifestList();
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
    updateBulkButtons();
  });

  deleteSelectedBtn?.addEventListener("click", async () => {
    if (!selectedManifests.size) return;
    if (!window.confirm(`Delete ${selectedManifests.size} selected file(s) and all Drive chunks?`)) return;
    deleteSelectedBtn.disabled = true;
    const ids = Array.from(selectedManifests);
    for (const id of ids) {
      const manifest = manifestDataMap.get(id);
      const controller = manifestControllers.get(id);
      if (!manifest || !controller) continue;
      try {
        await deleteManifest(manifest, controller, { skipConfirm: true, suppressRender: true });
      } catch (error) {
        console.error("Batch delete failed", error);
      }
    }
    deleteSelectedBtn.disabled = false;
    renderManifestList();
  });

  healthSelectedBtn?.addEventListener("click", async () => {
    if (!selectedManifests.size) return;
    healthSelectedBtn.disabled = true;
    for (const id of Array.from(selectedManifests)) {
      const manifest = manifestDataMap.get(id);
      const controller = manifestControllers.get(id);
      if (!manifest || !controller) continue;
      try {
        await checkManifestHealth(manifest, {
          button: controller.healthButton,
          block: controller.healthBlock,
          status: controller.status,
          summaryEl: controller.healthSummary,
          barFill: controller.healthBarFill,
          issuesEl: controller.healthIssues,
        });
      } catch (error) {
        console.error("Batch health check failed", error);
      }
    }
    healthSelectedBtn.disabled = false;
    updateBulkButtons();
  });

  renderManifestList();
});
