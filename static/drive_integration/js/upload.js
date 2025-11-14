// ------------------------------
// upload.js - multi-file uploader with global distribution
// ------------------------------

function csrf() {
  const name = "csrftoken=";
  for (const c of document.cookie.split(";")) {
    const s = c.trim();
    if (s.startsWith(name)) return s.substring(name.length);
  }
  return "";
}

const toMB = b => (b / (1024 * 1024)).toFixed(1);

let file = null;
let chunkSizeMB = parseInt(document.getElementById("chunkSize").value, 10) || 500;
let chunkSizeBytes = chunkSizeMB * 1024 * 1024;

const fileChecksumEl = document.getElementById("file-checksum");
const fileListWrapper = document.getElementById("selected-files-wrapper");
const fileListEl = document.getElementById("selectedFilesList");
const accountBlocks = Array.from(document.querySelectorAll(".account-block"));

const distributionShares = {};
let distributionInitialized = false;

const fileEntries = [];
let activeFileIndex = -1;

function checksum(blob) {
  return blob.arrayBuffer()
    .then(buf => crypto.subtle.digest("SHA-256", buf))
    .then(digest => Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join(""));
}

function parseRemainingMB(s) {
  if (!s) return 0;
  const trimmed = String(s).trim();
  const match = trimmed.match(/([\d.]+)\s*(GB|MB)?/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = (match[2] || "MB").toUpperCase();
  return unit === "GB" ? val * 1024 : val;
}

function initDistributionShares() {
  if (!accountBlocks.length) return;
  const even = 1 / accountBlocks.length;
  accountBlocks.forEach(block => {
    distributionShares[block.dataset.id] = even;
  });
}

initDistributionShares();

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
  const info = document.getElementById("file-info");
  const entry = getActiveEntry();
  if (!info || !entry) {
    document.getElementById("file-size").textContent = "0 MB";
    document.getElementById("total-chunks").textContent = "0";
    info?.classList.add("hidden");
    renderFileChecksumDisplay();
    return;
  }
  info.classList.remove("hidden");
  document.getElementById("file-size").textContent = `${toMB(entry.file.size)} MB`;
  const required = Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes));
  document.getElementById("total-chunks").textContent = required;
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
    return entry?.checksumPromise || null;
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
        if (entry === getActiveEntry() && !entry.checksum) {
          renderFileChecksumDisplay();
        }
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

function getAccountCapacity(accountId) {
  const block = document.querySelector(`.account-block[data-id="${accountId}"]`);
  if (!block || !chunkSizeMB) return 0;
  const remainingMB = parseRemainingMB(block.dataset.remaining);
  return Math.max(0, Math.floor(remainingMB / chunkSizeMB));
}

function normalizeShares() {
  let sum = 0;
  accountBlocks.forEach(block => {
    const id = block.dataset.id;
    sum += distributionShares[id] || 0;
  });
  if (sum <= 0) {
    initDistributionShares();
    return;
  }
  accountBlocks.forEach(block => {
    const id = block.dataset.id;
    distributionShares[id] = (distributionShares[id] || 0) / sum;
  });
}

function recordShareSnapshot(requiredChunks) {
  if (!requiredChunks) return;
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    const value = parseInt(slider.value, 10) || 0;
    distributionShares[block.dataset.id] = value / requiredChunks;
  });
  normalizeShares();
}

function allocateChunksForTotal(totalChunks) {
  if (!totalChunks) {
    return { allocations: {}, remainder: 0 };
  }
  const accounts = accountBlocks.map(block => {
    const id = block.dataset.id;
    return {
      id,
      share: distributionShares[id] || 0,
      capacity: getAccountCapacity(id),
    };
  });

  const available = accounts.filter(acc => acc.capacity > 0);
  if (!available.length) {
    return { allocations: {}, remainder: totalChunks };
  }

  let shareSum = available.reduce((sum, acc) => sum + acc.share, 0);
  if (shareSum <= 0) {
    available.forEach(acc => {
      acc.share = 1 / available.length;
    });
    shareSum = 1;
  } else {
    available.forEach(acc => {
      acc.share /= shareSum;
    });
  }

  const allocations = {};
  let remaining = totalChunks;
  available.forEach(acc => {
    const target = acc.share * totalChunks;
    const base = Math.min(acc.capacity, Math.floor(target));
    allocations[acc.id] = base;
    acc.target = target;
    acc.frac = target - Math.floor(target);
    remaining -= base;
  });

  const sorted = [...available].sort((a, b) => b.frac - a.frac);
  while (remaining > 0) {
    let assigned = false;
    for (const acc of sorted) {
      if (remaining === 0) break;
      if ((allocations[acc.id] || 0) < acc.capacity) {
        allocations[acc.id] = (allocations[acc.id] || 0) + 1;
        remaining -= 1;
        assigned = true;
      }
    }
    if (!assigned) break;
  }

  return { allocations, remainder: remaining };
}

function updateSliderBounds(entry) {
  const required = entry ? Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes)) : 0;
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    const maxLabel = block.querySelector(".acc-max");
    const capacity = getAccountCapacity(block.dataset.id);
    const max = entry ? Math.min(capacity, required) : 0;
    slider.max = max;
    if (maxLabel) maxLabel.textContent = max;
  });
}

