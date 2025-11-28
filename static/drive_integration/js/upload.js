// ------------------------------------------------------------
// upload.js — multi-file upload with global chunk distribution
// ------------------------------------------------------------

function csrf() {
  const name = "csrftoken=";
  for (const c of document.cookie.split(";")) {
    const s = c.trim();
    if (s.startsWith(name)) return s.substring(name.length);
  }
  return "";
}

const BYTES_PER_MB = 1024 * 1024;
const toMB = b => (b / BYTES_PER_MB).toFixed(1);
const toGB = b => (b / (1024 * 1024 * 1024)).toFixed(2);

const isPhone = (/Mobi|Android/i.test(navigator.userAgent || "") && !/iPad/i.test(navigator.userAgent || ""))
  || ((typeof screen !== "undefined" && screen.width <= 768) && (navigator.maxTouchPoints || 0) > 1);
const MAX_TOTAL_UPLOAD_MB = 5120; // 5GB per batch; tweak to raise/lower total upload cap
const MAX_TOTAL_UPLOAD_BYTES = MAX_TOTAL_UPLOAD_MB * BYTES_PER_MB;
const MAX_CHUNK_MB = 500; // keep chunk size small enough to satisfy server memory limits
const chunkSizeInput = document.getElementById("chunkSize");
const fileInput = document.getElementById("fileInput");
const fileDropZone = document.getElementById("fileDropZone");
const fileBrowseTrigger = document.getElementById("fileBrowseTrigger");
const uploadBtn = document.getElementById("uploadBtn");
const warningEl = document.getElementById("total-warning");
const fileListWrapper = document.getElementById("selected-files-wrapper");
const fileListEl = document.getElementById("selectedFilesList");
const fileChecksumEl = document.getElementById("file-checksum");
const fileInfoEl = document.getElementById("file-info");
const fileSizeEl = document.getElementById("file-size");
const totalChunksEl = document.getElementById("total-chunks");
const progressContainer = document.getElementById("progressContainer");
const accountBlocks = Array.from(document.querySelectorAll(".account-block"));
const uploadStatusBanner = document.getElementById("uploadStatus");
const uploadStatusText = document.getElementById("uploadStatusText");
const removeFileBtn = document.getElementById("removeFileBtn");
const noticeBox = warningEl; // shared notice box in the progress panel

function setNotice(message, tone = "error") {
  if (!noticeBox) return;
  noticeBox.textContent = message || "";
  noticeBox.classList.remove("hidden", "active", "success", "error");
  if (!message) {
    noticeBox.classList.add("hidden");
    return;
  }
  if (tone === "success") noticeBox.classList.add("success");
  else if (tone === "active") noticeBox.classList.add("active");
  else noticeBox.classList.add("error");
}
//const noticeBox = warningEl; // shared notice box in the progress panel

// ------------------------------------------------------------
// Lightweight streaming SHA-256 (avoids loading huge files at once)
// ------------------------------------------------------------
const HASH_STREAM_CHUNK = 4 * BYTES_PER_MB; // 4MB slices keep memory small
const HASH_BUFFER_THRESHOLD = 128 * BYTES_PER_MB; // use arrayBuffer for smaller blobs

function sha256ToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(buffer) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return sha256ToHex(digest);
  } catch (err) {
    // Fallback to pure JS if subtle.digest fails
    console.warn("crypto.subtle.digest failed, falling back to pure JS", err);
    const hasher = new Sha256();
    hasher.update(new Uint8Array(buffer));
    return sha256ToHex(hasher.digest());
  }
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

    // Pad
    this._buffer[this._bufferLength] = 0x80;
    this._bufferLength += 1;

    if (this._bufferLength > 56) {
      this._buffer.fill(0, this._bufferLength, 64);
      this._compress(this._buffer);
      this._bufferLength = 0;
    }

    this._buffer.fill(0, this._bufferLength, 56);
    const bitsHi = Math.floor(this._bytesHashed / 0x20000000); // bytes * 8 / 2^32
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

