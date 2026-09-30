const $ = (selector) => document.querySelector(selector);
const dbName = "papertrail-local-v1";
let db;
let subjects = [];
let currentSubjectId = null;
let drafts = [];
let editor = null;
let toastTimer;
let pendingFiles = null;

const homeView = $("#home-view");
const subjectView = $("#subject-view");
const subjectDialog = $("#subject-dialog");
const editorDialog = $("#editor-dialog");
const backupDialog = $("#backup-dialog");
const editorCanvas = $("#editor-canvas");
const canvasOverlay = $("#canvas-overlay");
const editorCtx = editorCanvas.getContext("2d", { willReadFrequently: true });

function showToast(message, ms = 2800) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) { button.dataset.original = button.innerHTML; button.disabled = true; button.textContent = text; }
  else { button.disabled = false; if (button.dataset.original) button.innerHTML = button.dataset.original; }
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("subjects")) request.result.createObjectStore("subjects", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbRequest(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("subjects", mode); const store = tx.objectStore("subjects");
    let result;
    try { result = action(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error || result?.error || new Error("Could not save this notebook."));
    tx.onabort = () => reject(tx.error || new Error("The save was cancelled."));
  });
}
const getAllSubjects = () => dbRequest("readonly", (store) => store.getAll());
const putSubject = (subject) => dbRequest("readwrite", (store) => store.put(subject));
const removeSubject = (id) => dbRequest("readwrite", (store) => store.delete(id));
function subject() { return subjects.find((s) => s.id === currentSubjectId); }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])); }

async function init() {
  try {
    db = await openDb();
    subjects = await getAllSubjects();
    for (const existing of subjects) {
      const pages = existing.pages.map((page) => isOldDefaultCrop(page.crop) ? { ...page, crop: fullCrop() } : page);
      if (pages.some((page, index) => page !== existing.pages[index])) {
        const updated = { ...existing, pages, updatedAt: Date.now(), lastError: null };
        try {
          updated.pdf = pages.length ? await buildPdf(pages) : null;
          await putSubject(updated);
          subjects = subjects.map((item) => item.id === updated.id ? updated : item);
        } catch (error) {
          console.warn("Could not refresh a PDF after removing the old default crop.", error);
          existing.lastError = "The old default crop could not be removed yet. Reset crop on the affected page and save to rebuild its PDF.";
        }
      }
    }
  } catch (error) {
    console.error(error); showToast("Local storage is unavailable. Try opening this app in a regular browser tab.", 6000);
    subjects = [];
  }
  renderHome();
  if (!window.PapertrailAndroid && "serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
}
function renderHome() {
  $("#subject-count").textContent = subjects.length;
  const grid = $("#subjects-grid"); grid.replaceChildren();
  subjects.slice().sort((a, b) => b.updatedAt - a.updatedAt).forEach((s) => {
    const card = document.createElement("article"); card.className = "subject-card"; card.tabIndex = 0; card.setAttribute("role", "button");
    card.innerHTML = `<div class="subject-card-top"><span class="subject-icon">▤</span><button class="subject-menu" aria-label="Subject options">···</button></div><div class="subject-name">${escapeHTML(s.name)}</div><div class="subject-sub">${s.pages.length} ${s.pages.length === 1 ? "page" : "pages"} · ${formatDate(s.updatedAt)}</div>`;
    card.addEventListener("click", (event) => { if (event.target.closest(".subject-menu")) { event.stopPropagation(); subjectOptions(s.id); } else openSubject(s.id); });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openSubject(s.id); } }); grid.append(card);
  });
  $("#empty-state").classList.toggle("hidden", subjects.length > 0);
}
function subjectOptions(id) {
  const item = subjects.find((s) => s.id === id); if (!item) return;
  if (confirm(`Delete “${item.name}” and its pages from this browser? This cannot be undone.`)) {
    removeSubject(id).then(() => { subjects = subjects.filter((s) => s.id !== id); renderHome(); showToast("Subject deleted from this browser."); }).catch(storageError);
  }
}
function openSubject(id) {
  currentSubjectId = id; drafts = []; homeView.classList.add("hidden"); subjectView.classList.remove("hidden"); renderSubject(); window.scrollTo(0, 0);
}
function goHome() { currentSubjectId = null; drafts = []; subjectView.classList.add("hidden"); homeView.classList.remove("hidden"); renderHome(); window.scrollTo(0, 0); }

