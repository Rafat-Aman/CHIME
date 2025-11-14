// ------------------------------
// upload.js - final uploader
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
let fileSize = 0;
let chunkSizeMB = 500;
let chunkSizeBytes = 500 * 1024 * 1024;
let totalChunks = 0;
let fileChecksum = "";
let fileChecksumPromise = null;
let fileChecksumContext = 0;
const fileChecksumEl = document.getElementById("file-checksum");

function renderFileChecksumDisplay(message) {
  if (!fileChecksumEl) return;
  if (message) {
    fileChecksumEl.textContent = message;
    return;
  }
  if (fileChecksum) {
    fileChecksumEl.textContent = fileChecksum;
  } else if (fileChecksumPromise) {
    fileChecksumEl.textContent = "Computing...";
  } else {
    fileChecksumEl.textContent = "N/A";
  }
}

function startFileChecksum() {
  if (!file) {
    fileChecksum = "";
    renderFileChecksumDisplay();
    return null;
  }
  if (fileChecksumPromise) return fileChecksumPromise;
  const context = fileChecksumContext;
  const promise = checksum(file)
    .then(hash => {
      if (context !== fileChecksumContext) return hash;
      fileChecksum = hash;
      renderFileChecksumDisplay();
      return hash;
    })
    .catch(err => {
      console.error("File checksum failed", err);
      if (context === fileChecksumContext) {
        fileChecksum = "";
        renderFileChecksumDisplay("Checksum failed");
      }
      return "";
    })
    .finally(() => {
      if (fileChecksumContext === context && fileChecksumPromise === promise) {
        fileChecksumPromise = null;
        if (!fileChecksum) {
          renderFileChecksumDisplay();
        }
      }
    });
  fileChecksumPromise = promise;
  renderFileChecksumDisplay();
  return promise;
}

async function ensureFileChecksum() {
  if (fileChecksum) return fileChecksum;
  if (!file) return "";
  if (!fileChecksumPromise) {
    startFileChecksum();
  }
  if (fileChecksumPromise) {
    try {
      await fileChecksumPromise;
    } catch (err) {
      console.error("Checksum promise failed", err);
    }
  }
  return fileChecksum;
}

function updateFileInfo() {
  document.getElementById("file-info").classList.remove("hidden");
  document.getElementById("file-size").textContent = `${toMB(fileSize)} MB`;
  document.getElementById("total-chunks").textContent = totalChunks;
  renderFileChecksumDisplay();
}