async function hashBlobStream(blob, onProgress) {
  const total = blob.size || 0;
  const hasher = new Sha256();
  if (blob.stream && typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    let processed = 0;
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        hasher.update(value instanceof Uint8Array ? value : new Uint8Array(value));
        processed += value.length;
        if (onProgress) onProgress(processed, total);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return sha256ToHex(hasher.digest());
  }

  // Fallback if stream() is unavailable
  let offset = 0;
  while (offset < total) {
    const slice = blob.slice(offset, offset + HASH_STREAM_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const buf = await slice.arrayBuffer();
    hasher.update(new Uint8Array(buf));
    offset += buf.byteLength;
    if (onProgress) onProgress(offset, total);
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return sha256ToHex(hasher.digest());
}

async function checksum(blob) {
  // For moderate blobs, the built-in path is fastest; for very large blobs stream it.
  if (blob.size <= HASH_BUFFER_THRESHOLD) {
    try {
      const buffer = await blob.arrayBuffer();
      return sha256Hex(buffer);
    } catch (err) {
      console.warn("Direct checksum failed, falling back to streaming", err);
    }
  }
  try {
    return await hashBlobStream(blob);
  } catch (streamErr) {
    console.error("Streaming checksum failed", streamErr);
    return "";
  }
}

async function hashChunkAndAccumulate(blob, fileHasher) {
  const chunkHasher = new Sha256();
  if (blob.stream && typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      const data = value instanceof Uint8Array ? value : new Uint8Array(value || []);
      chunkHasher.update(data);
      if (fileHasher) fileHasher.update(data);
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return sha256ToHex(chunkHasher.digest());
  }

  // Fallback: buffer read (should be safe for smaller slices/chunks)
  const buffer = await blob.arrayBuffer();
  const view = new Uint8Array(buffer);
  chunkHasher.update(view);
  if (fileHasher) fileHasher.update(view);
  return sha256ToHex(chunkHasher.digest());
}

let chunkSizeMB = Math.min(parseInt(chunkSizeInput?.value, 10) || 8, MAX_CHUNK_MB);
if (chunkSizeInput) {
  chunkSizeInput.value = chunkSizeMB;
}
let chunkSizeBytes = chunkSizeMB * BYTES_PER_MB;
let totalChunksOverall = 0;
let totalBytesOverall = 0;
let totalCapacityChunks = 0;
let userAdjustedDistribution = false;

const fileEntries = [];
let activeFileIndex = -1;
let uploadsRunning = false;
let uploadHadErrors = false;

function updateUploadStatus(state, message) {
  if (!uploadStatusBanner || !uploadStatusText) return;
  uploadStatusBanner.classList.remove("hidden", "active", "success", "error");
  if (state === "active") {
    uploadStatusBanner.classList.add("active");
  } else if (state === "success") {
    uploadStatusBanner.classList.add("success");
  } else if (state === "error") {
    uploadStatusBanner.classList.add("error");
  }
  const fallback = {
    idle: "Idle",
    active: "Uploading...",
    success: "All uploads complete.",
    error: "Upload interrupted.",
  };
  uploadStatusText.textContent = message || fallback[state] || "Status";
  uploadStatusBanner.classList.remove("hidden");
}

updateUploadStatus("idle", "Waiting for upload.");

window.addEventListener("beforeunload", event => {
  if (uploadsRunning) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function fileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function parseRemainingMB(value) {
  if (!value) return 0;
  const trimmed = String(value).trim();
  const match = trimmed.match(/([\d.]+)\s*(GB|MB)?/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = (match[2] || "MB").toUpperCase();
  return unit === "GB" ? val * 1024 : val;
}

function getTotalRemainingMB() {
  return accountBlocks.reduce((sum, block) => sum + parseRemainingMB(block.dataset.remaining), 0);
}

function getActiveEntry() {
  if (activeFileIndex < 0 || activeFileIndex >= fileEntries.length) return null;
  return fileEntries[activeFileIndex];
}

function renderFileChecksumDisplay(message) {
  if (!fileChecksumEl) return;
  if (message) {
    fileChecksumEl.textContent = message;
    return;
  }
  const entry = getActiveEntry();
  if (!entry) {
    fileChecksumEl.textContent = "N/A";
    return;
  }
  if (entry.checksum) {
    fileChecksumEl.textContent = entry.checksum;
  } else {
    fileChecksumEl.textContent = "Will compute during upload";
  }
}

function updateFileInfo() {
  const entry = getActiveEntry();
  if (!entry) {
    fileInfoEl.classList.add("hidden");
    fileSizeEl.textContent = "0 MB";
    totalChunksEl.textContent = "0";
    renderFileChecksumDisplay();
    return;
  }
  fileInfoEl.classList.remove("hidden");
  fileSizeEl.textContent = `${toMB(entry.file.size)} MB`;
  const chunksForFile = chunkSizeBytes ? Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes)) : 0;
  totalChunksEl.textContent = chunksForFile;
  renderFileChecksumDisplay();
}

function renderFileList() {
  if (!fileListWrapper || !fileListEl) return;
  if (!fileEntries.length) {
    fileListWrapper.classList.add("hidden");
    fileListEl.innerHTML = "";
    return;
  }
  fileListWrapper.classList.remove("hidden");
  fileListEl.innerHTML = "";
  fileEntries.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.textContent = `${entry.file.name} (${toMB(entry.file.size)} MB)`;
    if (idx === activeFileIndex) li.classList.add("active");
    li.addEventListener("click", () => setActiveFile(idx));
    fileListEl.appendChild(li);
  });
}

function startEntryChecksum(entry) {
  // No-op: file checksum is computed during upload now to avoid heavy upfront hashing.
  renderFileChecksumDisplay();
  return null;
}

async function ensureEntryChecksum(entry) {
  // Keep for compatibility, but checksum is calculated during upload.
  return entry && entry.checksum ? entry.checksum : "";
}

function setActiveFile(index) {
  if (!fileEntries.length) {
    activeFileIndex = -1;
    updateFileInfo();
    renderFileList();
    return;
  }
  const clamped = Math.min(Math.max(index, 0), fileEntries.length - 1);
  activeFileIndex = clamped;
  updateFileInfo();
  renderFileList();
}

function removeActiveFile() {
  if (activeFileIndex < 0 || activeFileIndex >= fileEntries.length) return;
  fileEntries.splice(activeFileIndex, 1);
  activeFileIndex = Math.min(activeFileIndex, fileEntries.length - 1);
  userAdjustedDistribution = false;
  recalcTotals();
  renderFileList();
  updateFileInfo();
  updateUploadStatus("idle", fileEntries.length ? "File removed from queue." : "Waiting for upload.");
}

function addFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const existingKeys = new Set(fileEntries.map(entry => entry.key));
  let added = false;
  Array.from(fileList).forEach(file => {
    const key = fileKey(file);
    if (existingKeys.has(key)) return;
    fileEntries.push({
      file,
      key,
      checksum: "",
      checksumPromise: null,
      checksumContext: 0,
    });
    existingKeys.add(key);
    added = true;
  });
  if (!added) return;
  if (activeFileIndex === -1) activeFileIndex = 0;
  userAdjustedDistribution = false;
  recalcTotals();
  renderFileList();
  updateFileInfo();
  updateUploadStatus("idle", "Files queued. Start upload when ready.");
}