function renderSubject() {
  const s = subject(); if (!s) return goHome();
  $("#subject-title").textContent = s.name;
  $("#subject-meta").textContent = `${s.pages.length} ${s.pages.length === 1 ? "page" : "pages"} · Last saved ${formatDate(s.updatedAt)}`;
  $("#page-count").textContent = s.pages.length;
  $("#download-pdf").disabled = !s.pdf;
  const status = $("#pdf-status"); status.classList.toggle("hidden", !s.lastError);
  status.classList.toggle("error", Boolean(s.lastError)); status.textContent = s.lastError || (s.pdf ? "Your current PDF is ready. Saving notebook changes will replace it after the new PDF is ready." : "Add and save pages to create this subject’s PDF.");
  const pdfStatus = $("#pdf-status"); if (!s.lastError) pdfStatus.classList.toggle("hidden", s.pages.length === 0 && !s.pdf);
  renderDrafts(); renderPages();
}
function renderDrafts() {
  const grid = $("#drafts-grid"), bar = $("#draft-bar"); grid.replaceChildren();
  bar.classList.toggle("hidden", drafts.length === 0);
  $("#draft-count").textContent = drafts.length; $("#draft-plural").textContent = drafts.length === 1 ? "" : "s";
  drafts.forEach((page, index) => grid.append(pageCard(page, index, true)));
}
function renderPages() {
  const s = subject(); if (!s) return;
  const grid = $("#pages-grid"); grid.replaceChildren();
  $("#pages-empty").classList.toggle("hidden", s.pages.length > 0 || drafts.length > 0);
  s.pages.forEach((page, index) => grid.append(pageCard(page, index, false)));
}
function pageCard(page, index, isDraft) {
  const card = document.createElement("article"); card.className = "page-card"; card.draggable = true; card.dataset.index = index; card.dataset.draft = isDraft ? "1" : "0";
  const preview = document.createElement("div"); preview.className = "page-preview";
  const image = document.createElement("img"); image.alt = page.name || `Note page ${index + 1}`; image.loading = "lazy";
  preview.append(image);
  const footer = document.createElement("div"); footer.className = "page-card-footer";
  const filename = page.name || `Page ${index + 1}`;
  footer.innerHTML = `<span class="page-label" title="${escapeHTML(filename)}">${escapeHTML(filename)}</span><span class="page-actions"><button class="page-action edit" title="Edit page" aria-label="Edit page">✎</button><button class="page-action delete" title="Delete page" aria-label="Delete page">×</button></span>`;
  const up = document.createElement("button"), down = document.createElement("button");
  up.className = "page-action move-up"; up.title = "Move page up"; up.setAttribute("aria-label", "Move page up"); up.textContent = "↑"; up.disabled = index === 0;
  down.className = "page-action move-down"; down.title = "Move page down"; down.setAttribute("aria-label", "Move page down"); down.textContent = "↓"; down.disabled = index === (isDraft ? drafts.length : subject().pages.length) - 1;
  footer.querySelector(".page-actions").prepend(up, down);
  card.append(preview, footer);
  renderPagePreview(page).then((blob) => { if (card.isConnected) { image.src = URL.createObjectURL(blob); image.onload = () => URL.revokeObjectURL(image.src); } }).catch(() => { preview.textContent = "Preview unavailable"; });
  card.querySelector(".edit").addEventListener("click", (event) => { event.stopPropagation(); openEditor(page, isDraft); });
  card.querySelector(".delete").addEventListener("click", (event) => { event.stopPropagation(); deletePage(index, isDraft); });
  up.addEventListener("click", (event) => { event.stopPropagation(); movePage(index, index - 1, isDraft); });
  down.addEventListener("click", (event) => { event.stopPropagation(); movePage(index, index + 1, isDraft); });
  card.addEventListener("click", (event) => { if (!event.target.closest("button")) openEditor(page, isDraft); });
  card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", String(index)); event.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("dragover", (event) => { event.preventDefault(); card.classList.add("drag-over"); });
  card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
  card.addEventListener("drop", async (event) => { event.preventDefault(); card.classList.remove("drag-over"); const from = Number(event.dataTransfer.getData("text/plain")); const to = index; if (from === to) return; if (isDraft) { const [item] = drafts.splice(from, 1); drafts.splice(to, 0, item); renderDrafts(); } else { const next = structuredClone(subject()); const [item] = next.pages.splice(from, 1); next.pages.splice(to, 0, item); await commitNotebook(next, "Page order updated."); } });
  return card;
}
function storageError(error) {
  console.error(error);
  const msg = error?.name === "QuotaExceededError" ? "This browser is low on storage. Export a backup or remove some large pages, then try again." : `Could not save: ${error?.message || "storage error"}`;
  showToast(msg, 6000);
}
async function movePage(from, to, isDraft) {
  if (to < 0 || (isDraft ? to >= drafts.length : to >= subject().pages.length)) return;
  if (isDraft) { const [page] = drafts.splice(from, 1); drafts.splice(to, 0, page); renderDrafts(); }
  else { const next = structuredClone(subject()); const [page] = next.pages.splice(from, 1); next.pages.splice(to, 0, page); await commitNotebook(next, "Page order updated."); }
}

