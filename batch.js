// BATCH (v2.151): run QUICK-FIX on several models one after another and download the results as one ZIP.
// It drives the same buttons a person would press (open the file, QUICK-FIX, DOWNLOAD), so every tool behaves exactly as it does by hand.
// DOWNLOAD is caught instead of saved (window.__shrinkCapture, checked by every saveBlob) and the files are zipped at the end.
// A memory bar warns when the queue is too big for this browser. Everything here is a plain estimate: browsers do not tell a page how much
// memory it may really use, so the bar uses the JS heap limit where the browser reports it and the device memory otherwise.
const $ = id => document.getElementById(id);
const GB = 1024 ** 3, MB = 1024 ** 2;
const PEAK_FACTOR = 12;      // working memory for the biggest file while it is open: roughly 12x its size on disk (parse, convert, reducer copies, repair)
const RESULT_FACTOR = 0.6;   // finished files kept until the ZIP is made
const WARN_AT = 0.6, STOP_AT = 0.9;
const fmtBytes = n => n >= GB ? `${(n / GB).toFixed(1)} GB` : n >= MB ? `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- memory model (pure; tested) ----
function memoryBudget() {
  const lim = typeof performance !== 'undefined' && performance.memory?.jsHeapSizeLimit;
  if (lim) return lim;
  const dm = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;     // GB, the browser rounds it and caps it at 8
  return dm * GB * 0.5;
}
function estimate(sizes, budget = memoryBudget()) {
  const total = sizes.reduce((a, b) => a + b, 0), biggest = sizes.reduce((a, b) => Math.max(a, b), 0);
  const need = biggest * PEAK_FACTOR + total * RESULT_FACTOR;
  const frac = budget ? need / budget : 0;
  return { need, budget, frac, level: frac >= STOP_AT ? 'red' : frac >= WARN_AT ? 'amber' : 'green', biggest, total };
}

// Print settings used for EVERY model in the batch (set here, before any file is loaded). Each maps onto the real printer / quality buttons.
const PRINTERS = (window.__shrinkPrinterList || []).filter(x => x.type !== 'custom').length ? window.__shrinkPrinterList.filter(x => x.type !== 'custom') : [
  { id: 'r16', label: 'Resin 12K / 16K (0.018 mm, most detail)', type: 'resin', quality: 'ultra' },
  { id: 'r8f', label: 'Resin 8K / 9K, fine detail (0.03 mm)', type: 'resin', quality: 'fine' },
  { id: 'r8', label: 'Resin 8K / 9K (0.05 mm)', type: 'resin', quality: 'standard' },
  { id: 'r4', label: 'Resin 2K–4K (0.1 mm)', type: 'resin', quality: 'large' },
  { id: 'fdm', label: 'FDM filament (0.2 mm)', type: 'fdm', quality: 'standard' }
];
function savedPrinterId() {     // the printer last chosen in the main panel (or here) is the starting choice
  try { const v = JSON.parse(localStorage.getItem('shrink-printer') || 'null'); const p = v && PRINTERS.find(x => x.type === v.type && x.quality === v.quality); if (p) return p.id; } catch { /* nothing saved */ }
  return 'r16';          // nothing saved yet: the highest resolution
}
const S = { fixing: null, fixingFresh: true, items: [], running: false, stop: false, results: [], seq: 0, tryAnyway: false, open: false, printer: savedPrinterId(), height: 0 };     // height 0 = keep each model's own size
function applySettings() {
  const p = PRINTERS.find(x => x.id === S.printer) || PRINTERS[2];
  // scoped to the print dashboard: other parts of the page also use data-quality / data-printer attributes
  const dash = document.querySelector('.print-v2-dashboard') || document;
  dash.querySelector(`[data-printer="${p.type}"]`)?.click();
  dash.querySelector(`[data-quality="${p.quality}"]`)?.click();
  const h = $('v2Height'); let mm = Number(S.height) || 0;
  if (!mm) {                      // "as uploaded": the model's own height in file units, taken as mm (a GLB is in metres: small numbers are scaled up)
    const units = window.__shrinkPrint?.state?.modelHeightUnits || 0, glb = window.__shrinkApp?.sourceKind === 'glb';
    mm = units > 0 ? (glb && units < 10 ? units * 1000 : units) : 0;
    mm = mm > 0 ? Math.max(1, Math.min(500, Math.round(mm * 10) / 10)) : 0;     // the Height box allows 1 to 500 mm
  }
  if (h && mm > 0) { h.value = String(mm); h.dispatchEvent(new Event('input', { bubbles: true })); }
}

function buildPanel() {
  if ($('v2BatchPanel')) return;
  const p = document.createElement('section'); p.id = 'v2BatchPanel'; p.className = 'v2-batch'; p.hidden = true;
  p.innerHTML = `
    <div class="v2-batch-head"><strong>BATCH</strong><span>QUICK-FIX many models, get one ZIP</span><button id="v2BatchFold" type="button" class="v2-batch-fold" aria-expanded="true" title="Fold the batch window up or open it again">▾</button></div>
    <div id="v2BatchDrop" class="v2-batch-drop">Drop STL, OBJ, PLY or GLB files here, or <button id="v2BatchAdd" type="button">choose files…</button></div>
 <div class="v2-batch-set">
      <label>Printer<select id="v2BatchPrinter">${PRINTERS.map(x => `<option value="${x.id}">${x.label}</option>`).join('')}</select></label>
      <label>Height (optional)<span class="v2-batch-h"><input id="v2BatchHeight" type="number" min="1" max="500" step="1" value="" placeholder="as uploaded"><em>mm</em></span></label>
    </div>
    <div class="v2-batch-hint">The printer is used for every model. Leave Height empty to keep each model at the size it was uploaded; you can resize afterwards.</div>
    <input id="v2BatchFiles" type="file" multiple accept=".stl,.obj,.ply,.glb" hidden>
    <div id="v2BatchList" class="v2-batch-list"></div>
    <div class="v2-batch-mem" id="v2BatchMem" data-level="green"><div class="v2-batch-bar"><i id="v2BatchBarFill"></i></div><div id="v2BatchMemText" class="v2-batch-memtext">Memory: add some models to see the estimate.</div></div>
    <label class="v2-check v2-batch-try" id="v2BatchTryRow" hidden><input id="v2BatchTry" type="checkbox"> Try anyway (the tab may crash)</label>
    <div class="v2-batch-actions"><button id="v2BatchStart" type="button" class="v2-magic">START BATCH</button><button id="v2BatchStop" type="button" class="v2-magic v2-magic-reset" hidden>STOP AFTER THIS ONE</button><button id="v2BatchZip" type="button" class="v2-magic v2-magic-dl" disabled>DOWNLOAD ZIP</button><button id="v2BatchClear" type="button" class="v2-magic v2-magic-reset">CLEAR</button></div>
    <div id="v2BatchNote" class="v2-batch-note"></div>`;
  document.body.appendChild(p); dock();
  const fold = () => { const f = p.classList.toggle('folded'); $('v2BatchFold').textContent = f ? '▸' : '▾'; $('v2BatchFold').setAttribute('aria-expanded', String(!f)); };
  $('v2BatchFold').addEventListener('click', fold);
  p.querySelector('.v2-batch-head').addEventListener('click', e => { if (e.target.id !== 'v2BatchFold') fold(); });      // the whole title bar folds it
  $('v2BatchAdd').addEventListener('click', () => $('v2BatchFiles').click());
  $('v2BatchFiles').addEventListener('change', e => { add([...e.target.files]); e.target.value = ''; });
  const drop = $('v2BatchDrop');
  ['dragenter', 'dragover'].forEach(t => p.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => p.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  p.addEventListener('drop', e => add([...(e.dataTransfer?.files || [])]));
  $('v2BatchPrinter').value = S.printer;
  $('v2BatchPrinter').addEventListener('change', e => { S.printer = e.target.value; const p = PRINTERS.find(x => x.id === S.printer); try { if (p) localStorage.setItem('shrink-printer', JSON.stringify({ type: p.type, quality: p.quality })); } catch { /* private mode */ } });
  $('v2BatchHeight').addEventListener('input', e => { S.height = Number(e.target.value) || 0; });
  $('v2BatchTry').addEventListener('change', e => { S.tryAnyway = e.target.checked; render(); });
  $('v2BatchStart').addEventListener('click', start);
  $('v2BatchStop').addEventListener('click', () => { S.stop = true; note('Stopping after the current model…'); });
  $('v2BatchZip').addEventListener('click', downloadZip);
  $('v2BatchClear').addEventListener('click', clear);
}

// Docked at the bottom-right of the viewer once the MODEL HEALTH box (bottom-left) exists (it is created when a model is opened); floating at the top right until then (v2.153).
function dock() {
  const p = $('v2BatchPanel'); if (!p) return;
  const card = $('v2HealthCard')?.parentElement;      // the viewer panel: the health box is bottom-left, this window is bottom-right
  if (card && p.parentElement !== card) { card.appendChild(p); p.classList.remove('floating'); }
  else if (!card && p.parentElement !== document.body) { document.body.appendChild(p); p.classList.add('floating'); }
  else if (!card) p.classList.add('floating');
}
function toggle(open) {
  buildPanel(); S.open = open ?? !S.open; $('v2BatchPanel').hidden = !S.open; if (S.open) render();
}
const note = (t, bad) => { const n = $('v2BatchNote'); if (n) { n.textContent = t || ''; n.classList.toggle('bad', !!bad); } };

function add(files) {
  buildPanel();
  const ok = files.filter(f => /\.(stl|obj|ply|glb)$/i.test(f.name));
  const bad = files.length - ok.length;
  for (const file of ok) S.items.push({ id: ++S.seq, file, name: file.name, size: file.size, status: 'queued', msg: '' });
  note(bad ? `${bad} file${bad === 1 ? '' : 's'} skipped: only STL, OBJ, PLY and GLB files work.` : '');
  render();
}
// A flagged model is opened on its own, with the left panel and the Advanced tools open, so it can be fixed there. While it is
// the "fixing" model, its next DOWNLOAD still saves normally AND replaces its file in the batch ZIP (the row is updated too).
function fixingCapture(blob, name) {
  const it = S.items.find(x => x.id === S.fixing); const a = window.__shrinkApp;
  if (!it || (a && a.sourceFile && a.sourceFile !== it.file)) return false;       // a different model is open now: ignore
  if (S.fixingFresh) { S.results = S.results.filter(r => r.source !== it.name); S.fixingFresh = false; }
  S.results.push({ name, blob, source: it.name });
  const sc = Number($('v2HealthScore')?.textContent); it.warn = !(Number.isFinite(sc) && sc >= 100);
  it.msg = Number.isFinite(sc) ? `fixed · health ${sc}/100${it.warn ? ' · still has issues' : ''}` : 'fixed';
  render(); note(`${it.name}: the downloaded file has replaced the old one in the ZIP.`);
  setTimeout(() => { S.fixingFresh = true; }, 1500);      // a split export hands over several files at once; a later download replaces them again
  return false;                                           // false = the file is also saved normally
}
// Click a row to look at it in the main window: the processed file if there is one (STL/OBJ/PLY), otherwise the original.
async function viewItem(id) {
  if (S.running) return; const it = S.items.find(x => x.id === id); if (!it) return;
  const res = S.results.filter(r => r.source === it.name && /\.(stl|obj|ply)$/i.test(r.name))[0];
  const file = res ? new File([res.blob], res.name, { type: res.blob.type || 'model/stl' }) : it.file;
  note(res ? `Showing the processed ${res.name} in the main window: rotate it, check its size, press DOWNLOAD there if you want it on its own.` : `Showing the original ${it.name} (no processed file to show).`);
  try { await window.__shrinkApp?.openFile?.(file); } catch { /* the note above already says what was opened */ }
  await wait(900);                                  // let the model settle and its health check start
  window.__shrinkPlatePreview?.();                  // plate, X/Y/Z arrows and front view, like the end of QUICK-FIX
}
function openToFix(id) {
  if (S.running) return; const it = S.items.find(x => x.id === id); if (!it) return;
  S.fixing = id; S.fixingFresh = true; window.__shrinkCapture = fixingCapture;
  note(`Opened ${it.name} on its own. Try FIX IT or Make watertight in the left panel, then DOWNLOAD IT: the fixed file also replaces this one in the ZIP.`);
  window.__shrinkApp?.openFile?.(it.file);
  window.__shrinkLeftPanel?.(true);
  setTimeout(() => { const d = $('v2AdvTools'); if (d) d.open = true; }, 600);
}
function remove(id) { if (S.running) return; S.items = S.items.filter(i => i.id !== id); render(); }
function clear() {
  if (S.running) return;
  S.items = []; S.results = []; S.fixing = null; if (window.__shrinkCapture === fixingCapture) window.__shrinkCapture = null; note(''); render();
}

const ICON = { queued: '·', working: '…', done: '✓', failed: '⚠', skipped: '–' };
function pending() { return S.items.filter(i => i.status === 'queued'); }
function render() {
  const panel = $('v2BatchPanel'); if (!panel) return;
  dock();
  const list = $('v2BatchList');
  list.innerHTML = S.items.length ? S.items.map(i => `<div class="v2-batch-row ${i.status}${i.warn ? ' warn' : ''}" data-id="${i.id}"><i>${i.warn ? '⚠' : ICON[i.status]}</i><span class="n${S.running ? '' : ' view'}" title="${i.name.replace(/"/g, '&quot;')}${S.running ? '' : ' (click to view it in the main window)'}">${i.name.replace(/</g, '&lt;')}</span><span class="s">${fmtBytes(i.size)}</span><span class="m"${i.warn ? ' title="Still not fully clean after QUICK-FIX. It is in the ZIP as it is. Click OPEN, expand the left panel and try FIX IT or Make watertight on it by itself."' : ''}>${(i.msg || '').replace(/</g, '&lt;')}</span>${S.running ? '' : (i.warn ? '<button type="button" class="open" title="Opens this model on its own with the left panel open. Try FIX IT or Make watertight, then DOWNLOAD IT: the fixed file replaces this one in the ZIP.">OPEN</button>' : '') + '<button type="button" class="x" title="Remove">×</button>'}</div>`).join('') : '<div class="v2-batch-empty">No models yet.</div>';
  list.querySelectorAll('.n.view').forEach(n => n.addEventListener('click', () => viewItem(Number(n.closest('.v2-batch-row').dataset.id))));
  list.querySelectorAll('.open').forEach(b => b.addEventListener('click', () => openToFix(Number(b.closest('.v2-batch-row').dataset.id))));
  list.querySelectorAll('.x').forEach(b => b.addEventListener('click', () => remove(Number(b.closest('.v2-batch-row').dataset.id))));
  // memory bar: what is still to be processed, plus what is already finished
  const sizes = S.items.filter(i => i.status === 'queued' || i.status === 'working').map(i => i.size);
  const done = S.results.reduce((a, r) => a + r.blob.size, 0);
  const est = estimate(sizes);
  const frac = Math.min(1, (est.need + done) / est.budget);
  const lvl = (est.need + done) / est.budget >= STOP_AT ? 'red' : (est.need + done) / est.budget >= WARN_AT ? 'amber' : 'green';
  $('v2BatchMem').dataset.level = lvl;
  $('v2BatchBarFill').style.width = `${Math.round(frac * 100)}%`;
  const live = performance.memory ? ` · in use now: ${fmtBytes(performance.memory.usedJSHeapSize)}` : '';
  $('v2BatchMemText').textContent = sizes.length || done
    ? `Memory estimate: ${fmtBytes(est.need + done)} of about ${fmtBytes(est.budget)} (${Math.round((est.need + done) / est.budget * 100)}%)${live}. ${lvl === 'red' ? 'Too much for this browser: remove the biggest models or run fewer at a time.' : lvl === 'amber' ? 'Getting close: it may be slow.' : 'Fine.'}`
    : 'Memory: add some models to see the estimate.';
  $('v2BatchTryRow').hidden = lvl !== 'red';
  const blocked = lvl === 'red' && !S.tryAnyway;
  const start = $('v2BatchStart');
  start.disabled = S.running || !pending().length || blocked;
  start.title = blocked ? 'The memory bar is in the red. Remove some models, or tick Try anyway.' : '';
  $('v2BatchStop').hidden = !S.running;
  $('v2BatchPrinter').disabled = S.running; $('v2BatchHeight').disabled = S.running;
  $('v2BatchZip').disabled = S.running || !S.results.length;
  $('v2BatchClear').disabled = S.running;
}

