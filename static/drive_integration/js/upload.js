// --------------------------------------
// GraceCoding Frontend Uploader (Fixed Version)
// --------------------------------------

// ---- Helpers ----
function csrf() {
  const name = "csrftoken=";
  for (const c of document.cookie.split(";")) {
    const s = c.trim();
    if (s.startsWith(name)) return s.substring(name.length);
  }
  return "";
}
const toMB = b => (b / (1024 * 1024)).toFixed(1);
const formatMB = b => `${toMB(b)} MB`;

async function checksum(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- Globals ----
let file = null;
let fileSize = 0;
let chunkSizeMB = 500;
let chunkSizeBytes = 500 * 1024 * 1024;
let totalChunks = 0;

// ---- UI Updates ----
function updateFileInfo() {
  document.getElementById("file-info").classList.remove("hidden");
  document.getElementById("file-size").textContent = formatMB(fileSize);
  document.getElementById("total-chunks").textContent = totalChunks;
}

function updateSliders() {
  const sliders = document.querySelectorAll(".chunk-slider");
  sliders.forEach(sl => {
    const accBlock = sl.closest(".account-block");
    const remainingText = accBlock.dataset.remaining;
    let availableMB = parseFloat(remainingText);
    if (isNaN(availableMB)) availableMB = 0;
    const maxChunks = Math.floor(availableMB / chunkSizeMB);
    sl.max = maxChunks > totalChunks ? totalChunks : maxChunks;
    accBlock.querySelector(".acc-max").textContent = sl.max;
    sl.value = 0;
    sl.dispatchEvent(new Event("input"));
  });
  validateTotals();
}

// ---- File + chunk size handlers ----
document.getElementById("fileInput").addEventListener("change", e => {
  file = e.target.files[0];
  if (!file) return;
  fileSize = file.size;
  chunkSizeMB = parseInt(document.getElementById("chunkSize").value);
  chunkSizeBytes = chunkSizeMB * 1024 * 1024;
  totalChunks = Math.ceil(fileSize / chunkSizeBytes);
  updateFileInfo();
  updateSliders();
});

document.getElementById("chunkSize").addEventListener("input", e => {
  if (!file) return;
  const prevChunkSize = chunkSizeBytes;
  chunkSizeMB = parseInt(e.target.value);
  chunkSizeBytes = chunkSizeMB * 1024 * 1024;
  const oldTotal = totalChunks;
  totalChunks = Math.ceil(fileSize / chunkSizeBytes);
  const ratio = totalChunks / oldTotal;

  document.querySelectorAll(".chunk-slider").forEach(sl => {
    const val = parseInt(sl.value);
    const newVal = Math.round(val * ratio);
    sl.value = Math.min(newVal, parseInt(sl.max));
    sl.dispatchEvent(new Event("input"));
  });
  updateFileInfo();
  updateSliders();
});

// ---- Slider interaction ----
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

// ---- Validation ----
function validateTotals() {
  const sliders = document.querySelectorAll(".chunk-slider");
  let sum = 0;
  sliders.forEach(s => sum += parseInt(s.value));
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

// --------------------------------------
// Upload Handling
// --------------------------------------
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

// ---- Main upload sequence ----
document.getElementById("uploadBtn").addEventListener("click", async () => {
  if (!file) return;
  const sliders = document.querySelectorAll(".chunk-slider");
  const container = document.getElementById("progressContainer");
  container.innerHTML = "";

  const chunkSize = chunkSizeMB * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);
  const manifest = [];

  let chunkIndex = 0;

  for (const acc of document.querySelectorAll(".account-block")) {
    const chunksForAcc = parseInt(acc.querySelector(".chunk-slider").value);
    const accId = acc.dataset.id;
    if (chunksForAcc === 0) continue;

    const block = createProgressBar(acc.querySelector(".acc-email").textContent);
    let uploadedBytes = 0;
    const totalUpload = Math.min(file.size - chunkIndex * chunkSize, chunksForAcc * chunkSize);

    for (let i = 0; i < chunksForAcc; i++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);
      const hash = await checksum(blob);

      // 1. Create upload session
      const sessionRes = await fetch(CREATE_SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type,
          account_id: accId,
          chunk_index: chunkIndex
        })
      });
      const { upload_url } = await sessionRes.json();

      // 2. Upload chunk via proxy (reset Content-Range each time)
      const qs = new URLSearchParams({
        upload_url,
        account_id: accId,
        start: 0,
        end: blob.size - 1,
        total: blob.size,
        mime: file.type
      });

      const putRes = await fetch(`${PROXY_CHUNK_URL}?${qs.toString()}`, {
        method: "POST",
        headers: { "X-CSRFToken": csrf() },
        body: blob
      });

      if (![200, 201].includes(putRes.status)) {
        block.querySelector(".retry").classList.remove("hidden");
        block.querySelector(".progress-inner").style.background = "#f55";
        console.error(`Chunk ${chunkIndex} failed for account ${accId}`);
        break;
      }

      uploadedBytes += blob.size;
      updateBar(block, uploadedBytes, totalUpload);
      manifest.push({
        index: chunkIndex,
        account_id: accId,
        size: blob.size,
        checksum: hash
      });
      chunkIndex++;
    }
    block.querySelector(".checkmark").classList.remove("hidden");
  }

  // Save manifest
  await fetch(SAVE_MANIFEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
    body: JSON.stringify({
      file_name: file.name,
      total_size: file.size,
      chunk_size: chunkSize,
      total_chunks: totalChunks,
      chunks: manifest
    })
  });
});