$("#new-subject").addEventListener("click", () => showSubjectDialog());
$("#empty-create").addEventListener("click", () => showSubjectDialog());
function showSubjectDialog(existing = null) {
  $("#subject-dialog-title").textContent = existing ? "Rename your subject" : "Name your subject";
  $("#subject-submit").textContent = existing ? "Save name" : "Create subject";
  $("#subject-name").value = existing?.name || ""; $("#subject-name").dataset.id = existing?.id || "";
  subjectDialog.showModal(); setTimeout(() => $("#subject-name").focus(), 30);
}
$("#subject-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const name = $("#subject-name").value.trim(); if (!name) return;
  const id = $("#subject-name").dataset.id;
  if (id) { const s = subjects.find((x) => x.id === id); if (s) { const next = { ...s, name, updatedAt: Date.now() }; try { await putSubject(next); subjects = subjects.map((x) => x.id === id ? next : x); subjectDialog.close(); renderSubject(); showToast("Subject renamed."); } catch (e) { storageError(e); } } }
  else { const next = { id: uid(), name, pages: [], pdf: null, updatedAt: Date.now(), lastError: null }; try { await putSubject(next); subjects.push(next); subjectDialog.close(); renderHome(); showToast("Subject created."); } catch (e) { storageError(e); } }
});
$("#back-home").addEventListener("click", goHome);
$("#rename-subject").addEventListener("click", () => showSubjectDialog(subject()));

$("#add-pages").addEventListener("click", () => $("#file-input").click());
$("#first-add").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []); event.target.value = ""; if (!files.length) return;
  await stageFiles(files);
});
async function stageFiles(files) {
  let added = 0, failed = [];
  for (const file of files) {
    const ext = file.name.toLowerCase().split(".").pop();
    const supported = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext) || ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type);
    if (!supported) { failed.push(`${file.name}: unsupported format`); continue; }
    try {
      await loadImage(file);
      drafts.push({ id: uid(), name: file.name, mime: file.type || `image/${ext}`, blob: file.slice(0, file.size, file.type || "application/octet-stream"), rotation: 0, crop: fullCrop(), filter: "color" }); added++;
    } catch (error) {
      const heic = /heic|heif/i.test(file.type + file.name);
      failed.push(`${file.name}: ${heic ? "this browser can’t decode HEIC/HEIF; convert it to JPG first or open Papertrail in a browser that supports HEIC" : "the image could not be opened"}`);
    }
  }
  if (added) { renderDrafts(); renderPages(); showToast(`${added} ${added === 1 ? "page is" : "pages are"} ready to review.`); }
  if (failed.length) showToast(failed.slice(0, 2).join(" · ") + (failed.length > 2 ? ` · and ${failed.length - 2} more` : ""), 7000);
}
function fullCrop() { return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]; }
function isOldDefaultCrop(crop) {
  if (!Array.isArray(crop) || crop.length !== 4) return false;
  const edges = crop.map((point) => `${Math.round(point.x * 100)}:${Math.round(point.y * 100)}`).sort().join("|");
  return edges === ["2:2", "2:98", "98:2", "98:98"].sort().join("|");
}
async function deletePage(index, isDraft) {
  if (isDraft) { drafts.splice(index, 1); renderDrafts(); renderPages(); return; }
  const next = structuredClone(subject()); next.pages.splice(index, 1); await commitNotebook(next, next.pages.length ? "Page deleted." : "Last page removed. The saved PDF was cleared.");
}
$("#save-drafts").addEventListener("click", async () => {
  if (!drafts.length) return;
  const button = $("#save-drafts"); setBusy(button, true, "Preparing PDF…");
  const next = structuredClone(subject()); next.pages.push(...drafts); next.updatedAt = Date.now(); next.lastError = null;
  try { await regenerateAndSave(next); drafts = []; subjects = subjects.map((s) => s.id === next.id ? next : s); renderSubject(); showToast("New pages added and PDF updated."); }
  catch (error) { next.lastError = error.message || "Could not generate the PDF."; subject().lastError = next.lastError; renderSubject(); storageError(error); }
  finally { setBusy(button, false); }
});

