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

const S = { items: [], running: false, stop: false, results: [], seq: 0, tryAnyway: false, open: false };

function buildPanel() {
  if ($('v2BatchPanel')) return;
  const p = document.createElement('section'); p.id = 'v2BatchPanel'; p.className = 'v2-batch'; p.hidden = true;
  p.innerHTML = `
    <div class="v2-batch-head"><strong>BATCH</strong><span>QUICK-FIX many models, get one ZIP</span><button id="v2BatchClose" type="button" class="v2-magic-x" title="Close">×</button></div>
    <div id="v2BatchDrop" class="v2-batch-drop">Drop STL, OBJ, PLY or GLB files here, or <button id="v2BatchAdd" type="button">choose files…</button></div>
    <input id="v2BatchFiles" type="file" multiple accept=".stl,.obj,.ply,.glb" hidden>
    <div id="v2BatchList" class="v2-batch-list"></div>
    <div class="v2-batch-mem" id="v2BatchMem" data-level="green"><div class="v2-batch-bar"><i id="v2BatchBarFill"></i></div><div id="v2BatchMemText" class="v2-batch-memtext">Memory: add some models to see the estimate.</div></div>
    <label class="v2-check v2-batch-try" id="v2BatchTryRow" hidden><input id="v2BatchTry" type="checkbox"> Try anyway (the tab may crash)</label>
    <div class="v2-batch-actions"><button id="v2BatchStart" type="button" class="v2-magic">START BATCH</button><button id="v2BatchStop" type="button" class="v2-magic v2-magic-reset" hidden>STOP AFTER THIS ONE</button><button id="v2BatchZip" type="button" class="v2-magic v2-magic-dl" disabled>DOWNLOAD ZIP</button><button id="v2BatchClear" type="button" class="v2-magic v2-magic-reset">CLEAR</button></div>
    <div id="v2BatchNote" class="v2-batch-note"></div>`;
  document.body.appendChild(p); dock();
  $('v2BatchClose').addEventListener('click', () => toggle(false));
  $('v2BatchAdd').addEventListener('click', () => $('v2BatchFiles').click());
  $('v2BatchFiles').addEventListener('change', e => { add([...e.target.files]); e.target.value = ''; });
  const drop = $('v2BatchDrop');
  ['dragenter', 'dragover'].forEach(t => p.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => p.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  p.addEventListener('drop', e => add([...(e.dataTransfer?.files || [])]));
  $('v2BatchTry').addEventListener('change', e => { S.tryAnyway = e.target.checked; render(); });
  $('v2BatchStart').addEventListener('click', start);
  $('v2BatchStop').addEventListener('click', () => { S.stop = true; note('Stopping after the current model…'); });
  $('v2BatchZip').addEventListener('click', downloadZip);
  $('v2BatchClear').addEventListener('click', clear);
}

// Docked above the MODEL HEALTH box once that exists (it is created when a model is opened); floating at the top right until then (v2.153).
function dock() {
  const p = $('v2BatchPanel'); if (!p) return;
  const card = $('v2HealthCard');
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
function remove(id) { if (S.running) return; S.items = S.items.filter(i => i.id !== id); render(); }
function clear() {
  if (S.running) return;
  S.items = []; S.results = []; note(''); render();
}

const ICON = { queued: '·', working: '…', done: '✓', failed: '⚠', skipped: '–' };
function pending() { return S.items.filter(i => i.status === 'queued'); }
function render() {
  const panel = $('v2BatchPanel'); if (!panel) return;
  dock();
  const list = $('v2BatchList');
  list.innerHTML = S.items.length ? S.items.map(i => `<div class="v2-batch-row ${i.status}" data-id="${i.id}"><i>${ICON[i.status]}</i><span class="n" title="${i.name.replace(/"/g, '&quot;')}">${i.name.replace(/</g, '&lt;')}</span><span class="s">${fmtBytes(i.size)}</span><span class="m">${(i.msg || '').replace(/</g, '&lt;')}</span>${S.running ? '' : '<button type="button" class="x" title="Remove">×</button>'}</div>`).join('') : '<div class="v2-batch-empty">No models yet.</div>';
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
  $('v2BatchZip').disabled = S.running || !S.results.length;
  $('v2BatchClear').disabled = S.running;
  const btn = $('v2BatchBtn'); if (btn) btn.dataset.count = S.items.length ? String(S.items.length) : '';
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
  if (S.running) return;
  buildPanel(); render();
  if ($('v2BatchStart').disabled) return;
  S.running = true; S.stop = false; render(); note('');
  const total = pending().length; let n = 0, ok = 0;
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
        await deps.quickFix();
        const score = deps.healthScore();
        const files = await deps.capture();
        for (const f of files) S.results.push({ name: f.name, blob: f.blob, source: item.name });
        item.status = 'done'; item.msg = score ? `health ${score}/100` : 'done'; ok++;
      } catch (err) {
        console.warn('[SHRINK 3D] batch item failed', item.name, err);
        item.status = 'failed'; item.msg = String(err.message || err).slice(0, 80);
      }
      render(); await wait(300);    // a moment for the browser to let go of the last model
    }
    if (!S.stop && !$('v2BatchNote').classList.contains('bad')) note(`Finished: ${ok} of ${total} models ready. Press DOWNLOAD ZIP.`);
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

// ---- button next to RELOAD ----
function ensureButton() {
  if ($('v2BatchBtn')) return true;
  const wrap = document.querySelector('.v2-magic-wrap'); if (!wrap) return false;
  const b = document.createElement('button'); b.id = 'v2BatchBtn'; b.type = 'button'; b.className = 'v2-magic v2-magic-reset v2-magic-batch';
  b.title = 'Run QUICK-FIX on many models in a row and get them all as one ZIP.'; b.textContent = 'BATCH';
  b.addEventListener('click', () => toggle());
  wrap.appendChild(b); return true;
}
let tries = 0; const iv = setInterval(() => { if (ensureButton() || ++tries > 100) clearInterval(iv); }, 300);
ensureButton();
setInterval(() => { if (S.open) render(); }, 2000);     // keeps the live memory reading fresh

window.__shrinkBatch = { add, start, clear, toggle, render, estimate, memoryBudget, state: S, deps, downloadZip };
