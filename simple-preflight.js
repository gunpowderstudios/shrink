// SHRINK 3D v2.22 — Simple Print preflight gate: check -> repair -> optional download -> workflow.
(() => {
  const RELEASE = '2.36';
  const CORE = '2.18';           // engine graph (mesh-tools)
  const FIX = '2.27';            // repair graph: repair-core.js, repair-worker.js, solid-rebuild.js. Bump these three + their importers together.
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const body = document.body;

  let card = null;
  let state = 'idle';
  let info = null;
  let busy = false;
  let proceeded = false;
  let token = 0;
  let abort = null;
  let pendingFix = null;
  let pendingView = null;
  let lastCheckedModel = null;

  function active() {
    return body.classList.contains('app-mode-print') && body.classList.contains('ui-simple') && !!app()?.originalModel;
  }

  async function waitFor(test, ms = 10000, step = 80) {
    for (let t = 0; t < ms; t += step) { const v = test(); if (v) return v; await wait(step); }
    return test() || null;
  }

  const nf = n => new Intl.NumberFormat().format(Math.max(0, Number(n) || 0));
  const issues = t => (t?.openEdges || 0) + (t?.pinchedEdges || 0) + (t?.flippedEdges || 0);

  async function topology(model, signal) {
    try {
      const mod = await import(`./solid-rebuild.js?v=${FIX}`);
      const h = await mod.healthAsync(model, { signal });
      return { ...h, openEdges: h.open, pinchedEdges: h.tangled, flippedEdges: h.flipped, degenerateTriangles: h.degenerate };
    } catch (err) { if (err?.code === 'CANCELLED') throw err; console.warn(`[SHRINK 3D ${RELEASE}] Preflight health check failed`, err); return null; }
  }

  function details(t, extra = '') {
    if (!t) return extra || 'No topology report was available.';
    return `Triangles: ${nf(t.triangles)} · open edges: ${nf(t.openEdges)} · pinched/non-manifold edges: ${nf(t.pinchedEdges)} · flipped edges: ${nf(t.flippedEdges)} · empty triangles (harmless): ${nf(t.degenerateTriangles)}${extra ? ` · ${extra}` : ''}`;
  }

  function disposeRoot(root) {
    try { root?.traverse?.(o => { if (!o.isMesh) return; o.geometry?.dispose?.(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m?.dispose?.()); }); }
    catch {}
  }

  function addCss() {
    if (document.querySelector('link[data-shrink-preflight]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = `./simple-preflight.css?v=${RELEASE}`; link.dataset.shrinkPreflight = 'true';
    document.head.appendChild(link);
  }

  function buildCard() {
    const el = document.createElement('section');
    el.id = 'simplePreflightCard'; el.className = 'simple-preflight-card'; el.dataset.state = 'checking';
    el.setAttribute('aria-label', 'Model repair check');
    el.innerHTML = `
      <div class="sp-eyebrow">STEP 1 · CHECK / REPAIR</div>
      <div class="sp-head"><div id="spIcon" class="sp-icon">⌁</div><div class="sp-copy"><h2 id="spTitle">Checking your model…</h2><p id="spText">Before SHRINK changes anything, we check that the uploaded mesh is safe to work on.</p></div></div>
      <div class="sp-meter" aria-hidden="true"><span id="spMeter"></span></div>
      <div id="spSummary" class="sp-summary"></div>
      <div id="spActions" class="sp-actions"></div>
      <p id="spNote" class="sp-note"></p>
      <details class="sp-tech"><summary>Technical details</summary><div id="spTech" class="sp-tech-body"></div></details>`;
    return el;
  }

  function ensureCard() {
    const simple = $('simpleCard');
    const grid = document.querySelector('.print-v2-dashboard .v2-top-grid');
    if (!simple || !grid) return false;
    if (!card?.isConnected) {
      card = buildCard();
      grid.insertBefore(card, simple);
      wireCard();
    }
    return true;
  }

  function setBlocked(on) { body.classList.toggle('simple-preflight-blocked', !!on && active()); }

  function readyChip(fix = null) {
    const simple = $('simpleCard'); if (!simple) return;
    let chip = $('scPreflightOk');
    if (!chip) { chip = document.createElement('div'); chip.id = 'scPreflightOk'; chip.className = 'sc-preflight-ok'; const stepper = simple.querySelector('.sc-stepper'); stepper?.insertAdjacentElement('afterend', chip); }
    chip.dataset.warning = fix === 'warning' ? 'true' : 'false';
    chip.textContent = fix === 'repair' ? 'Repair complete — now working from the repaired model.'
      : fix === 'rebuild' ? 'Watertight rebuild complete — now working from the rebuilt model.'
      : fix === 'warning' ? 'Continuing with mesh warnings — your slicer may still need to repair this file.'
      : 'Model check passed — no repair was needed.';
  }

  function clearReadyChip() { $('scPreflightOk')?.remove(); }

  function render() {
    if (!card) return;
    card.dataset.state = state;
    const title = $('spTitle'), text = $('spText'), icon = $('spIcon'), summary = $('spSummary'), actions = $('spActions'), note = $('spNote'), tech = $('spTech'), meter = $('spMeter');
    actions.innerHTML = '';
    meter?.parentElement?.removeAttribute('hidden');
    if (meter) meter.style.removeProperty('width');

    const button = (label, act, cls = '') => `<button type="button" class="sp-action ${cls}" data-sp-act="${act}"${busy ? ' disabled' : ''}>${label}</button>`;
    const t = info?.topology || null;

    if (state === 'checking') {
      icon.textContent = '⌁'; title.textContent = 'Checking your model…'; text.textContent = 'Before SHRINK changes anything, we check the uploaded mesh for holes, pinched edges and broken triangles.';
      summary.innerHTML = '<strong>Nothing has been changed.</strong> This usually only takes a moment.'; note.textContent = 'The next stage stays locked until this check passes.'; tech.textContent = details(t);
    } else if (state === 'needs') {
      icon.textContent = '⚠'; title.textContent = 'This model needs repairing first'; text.textContent = 'SHRINK found geometry that should be fixed before we reduce, fuse or split the model.';
      summary.innerHTML = `<strong>${nf(t?.openEdges)} open edges · ${nf(t?.pinchedEdges)} pinched edges · ${nf(t?.flippedEdges)} flipped edges.</strong>`;
      actions.innerHTML = button('Repair model — keep the detail', 'repair', 'primary') + button('Open Tools', 'advanced');
      note.textContent = 'Repair only changes problem areas. Separate clean printable pieces are allowed and do not have to be fused.'; tech.textContent = details(t);
    } else if (state === 'repairing') {
      icon.textContent = '↻'; title.textContent = 'Repairing the model…'; text.textContent = info?.progress || 'Joining loose points, removing bad triangles, correcting face direction and closing holes.';
      actions.innerHTML = '<button type="button" class="sp-action warn" data-sp-act="cancel">Cancel</button>';
      if (card) card.style.setProperty('--sp-progress', `${Math.max(5, Math.min(100, info?.pct || 8))}%`);
      summary.innerHTML = '<strong>Keeping the existing surface wherever possible.</strong>'; note.textContent = 'When repair finishes SHRINK will automatically check the model again.'; tech.textContent = details(info?.before, 'detail-preserving repair running');
    } else if (state === 'repair-failed') {
      icon.textContent = '⚠'; title.textContent = 'Normal repair could not make it clean'; text.textContent = 'Nothing has been accepted yet. You can try the stronger watertight rebuild, which recreates the outer surface.';
      summary.innerHTML = '<strong>The stronger fix can soften very small detail.</strong> You will get the rebuilt model in the viewer before any shrinking happens.';
      actions.innerHTML = button('Stronger fix — rebuild watertight', 'rebuild', 'primary') + button('Continue anyway', 'continue-anyway') + button('Download as it is', 'download') + button('Open Tools', 'advanced');
      note.textContent = 'Continuing may still work because many slicers can repair mesh faults. SHRINK will keep the warning visible.'; tech.textContent = `${details(info?.before)}
After repair: ${details(info?.after, info?.message || '')}`;
    } else if (state === 'rebuilding') {
      icon.textContent = '◫'; title.textContent = 'Rebuilding a watertight surface…'; text.textContent = info?.progress || 'Starting the background rebuild…';
      summary.innerHTML = '<strong>This is the stronger fallback.</strong> SHRINK is making a new closed outer skin from the uploaded shape.';
      actions.innerHTML = '<button type="button" class="sp-action warn" data-sp-act="cancel">Cancel</button>';
      note.textContent = 'This runs in a background worker where the browser supports it.'; tech.textContent = details(info?.before, info?.progress || '');
      if (card) card.style.setProperty('--sp-progress', `${Math.max(5, Math.min(100, info?.pct || 8))}%`);
    } else if (state === 'ready') {
      meter?.parentElement?.setAttribute('hidden', '');
      const fixedBy = info?.fixedBy || null;
      icon.textContent = '✓';
      title.textContent = fixedBy === 'repair' ? 'Repair complete — model ready' : fixedBy === 'rebuild' ? 'Watertight rebuild complete' : 'Model check passed';
      text.textContent = fixedBy ? 'The repaired model passed the same mesh check and is now safe to reduce or prepare for printing.' : 'This model is already closed and healthy, so no repair is needed.';
      summary.innerHTML = fixedBy ? '<strong>Nothing else has been changed yet.</strong> You can download this repaired STL now, or continue into SHRINK.' : '<strong>Ready for the next stage.</strong> SHRINK has not reduced or changed the model.';
      actions.innerHTML = button('Continue to printer & size →', 'continue', 'primary');
      actions.innerHTML += button(fixedBy ? (fixedBy === 'rebuild' ? 'Download rebuilt STL' : 'Download repaired STL') : 'Download as it is', 'download-ready');
      note.textContent = fixedBy ? 'If all you wanted was a repaired file, download it here. Otherwise continue to reduce and prepare it.' : 'You can download the unchanged model now, or continue to reduce and prepare it.';
      tech.textContent = details(t, fixedBy ? `${fixedBy} passed` : 'no repair needed');
    } else if (state === 'failed') {
      icon.textContent = '×'; title.textContent = 'SHRINK could not make this model clean automatically'; text.textContent = 'The mesh still has problems. Your original file has not been changed.';
      summary.innerHTML = '<strong>You can still continue if your slicer is good at repairing meshes.</strong>';
      actions.innerHTML = button('Continue anyway', 'continue-anyway', 'primary') + button('Download as it is', 'download') + button('Open Tools', 'advanced') + button('Re-upload repaired file', 'reupload');
      note.textContent = 'Continuing keeps a warning visible. For the safest result, repair it in your slicer or modelling software first.'; tech.textContent = `${details(info?.before)}
${info?.message || ''}`;
    }
  }

  async function checkModel(fixedBy = null) {
    if (!app()?.originalModel) return;
    const my = ++token;
    proceeded = false;
    busy = true; state = 'checking'; info = { topology: null, fixedBy }; clearReadyChip(); setBlocked(true); render();
    app()?.show?.('original');
    await wait(30);
    if (my !== token) return;
    const t = await topology(app().originalModel).catch(() => null);
    if (my !== token) return;
    info.topology = t;
    if (!t) {
      busy = false; state = 'failed'; info.message = 'The topology checker did not become available.'; render(); setBlocked(true); return;
    }
    if (issues(t) === 0) {
      lastCheckedModel = app().originalModel;
      busy = false; state = 'ready'; setBlocked(true); render();
      app()?.show?.('original');
      window.dispatchEvent(new CustomEvent('shrink:preflight-ready', { detail: { fixedBy, topology: t } }));
      return;
    }
    busy = false; state = 'needs'; render(); setBlocked(true);
  }

  function continueWorkflow() {
    if (state !== 'ready' || !lastCheckedModel || lastCheckedModel !== app()?.originalModel) return;
    proceeded = true;
    setBlocked(false);
    readyChip(info?.fixedBy || null);
    app()?.show?.('original');
    window.dispatchEvent(new CustomEvent('shrink:preflight-continued', { detail: { fixedBy: info?.fixedBy || null, bypassed: false } }));
  }

  function continueAnyway() {
    if (busy || !app()?.originalModel) return;
    proceeded = true;
    lastCheckedModel = app().originalModel;
    state = 'bypassed';
    setBlocked(false);
    readyChip('warning');
    app()?.show?.('original');
    window.dispatchEvent(new CustomEvent('shrink:preflight-continued', { detail: { fixedBy: null, bypassed: true, topology: info?.after || info?.before || info?.topology || null } }));
  }

  async function reopenRoot(root, suffix, fixKind) {
    const mod = await import(`./mesh-tools.js?v=${CORE}`);
    pendingView = app()?.getViewState?.() || null;
    const out = mod.buildBinaryStl({ THREE: app().THREE, model: root, mmPerUnit: 1, zUp: true });
    const file = new File([out.buffer], `${app()?.baseName?.() || 'model'}-${suffix}.stl`, { type: 'model/stl' });
    disposeRoot(root);
    const input = $('fileInput');
    if (!input || typeof DataTransfer === 'undefined') throw new Error('This browser could not re-open the repaired model automatically.');
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    pendingFix = fixKind;
    state = 'checking'; busy = true; render();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function repairModel() {
    if (busy || !app()?.originalModel) return;
    const before = info?.topology || info?.before || null;
    const ctl = abort = new AbortController(), my = token; busy = true; state = 'repairing'; info = { before, progress: 'Starting…', pct: 4 }; render();
    app()?.clearPreview?.(); app()?.show?.('original');
    await wait(35);
    let root = null;
    try {
      if (my !== token) return;
      const mod = await import(`./solid-rebuild.js?v=${FIX}`);
      const res = await mod.repairAsync(app().originalModel, {
        signal: ctl.signal,
        onStatus: (text, pct) => { if (state !== 'repairing') return; info.progress = text || 'Repairing…'; info.pct = pct || info.pct; render(); }
      });
      root = res.root;
      if (my !== token) { disposeRoot(root); root = null; return; }
      const h = res.stats.after;
      const after = h && { ...h, openEdges: h.open, pinchedEdges: h.tangled, flippedEdges: h.flipped, degenerateTriangles: h.degenerate };
      if (!after || issues(after) !== 0) {
        info = { before, after, stats: res.stats, message: 'The detail-preserving repair still left topology problems.' };
        disposeRoot(root); root = null; busy = false; state = 'repair-failed'; render(); return;
      }
      await reopenRoot(root, 'repaired', 'repair'); root = null;
    } catch (err) {
      disposeRoot(root);
      if (my !== token) return;
      if (err?.code === 'CANCELLED') { busy = false; state = 'needs'; info = { before }; render(); return; }
      console.warn(`[SHRINK 3D ${RELEASE}] Preflight repair failed`, err);
      busy = false; state = 'repair-failed'; info = { before, after: null, message: err?.message || String(err) }; render();
    } finally { if (abort === ctl) abort = null; }
  }

  async function rebuildModel() {
    if (busy || !app()?.originalModel) return;
    const before = info?.topology || info?.before || null;
    const ctl = abort = new AbortController(), my = token; busy = true; state = 'rebuilding'; info = { before, progress: 'Starting…', pct: 5 }; render();
    app()?.clearPreview?.(); app()?.show?.('original');
    let root = null;
    try {
      const { rebuildSolid } = await import(`./solid-rebuild.js?v=${FIX}`);
      const res = await rebuildSolid(app().originalModel, {
        detailUnits: 0, maxCells: 24e6, maxTris: 350000, signal: ctl.signal,
        onStatus: (text, pct) => { if (state !== 'rebuilding') return; info.progress = text || 'Rebuilding…'; info.pct = pct || info.pct; render(); }
      });
      root = res.root;
      if (my !== token) { disposeRoot(root); root = null; return; }
      const after = await topology(root).catch(() => null);
      if (!after || issues(after) !== 0) throw new Error('The rebuilt surface still did not pass the watertight mesh check.');
      await reopenRoot(root, 'watertight', 'rebuild'); root = null;
    } catch (err) {
      disposeRoot(root);
      if (my !== token) return;
      if (err?.code === 'CANCELLED') { busy = false; state = 'repair-failed'; info = { before, after: null, message: 'Rebuild cancelled.' }; render(); return; }
      console.warn(`[SHRINK 3D ${RELEASE}] Preflight rebuild failed`, err);
      busy = false; state = 'failed'; info = { before, message: err?.message || String(err) }; render(); setBlocked(true);
    } finally { if (abort === ctl) abort = null; }
  }

  function downloadSource() {
    const file = app()?.sourceFile; if (!file) return;
    const a = document.createElement('a'), url = URL.createObjectURL(file);
    a.href = url; a.download = file.name || 'model.stl'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function wireCard() {
    card.addEventListener('click', e => {
      const act = e.target.closest('[data-sp-act]')?.dataset.spAct; if (!act) return;
      if (act === 'repair') repairModel();
      else if (act === 'rebuild') rebuildModel();
      else if (act === 'cancel') abort?.abort?.();
      else if (act === 'continue') continueWorkflow();
      else if (act === 'continue-anyway') continueAnyway();
      else if (act === 'advanced') window.__shrinkSimple?.setLevel?.('advanced');
      else if (act === 'download' || act === 'download-ready') downloadSource();
      else if (act === 'reupload') $('fileInput')?.click();
    });
  }

  let openTimer = 0;
  function onModelOpened() {
    const fix = pendingFix; pendingFix = null;
    const view = pendingView; pendingView = null;
    if (view) requestAnimationFrame(() => app()?.restoreViewState?.(view));
    token++; abort?.abort?.();
    clearTimeout(openTimer);
    proceeded = false; lastCheckedModel = null; clearReadyChip(); state = 'checking'; info = null; busy = false; setBlocked(true);
    openTimer = setTimeout(() => {
      ensureCard();
      if (active()) checkModel(fix); else setBlocked(false);
    }, 120);
  }

  function syncMode() {
    ensureCard();
    if (!active()) { setBlocked(false); return; }
    if (lastCheckedModel === app()?.originalModel && (state === 'ready' || state === 'bypassed')) {
      if (proceeded) { setBlocked(false); readyChip(state === 'bypassed' ? 'warning' : (info?.fixedBy || null)); }
      else { setBlocked(true); render(); }
      return;
    }
    if (!busy) checkModel(null);
  }

  addCss();
  const installTimer = setInterval(() => { if (ensureCard()) { clearInterval(installTimer); syncMode(); } }, 80);
  setTimeout(() => clearInterval(installTimer), 15000);
  window.addEventListener('shrink:model-opened', onModelOpened);
  window.addEventListener('shrink:ui-level', () => setTimeout(syncMode, 70));
  window.addEventListener('shrink:ui-mode', () => setTimeout(syncMode, 70));
  window.addEventListener('shrink:live-updated', () => { if (body.classList.contains('simple-preflight-blocked')) app()?.show?.('original'); });
  if (document.readyState !== 'loading') syncMode(); else document.addEventListener('DOMContentLoaded', syncMode, { once: true });

  window.__shrinkPreflight = { check: checkModel, repair: repairModel, rebuild: rebuildModel, continueWorkflow, continueAnyway, get state() { return state; }, version: RELEASE };
})();