async function commitNotebook(next, successMessage) {
  const wasPdf = Boolean(subject()?.pdf); const status = $("#pdf-status"); status.classList.remove("hidden", "error"); status.textContent = wasPdf ? "Building the replacement PDF… your current PDF stays available until it’s ready." : "Building your PDF…";
  try {
    next.updatedAt = Date.now(); next.lastError = null;
    next.pdf = next.pages.length ? await buildPdf(next.pages) : null;
    await putSubject(next); // One IDB transaction replaces the prior PDF only after generation succeeds.
    subjects = subjects.map((s) => s.id === next.id ? next : s); renderSubject(); showToast(successMessage);
  } catch (error) {
    const original = subject();
    if (original) original.lastError = `Update not saved: ${error.message || "PDF generation failed"}. The previous PDF and notebook pages are still available.`;
    renderSubject(); storageError(error);
  }
}
async function regenerateAndSave(next) {
  next.updatedAt = Date.now(); next.lastError = null;
  next.pdf = next.pages.length ? await buildPdf(next.pages) : null;
  await putSubject(next);
}

function loadImage(blob) {
  if ("createImageBitmap" in window) return createImageBitmap(blob);
  return new Promise((resolve, reject) => { const url = URL.createObjectURL(blob), img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode image.")); }; img.src = url; });
}
function getRotatedSource(image, rotation) {
  const w = image.width, h = image.height, turns = ((rotation % 4) + 4) % 4;
  const canvas = document.createElement("canvas"); canvas.width = turns % 2 ? h : w; canvas.height = turns % 2 ? w : h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (turns === 0) ctx.drawImage(image, 0, 0);
  else if (turns === 1) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0); }
  else if (turns === 2) { ctx.translate(w, h); ctx.rotate(Math.PI); ctx.drawImage(image, 0, 0); }
  else { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); ctx.drawImage(image, 0, 0); }
  return canvas;
}
async function decodePage(page) { const img = await loadImage(page.blob); return getRotatedSource(img, page.rotation || 0); }
function resizeFor(source, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  if (scale >= 1) return source;
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(source.width * scale)); c.height = Math.max(1, Math.round(source.height * scale));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height); return c;
}
async function processPage(page, maxDim = 2000) {
  const source = resizeFor(await decodePage(page), maxDim);
  const W = source.width, H = source.height, pts = (page.crop?.length === 4 ? page.crop : fullCrop()).map((p) => ({ x: Math.max(0, Math.min(1, p.x)) * (W - 1), y: Math.max(0, Math.min(1, p.y)) * (H - 1) }));
  const edge = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const outW = Math.max(2, Math.min(1800, Math.round(Math.max(edge(pts[0], pts[1]), edge(pts[3], pts[2])) + 1)));
  const outH = Math.max(2, Math.min(2500, Math.round(Math.max(edge(pts[0], pts[3]), edge(pts[1], pts[2])) + 1)));
  const src = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const output = document.createElement("canvas"); output.width = outW; output.height = outH;
  const ctx = output.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.createImageData(outW, outH), dst = imageData.data;
  const [tl, tr, br, bl] = pts;
  const filter = page.filter || "color";
  for (let y = 0; y < outH; y++) {
    const v = y / Math.max(1, outH - 1);
    const leftX = tl.x * (1 - v) + bl.x * v, leftY = tl.y * (1 - v) + bl.y * v;
    const rightX = tr.x * (1 - v) + br.x * v, rightY = tr.y * (1 - v) + br.y * v;
    for (let x = 0; x < outW; x++) {
      const u = x / Math.max(1, outW - 1), fx = Math.max(0, Math.min(W - 1, leftX * (1 - u) + rightX * u)), fy = Math.max(0, Math.min(H - 1, leftY * (1 - u) + rightY * u));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), dx = fx - x0, dy = fy - y0;
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4, at = (y * outW + x) * 4;
      for (let ch = 0; ch < 3; ch++) dst[at + ch] = Math.round((src[a + ch] * (1 - dx) + src[b + ch] * dx) * (1 - dy) + (src[c + ch] * (1 - dx) + src[d + ch] * dx) * dy);
      dst[at + 3] = 255;
      if (filter !== "color") { const gray = .299 * dst[at] + .587 * dst[at + 1] + .114 * dst[at + 2]; const value = filter === "bw" ? (gray > 178 ? 255 : Math.max(0, Math.min(255, gray * 1.5 - 75))) : gray; dst[at] = dst[at + 1] = dst[at + 2] = value; }
    }
    if (y % 120 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, outW, outH); ctx.putImageData(imageData, 0, 0);
  return output;
}
async function canvasToJpeg(canvas, quality = .9) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare an image for the PDF.")), "image/jpeg", quality)); }
async function renderPagePreview(page) { const canvas = await processPage(page, 450); return canvasToJpeg(canvas, .76); }