// ---- the work, one model at a time ----
const deps = {
  app: () => window.__shrinkApp,
  openFile: async file => { await window.__shrinkApp.openFile(file); },
  quickFix: async () => {
    const b = $('v2MagicBtn'); if (!b) throw new Error('QUICK-FIX is not on this page');
    await waitFor(() => b.dataset.state === 'ready' && !b.disabled && !b.dataset.busy, 180000, 'The health check did not finish');
    b.click(); await wait(80);
    await waitFor(() => !b.dataset.busy, 30 * 60000, 'QUICK-FIX did not finish');
    const dl = $('v2MagicDownload'); if (!dl || dl.disabled) throw new Error('QUICK-FIX stopped before it finished');
  },
  capture: async () => {
    const got = [];
    window.__shrinkCapture = (blob, name) => { got.push({ blob, name }); return true; };
    try {
      const b = $('v2DownloadBtn') || $('v2MagicDownload'); b.click();
      await waitFor(() => got.length > 0, 120000, 'Nothing was exported');
      await wait(400);       // a split export can hand over more than one file
    } finally { window.__shrinkCapture = null; }
    return got;
  },
  applySettings,
  healthScore: () => $('v2HealthScore')?.textContent || ''
};
async function waitFor(fn, ms, msg) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(msg || 'Timed out'); await wait(120); }
}
function memoryTight() {
  const m = typeof performance !== 'undefined' && performance.memory; return !!(m && m.jsHeapSizeLimit && m.usedJSHeapSize / m.jsHeapSizeLimit > STOP_AT);
}