function getAccountCapacityChunks(block) {
  if (!chunkSizeMB) return 0;
  const remainingMB = parseRemainingMB(block.dataset.remaining);
  return Math.max(0, Math.floor(remainingMB / chunkSizeMB));
}

function updateSliderValueUI(block, chunks) {
  const tooltip = block.querySelector(".tooltip");
  if (tooltip) tooltip.textContent = chunks;
  const label = block.querySelector(".slider-value");
  if (label) {
    const approxMB = chunks * chunkSizeMB;
    label.textContent = `${chunks} chunk${chunks === 1 ? "" : "s"} (~${approxMB.toFixed(1)} MB)`;
  }
}

function updateSliderBounds() {
  totalCapacityChunks = 0;
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    const capacity = getAccountCapacityChunks(block);
    totalCapacityChunks += capacity;
    const maxChunks = totalChunksOverall ? Math.min(capacity, totalChunksOverall) : capacity;
    slider.max = maxChunks;
    const maxLabel = block.querySelector(".acc-max");
    if (maxLabel) {
      const approxMB = capacity * chunkSizeMB;
      maxLabel.textContent = `${capacity} chunk${capacity === 1 ? "" : "s"} (~${approxMB.toFixed(1)} MB)`;
    }
    if (parseInt(slider.value, 10) > maxChunks) {
      slider.value = maxChunks;
    }
    updateSliderValueUI(block, parseInt(slider.value, 10) || 0);
  });
}