async function buildPdf(pages) {
  const images = [];
  for (let index = 0; index < pages.length; index++) {
    const canvas = await processPage(pages[index], 1800); const blob = await canvasToJpeg(canvas, .91);
    const bytes = new Uint8Array(await blob.arrayBuffer()); images.push({ bytes, width: canvas.width, height: canvas.height });
  }
  const objects = [];
  const setObject = (number, parts) => { objects[number] = parts; };
  setObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  const kids = pages.map((_, i) => `${3 + 3*i} 0 R`).join(" ");
  setObject(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`]);
  images.forEach((image, i) => {
    const pageObj = 3 + i*3, imageObj = pageObj+1, contentObj = pageObj+2;
    const landscape = image.width > image.height, pageW = landscape ? 841.89 : 595.28, pageH = landscape ? 595.28 : 841.89;
    const scale = Math.min(pageW/image.width, pageH/image.height), w = image.width*scale, h = image.height*scale, x = (pageW-w)/2, y = (pageH-h)/2;
    const content = `q\n${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/Im0 Do\nQ`;
    setObject(pageObj, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`]);
    setObject(imageObj, [`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`, image.bytes, "\nendstream"]);
    setObject(contentObj, [`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`]);
  });
  const chunks = [new TextEncoder().encode("%PDF-1.4\n%Papertrail\n")], offsets=[0]; let position=chunks[0].length;
  for (let n=1;n<objects.length;n++) { offsets[n]=position; const head=new TextEncoder().encode(`${n} 0 obj\n`), body=objects[n].map((part)=>typeof part==="string"?new TextEncoder().encode(part):part), tail=new TextEncoder().encode("\nendobj\n"); chunks.push(head,...body,tail); position+=head.length+body.reduce((sum,b)=>sum+b.length,0)+tail.length; }
  const xrefStart=position, xref=[`xref\n0 ${objects.length}\n`,`0000000000 65535 f \n`];
  for(let n=1;n<objects.length;n++) xref.push(`${String(offsets[n]).padStart(10,"0")} 00000 n \n`);
  const trailer=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  chunks.push(new TextEncoder().encode(xref.join("")+trailer));
  return new Blob(chunks,{type:"application/pdf"});
}