async function start() {
  S.fixing = null; if (window.__shrinkCapture === fixingCapture) window.__shrinkCapture = null;
  if (S.running) return;
  buildPanel(); render();
  if ($('v2BatchStart').disabled) return;
  S.running = true; S.stop = false; render(); note('');
  if (!document.body.classList.contains('app-mode-print')) { document.querySelector('.mode-card[data-mode="print"]')?.click(); await wait(600); }
  const total = pending().length; let n = 0, ok = 0, warned = 0;
  try {
    for (const item of S.items) {
      if (item.status !== 'queued') continue;
      if (S.stop) { note(`Stopped. ${ok} of ${total} done.`); break; }
      if (memoryTight()) { note(`Stopped: the browser is nearly out of memory (${ok} of ${total} done). Download the ZIP, reload the page and run the rest.`, true); break; }
      n++; item.status = 'working'; item.msg = `${n}/${total}`; render();
      try {
        await deps.openFile(item.file);
        const a = deps.app();
        if (a && a.sourceFile && a.sourceFile !== item.file) throw new Error('Could not open this file');
        await wait(350);            // let the open settle and the health check start
        deps.applySettings();       // printer resolution and height chosen in the panel
        await wait(150);
        await deps.quickFix();
        const score = deps.healthScore();
        const files = await deps.capture();
        for (const f of files) S.results.push({ name: f.name, blob: f.blob, source: item.name });
        item.status = 'done'; item.msg = score ? `health ${score}/100` : 'done'; ok++;
        const sc = Number(score); item.warn = Number.isFinite(sc) && sc < 100;      // still not perfectly healthy after QUICK-FIX: highlighted in the list, but its file is still in the ZIP
        if (item.warn) { item.msg += ' · still has issues'; warned++; }
      } catch (err) {
        console.warn('[SHRINK 3D] batch item failed', item.name, err);
        item.status = 'failed'; item.msg = String(err.message || err).slice(0, 80);
      }
      render(); await wait(300);    // a moment for the browser to let go of the last model
    }
    if (!S.stop && !$('v2BatchNote').classList.contains('bad')) note(`Finished: ${ok} of ${total} models ready.${warned ? ` ${warned} still ${warned === 1 ? 'has' : 'have'} issues (highlighted in amber). They are in the ZIP too: use them as they are, or open one on its own to fix it.` : ''} Press DOWNLOAD ZIP.`);
  } finally { S.running = false; S.stop = false; render(); }
}