function computeEvenAllocation() {
  if (!totalChunksOverall) return { allocations: {}, remainder: 0 };
  const entries = accountBlocks.map(block => ({
    id: block.dataset.id,
    capacity: getAccountCapacityChunks(block),
  })).filter(entry => entry.capacity > 0);

  const totalCapacity = entries.reduce((sum, entry) => sum + entry.capacity, 0);
  if (totalCapacity < totalChunksOverall) {
    return { allocations: {}, remainder: totalChunksOverall - totalCapacity, insufficient: true };
  }

  const allocations = {};
  let remaining = totalChunksOverall;
  entries.forEach(entry => {
    const share = entry.capacity / totalCapacity;
    const base = Math.min(entry.capacity, Math.floor(share * totalChunksOverall));
    allocations[entry.id] = base;
    entry.fraction = share * totalChunksOverall - base;
    remaining -= base;
  });

  const sorted = [...entries].sort((a, b) => b.fraction - a.fraction);
  let idx = 0;
  while (remaining > 0) {
    const entry = sorted[idx % sorted.length];
    if (allocations[entry.id] < entry.capacity) {
      allocations[entry.id] += 1;
      remaining -= 1;
    }
    idx += 1;
  }

  return { allocations, remainder: 0 };
}

function applyAllocationToSliders(allocation) {
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    const max = parseInt(slider.max, 10) || 0;
    const val = Math.min(max, allocation[block.dataset.id] || 0);
    slider.value = val;
    updateSliderValueUI(block, val);
  });
}

function readAllocationFromSliders() {
  const allocation = {};
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    allocation[block.dataset.id] = parseInt(slider.value, 10) || 0;
  });
  return allocation;
}

function updateSlidersWithAllocation(updated) {
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    const value = Math.max(0, Math.min(parseInt(slider.max, 10) || 0, updated[block.dataset.id] || 0));
    slider.value = value;
    updateSliderValueUI(block, value);
  });
}

function redistributeAllocation(changedId, desiredValue) {
  const current = readAllocationFromSliders();
  const max = accountBlocks.reduce((sum, block) => sum + (parseInt(block.querySelector(".chunk-slider").max, 10) || 0), 0);
  const totalChunks = totalChunksOverall;
  const clampedValue = Math.max(0, Math.min(parseInt(document.querySelector(`.account-block[data-id="${changedId}"] .chunk-slider`).max, 10) || 0, desiredValue));
  current[changedId] = clampedValue;

  let remaining = totalChunks - clampedValue;
  const otherBlocks = accountBlocks.filter(block => block.dataset.id !== changedId);

  const available = otherBlocks.map(block => ({
    id: block.dataset.id,
    max: parseInt(block.querySelector(".chunk-slider").max, 10) || 0,
  }));

  let sumCurrentOthers = available.reduce((sum, entry) => sum + (current[entry.id] || 0), 0);

  if (sumCurrentOthers > remaining) {
    let excess = sumCurrentOthers - remaining;
    const sorted = [...available].sort((a, b) => (current[b.id] || 0) - (current[a.id] || 0));
    for (const entry of sorted) {
      if (excess <= 0) break;
      const allotted = current[entry.id] || 0;
      const reduction = Math.min(allotted, excess);
      current[entry.id] = allotted - reduction;
      excess -= reduction;
    }
  } else if (sumCurrentOthers < remaining) {
    let deficit = remaining - sumCurrentOthers;
    const sorted = [...available].sort((a, b) => ((b.max - (current[b.id] || 0)) - (a.max - (current[a.id] || 0))));
    for (const entry of sorted) {
      if (deficit <= 0) break;
      const allot = Math.min(entry.max - (current[entry.id] || 0), deficit);
      current[entry.id] = (current[entry.id] || 0) + allot;
      deficit -= allot;
    }
  }

  updateSlidersWithAllocation(current);
  userAdjustedDistribution = true;
  validateTotals();
}