function applyDistributionToSliders() {
  const entry = getActiveEntry();
  if (!entry) {
    updateSliderBounds(null);
    accountBlocks.forEach(block => {
      const slider = block.querySelector(".chunk-slider");
      slider.value = 0;
      const tooltip = block.querySelector(".tooltip");
      if (tooltip) tooltip.textContent = "0";
      block.querySelector(".slider-value").textContent = "0 chunks";
    });
    validateTotals();
    return;
  }
  updateSliderBounds(entry);
  const required = Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes));
  const { allocations, remainder } = allocateChunksForTotal(required);
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    const value = allocations[block.dataset.id] || 0;
    slider.value = value;
    const tooltip = block.querySelector(".tooltip");
    if (tooltip) tooltip.textContent = value;
    block.querySelector(".slider-value").textContent = `${value} chunks`;
  });
  if (distributionInitialized) {
    recordShareSnapshot(required);
  }
  validateTotals(remainder);
}

function setActiveFile(index) {
  if (!fileEntries.length) {
    activeFileIndex = -1;
    file = null;
    updateFileInfo();
    renderFileList();
    applyDistributionToSliders();
    return;
  }
  const clamped = Math.min(Math.max(index, 0), fileEntries.length - 1);
  activeFileIndex = clamped;
  file = fileEntries[clamped].file;
  updateFileInfo();
  renderFileList();
  applyDistributionToSliders();
  startEntryChecksum(fileEntries[clamped]);
}

function setSelectedFiles(fileList) {
  fileEntries.length = 0;
  Array.from(fileList || []).forEach(f => {
    fileEntries.push({
      file: f,
      checksum: "",
      checksumPromise: null,
      checksumContext: 0,
    });
  });
  distributionInitialized = false;
  if (fileEntries.length) {
    setActiveFile(0);
  } else {
    setActiveFile(-1);
  }
}

function validateTotals(forceRemainder) {
  const warn = document.getElementById("total-warning");
  const btn = document.getElementById("uploadBtn");
  const entry = getActiveEntry();
  if (!entry) {
    warn.textContent = "Select at least one file to configure uploads.";
    warn.classList.remove("hidden");
    btn.disabled = true;
    return;
  }
  const required = Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes));
  let sum = 0;
  accountBlocks.forEach(block => {
    const slider = block.querySelector(".chunk-slider");
    sum += parseInt(slider.value, 10) || 0;
  });
  if (sum !== required) {
    warn.textContent = `Total assigned chunks must equal ${required} (currently ${sum}).`;
    warn.classList.remove("hidden");
    btn.disabled = true;
    return;
  }
  const remainder = typeof forceRemainder === "number"
    ? forceRemainder
    : allocateChunksForTotal(required).remainder;
  if (remainder > 0) {
    warn.textContent = "Insufficient available Drive space to cover this file.";
    warn.classList.remove("hidden");
    btn.disabled = true;
    return;
  }
  warn.classList.add("hidden");
  btn.disabled = false;
}

document.getElementById("fileInput").addEventListener("change", e => {
  setSelectedFiles(e.target.files);
});

document.getElementById("chunkSize").addEventListener("input", e => {
  const next = parseInt(e.target.value, 10);
  if (Number.isNaN(next) || next <= 0) return;
  chunkSizeMB = next;
  chunkSizeBytes = chunkSizeMB * 1024 * 1024;
  updateFileInfo();
  applyDistributionToSliders();
});

document.querySelectorAll(".chunk-slider").forEach(sl => {
  const tooltip = sl.parentElement.querySelector(".tooltip");
  sl.addEventListener("input", e => {
    const entry = getActiveEntry();
    if (!entry) return;
    const val = parseInt(e.target.value, 10) || 0;
    if (tooltip) tooltip.textContent = val;
    const valueLabel = e.target.closest(".account-block").querySelector(".slider-value");
    if (valueLabel) valueLabel.textContent = `${val} chunks`;
    const required = Math.max(1, Math.ceil(entry.file.size / chunkSizeBytes));
    distributionInitialized = true;
    recordShareSnapshot(required);
    validateTotals();
  });
  sl.addEventListener("mousemove", e => {
    if (!tooltip) return;
    const rect = sl.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left}px`;
  });
  sl.addEventListener("mouseenter", () => tooltip?.classList.remove("hidden"));
  sl.addEventListener("mouseleave", () => tooltip?.classList.add("hidden"));
});

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

document.getElementById("uploadBtn").addEventListener("click", async () => {
  if (!fileEntries.length) return;
  const container = document.getElementById("progressContainer");
  container.innerHTML = "";

  for (const entry of fileEntries) {
    const currentFile = entry.file;
    const chunkSize = chunkSizeBytes;
    const totalChunksLocal = Math.max(1, Math.ceil(currentFile.size / chunkSize));
    const { allocations, remainder } = allocateChunksForTotal(totalChunksLocal);

    const fileSection = document.createElement("div");
    fileSection.className = "file-progress";
    fileSection.innerHTML = `<h3>${currentFile.name}</h3>`;
    container.appendChild(fileSection);

    if (remainder > 0) {
      const warn = document.createElement("div");
      warn.textContent = "Skipped — insufficient Drive space for this distribution.";
      fileSection.appendChild(warn);
      continue;
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
      const chunksForAcc = allocations[accountId] || 0;
      if (!chunksForAcc) continue;

      const progressBlock = createProgressBar(block.querySelector(".acc-email").textContent, fileSection);
      let uploadedBytes = 0;
      const totalUploadBytes = Math.min(
        currentFile.size - chunkIndex * chunkSize,
        chunksForAcc * chunkSize,
      );

      for (let i = 0; i < chunksForAcc; i += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, currentFile.size);
        const blob = currentFile.slice(start, end);

        let hash = "";
        try {
          hash = await checksum(blob);
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
            checksum: hash,
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
      continue;
    }

    const saveRes = await fetch(SAVE_MANIFEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      body: JSON.stringify({
        file_name: currentFile.name,
        total_size: currentFile.size,
        chunk_size: chunkSizeBytes,
        total_chunks: totalChunksLocal,
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