function parseRemainingMB(s) {
  if (!s) return 0;
  s = String(s).trim();
  const m = s.match(/([\d.]+)\s*(GB|MB)?/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = (m[2] || "MB").toUpperCase();
  return unit === "GB" ? val * 1024 : val;
}

function updateSliders() {
  const sliders = document.querySelectorAll(".chunk-slider");
  sliders.forEach(sl => {
    const accBlock = sl.closest(".account-block");
    const remainingMB = parseRemainingMB(accBlock.dataset.remaining);
    const maxChunks = Math.max(0, Math.floor(remainingMB / chunkSizeMB));
    sl.max = Math.min(maxChunks, totalChunks);
    accBlock.querySelector(".acc-max").textContent = sl.max;
    if (parseInt(sl.value) > sl.max) sl.value = sl.max;
    sl.dispatchEvent(new Event("input"));
  });
  validateTotals();
}

document.getElementById("fileInput").addEventListener("change", async e => {
  file = e.target.files[0];
  fileChecksumContext += 1;
  fileChecksumPromise = null;
  fileChecksum = "";
  renderFileChecksumDisplay();
  if (!file) {
    fileSize = 0;
    totalChunks = 0;
    return;
  }
  fileSize = file.size;
  chunkSizeMB = parseInt(document.getElementById("chunkSize").value);
  chunkSizeBytes = chunkSizeMB * 1024 * 1024;
  totalChunks = Math.ceil(fileSize / chunkSizeBytes);
  updateFileInfo();
  updateSliders();
  startFileChecksum();
});

document.getElementById("chunkSize").addEventListener("input", e => {
  if (!file) return;
  const oldTotal = totalChunks;
  chunkSizeMB = parseInt(e.target.value);
  chunkSizeBytes = chunkSizeMB * 1024 * 1024;
  totalChunks = Math.ceil(fileSize / chunkSizeBytes);
  const ratio = totalChunks / (oldTotal || 1);
  document.querySelectorAll(".chunk-slider").forEach(sl => {
    const val = parseInt(sl.value);
    const newVal = Math.round(val * ratio);
    sl.value = Math.min(newVal, parseInt(sl.max));
    sl.dispatchEvent(new Event("input"));
  });
  updateFileInfo();
  updateSliders();
});

document.querySelectorAll(".chunk-slider").forEach(sl => {
  const tooltip = sl.parentNode.querySelector(".tooltip");
  sl.addEventListener("input", e => {
    const val = parseInt(e.target.value);
    tooltip.textContent = val;
    sl.closest(".account-block").querySelector(".slider-value").textContent = `${val} chunks`;
    validateTotals();
  });
  sl.addEventListener("mousemove", e => {
    const rect = sl.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left}px`;
  });
  sl.addEventListener("mouseenter", () => tooltip.classList.remove("hidden"));
  sl.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
});

function validateTotals() {
  let sum = 0;
  document.querySelectorAll(".chunk-slider").forEach(s => sum += parseInt(s.value));
  const warn = document.getElementById("total-warning");
  const btn = document.getElementById("uploadBtn");
  if (sum !== totalChunks) {
    warn.textContent = `Total assigned chunks must equal ${totalChunks} (currently ${sum}).`;
    warn.classList.remove("hidden");
    btn.disabled = true;
  } else {
    warn.classList.add("hidden");
    btn.disabled = false;
  }
}

async function checksum(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function createProgressBar(label) {
  const block = document.createElement("div");
  block.className = "progress-item";
  block.innerHTML = `
    <span class="progress-label">${label}</span>
    <div class="progress-outer"><div class="progress-inner"></div></div>
    <div class="progress-text">0 MB / 0 MB</div>
    <button class="retry hidden">Retry</button>
    <div class="checkmark hidden">✓</div>`;
  document.getElementById("progressContainer").appendChild(block);
  return block;
}
function updateBar(block, uploaded, total) {
  const bar = block.querySelector(".progress-inner");
  const pct = Math.min(100, (uploaded / total) * 100);
  bar.style.width = pct + "%";
  block.querySelector(".progress-text").textContent = `${toMB(uploaded)} / ${toMB(total)} MB`;
}

document.getElementById("uploadBtn").addEventListener("click", async () => {
  if (!file) return;
  const overallChecksum = await ensureFileChecksum();
  if (!overallChecksum) {
    alert("Unable to compute the file checksum. Please reselect the file and try again.");
    return;
  }
  const chunkSize = chunkSizeMB * 1024 * 1024;
  const totalChunksLocal = Math.ceil(file.size / chunkSize);
  const manifest = [];
  const container = document.getElementById("progressContainer");
  container.innerHTML = "";

  let chunkIndex = 0;

  for (const acc of document.querySelectorAll(".account-block")) {
    const chunksForAcc = parseInt(acc.querySelector(".chunk-slider").value);
    const accountId = acc.dataset.id;
    if (!chunksForAcc) continue;

    const progressBlock = createProgressBar(acc.querySelector(".acc-email").textContent);
    let uploadedBytes = 0;
    const totalUploadBytes = Math.min(file.size - (chunkIndex * chunkSize), chunksForAcc * chunkSize);

    for (let i = 0; i < chunksForAcc; i++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);

      let hash = "";
      try {
        hash = await checksum(blob);
      } catch (e) {
        console.error("Checksum failed", e);
      }

      const createRes = await fetch(CREATE_SESSION_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-CSRFToken": csrf()},
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          account_id: accountId,
          chunk_index: chunkIndex
        }),
      });

      if (!createRes.ok) {
        const txt = await createRes.text();
        progressBlock.querySelector(".retry").classList.remove("hidden");
        progressBlock.querySelector(".progress-inner").style.background = "#f55";
        console.error("Create session failed", txt);
        return;
      }

      const createData = await createRes.json();
      const upload_url = createData.upload_url;
      if (!upload_url) {
        console.error("No upload_url from server", createData);
        return;
      }

      const qs = new URLSearchParams({
        upload_url,
        account_id: accountId,
        start: 0,
        end: (blob.size - 1),
        mime: file.type || "application/octet-stream"
      });

      const putRes = await fetch(`${PROXY_CHUNK_URL}?${qs.toString()}`, {
        method: "POST",
        headers: {"X-CSRFToken": csrf()},
        body: blob
      });

      if (putRes.status === 200 || putRes.status === 201) {
        let driveFileId = null;
        try {
          const text = await putRes.text();
          const parsed = JSON.parse(text || "{}");
          driveFileId = parsed.id || null;
        } catch (e) {
          console.warn("Failed to parse drive response JSON", e);
        }

        uploadedBytes += blob.size;
        updateBar(progressBlock, uploadedBytes, totalUploadBytes);

        manifest.push({
          index: chunkIndex,
          account_id: parseInt(accountId),
          drive_file_id: driveFileId,
          size: blob.size,
          checksum: hash,
          uploaded_at: new Date().toISOString()
        });

        chunkIndex++;
        continue;
      }

      if (putRes.status === 308) {
        uploadedBytes += blob.size;
        updateBar(progressBlock, uploadedBytes, totalUploadBytes);
        chunkIndex++;
        continue;
      }

      console.error("Chunk upload failed", putRes.status, await putRes.text());
      progressBlock.querySelector(".retry").classList.remove("hidden");
      progressBlock.querySelector(".progress-inner").style.background = "#f55";
      return;
    }

    progressBlock.querySelector(".checkmark").classList.remove("hidden");
  }

  const saveRes = await fetch(SAVE_MANIFEST_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-CSRFToken": csrf()},
    body: JSON.stringify({
      file_name: file.name,
      total_size: file.size,
      chunk_size: chunkSize,
      total_chunks: totalChunksLocal,
      file_checksum: overallChecksum,
      chunks: manifest
    })
  });

  if (!saveRes.ok) {
    console.error("Saving manifest failed", await saveRes.text());
    return;
  }

  const saved = await saveRes.json();
  console.log("Manifest saved", saved);
  const done = document.createElement("div");
  done.textContent = "Upload complete — manifest saved.";
  document.getElementById("progressContainer").appendChild(done);
});
