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

const chunkSizeInput = document.getElementById("chunkSize");
const fileInput = document.getElementById("fileInput");
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

let chunkSizeMB = parseInt(chunkSizeInput.value, 10) || 500;
let chunkSizeBytes = chunkSizeMB * BYTES_PER_MB;
let totalChunksOverall = 0;
let totalBytesOverall = 0;
let totalCapacityChunks = 0;
let userAdjustedDistribution = false;

const fileEntries = [];
let activeFileIndex = -1;

function parseRemainingMB(value) {
  if (!value) return 0;
  const trimmed = String(value).trim();
  const match = trimmed.match(/([\d.]+)\s*(GB|MB)?/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = (match[2] || "MB").toUpperCase();
  return unit === "GB" ? val * 1024 : val;
}

function checksum(blob) {
  return blob.arrayBuffer()
    .then(buf => crypto.subtle.digest("SHA-256", buf))
    .then(digest => Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join(""));
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
  } else if (entry.checksumPromise) {
    fileChecksumEl.textContent = "Computing...";
  } else {
    fileChecksumEl.textContent = "N/A";
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
  if (!entry || entry.checksum || entry.checksumPromise) {
    renderFileChecksumDisplay();
    return entry && entry.checksumPromise ? entry.checksumPromise : null;
  }
  const context = (entry.checksumContext || 0) + 1;
  entry.checksumContext = context;
  entry.checksumPromise = checksum(entry.file)
    .then(hash => {
      if (entry.checksumContext === context) {
        entry.checksum = hash;
        if (entry === getActiveEntry()) renderFileChecksumDisplay();
      }
      return hash;
    })
    .catch(err => {
      console.error("File checksum failed", err);
      if (entry.checksumContext === context) {
        entry.checksum = "";
        if (entry === getActiveEntry()) renderFileChecksumDisplay("Checksum failed");
      }
      return "";
    })
    .finally(() => {
      if (entry.checksumContext === context) {
        entry.checksumPromise = null;
        if (entry === getActiveEntry() && !entry.checksum) renderFileChecksumDisplay();
      }
    });
  renderFileChecksumDisplay();
  return entry.checksumPromise;
}

async function ensureEntryChecksum(entry) {
  if (!entry) return "";
  if (entry.checksum) return entry.checksum;
  if (!entry.checksumPromise) startEntryChecksum(entry);
  if (entry.checksumPromise) {
    try {
      await entry.checksumPromise;
    } catch (err) {
      console.error("Checksum promise failed", err);
    }
  }
  return entry.checksum || "";
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
  startEntryChecksum(getActiveEntry());
}

function setSelectedFiles(fileList) {
  fileEntries.length = 0;
  Array.from(fileList || []).forEach(file => {
    fileEntries.push({
      file,
      checksum: "",
      checksumPromise: null,
      checksumContext: 0,
    });
  });
  activeFileIndex = fileEntries.length ? 0 : -1;
  userAdjustedDistribution = false;
  recalcTotals();
  renderFileList();
  updateFileInfo();
  if (fileEntries.length) startEntryChecksum(getActiveEntry());
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
    warningEl.textContent = "Select one or more files to begin.";
    warningEl.classList.remove("hidden");
    uploadBtn.disabled = true;
    return;
  }
  if (!chunkSizeBytes) {
    warningEl.textContent = "Chunk size must be greater than zero.";
    warningEl.classList.remove("hidden");
    uploadBtn.disabled = true;
    return;
  }
  if (totalCapacityChunks < totalChunksOverall) {
    warningEl.textContent = "Not enough available Drive space to cover this upload.";
    warningEl.classList.remove("hidden");
    uploadBtn.disabled = true;
    return;
  }
  if (totalAssigned !== totalChunksOverall) {
    warningEl.textContent = `Allocate exactly ${totalChunksOverall} chunk${totalChunksOverall === 1 ? "" : "s"} (~${(totalChunksOverall * chunkSizeMB).toFixed(1)} MB). Currently assigned: ${totalAssigned}.`;
    warningEl.classList.remove("hidden");
    uploadBtn.disabled = true;
    return;
  }
  if (extraRemainder && extraRemainder > 0 && extraRemainder !== Infinity) {
    warningEl.textContent = "Unable to distribute chunks evenly — adjust the sliders manually.";
    warningEl.classList.remove("hidden");
    uploadBtn.disabled = true;
    return;
  }
  warningEl.classList.add("hidden");
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
    <div class="checkmark hidden">✓</div>`;
  parent.appendChild(block);
  return block;
}

function updateBar(block, uploaded, total) {
  const bar = block.querySelector(".progress-inner");
  const pct = total ? Math.min(100, (uploaded / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  block.querySelector(".progress-text").textContent = `${toMB(uploaded)} / ${toMB(total)} MB`;
}

fileInput.addEventListener("change", e => {
  setSelectedFiles(e.target.files);
});

chunkSizeInput.addEventListener("input", e => {
  const next = parseInt(e.target.value, 10);
  if (Number.isNaN(next) || next <= 0) return;
  chunkSizeMB = next;
  userAdjustedDistribution = false;
  recalcTotals();
  updateFileInfo();
});

document.querySelectorAll(".chunk-slider").forEach(slider => {
  slider.addEventListener("input", e => {
    const block = e.target.closest(".account-block");
    const value = parseInt(e.target.value, 10) || 0;
    updateSliderValueUI(block, value);
    userAdjustedDistribution = true;
    validateTotals();
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
  if (!chunkSizeBytes) {
    alert("Chunk size must be greater than zero.");
    return;
  }
  const allocation = readAllocationFromSliders();
  const allocatedChunks = Object.values(allocation).reduce((sum, val) => sum + val, 0);
  if (allocatedChunks !== totalChunksOverall) {
    alert("Chunk allocation mismatch. Please adjust the sliders so they match the total upload size.");
    return;
  }

  progressContainer.innerHTML = "";
  const chunkAllocationRemaining = {};
  Object.keys(allocation).forEach(id => {
    chunkAllocationRemaining[id] = allocation[id];
  });

  for (const entry of fileEntries) {
    const currentFile = entry.file;
    const fileSection = document.createElement("div");
    fileSection.className = "file-progress";
    fileSection.innerHTML = `<h3>${currentFile.name}</h3>`;
    progressContainer.appendChild(fileSection);

    const fileChunks = Math.max(1, Math.ceil(currentFile.size / chunkSizeBytes));
    const perFileAllocation = {};
    let remainingForFile = fileChunks;

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
      break;
    }

    const overallChecksum = await ensureEntryChecksum(entry);
    if (!overallChecksum) {
      const warn = document.createElement("div");
      warn.textContent = "Skipped — unable to compute file checksum.";
      fileSection.appendChild(warn);
      continue;
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
          chunkHash = await checksum(blob);
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
          aborted = true;
          break;
        }

        const createData = await createRes.json();
        const uploadUrl = createData.upload_url;
        if (!uploadUrl) {
          console.error("No upload_url from server", createData);
          aborted = true;
          break;
        }

        const qs = new URLSearchParams({
          upload_url: uploadUrl,
          account_id: accountId,
          start: 0,
          end: blob.size - 1,
          mime: currentFile.type || "application/octet-stream",
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
      break;
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
      continue;
    }

    const saved = await saveRes.json();
    const done = document.createElement("div");
    done.textContent = `Upload complete — manifest saved (ID ${saved.id}).`;
    fileSection.appendChild(done);
  }
});