async function downloadZip() {
  if (!S.results.length) return;
  const btn = $('v2BatchZip'); btn.disabled = true; note('Making the ZIP…');
  try {
    const { zipSync } = await import('https://esm.sh/fflate@0.8.2');
    const files = {}, used = new Set();
    for (const r of S.results) {
      let name = r.name, k = 1; while (used.has(name)) name = r.name.replace(/(\.[^.]*)?$/, `-${++k}$1`);
      used.add(name); files[name] = new Uint8Array(await r.blob.arrayBuffer());
    }
    const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `shrink-batch-${S.results.length}-files.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note(`ZIP saved: ${S.results.length} file${S.results.length === 1 ? '' : 's'}, ${fmtBytes(blob.size)}.`);
  } catch (err) { console.error(err); note(`Could not make the ZIP: ${err.message || err}`, true); }
  finally { render(); }
}

// BATCH on the load screen, under the main drop zone: opens the panel (and the print tools it needs) before any model is loaded.
function ensureHomeButton() {
  if ($('v2BatchHome')) return true;
  const dz = $('dropZone'); if (!dz) return false;
  const row = document.createElement('div'); row.className = 'v2-batch-home';
  row.innerHTML = '<button id="v2BatchHome" type="button" class="v2-magic">BATCH</button><span>Shrink many models in one go: choose your printer first, then add the files.</span>';
  dz.insertAdjacentElement('afterend', row);
  $('v2BatchHome').addEventListener('click', () => {
    if (!document.body.classList.contains('app-mode-print')) document.querySelector('.mode-card[data-mode="print"]')?.click();
    toggle(true);
  });
  return true;
}
// (v2.180) A BATCH button in the top bar, right after RELOAD, opens the same window as the load-screen button.
function ensureTopButton() {
  if ($('v2BatchTop')) return true;
  const rl = $('v2MagicReset'); if (!rl) return false;
  const btn = document.createElement('button'); btn.id = 'v2BatchTop'; btn.type = 'button'; btn.className = 'v2-magic v2-magic-reset'; btn.textContent = 'BATCH';
  btn.title = 'Shrink many models in one go';
  btn.addEventListener('click', () => toggle(true));
  rl.insertAdjacentElement('afterend', btn);
  return true;
}
ensureHomeButton(); ensureTopButton();
let tries2 = 0; const iv2 = setInterval(() => { if (ensureTopButton() || ++tries2 > 100) clearInterval(iv2); }, 300);
let tries = 0; const iv = setInterval(() => { if (ensureHomeButton() || ++tries > 100) clearInterval(iv); }, 300);
setInterval(() => { if (S.open) render(); }, 2000);     // keeps the live memory reading fresh

window.__shrinkBatch = { applySettings, add, start, clear, toggle, render, estimate, memoryBudget, state: S, deps, downloadZip };