function recalcTotals() {
  chunkSizeBytes = chunkSizeMB * BYTES_PER_MB;
  totalBytesOverall = fileEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  totalChunksOverall = chunkSizeBytes
    ? fileEntries.reduce((sum, entry) => sum + Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes)), 0)
    : 0;
  updateSliderBounds();

  if (!fileEntries.length || !totalChunksOverall) {
    applyAllocationToSliders({});
    validateTotals();
    return;
  }

  if (!userAdjustedDistribution) {
    const { allocations, remainder, insufficient } = computeEvenAllocation();
    applyAllocationToSliders(allocations);
    validateTotals(insufficient ? Infinity : remainder);
  } else {
    validateTotals();
  }
}

function validateTotals(extraRemainder) {
  if (!warningEl) return;
  const allocation = readAllocationFromSliders();
  const totalAssigned = Object.values(allocation).reduce((sum, val) => sum + val, 0);

  if (!fileEntries.length) {
    setNotice("Select one or more files to begin.", "active");
    uploadBtn.disabled = true;
    return;
  }
  if (!chunkSizeBytes) {
    setNotice("Chunk size must be greater than zero.", "error");
    uploadBtn.disabled = true;
    return;
  }
  if (totalBytesOverall > MAX_TOTAL_UPLOAD_BYTES) {
    const limitGB = (MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024 * 1024)).toFixed(1);
    setNotice(`Upload limit exceeded: ${toGB(totalBytesOverall)} GB selected. Limit is ${limitGB} GB. Remove some files.`, "error");
    uploadBtn.disabled = true;
    return;
  }
  const desiredMB = totalBytesOverall / BYTES_PER_MB;
  const availableMB = getTotalRemainingMB();
  if (desiredMB > availableMB) {
    setNotice(`Not enough Drive quota: need ~${desiredMB.toFixed(1)} MB, available ~${availableMB.toFixed(1)} MB.`, "error");
    uploadBtn.disabled = true;
    return;
  }
  if (totalCapacityChunks < totalChunksOverall) {
    setNotice("Not enough available Drive space to cover this upload.", "error");
    uploadBtn.disabled = true;
    return;
  }
  if (totalAssigned !== totalChunksOverall) {
    setNotice(`Allocate exactly ${totalChunksOverall} chunk${totalChunksOverall === 1 ? "" : "s"} (~${(totalChunksOverall * chunkSizeMB).toFixed(1)} MB). Currently assigned: ${totalAssigned}.`, "active");
    uploadBtn.disabled = true;
    return;
  }
  if (extraRemainder && extraRemainder > 0 && extraRemainder !== Infinity) {
    setNotice("Unable to distribute chunks evenly. Adjust the sliders manually.", "active");
    uploadBtn.disabled = true;
    return;
  }
  setNotice("");
  uploadBtn.disabled = false;
}

function createProgressBar(label, parent) {
  const block = document.createElement("div");
  block.className = "progress-item";
  block.innerHTML = `
    <span class="progress-label">${label}</span>
    <div class="progress-outer"><div class="progress-inner"></div></div>
    <div class="progress-text">0 MB / 0 MB</div>
    <button class="retry hidden">Retry</button>
    <div class="checkmark hidden">&#10003;</div>`;
  parent.appendChild(block);
  return block;
}