async function openEditor(page, isDraft) {
  try {
    const source = await decodePage(page); editor = { page: structuredClone(page), isDraft, source };
    $("#editor-title").textContent = page.name || "Refine your page";
    $("#editor-error").classList.add("hidden");
    document.querySelectorAll(".filter-option").forEach((button) => button.classList.toggle("active", button.dataset.filter === (page.filter || "color")));
    drawEditor(); editorDialog.showModal();
  } catch (error) { showToast(/heic|heif/i.test(page.mime + page.name) ? "This browser can’t decode this HEIC/HEIF image. Convert it to JPG to edit it." : "Could not open this image for editing.", 5000); }
}
function drawEditor() {
  if (!editor) return;
  const { source, page } = editor;
  const maxW = Math.max(240, Math.min(760, $(".canvas-wrap").clientWidth-20)), maxH = Math.max(240, Math.min(760, $(".canvas-wrap").clientHeight-20));
  const scale = Math.min(maxW/source.width,maxH/source.height,1); const w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
  editorCanvas.width=w;editorCanvas.height=h;editorCanvas.style.width=`${w}px`;editorCanvas.style.height=`${h}px`;
  editorCtx.clearRect(0,0,w,h);editorCtx.filter=page.filter==="gray"?"grayscale(1)":page.filter==="bw"?"grayscale(1) contrast(2.4) brightness(1.12)":"none";editorCtx.drawImage(source,0,0,w,h);editorCtx.filter="none";
  positionCropHandles();
}
function positionCropHandles() {
  if (!editor) return;
  const wrap = $(".canvas-wrap"), rect = editorCanvas.getBoundingClientRect(), wrapRect = wrap.getBoundingClientRect();
  const points = editor.page.crop?.length===4?editor.page.crop:fullCrop();
  const pts = points.map((p)=>({x:rect.left-wrapRect.left+p.x*rect.width,y:rect.top-wrapRect.top+p.y*rect.height}));
  canvasOverlay.innerHTML="";
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("width","100%");svg.setAttribute("height","100%");svg.setAttribute("style","position:absolute;inset:0;overflow:visible;pointer-events:none");
  const mask=document.createElementNS("http://www.w3.org/2000/svg","mask");mask.setAttribute("id","crop-mask");mask.setAttribute("maskUnits","userSpaceOnUse");mask.setAttribute("maskContentUnits","userSpaceOnUse");
  const base=document.createElementNS("http://www.w3.org/2000/svg","rect");base.setAttribute("width","100%");base.setAttribute("height","100%");base.setAttribute("fill","white");
  const cut=document.createElementNS("http://www.w3.org/2000/svg","polygon");cut.setAttribute("points",pts.map((p)=>`${p.x},${p.y}`).join(" "));cut.setAttribute("fill","black");mask.append(base,cut);
  const shade=document.createElementNS("http://www.w3.org/2000/svg","rect");shade.setAttribute("width","100%");shade.setAttribute("height","100%");shade.setAttribute("fill","#111712");shade.setAttribute("fill-opacity",".43");shade.setAttribute("mask","url(#crop-mask)");svg.append(mask,shade);canvasOverlay.append(svg);
  pts.forEach((point,index)=>{const handle=document.createElement("button");handle.className="crop-handle";handle.setAttribute("aria-label",`Crop corner ${index+1}`);handle.style.left=`${point.x}px`;handle.style.top=`${point.y}px`;handle.addEventListener("pointerdown",(event)=>beginCropDrag(event,index));canvasOverlay.append(handle);});
}
function beginCropDrag(event,index) {
  event.preventDefault(); const pointerId = event.pointerId; canvasOverlay.setPointerCapture(pointerId);
  const rect=editorCanvas.getBoundingClientRect();
  const move=(e)=>{const x=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height));const pts=editor.page.crop.map((p)=>({...p}));pts[index]={x,y};editor.page.crop=pts;positionCropHandles();};
  const end=()=>{canvasOverlay.removeEventListener("pointermove",move);canvasOverlay.removeEventListener("pointerup",end);canvasOverlay.removeEventListener("pointercancel",end);};
  canvasOverlay.addEventListener("pointermove",move);canvasOverlay.addEventListener("pointerup",end,{once:true});canvasOverlay.addEventListener("pointercancel",end,{once:true});
}
$("#rotate-page").addEventListener("click",()=>{if(!editor)return;const old=editor.page.crop||fullCrop();editor.page.rotation=((editor.page.rotation||0)+1)%4;editor.page.crop=[old[3],old[0],old[1],old[2]].map((p)=>({x:1-p.y,y:p.x}));editor.source=getRotatedSource(editor.source,1);drawEditor();});
$("#reset-crop").addEventListener("click",()=>{if(editor){editor.page.crop=fullCrop();drawEditor();}});
document.querySelectorAll(".filter-option").forEach((button)=>button.addEventListener("click",()=>{if(!editor)return;editor.page.filter=button.dataset.filter;document.querySelectorAll(".filter-option").forEach((b)=>b.classList.toggle("active",b===button));drawEditor();}));
function closeEditor() { editorDialog.close(); editor=null; }
$("#editor-close").addEventListener("click",closeEditor); $("#editor-cancel").addEventListener("click",closeEditor);
$("#editor-save").addEventListener("click",async()=>{
  if(!editor)return;const button=$("#editor-save");setBusy(button,true,"Saving…");const saved=editor;
  if(saved.isDraft){const i=drafts.findIndex((p)=>p.id===saved.page.id);if(i>=0)drafts[i]=saved.page;closeEditor();renderDrafts();showToast("Page edits saved to this draft.");setBusy(button,false);return;}
  const next=structuredClone(subject()),i=next.pages.findIndex((p)=>p.id===saved.page.id);if(i<0){closeEditor();setBusy(button,false);return;}next.pages[i]=saved.page;
  statusInline("Building the replacement PDF…");
  try{await regenerateAndSave(next);subjects=subjects.map((s)=>s.id===next.id?next:s);closeEditor();renderSubject();showToast("Page edited and PDF updated.");}
  catch(error){const original=subject();if(original)original.lastError=`Update not saved: ${error.message||"PDF generation failed"}. The previous PDF and page are still available.`;$("#editor-error").textContent=`Could not save this edit. ${error.message||"PDF generation failed"}. Your current saved page and PDF are unchanged.`;$("#editor-error").classList.remove("hidden");renderSubject();storageError(error);}
  finally{setBusy(button,false);}
});
function statusInline(message){const s=$("#pdf-status");s.classList.remove("hidden","error");s.textContent=message;}

