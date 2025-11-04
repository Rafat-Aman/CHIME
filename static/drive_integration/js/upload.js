async function uploadFile(file, chunkSizeMB, backendSessionUrl) {
  if (!file) {
    alert("Please select a file!");
    return;
  }

  const chunkSize = chunkSizeMB * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);
  let start = 0;

  // Step 1: Ask backend for upload session URL
  const formData = new FormData();
  formData.append("filename", file.name);
  formData.append("filesize", file.size);
  formData.append("mime_type", file.type);

  const sessionResp = await fetch(backendSessionUrl, { method: "POST", body: formData });
  const { uploadUrl } = await sessionResp.json();

  // Step 2: Upload chunks
  const bar = document.getElementById("bar");

  for (let i = 0; i < totalChunks; i++) {
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);

    const headers = { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` };
    const response = await fetch(uploadUrl, { method: "PUT", headers, body: blob });

    if (response.status === 308) {
      // Partial upload
      start = end;
      bar.style.width = ((end / file.size) * 100) + "%";
    } else if (response.ok) {
      bar.style.width = "100%";
      alert("Upload complete!");
      break;
    } else {
      console.error(await response.text());
      alert("Upload failed!");
      break;
    }
  }
}
