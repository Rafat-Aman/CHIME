function getCSRFToken() {
  const name = "csrftoken=";
  for (const c of decodeURIComponent(document.cookie).split(";")) {
    const s = c.trim();
    if (s.startsWith(name)) return s.substring(name.length);
  }
  return "";
}

function createProgressBar(label) {
  const container = document.createElement("div");
  container.className = "progress-item";
  const text = document.createElement("span");
  text.className = "progress-label";
  text.textContent = label;

  const barOuter = document.createElement("div");
  barOuter.className = "progress-outer";
  const barInner = document.createElement("div");
  barInner.className = "progress-inner";
  barOuter.appendChild(barInner);

  const check = document.createElement("div");
  check.className = "checkmark hidden";
  check.innerHTML = "✓";

  container.append(text, barOuter, check);
  document.getElementById("progressContainer").appendChild(container);
  return { bar: barInner, check };
}

function updateBar(bar, percent) {
  bar.style.width = Math.min(100, Math.max(0, percent)) + "%";
}

async function uploadFileForAccount(file, chunkSizeMB, accountId, createUrl, proxyUrl, bar, check) {
  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCSRFToken(),
    },
    body: JSON.stringify({
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      account_id: accountId,
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const uploadUrl = data.upload_url;
  const chunkSize = Math.max(1, Number(chunkSizeMB) || 5) * 1024 * 1024;
  let uploaded = 0;

  while (uploaded < file.size) {
    const end = Math.min(uploaded + chunkSize, file.size);
    const chunk = file.slice(uploaded, end);
    const qs = new URLSearchParams({
      upload_url: uploadUrl,
      start: uploaded,
      end: end - 1,
      total: file.size,
      mime: file.type,
      account_id: accountId,
    });

    const r = await fetch(`${proxyUrl}?${qs.toString()}`, {
      method: "POST",
      headers: { "X-CSRFToken": getCSRFToken() },
      body: chunk,
    });

    if (r.status === 308) {
      uploaded = end;
      updateBar(bar, (uploaded / file.size) * 100);
      continue;
    }
    if (r.status === 200 || r.status === 201) {
      updateBar(bar, 100);
      check.classList.remove("hidden");
      return;
    }
    throw new Error(await r.text());
  }
}

document.getElementById("uploadBtn").addEventListener("click", async () => {
  const file = document.getElementById("fileInput").files[0];
  if (!file) return alert("Select a file first.");
  const chunkSize = parseInt(document.getElementById("chunkSize").value) || 5;
  const selected = Array.from(document.querySelectorAll('input[name="account"]:checked')).map(el => el.value);
  if (selected.length === 0) return alert("Select at least one account.");

  const container = document.getElementById("progressContainer");
  container.innerHTML = "";
  const bars = selected.map(id => {
    const label = document.querySelector(`input[value="${id}"]`).parentNode.innerText.trim();
    return { id, label, ...createProgressBar(label) };
  });

  for (const item of bars) {
    try {
      await uploadFileForAccount(file, chunkSize, item.id, CREATE_SESSION_URL, PROXY_CHUNK_URL, item.bar, item.check);
    } catch (err) {
      console.error(err);
      item.bar.style.background = "#f66";
      item.bar.title = "Upload failed";
      break;
    }
  }
});