$("#download-pdf").addEventListener("click",()=>{const s=subject();if(s?.pdf)downloadBlob(s.pdf,`${safeFilename(s.name)}.pdf`);});
function safeFilename(name){return String(name||"notes").normalize("NFKD").replace(/[^\w -]/g,"").trim().replace(/\s+/g,"-").slice(0,60)||"notes";}
async function downloadBlob(blob,name){if(window.PapertrailAndroid?.saveFile){const bytes=new Uint8Array(await blob.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));window.PapertrailAndroid.saveFile(name,blob.type||"application/octet-stream",btoa(binary));return;}const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}

$("#backup-button").addEventListener("click",()=>backupDialog.showModal());$("#import-backup-subject").addEventListener("click",()=>backupDialog.showModal());$("#backup-close").addEventListener("click",()=>backupDialog.close());
function blobToBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
function base64ToBlob(data,mime){const binary=atob(data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:mime||"application/octet-stream"});}
$("#export-backup").addEventListener("click",async()=>{
  try{const rows=await getAllSubjects();const payload={format:"papertrail-backup",version:1,exportedAt:new Date().toISOString(),subjects:[]};for(const s of rows){const copy={...s,pages:[]};for(const p of s.pages){copy.pages.push({...p,blobBase64:await blobToBase64(p.blob),blob:undefined});}copy.pdfBase64=s.pdf?await blobToBase64(s.pdf):null;copy.pdf=undefined;payload.subjects.push(copy);}const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});downloadBlob(blob,`papertrail-backup-${new Date().toISOString().slice(0,10)}.papertrail.json`);backupDialog.close();showToast("Backup exported.");}catch(error){storageError(error);}
});
$("#import-backup").addEventListener("click",()=>$("#backup-input").click());
$("#backup-input").addEventListener("change",async(event)=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;try{const payload=JSON.parse(await file.text());if(payload.format!=="papertrail-backup"||payload.version!==1||!Array.isArray(payload.subjects))throw new Error("This is not a Papertrail backup.");for(const item of payload.subjects){if(!item.id||typeof item.name!=="string"||!Array.isArray(item.pages))continue;const restored={...item,pdf:item.pdfBase64?base64ToBlob(item.pdfBase64,"application/pdf"):null,pages:item.pages.map((p)=>({...p,blob:base64ToBlob(p.blobBase64,p.mime),blobBase64:undefined}))};delete restored.pdfBase64;await putSubject(restored);}subjects=await getAllSubjects();backupDialog.close();if(currentSubjectId)renderSubject();else renderHome();showToast(`Imported ${payload.subjects.length} subject${payload.subjects.length===1?"":"s"}.`);}catch(error){showToast(`Could not import backup: ${error.message}`,6000);}});

init();