function updateBar(block, uploaded, total) {
  const bar = block.querySelector(".progress-inner");
  const pct = total ? Math.min(100, (uploaded / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  block.querySelector(".progress-text").textContent = `${toMB(uploaded)} / ${toMB(total)} MB`;
}

function triggerFilePicker(event) {
  if (event) {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
  }
  fileInput?.click();
}

if (fileBrowseTrigger) {
  fileBrowseTrigger.addEventListener("click", triggerFilePicker);
  fileBrowseTrigger.addEventListener("keydown", triggerFilePicker);
}

if (fileDropZone) {
  fileDropZone.addEventListener("click", e => {
    if (e.target === fileInput) return;
    e.preventDefault();
    fileInput?.click();
  });

  ["dragenter", "dragover"].forEach(evt => {
    fileDropZone.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      fileDropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "dragend"].forEach(evt => {
    fileDropZone.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      fileDropZone.classList.remove("drag-over");
    });
  });

  fileDropZone.addEventListener("drop", e => {
    e.preventDefault();
    fileDropZone.classList.remove("drag-over");
    addFiles(e.dataTransfer.files);
  });
}

fileInput?.addEventListener("change", e => {
  addFiles(e.target.files);
  e.target.value = "";
});

removeFileBtn?.addEventListener("click", e => {
  e.preventDefault();
  removeActiveFile();
});

if (chunkSizeInput) {
  chunkSizeInput.addEventListener("input", e => {
    const next = parseInt(e.target.value, 10);
    if (Number.isNaN(next) || next <= 0) return;
    chunkSizeMB = Math.min(next, MAX_CHUNK_MB);
    chunkSizeInput.value = chunkSizeMB;
    userAdjustedDistribution = false;
    recalcTotals();
    updateFileInfo();
  });
  chunkSizeInput.max = MAX_CHUNK_MB;
}

document.querySelectorAll(".chunk-slider").forEach(slider => {
  slider.addEventListener("input", e => {
    const block = e.target.closest(".account-block");
    const value = parseInt(e.target.value, 10) || 0;
    updateSliderValueUI(block, value);
    redistributeAllocation(block.dataset.id, value);
  });
  slider.addEventListener("mousemove", e => {
    const tooltip = slider.parentElement.querySelector(".tooltip");
    if (!tooltip) return;
    const rect = slider.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left}px`;
  });
  slider.addEventListener("mouseenter", () => {
    const tooltip = slider.parentElement.querySelector(".tooltip");
    if (tooltip) tooltip.classList.remove("hidden");
  });
  slider.addEventListener("mouseleave", () => {
    const tooltip = slider.parentElement.querySelector(".tooltip");
    if (tooltip) tooltip.classList.add("hidden");
  });
});

uploadBtn.addEventListener("click", async () => {
  if (!fileEntries.length || uploadBtn.disabled) return;
  // Double-check limits before starting
  validateTotals();
  if (uploadBtn.disabled) return;
  const allocation = readAllocationFromSliders();
  const allocatedChunks = Object.values(allocation).reduce((sum, val) => sum + val, 0);
  if (allocatedChunks !== totalChunksOverall) {
    setNotice("Chunk allocation mismatch. Please adjust the sliders so they match the total upload size.", "active");
    return;
  }

  progressContainer.innerHTML = "";
  const chunkAllocationRemaining = {};
  Object.keys(allocation).forEach(id => {
    chunkAllocationRemaining[id] = allocation[id];
  });

  uploadsRunning = true;
  uploadHadErrors = false;
  updateUploadStatus("active", "Uploading files...");

  try {
    for (const entry of fileEntries) {
      const currentFile = entry.file;
      const fileSection = document.createElement("div");
      fileSection.className = "file-progress";
      fileSection.innerHTML = `<h3>${currentFile.name}</h3>`;
      progressContainer.appendChild(fileSection);

      const fileChunks = Math.max(1, Math.ceil(currentFile.size / chunkSizeBytes));
      const perFileAllocation = {};
      let remainingForFile = fileChunks;
      const fileHasher = new Sha256();

      for (const block of accountBlocks) {
        if (!remainingForFile) break;
        const accountId = block.dataset.id;
        const available = chunkAllocationRemaining[accountId] || 0;
        if (!available) continue;
        const take = Math.min(available, remainingForFile);
        perFileAllocation[accountId] = take;
        chunkAllocationRemaining[accountId] -= take;
        remainingForFile -= take;
      }

      if (remainingForFile > 0) {
        const warn = document.createElement("div");
        warn.textContent = "Upload aborted — insufficient chunk allocation for this file.";
        fileSection.appendChild(warn);
        uploadHadErrors = true;
        break;
      }

      const manifest = [];
      let chunkIndex = 0;
      let aborted = false;

      for (const block of accountBlocks) {
        const accountId = block.dataset.id;
        const chunksForAcc = perFileAllocation[accountId] || 0;
        if (!chunksForAcc) continue;

        const progressBlock = createProgressBar(block.querySelector(".acc-email").textContent, fileSection);
        let uploadedBytes = 0;
        const totalUploadBytes = Math.min(
          currentFile.size - (chunkIndex * chunkSizeBytes),
          chunksForAcc * chunkSizeBytes,
        );

        for (let i = 0; i < chunksForAcc; i += 1) {
          const start = chunkIndex * chunkSizeBytes;
          const end = Math.min(start + chunkSizeBytes, currentFile.size);
          const blob = currentFile.slice(start, end);

          let chunkHash = "";
          try {
            chunkHash = await hashChunkAndAccumulate(blob, fileHasher);
          } catch (err) {
            console.error("Chunk checksum failed", err);
          }

          const createRes = await fetch(CREATE_SESSION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
            body: JSON.stringify({
              file_name: currentFile.name,
              mime_type: currentFile.type || "application/octet-stream",
              account_id: accountId,
              chunk_index: chunkIndex,
            }),
          });

          if (!createRes.ok) {
            progressBlock.querySelector(".retry").classList.remove("hidden");
            progressBlock.querySelector(".progress-inner").style.background = "#f55";
            console.error("Create session failed", await createRes.text());
            uploadHadErrors = true;
            aborted = true;
            break;
          }

          const createData = await createRes.json();
          const uploadUrl = createData.upload_url;
          if (!uploadUrl) {
            console.error("No upload_url from server", createData);
            uploadHadErrors = true;
            aborted = true;
            break;
          }

          const qs = new URLSearchParams({
            upload_url: uploadUrl,
            account_id: accountId,
            start: 0,
            end: blob.size - 1,
            mime: currentFile.type || "application/octet-stream",
            total_size: blob.size,
          });

          const putRes = await fetch(`${PROXY_CHUNK_URL}?${qs.toString()}`, {
            method: "POST",
            headers: { "X-CSRFToken": csrf() },
            body: blob,
          });

          if (putRes.status === 200 || putRes.status === 201) {
            let driveFileId = null;
            try {
              const text = await putRes.text();
              driveFileId = JSON.parse(text || "{}").id || null;
            } catch (err) {
              console.warn("Failed to parse drive response JSON", err);
            }

            uploadedBytes += blob.size;
            updateBar(progressBlock, uploadedBytes, totalUploadBytes);

            manifest.push({
              index: chunkIndex,
              account_id: parseInt(accountId, 10),
              drive_file_id: driveFileId,
              size: blob.size,
              checksum: chunkHash,
              uploaded_at: new Date().toISOString(),
            });

            chunkIndex += 1;
            continue;
          }

          if (putRes.status === 308) {
            uploadedBytes += blob.size;
            updateBar(progressBlock, uploadedBytes, totalUploadBytes);
            chunkIndex += 1;
            continue;
          }

          console.error("Chunk upload failed", putRes.status, await putRes.text());
          progressBlock.querySelector(".retry").classList.remove("hidden");
          progressBlock.querySelector(".progress-inner").style.background = "#f55";
          uploadHadErrors = true;
          aborted = true;
          break;
        }

        if (aborted) break;
        progressBlock.querySelector(".checkmark").classList.remove("hidden");
      }

      if (aborted) {
        const note = document.createElement("div");
        note.textContent = "Upload aborted due to an error.";
        fileSection.appendChild(note);
        uploadHadErrors = true;
        break;
      }

      let overallChecksum = "";
      try {
        overallChecksum = sha256ToHex(fileHasher.digest());
        entry.checksum = overallChecksum;
        if (entry === getActiveEntry()) renderFileChecksumDisplay();
      } catch (err) {
        console.error("Final file checksum failed", err);
      }

      if (!overallChecksum) {
        const warn = document.createElement("div");
        warn.textContent = "Skipped — unable to compute file checksum.";
        fileSection.appendChild(warn);
        uploadHadErrors = true;
        continue;
      }

      const saveRes = await fetch(SAVE_MANIFEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
        body: JSON.stringify({
          file_name: currentFile.name,
          total_size: currentFile.size,
          chunk_size: chunkSizeBytes,
          total_chunks: fileChunks,
          file_checksum: overallChecksum,
          chunks: manifest,
        }),
      });

      if (!saveRes.ok) {
        const failNote = document.createElement("div");
        failNote.textContent = "Failed to save manifest.";
        fileSection.appendChild(failNote);
        console.error("Saving manifest failed", await saveRes.text());
        uploadHadErrors = true;
        continue;
      }

      const saved = await saveRes.json();
      const done = document.createElement("div");
      done.textContent = `Upload complete — manifest saved (ID ${saved.id}).`;
      fileSection.appendChild(done);
    }
  } finally {
    uploadsRunning = false;
    updateUploadStatus(
      uploadHadErrors ? "error" : "success",
      uploadHadErrors ? "Uploads finished with issues." : "All uploads complete."
    );
  }
});
