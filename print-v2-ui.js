// SHRINK 3D v2.68 — Auto and Manual both show true-size pegs; Manual uses axis sliders only.
(() => {
  const VERSION = '2.68';
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  let dashboard = null;
  let viewerPanel = null;
  let viewerHome = null;
  let viewerNext = null;
  let fuseReady = false;
  let shrinkReady = false;
  let workingModel = null;
  const appliedChanges = new Set();

  function setWorkingModel(model) {
    workingModel = model || app()?.originalModel || null;
    return workingModel;
  }
  function sourceModel() { return workingModel || app()?.originalModel || null; }
  function healthModel() { return sourceModel(); }
  window.__shrinkWorkingModel = () => sourceModel();
  window.__shrinkSetWorkingModel = setWorkingModel;
  function modelTriangles(model) {
    let tris = 0;
    model?.traverse?.(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const g = o.geometry;
      tris += g.index ? Math.floor(g.index.count / 3) : Math.floor(g.attributes.position.count / 3);
    });
    return tris;
  }

  function cleanBaseName(base = 'model') {
    return String(base || 'model').replace(/[-_ ]+$/g, '') || 'model';
  }

  // Downloads are simply <original name>-SHRINK (no height / FIX / FUSE / reduction tags). Split parts keep their -PARTnofN suffix elsewhere.
  // One detail choice for single and batch (v2.166). batch.js reads this list too.
  const PRINTER_LIST = [
    { id: 'r16', label: 'Resin 12K / 16K (0.018 mm, most detail)', tag: '16K', type: 'resin', quality: 'ultra' },
    { id: 'r8f', label: 'Resin 8K / 9K, fine detail (0.03 mm)', tag: '8K-fine', type: 'resin', quality: 'fine' },
    { id: 'r8', label: 'Resin 8K / 9K (0.05 mm)', tag: '8K', type: 'resin', quality: 'standard' },
    { id: 'r4', label: 'Resin 2K–4K (0.1 mm)', tag: '4K', type: 'resin', quality: 'large' },
    { id: 'fdm', label: 'FDM filament (0.2 mm)', tag: 'FDM', type: 'fdm', quality: 'standard' },
    { id: 'custom', label: 'Custom (set in Advanced printer settings)', tag: 'custom', type: 'custom', quality: 'standard' }
  ];
  window.__shrinkPrinterList = PRINTER_LIST;
  // v2.310: small line icons for the EDIT tab (24x24, drawn with the text colour)
  const ICON = {
    brush: '<path d="M20 4l-9 9"/><path d="M11 13c-3 0-4 2-4 4 0 2-1 3-3 3 3 2 8 1 9-2 .8-2.2-.2-4.2-2-5z"/>',
    shape: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    slice: '<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M2 15l20-6" stroke-dasharray="3 2"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    ball: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3"/>',
    cylinder: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
    cone: '<path d="M12 3L5 18M12 3l7 15"/><ellipse cx="12" cy="18" rx="7" ry="3"/>',
    join: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
    cut: '<circle cx="12" cy="12" r="9"/><path d="M7 12h10"/>',
    sculpt: '<path d="M20 4l-9 9"/><path d="M11 13c-3 0-4 2-4 4 0 2-1 3-3 3 3 2 8 1 9-2 .8-2.2-.2-4.2-2-5z"/>',
    smooth: '<path d="M3 9c3-3 5 3 9 0s6 3 9 0"/><path d="M3 15c3-3 5 3 9 0s6 3 9 0"/>',
    pull: '<path d="M12 20V5M6 11l6-6 6 6"/>',
    push: '<path d="M12 4v15M6 13l6 6 6-6"/>',
    lasso: '<path d="M12 4C6.5 4 3 6.2 3 9s3.5 5 9 5 9-2.2 9-5-3.5-5-9-5z" stroke-dasharray="3 2"/><path d="M8.5 13.5c-1.2 2-1.2 4.2.8 5.2 1.3.6 2.6-.4 2.1-2"/>',
    razor: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M3 12h18"/><circle cx="7" cy="10" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="17" cy="10" r="1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    select: '<path d="M6 3l13 8-6 2-3.5 6z"/>',
    part: '<rect x="5" y="12" width="14" height="8" rx="1"/><rect x="8.5" y="3" width="7" height="9" rx="1"/>'
  };
  const icon = k => `<svg class="v2-ico" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const iconBtn = (group, value, label, pressed) => `<button type="button" class="v2-icon-btn" data-ed="${group}" data-value="${value}" aria-pressed="${pressed ? 'true' : 'false'}" title="${label}">${icon(value)}<span>${label}</span></button>`;
  function currentPrinter() {
    const d = document.querySelector('.print-v2-dashboard'); if (!d) return PRINTER_LIST[0];
    const t = d.dataset.printerType || 'resin', q = d.dataset.quality || 'standard';
    return PRINTER_LIST.find(x => t === 'custom' ? x.type === 'custom' : x.type === t && x.quality === q) || PRINTER_LIST[0];
  }
  // v2.266: the file name is just name-SHRINK-75mm (the SHRINK part only when SHRINK ran; the height is always there). The CLAY/REBUILT/FIXED/FUSED and printer-tag parts of v2.221 are gone.
  function downloadStem(base) {
    const parts = [cleanBaseName(base)];
    if (appliedChanges.has('shrunk')) parts.push('SHRINK');
    const h = Number(document.getElementById('v2Height')?.value);
    if (h > 0) parts.push(`${Number.isInteger(h) ? h : h.toFixed(1)}mm`);
    return parts.join('-');
  }

  window.__shrinkDownloadStem = downloadStem;

  // Matrix-style rain of 0s and 1s in the MODEL HEALTH box while QUICK-FIX works (v2.176)
  let rainTimer = null;
  // Reference-counted: nested tools (QUICK-FIX runs shrink, fix, fuse) keep the rain going until the last one ends.
  // A delay lets quick things (the health check) finish before the rain shows, so it does not flash.
  let workCount = 0, workTimer = null, workShown = false, workOnViewer = false;
  // v2.309: while any job runs (and until the FIRST health check has finished) the whole screen is dimmed with one word: Checking… / Shrinking… / Fixing… / Fusing… / Hollowing… / Editing…
  // Nested jobs (QUICK-FIX runs fix, shrink, fuse, each with its own health check) show the OUTERMOST labelled job, so the word only changes between steps.
  let dimStack = [], dimLast = '', dimTimer = 0, firstChecking = false;
  function dimUpdate() {
    let el = document.getElementById('v2Dim');
    const now = Date.now(), live = dimStack.filter(e => e.until <= now), labelled = dimStack.find(e => e.label);
    if (labelled) dimLast = labelled.label; else if (!dimStack.length) dimLast = '';
    const text = labelled ? labelled.label : (dimLast || (firstChecking ? 'Checking…' : ''));
    const want = (live.length > 0 || firstChecking) && !!text && document.body.classList.contains('app-mode-print');
    if (want && !el) { el = document.createElement('div'); el.id = 'v2Dim'; el.className = 'v2-dim'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    if (el) { if (want && el.textContent !== text) el.textContent = text; if (el.hidden === want) el.hidden = !want; }
    clearTimeout(dimTimer); const next = dimStack.filter(e => e.until > now).map(e => e.until); if (next.length) dimTimer = setTimeout(dimUpdate, Math.max(20, Math.min(...next) - now + 5));
  }
  window.addEventListener('shrink:model-opened', () => { firstChecking = true; setTimeout(dimUpdate, 0); });
  window.__shrinkDimState = () => ({ text: document.getElementById('v2Dim')?.textContent || '', shown: !!document.getElementById('v2Dim') && !document.getElementById('v2Dim').hidden, firstChecking, depth: dimStack.length });
  function setWorking(on, delayMs = 0, label = '') {
    if (on) dimStack.push({ label, until: Date.now() + (delayMs > 0 ? delayMs : 0) }); else dimStack.pop();
    dimUpdate();
    if (on) {
      workCount++; document.body.setAttribute('data-v2-work', '1');
      if (workShown || workTimer) return;
      if (delayMs > 0) workTimer = setTimeout(() => { workTimer = null; if (workCount > 0) showWork(); }, delayMs); else showWork();
    } else {
      workCount = Math.max(0, workCount - 1);
      if (workCount === 0) document.body.removeAttribute('data-v2-work');
      if (workCount === 0) { if (workTimer) { clearTimeout(workTimer); workTimer = null; } hideWork(); }
    }
  }
  // With the left panel folded away the health card is hidden, so the rain falls over the 3D view instead (v2.218).
  function viewerRain() {
    const v = document.getElementById('viewer'); if (!v) return null;
    let cv = document.getElementById('v2ViewerRain');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'v2ViewerRain'; cv.className = 'v2-viewer-rain'; cv.setAttribute('aria-hidden', 'true'); v.appendChild(cv); }
    return cv;
  }
  function showWork() {
    const hc = document.getElementById('v2HealthCard'); if (!hc) return;
    if (dashboard?.dataset.left === 'closed') {
      const v = document.getElementById('viewer'), cv = viewerRain(); if (!v || !cv) return;
      cv.hidden = false; workShown = true; workOnViewer = true; startRain(v, cv); return;
    }
    const r = hc.getBoundingClientRect(); hc.style.width = r.width + 'px'; hc.style.height = Math.max(r.height, 150) + 'px'; hc.dataset.working = '1'; workShown = true; workOnViewer = false;
    startRain(hc, hc.querySelector('.v2-working-rain'));
  }
  function hideWork() {
    stopRain(); workShown = false;
    const vr = document.getElementById('v2ViewerRain'); if (vr) vr.hidden = true;
    const hc = document.getElementById('v2HealthCard'); if (hc) { hc.dataset.working = ''; hc.style.width = ''; hc.style.height = ''; }
  }
  window.__shrinkWork = setWorking;      // other modules (Make watertight) call this around their own long jobs
  function startRain(hc, cv) {
    stopRain();
    const ctx = cv?.getContext?.('2d'); if (!ctx) return;
    const W = Math.max(60, Math.round(hc.clientWidth)), H = Math.max(60, Math.round(hc.clientHeight)), size = 13;
    cv.width = W; cv.height = H;
    const cols = Math.ceil(W / size), drops = Array.from({ length: cols }, () => -Math.floor(Math.random() * H / size));
    ctx.fillStyle = '#06100d'; ctx.fillRect(0, 0, W, H); ctx.font = `bold ${size}px monospace`;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const tick = () => {
      ctx.fillStyle = 'rgba(6,16,13,.16)'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < cols; i++) {
        const y = drops[i] * size;
        ctx.fillStyle = 'rgba(39,194,125,.85)'; ctx.fillText(Math.random() < .5 ? '0' : '1', i * size, y - size);
        ctx.fillStyle = '#d6ffe6'; ctx.fillText(Math.random() < .5 ? '0' : '1', i * size, y);
        if (y > H && Math.random() > .96) drops[i] = 0; else drops[i]++;
      }
    };
    tick(); if (!still) rainTimer = setInterval(tick, 60);
  }
  function stopRain() { if (rainTimer) { clearInterval(rainTimer); rainTimer = null; } }


  // Make a tool's result the new current working model: show it, keep the camera, tell the rest of the app,
  // record the change chip and clear the red warning. Fix It, Make watertight and any future tool go through here.
  function installWorkingResult(root, kind) {
    if (kind !== 'hollow') { try { removeHollowBlue(); } catch {} }
    const view = app()?.getViewState?.();
    app()?.setPreview?.(root);
    setWorkingModel(root);
    app()?.show?.('optimized');
    if (view) app()?.restoreViewState?.(view);
    app()?.notifyReduced?.({ kind });
    markApplied(kind === 'rebuild' ? 'rebuilt' : kind === 'clay' ? 'clay' : kind === 'hollow' ? 'hollowed' : kind === 'edit' ? 'edited' : 'fixed');
    window.__shrinkPrintSafety?.clearDiagnostic?.();
    return root;
  }
  window.__shrinkInstallWorkingModel = installWorkingResult;
  window.__shrinkMarkApplied = markApplied;       // tests
  window.__shrinkRefreshHealth = () => updateHealthCard();
  window.__shrinkHealthIsCurrent = () => !!(lastHealth && lastHealth.model === sourceModel());   // v2.251: BATCH waits for the health check of THIS model, not a leftover one
  const HOLLOW_ON = (() => { try { return new URLSearchParams(window.location.search).get('hollow') !== '0'; } catch { return true; } })();   // v2.295: HOLLOW IT is on for everyone; ?hollow=0 switches it off
  let fusedPieces = 1;                          // how many pieces the last fuse left (v2.187): the chip says so when it is not one
  function renderAppliedChanges() {
    { const hc = $('v2HollowCard'); if (hc) hc.hidden = !(HOLLOW_ON && appliedChanges.has('shrunk')); }
    ensureHollowSlide(); { const hs = $('v2HollowSlide'); if (hs) hs.hidden = !appliedChanges.has('hollowed'); }
    const wrap = $('v2HealthChanges');
    if (!wrap) return;
    const order = ['clay','fixed','rebuilt','fused','edited','hollowed','shrunk'];
    const labels = { clay:'BRUSH', fixed:'FIXED', rebuilt:'REBUILT', fused:'FUSED', hollowed:'HOLLOW', edited:'EDITED', shrunk:'SHRUNK' };
    const chips = order.filter(k => appliedChanges.has(k))
      .map(k => `<span class="v2-change-chip ${k}"><i></i>${k === 'fused' && fusedPieces > 1 ? `FUSED · ${fusedPieces} PIECES` : labels[k]}</span>`)
      .join('');
    // v2.278: a green tick on the SHRINK / FIX / FUSE buttons in ADVANCED once that step has been done on the working model
    [['v2ShrinkBtn', 'shrunk'], ['v2FixBigBtn', 'fixed'], ['v2FuseBtn', 'fused'], ['v2HollowBtn', 'hollowed']].forEach(([id, k]) => { const b = $(id); if (!b) return; const on = appliedChanges.has(k) || (k === 'fixed' && appliedChanges.has('rebuilt')); if (on) { if (b.dataset.done !== '1') b.dataset.done = '1'; } else if (b.dataset.done) delete b.dataset.done; });
    wrap.innerHTML = chips
      ? `<small>CHANGES</small><div>${chips}</div>`
      : '<small>CHANGES</small><div class="v2-change-none">None yet</div>';
  }

  function markApplied(kind) {
    appliedChanges.add(kind);
    renderAppliedChanges();
  }

  function clearApplied() {
    appliedChanges.clear(); fusedPieces = 1;
    renderAppliedChanges();
  }


  function setNative(id, value, event = 'change') {
    const el = $(id);
    if (!el) return false;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
    return true;
  }

  function nativeValue(id, fallback = '') {
    const el = $(id);
    return el ? el.value : fallback;
  }

  // v2.199: a handful of stray edges (no holes) is "minor": slicers repair it on their own, so it costs 5 points and shows green/amber, not red.
  const MINOR_MAX = 250;   // v2.249: was 10; slicers cope with a few hundred stray edges, and Make watertight costs far more detail than that is worth
  function minorCount(h) {
    if (!h || h.openEdges > 0) return 0;
    const n = (h.pinchedEdges || 0) + (h.flippedEdges || 0);
    return n > 0 && n <= MINOR_MAX ? n : 0;
  }
  function healthScore(h) {
    if (!h) return { score: 0, label: 'Checking…', level: 'checking' };
    const minor = minorCount(h);
    if (minor) return { score: 95, label: 'Good', level: 'good', minor };
    let score = 100;
    if (h.openEdges > 0) score -= 35;
    if (h.pinchedEdges > 0) score -= 35;
    if (h.flippedEdges > 0) score -= 20;
    // Degenerate (zero-area) triangles are reported but cost nothing (v2.190): slicers skip them and they never block printing, the same rule as meshHealth.
    score = Math.max(0, score);
    const label = score === 100 ? 'Excellent' : score >= 80 ? 'Good' : score >= 55 ? 'Needs attention' : 'Poor';
    const level = score === 100 ? 'good' : score >= 80 ? 'fair' : 'bad';
    return { score, label, level };
  }

  // How many separate pieces (shells that share no vertex) the working model has. Quantised world positions, union-find; skipped for huge models (v2.185).
  const PIECES_MAX_TRIANGLES = 1500000;
  const SCULPT_MAX_TRIANGLES = 2500000;           // v2.317: Sculpt and Grab-whole-piece work on the mesh itself (no Manifold), so they take bigger models
  async function countPieces(model) {
    const THREE = app()?.THREE; if (!model || !THREE) return null;
    try {
      model.updateWorldMatrix?.(true, true);
      const box = new THREE.Box3().setFromObject(model, true); if (box.isEmpty()) return null;
      const size = box.getSize(new THREE.Vector3()), tol = Math.max(size.length() * 1e-6, 1e-9);
      const meshes = []; let tris = 0;
      model.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) { meshes.push(o); const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
      if (!meshes.length || tris > PIECES_MAX_TRIANGLES) return null;
      const ids = new Map(), parent = []; const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
      const v = new THREE.Vector3(); let n = 0;
      for (const m of meshes) {
        const g = m.geometry, pos = g.attributes.position, idx = g.index, map = new Int32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const key = Math.round(v.x / tol) + ',' + Math.round(v.y / tol) + ',' + Math.round(v.z / tol);
          let id = ids.get(key); if (id === undefined) { id = n++; ids.set(key, id); parent.push(id); }
          map[i] = id;
        }
        const cnt = idx ? idx.count : pos.count;
        for (let t = 0; t < cnt; t += 3) {
          const a = map[idx ? idx.getX(t) : t], b = map[idx ? idx.getX(t + 1) : t + 1], c = map[idx ? idx.getX(t + 2) : t + 2];
          const ra = find(a), rb = find(b), rc = find(c); if (ra !== rb) parent[rb] = ra; const r2 = find(rc); if (r2 !== ra) parent[r2] = ra;
        }
        await wait(0);
      }
      const used = new Set(); for (let i = 0; i < n; i++) used.add(find(i));
      try { const tc = new Map(); for (const m of meshes) { const g = m.geometry, idx = g.index, cnt = idx ? idx.count : g.attributes.position.count; /* count triangles per piece from the first vertex of each triangle */ const pos = g.attributes.position; for (let t = 0; t < cnt; t += 3) { v.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(m.matrixWorld); const id = ids.get(Math.round(v.x / tol) + ',' + Math.round(v.y / tol) + ',' + Math.round(v.z / tol)); const r = find(id); tc.set(r, (tc.get(r) || 0) + 1); } } window.__shrinkPieceInfo = [...tc.values()].sort((a, b) => b - a); } catch { window.__shrinkPieceInfo = null; }
      return used.size;
    } catch (e) { console.warn('piece count', e); return null; }
  }

  function healthRow(label, value, ok, minor) {
    return `<div class="v2-health-row"><span>${label}</span><strong class="${ok ? 'ok' : (minor ? 'note' : 'issue')}">${value}</strong></div>`;
  }

  function ensureHealthCard() {
    const viewer = $('viewer');
    if (!viewer) return null;
    let card = $('v2HealthCard');
    if (card) return card;
    card = document.createElement('aside');
    card.id = 'v2HealthCard';
    card.className = 'v2-health-card checking';
    card.innerHTML = `
      <div class="v2-health-top">
        <div><small>MODEL HEALTH</small><strong id="v2HealthLabel">Checking…</strong></div>
        <div class="v2-health-score"><b id="v2HealthScore">—</b><span>/100</span></div>
      </div>
      <div id="v2HealthRows" class="v2-health-rows"><div class="v2-health-checking">Running mesh checks…</div></div>
      <div id="v2HealthChanges" class="v2-health-changes"><small>CHANGES</small><div class="v2-change-none">None yet</div></div>
      <div id="v2FixProgress" class="v2-fix-progress" hidden><div class="v2-fix-bar"><i id="v2FixFill"></i></div><small id="v2FixLabel"></small></div>
      <div id="v2MagicNote" class="v2-magic-note" role="status" hidden></div>
      <div class="v2-health-working" aria-live="polite"><canvas class="v2-working-rain" aria-hidden="true"></canvas><b>Working…</b></div>
    `;
    viewer.appendChild(card);
    $('v2MagicNote').addEventListener('click', () => { $('v2MagicNote').hidden = true; });
    return card;
  }

  let healthRun = 0;
  let detailScale = 1;                          // v2.270: the live reducer's base as a fraction of the upload. The Detail kept number is always % of the ORIGINAL, so native = shown / detailScale
  let detailManual = false;                     // the Detail kept value was set by hand after SHRINK, so the printer tag no longer describes the result
  let manualLevel = '';                         // '16K' | '8K' | 'below 8K': what the hand-set Detail kept still prints safely at (from the last measurement)
  const shrinkTag = () => detailManual ? `${$('v2Detail')?.value || ''}% kept${manualLevel ? ' · ' + manualLevel : ''}` : currentPrinter().tag;
  let rebasing = null;                          // a re-base of the live reducer that is in flight (the slider waits for it)
  let lastHealth = null;                         // { model, h }: the newest health result and the model it belongs to
  // v2.244: the yellow "Too many triangles to fuse" banner is gone (too confusing). FUSE IT still refuses above the limit (fuseCheck) and says so in its own card.
  function updateSizeWarning() { $('v2SizeWarn')?.remove(); }
  window.__shrinkRefreshSizeWarning = updateSizeWarning;

  // QUICK-FIX is grey and unclickable (like DOWNLOAD) while the health check runs and turns green when it has finished, so it is clear when to press it (v2.148).
  /* v2.304: AUTO-SHRINK stays grey from the moment a model opens until its FIRST full health check (including the piece count) has finished; later re-checks never turn it grey again, so it no longer flickers green / grey / green */
  let firstHealthDone = false;
  window.addEventListener('shrink:model-opened', () => { firstHealthDone = false; try { quickState('checking'); } catch {} });
  const quickState = (st) => { if (st === 'ready' && firstChecking) { firstChecking = false; setTimeout(dimUpdate, 0); }
    const b = $('v2MagicBtn'); if (!b) return; if (b.dataset.state !== st) b.dataset.state = st; if (!b.dataset.busy) { const off = st === 'checking' || !sourceModel(); if (b.disabled !== off) b.disabled = off; }
    const sb = $('v2ShrinkBtn'); if (sb) { const sOff = st === 'checking' || !sourceModel(); if (sOff) { sb.dataset.checking = '1'; if (!sb.disabled) sb.disabled = true; } else if (sb.dataset.checking) { delete sb.dataset.checking; if (!shrinkRunning && sb.disabled) sb.disabled = false; } } };
  let shrinkRunning = false;
  // v2.267/v2.270: once FIX IT / FUSE IT / QUICK-FIX has installed a new working model, Detail kept shows how much of the ORIGINAL it holds (e.g. 1.1%), not the stale value from before. Dragging it back up restores the original (see applyDetailValue).
  const origTrisOf = () => Math.max(1, modelTriangles(app()?.originalModel));
  function syncDetailToBase() {
    const live = window.__shrinkLive, d = $('v2Detail'), n = $('v2DetailNumber'), note = $('v2DetailNote'); if (!live?.root || !d || !sourceModel() || sourceModel() === app()?.originalModel) return;
    if (!['fixed', 'fused', 'rebuilt', 'clay', 'hollowed', 'edited'].some(k => appliedChanges.has(k))) return;   // a freshly opened model also differs from the live preview root: only a tool that really replaced the model counts
    const pct = Math.max(1, Math.min(100, Math.round(Math.min(1, modelTriangles(sourceModel()) / origTrisOf()) * 1000) / 10)), t = String(pct);
    if (d.value !== t) d.value = t; if (n && n.value !== t) n.value = t;
    detailManual = false; manualLevel = '';
    if (note) note.textContent = `This model keeps ${pct}% of the original triangles (${modelTriangles(sourceModel()).toLocaleString()}). Drag the slider up to go back to the original; FIX IT and FUSE IT are then undone.`;
  }
  async function updateHealthCard(...a) { setWorking(true, firstHealthDone ? 350 : 0, 'Checking…'); try { return await updateHealthCardInner(...a); } finally { setWorking(false); try { syncDetailToBase(); } catch {} } }
  async function updateHealthCardInner() {
    updateSizeWarning(); ensureTurnPad();
    const card = ensureHealthCard();
    const model = healthModel();
    if (!card || !model) return;
    const run = ++healthRun;
    card.className = 'v2-health-card checking';
    if (!firstHealthDone) quickState('checking');
    $('v2HealthLabel').textContent = 'Checking…';
    $('v2HealthScore').textContent = '—';
    $('v2HealthRows').innerHTML = '<div class="v2-health-checking">Running mesh checks…</div>';
    await wait(60);
    if (run !== healthRun) return;
    try {
      for (let i = 0; i < 40 && !window.__shrinkPrintSafety?.topologySummary; i++) await wait(50);
      // Very dense GLBs may contain many independent meshes. An exact edge-by-edge
      // topology check can monopolise the UI; don't block conversion or AUTO-SHRINK.
      const largeGlb = app()?.sourceKind === 'glb' && modelTriangles(model) > 400000;
      const h = largeGlb ? null : window.__shrinkPrintSafety?.topologySummary?.(model);
      if (run !== healthRun) return;
      if (!h) {
        card.className = 'v2-health-card';
        $('v2HealthLabel').textContent = largeGlb ? 'Large GLB loaded' : 'Health check unavailable';
        $('v2HealthScore').textContent = '—';
        $('v2HealthRows').innerHTML = heightRowHtml() + '<div class="v2-health-row"><span>Triangles</span><strong>' + modelTriangles(model).toLocaleString() + '</strong></div><div class="v2-health-minor">' + (largeGlb ? 'Detailed mesh checks skipped for this large GLB so the interface stays responsive. AUTO-SHRINK can still run; OBJ conversion does not require it.' : 'The health analyser did not load. You can still convert this model using Other formats.') + '</div>';
        firstHealthDone = true; quickState('ready');
        return;
      }
      lastHealth = { model, h };
      const rating = healthScore(h);
      card.className = `v2-health-card ${rating.level}`;
      if (firstHealthDone) quickState('ready');   // first check: turns green only after the piece count below has finished
      $('v2HealthLabel').textContent = rating.label;
      $('v2HealthScore').textContent = String(rating.score);
      const watertight = h.openEdges === 0;
      const manifold = h.pinchedEdges === 0;
      const oriented = h.flippedEdges === 0;
      const cleanDegens = true;                       // informational only (v2.190): shown, never red
      const tris = modelTriangles(model), stlBytes = 84 + 50 * tris, sizeText = stlBytes >= 1048576 ? `${(stlBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(stlBytes / 1024))} KB`;
      {   // v2.224: white note under the health box: how much smaller the file got (STL size estimate before vs now)
        const fmt = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
        const orig = app()?.originalModel, origTris = orig ? modelTriangles(orig) : 0, viewer = document.getElementById('viewer'), card = $('v2HealthCard');
        let note = $('v2ReduceNote');
        if (!note && viewer) { note = document.createElement('div'); note.id = 'v2ReduceNote'; note.className = 'v2-reduce-note'; viewer.appendChild(note); }
        if (note && card) {
          const was = 84 + 50 * origTris;
          const st = sideStack(); if (st && note.parentNode !== st) st.appendChild(note);
          if (origTris > 0 && tris < origTris) { const kTag = appliedChanges.has('shrunk') ? ` (${shrinkTag()})` : ''; const nf = n => new Intl.NumberFormat().format(n); note.innerHTML = `Reduced from <b class="v2-was">${fmt(was)}</b> to <b class="v2-now">${fmt(stlBytes)}</b>${kTag}<br><small>${nf(origTris)} → ${nf(tris)} triangles</small>`; note.hidden = false; }
          else note.hidden = true;
        }
      }
      $('v2HealthRows').innerHTML =
        heightRowHtml() +
        healthRow('File size', `≈ ${sizeText} STL${appliedChanges.has('shrunk') ? ' · ' + shrinkTag() : ''}`, true) +
        healthRow('Triangles', new Intl.NumberFormat().format(tris), true) +
        healthRow('Watertight', watertight ? 'YES' : 'NO', watertight) +
        healthRow('Open edges', new Intl.NumberFormat().format(h.openEdges), h.openEdges === 0) +
        healthRow('Non-manifold', new Intl.NumberFormat().format(h.pinchedEdges), manifold, !!rating.minor) +
        healthRow('Flipped faces', new Intl.NumberFormat().format(h.flippedEdges), oriented, !!rating.minor) +
        healthRow('Degenerates', new Intl.NumberFormat().format(h.degenerateTriangles), cleanDegens) +
        (rating.minor ? `<div class="v2-health-minor">${rating.minor} minor ${rating.minor === 1 ? 'edge' : 'edges'}: your slicer will handle this. Fine to print.</div>` : '');
      const rowsEl = $('v2HealthRows'); delete rowsEl.dataset.pieces;
      countPieces(model).then(np => {
        if (run !== healthRun || !np) return;
        rowsEl.dataset.pieces = String(np);
        rowsEl.insertAdjacentHTML('beforeend', np === 1 ? '<div class="v2-health-row"><span>Pieces</span><strong class="ok">1 (one solid)</strong></div>' : `<div class="v2-health-row v2-pieces-row"><span>Separate pieces</span><strong class="note">${np} (not fused)</strong></div>`);
      }).catch(() => {}).finally(() => { if (run === healthRun) { firstHealthDone = true; quickState('ready'); } });
    } catch (err) {
      card.className = 'v2-health-card bad';
      firstHealthDone = true; quickState('ready');
      $('v2HealthLabel').textContent = 'Check failed';
      $('v2HealthScore').textContent = '—';
      $('v2HealthRows').innerHTML = '<div class="v2-health-checking">Could not analyse this mesh.</div>';
      console.warn('[SHRINK 3D v2.55] Health card check failed', err);
    }
  }

  // Little progress bar in the health card while FIX IT works. The repair itself is one blocking step, so the bar is staged (it is painted before each step)
  // and carries a sliding stripe (a CSS transform animation keeps moving while the page is busy).
  // v2.255: never wait on requestAnimationFrame alone: it stops while the tab is hidden or covered, which froze QUICK-FIX and BATCH until you looked again
  const paintNow = () => new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};requestAnimationFrame(()=>setTimeout(f,0));setTimeout(f,60);});
  async function fixStep(pct, text) {
    const box = $('v2FixProgress'); if (!box) return;
    box.hidden = false; box.dataset.busy = pct < 100 ? '1' : '';
    $('v2FixFill').style.width = `${pct}%`; $('v2FixLabel').textContent = text || '';
    progress($('v2FixCard'), pct, text);
    await paintNow();
  }
  async function fixHealthModel(...a) { setWorking(true, 0, 'Fixing…'); try { return await fixHealthModelInner(...a); } finally { setWorking(false); } }
  async function fixHealthModelInner() {
    const big = $('v2FixBigBtn');
    const model = healthModel();
    if (!big || !model || big.disabled) return;
    big.disabled = true; big.textContent = 'FIXING…';
    const bigResult = html => { const r = $('v2FixResult'); if (r) r.innerHTML = html; };
    try {
      await fixStep(8, 'Getting ready…');
      for (let i = 0; i < 50 && !window.__shrinkFuse?.repairModel; i++) await wait(100);
      if (!window.__shrinkFuse?.repairModel) throw new Error('The repair engine is still loading.');
      let clayNote = '';
      if (window.__shrinkClay?.hasClay?.()) {
        // pink clay first: it is joined to (or carved out of) the model, then the normal repair runs on the result if it is still not clean
        await fixStep(30, 'Joining the clay to the model…');
        const cr = await window.__shrinkClay.apply(model, t => fixStep(40, t));
        await fixStep(75, 'Putting the result on screen…');
        installWorkingResult(cr.root, 'clay'); window.__shrinkClay.finish(); clayNote = cr.note;
      } else {
      await fixStep(30, 'Repairing the mesh…');
      const { root } = window.__shrinkFuse.repairModel(model);
      await fixStep(75, 'Putting the fixed model on screen…');
      installWorkingResult(root, 'repair');
      }
      // (the big FIX IT button resets itself in finally)
      await fixStep(90, 'Checking the result…');
      await wait(80);
      await updateHealthCard();
      await fixStep(100, 'Done');
      { const sc = Number($('v2HealthScore')?.textContent); bigResult(sc === 100 ? `<strong>✓ Fixed</strong><span>The model is watertight and clean now.${clayNote ? ' ' + clayNote : ''}</span>` : `<strong>✓ Fixed what could be fixed</strong><span>Model health is ${Number.isFinite(sc) ? sc + '/100' : 'updated'}. See the Model Health box for what is left.</span>`); }
      setTimeout(() => { if ($('v2FixProgress') && !big.disabled) $('v2FixProgress').hidden = true; }, 1500);
    } catch (err) {
      console.error('[SHRINK 3D v2.55] Health repair failed', err);
      await fixStep(100, 'Could not fix this model');
      bigResult(`<strong>Could not fix this model</strong><span>${err?.message || err}</span>`);
      $('v2FixProgress') && ($('v2FixProgress').dataset.state = 'bad');
      window.__shrinkPrintSafety?.showDiagnostic?.('Fuse', err?.message || String(err));
      setTimeout(() => { const b = $('v2FixProgress'); if (b) { b.hidden = true; delete b.dataset.state; } }, 2500);
    } finally {
      big.disabled = false; big.textContent = 'FIX IT';
    }
  }

  // v2.257: the print height in mm, first row of the health box; kept in step with the Finished height box
  function heightText() { const v = Number($('v2Height')?.value); return v > 0 ? `${Number.isInteger(v) ? v : v.toFixed(1)} mm` : '–'; }
  function heightRowHtml() { return `<div class="v2-health-row"><span>Height</span><strong id="v2HealthHeight">${heightText()}</strong></div>`; }
  function syncHealthHeight() { const el = $('v2HealthHeight'); if (el && el.textContent !== heightText()) el.textContent = heightText(); }
  function updateHeight() {
    const number = $('v2Height');
    const range = $('v2HeightRange');
    if (!number || !range) return;
    const v = Math.max(1, Math.min(500, Number(number.value) || 75));
    number.value = String(v);
    range.value = String(Math.max(Number(range.min), Math.min(Number(range.max), v)));
    setNative('figureHeightMm', v, 'input');
    updateStep1Summary();
    refreshDims();
    syncHealthHeight();
    markSettingsChanged();
  }

  // ---- Width / Depth read-outs: the print is always scaled uniformly from the height, so width and depth follow it ----
  let sizeCache = { key: '', size: null }, reducedTick = 0;
  let manualHeight = false; // Automatic 30 mm floor never overrides an intentional resize.
  // v2.289: printer/size changes require the all-in-one SHRINK again.
  // Manual Detail kept is different: it can be downloaded once the live preview settles.
  let autoReady = false, settingsDirty = false, detailUpdating = false;
  function updateWorkflowButtons() {
    const magic = $('v2MagicBtn'), dl = $('v2MagicDownload'), other = $('v2DownloadBtn');
    const working = !!magic?.dataset.busy;
    const ready = autoReady && !settingsDirty && !detailUpdating && !working;
    if (magic && !working) magic.textContent = settingsDirty ? 'AUTO-SHRINK — settings changed' : 'AUTO-SHRINK';   /* v2.301: no "AGAIN" any more; the line under DOWNLOAD says when it is done */
    if (dl) { dl.disabled = !ready; dl.title = settingsDirty ? 'Settings changed: press SHRINK again.' : detailUpdating ? 'Waiting for the manual detail preview.' : ready ? 'Download the current model.' : 'Press SHRINK first.'; }
    if (other) other.disabled = !ready;
    const otherFormats = $('v2SideGlb');
    // Direct format conversion (GLB -> OBJ etc.) does not require AUTO-SHRINK.
    // It is separate from the protected, print-ready DOWNLOAD workflow.
    if (otherFormats) { otherFormats.dataset.available = sourceModel() && !working && !detailUpdating ? 'yes' : 'no'; otherFormats.title = 'Convert the loaded model to OBJ (Cinema 4D R25), GLB, 3MF or USDZ. AUTO-SHRINK is optional.'; }
    const note = $('v2WorkflowStatus');
    if (note) note.textContent = settingsDirty ? 'Settings changed — press SHRINK again.' : detailUpdating ? 'Updating manual detail…' : ready ? (detailManual ? 'Manual detail ready — download when happy.' : 'Optimised — ready to download.') : working ? 'SHRINK is working…' : 'Press SHRINK for automatic optimisation.';
  }
  function markSettingsChanged() {
    if (!autoReady || $('v2MagicBtn')?.dataset.busy || restoringPrinter || window.__shrinkBatchRunning) return;
    settingsDirty = true; detailUpdating = false; updateWorkflowButtons();
  }
  function markWorkflowReady() { autoReady = true; settingsDirty = false; detailUpdating = false; updateWorkflowButtons(); }
  function markManualPending() {
    if (!autoReady || settingsDirty) return;
    detailUpdating = true; updateWorkflowButtons();
  }
  function modelSize() {
    const THREE = app()?.THREE, model = sourceModel();
    if (!THREE || !model) return null;
    model.updateWorldMatrix(true, true);
    const key = [model.uuid, reducedTick, ...model.matrixWorld.elements.map(v => v.toFixed(4))].join('|');
    if (sizeCache.key === key) return sizeCache.size;
    const b = new THREE.Box3().setFromObject(model, true);
    const size = b.isEmpty() ? null : b.getSize(new THREE.Vector3());
    if (size) sizeCache = { key, size };        // an empty box (model mid-swap) is never remembered, or Width/Depth stay greyed out until something else changes (v2.182)
    return size;
  }
  let dimRetry = 0;
  function refreshDims() {
    const w = $('v2Width'), d = $('v2Depth'); if (!w || !d) return;
    const sz = modelSize(), h = Number($('v2Height')?.value) || 0;
    const ok = !!(sz && sz.y > 1e-9 && h);
    [w, d].forEach(i => { i.disabled = !ok; });
    $('v2ScaleUp') && ($('v2ScaleUp').disabled = !ok); $('v2ScaleDown') && ($('v2ScaleDown').disabled = !ok);
    if (!ok) { if (w.value !== '') w.value = ''; if (d.value !== '') d.value = ''; if (sourceModel() && dimRetry++ < 8) setTimeout(refreshDims, 500); return; }
    dimRetry = 0;
    const k = h / sz.y, set = (el, v) => { if (document.activeElement !== el) { const t = (Math.round(v * 10) / 10).toString(); if (el.value !== t) el.value = t; } };
    set(w, sz.x * k); set(d, sz.z * k);
  }
  function setHeightMm(h) {
    manualHeight = true; // Width/Depth adjustments and +/- scaling are deliberate resizes.
    const v = Math.max(1, Math.min(500, Math.round(h * 100) / 100));
    $('v2Height').value = String(v); updateHeight();
  }
  // Non-uniform stretch: lives on the working model root's scale, in WORLD axes. The root keeps an identity rotation (any tilt/yaw is moved into an inner group),
  // so root.scale.x/z are world X/Z and no shear is possible. The Height field still scales everything uniformly (mm per unit).
  function normalizeRoot(model, THREE) {
    if (model.quaternion.angleTo(new THREE.Quaternion()) < 1e-6) return;
    const kids = [...model.children]; if (!kids.length) return;
    const g = new THREE.Group(); g.name = 'shrinkInner'; g.quaternion.copy(model.quaternion); model.quaternion.identity();
    kids.forEach(k => g.add(k)); model.add(g); model.updateWorldMatrix(true, true);
  }
  const stretchOf = model => (model.userData.shrinkStretch ||= { x: 1, z: 1, base: model.scale.clone() });
  function worldBoxOf(model, THREE) { model.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(model, true); }
  function applyStretch(fx, fz) {
    const THREE = app()?.THREE, model = sourceModel(); if (!THREE || !model) return;
    fx = Math.max(0.05, Math.min(20, fx)); fz = Math.max(0.05, Math.min(20, fz));
    normalizeRoot(model, THREE);
    const st = stretchOf(model), b0 = worldBoxOf(model, THREE), c0 = b0.getCenter(new THREE.Vector3());
    st.x = fx; st.z = fz; notePose(model, () => model.scale.set(st.base.x * fx, st.base.y, st.base.z * fz));
    const b1 = worldBoxOf(model, THREE), c1 = b1.getCenter(new THREE.Vector3());
    moveWorld(model, new THREE.Vector3(c0.x - c1.x, b0.min.y - b1.min.y, c0.z - c1.z), THREE);   // grow about the middle, keep it on the bed
    reducedTick++; window.__shrinkStretchTick = (window.__shrinkStretchTick || 0) + 1;
    refreshDims();
    try { window.__shrinkSplit?.updatePreview?.(); } catch (e) { /* preview refresh is best effort */ }
    if (window.__shrinkViewer?.scene.getObjectByName('shrinkBedGuide')) showBedGuide();
  }
  function resetStretch() {
    const model = sourceModel(); if (!model) return false;
    const st = model.userData.shrinkStretch; const had = !!st && (st.x !== 1 || st.z !== 1);
    if (had) { applyStretch(1, 1); const u = $('v2Uniform'); if (u && !u.checked) u.checked = true; }
    return had;
  }
  function dimInput(axis) {
    const sz = modelSize(), el = $(axis === 'x' ? 'v2Width' : 'v2Depth'), val = Number(el.value), model = sourceModel();
    if (!sz || !model || !(val > 0) || sz[axis] < 1e-9) return;
    if ($('v2Uniform')?.checked !== false) { setHeightMm(val * sz.y / sz[axis]); return; }       // uniform: the other two follow
    const st = stretchOf(model), k = (Number($('v2Height').value) || 75) / sz.y;               // mm per world unit
    const baseW = sz[axis] / (axis === 'x' ? st.x : st.z);                                       // unstretched size in units
    const f = val / (baseW * k);
    axis === 'x' ? applyStretch(f, st.z) : applyStretch(st.x, f);
    markSettingsChanged();
  }
  function scaleBy(f) { setHeightMm((Number($('v2Height').value) || 75) * f); }
  function updateStep1Summary() {
    const out = $('v2Step1Summary');
    if (!out) return;
    const type = dashboard?.dataset.printerType || 'resin';
    const h = Number($('v2Height')?.value || 75);
    const label = type === 'fdm' ? 'FDM' : type === 'custom' ? 'Custom' : 'Resin';
    out.textContent = `${label} · ${h} mm high`;
  }

  // The printer type and quality are remembered in this browser (v2.159); a saved choice is put back when the dashboard is built.
  const PRINTER_KEY = 'shrink-printer'; let restoringPrinter = false;
  const savedPrinter = () => { try { const v = JSON.parse(localStorage.getItem(PRINTER_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  const syncPrinterSel = () => { const el = document.getElementById('v2PrinterSel'); if (el && dashboard) { const id = currentPrinter().id; if (el.value !== id) el.value = id; } };
  /* v2.262: only FDM / Custom are remembered. A resin model always starts on 16K, so a quality picked for one model (or switched automatically) never carries to the next. */
  const savePrinter = () => { syncPrinterSel(); if (restoringPrinter || !dashboard) return; try { localStorage.setItem(PRINTER_KEY, JSON.stringify({ type: dashboard.dataset.printerType || 'resin', quality: (dashboard.dataset.printerType || 'resin') === 'resin' ? 'ultra' : (dashboard.dataset.quality || 'standard') })); } catch { /* private mode: nothing to remember */ } };
  function choosePrinter(type) {
    dashboard.dataset.printerType = type;
    dashboard.querySelectorAll('[data-printer]').forEach(b => b.classList.toggle('active', b.dataset.printer === type));
    if (type === 'resin') setNative('printerPreset', '0.05');
    if (type === 'fdm') setNative('printerPreset', '0.2');
    if (type === 'custom') setNative('printerPreset', 'custom');
    $('v2CustomPrinter').hidden = type !== 'custom';
    updateStep1Summary();
    markStep(1, 'done');
    savePrinter();
    markSettingsChanged();
  }

  function setQuality(kind) {
    dashboard.dataset.quality = kind;
    dashboard.querySelectorAll('[data-quality]').forEach(b => b.classList.toggle('active', b.dataset.quality === kind));
    const type = dashboard.dataset.printerType || 'resin';
    let detail = type === 'fdm' ? 0.2 : 0.05;
    if (kind === 'fine') detail = type === 'fdm' ? 0.15 : 0.03;
    if (kind === 'ultra') detail = type === 'fdm' ? 0.1 : 0.018;     // 16K resin: about 18 micron pixels
    if (kind === 'large') detail = type === 'fdm' ? 0.3 : 0.1;
    window.__shrinkStrict = kind === 'ultra' ? 'p995' : undefined;     // 16K also holds the last 0.5% of the surface to the limit
    setNative('printerPreset', 'custom');
    setNative('printerDetailMm', detail, 'input');
    const adv = $('v2PrinterDetail'); if (adv) adv.value = String(detail);
    savePrinter();
    markSettingsChanged();
  }

  function markStep(n, state = 'active') {
    dashboard?.querySelectorAll('.v2-progress-step').forEach((el, i) => {
      const step = i + 1;
      el.classList.toggle('active', step === n && state === 'active');
      if (step < n || (step === n && state === 'done')) el.classList.add('done');
    });
    const fill = $('v2ProgressFill');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, ((n - 1) / 3) * 100))}%`;
  }

  function progress(card, pct, text) {
    const bar = card?.querySelector('.v2-card-progress > i');
    const label = card?.querySelector('.v2-card-progress-label');
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = text || '';
  }

  const FUSE_MAX_TRIANGLES = 1000000;
  const BIG_TASK_TRIANGLES = 1000000;           // QUICK-FIX shows the "complex one" note above this many triangles
  async function fuseCheck(...a) { setWorking(true, 0, 'Fusing…'); try { return await fuseCheckInner(...a); } finally { setWorking(false); } }
  async function fuseCheckInner() {
    const btn = $('v2FuseBtn');
    const card = $('v2FuseCard');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    markStep(2, 'active');
    progress(card, 12, 'Checking the model…');
    $('v2FuseResult').textContent = 'Checking whether the model can be made into one clean solid…';
    try {
      for (let i = 0; i < 50 && !window.__shrinkFuse?.modelToSolid; i++) await wait(100);
      if (!window.__shrinkFuse?.modelToSolid) throw new Error('The repair tool is still loading. Try again in a moment.');
      const model = sourceModel();
      if (!model) throw new Error('Load a model first.');
      // The solid work runs on the page's main thread: a multi-million triangle model freezes the tab ("Page Unresponsive"). Say so up front instead of hanging.
      const tris = modelTriangles(model), limit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES;
      if (tris > limit) {
        fuseReady = false; progress(card, 100, 'Too detailed to fuse as it is.'); markStep(2, 'pending');
        $('v2FuseResult').innerHTML = `<strong>Press SHRINK IT first</strong><span>This model has ${tris.toLocaleString()} triangles, which is too many to fuse in the browser without freezing the page (the limit is ${limit.toLocaleString()}). SHRINK IT keeps the shape and cuts the triangles right down; then FUSE IT will work in a moment.</span>`;
        btn.disabled = false; return;
      }
      progress(card, 36, 'Repairing seams and joining touching parts…');
      await wait(20);
      const built = await window.__shrinkFuse.fuseModel(model);
      progress(card, 78, 'Checking the result…');
      const components = Math.max(1, Number(built.components) || 1);
      app()?.setPreview?.(built.root);
      setWorkingModel(built.root);
      app()?.show?.('optimized');
      app()?.notifyReduced?.({ kind: 'fuse', components });
      fusedPieces = components; window.__shrinkLastFuse = { components, build: window.__shrinkFuseBuild || 'OLD fuse-export (no shell split)', triangles: modelTriangles(built.root), at: new Date().toISOString() }; markApplied('fused');
      window.__shrinkPrintSafety?.clearDiagnostic?.();
      card.dataset.state = 'good';
      markStep(2, 'done');
      markStep(3, 'active');

      if (components === 1) {
        setNative('fuseSolidToggle', false, 'change');
        fuseReady = false;
        progress(card, 100, 'Done — current model is one fused printable solid.');
        $('v2FuseResult').innerHTML = '<strong>✓ Fused</strong><span>The fused result is now your current working model.</span>';
      } else {
        setNative('fuseSolidToggle', false, 'change');
        fuseReady = false;
        const noun = components === 1 ? 'component' : 'components';
        progress(card, 100, `Done — ${components} watertight ${noun} remain separate.`);
        $('v2FuseResult').innerHTML = `<strong>✓ Repaired and fused where possible</strong><span>${components} watertight ${noun} remain because they do not all touch. This result is now your current working model.</span>`;
      }
      setTimeout(updateHealthCard, 80);
    } catch (err) {
      fuseReady = false;
      progress(card, 100, 'This model needs more repair.');
      $('v2FuseResult').innerHTML = `<strong>Needs repair</strong><span>${err.message}</span>`;
      card.dataset.state = 'warn';
      window.__shrinkPrintSafety?.showDiagnostic?.('Fuse', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- HOLLOW IT (v2.281, test branch): hollow the working model after SHRINK, then a cut-away slider to look inside ----
  let hollowPlane = null, hollowBase = null, hollowResult = null;
  /* v2.303: a tall blue slider at the left of the viewer (right of the ADVANCED column) that cuts the hollow model open from the top; it drives the same cut-away as the slider on the Hollow card */
  function ensureHollowSlide() {
    if ($('v2HollowSlide')) return;
    const slot = document.querySelector('.v2-viewer-slot'); if (!slot) return;
    const d = document.createElement('div'); d.id = 'v2HollowSlide'; d.className = 'v2-hollow-slide'; d.hidden = true;
    d.title = 'Slide down to cut the hollow model open and see the inside';
    d.innerHTML = '<span>CUT</span><input id="v2HollowSlideRange" type="range" min="0" max="100" step="1" value="100" orient="vertical" aria-label="Cut-away height" autocomplete="off"><output id="v2HollowSlideOut">off</output>';
    slot.appendChild(d);
    $('v2HollowSlideRange').addEventListener('input', e => hollowClip(Number(e.target.value)));
  }
  function removeHollowBlue() { const V = window.__shrinkViewer; const g = V?.scene?.getObjectByName?.('shrinkHollowBlue'); if (!g) return; V.scene.remove(g); g.traverse(o => { if (o.isMesh && o.material && o.material.dispose && g.children[0] === o) o.material.dispose(); }); }
  window.addEventListener('shrink:model-opened', () => { removeHollowBlue(); hollowBase = null; hollowResult = null; });
  function hollowClip(pct) {
    const V = window.__shrinkViewer, THREE = app()?.THREE, model = sourceModel(); if (!THREE || !model) return;
    if (V?.renderer) V.renderer.localClippingEnabled = true;
    const box = new THREE.Box3().setFromObject(model, true); if (box.isEmpty()) return;
    hollowPlane = hollowPlane || new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    hollowPlane.constant = box.min.y + (box.max.y - box.min.y) * (pct / 100);          // keeps everything below the plane; dragging down slices the top away
    const cutting = pct < 99.5;
    model.traverse(o => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (!m) return; const want = cutting ? [hollowPlane] : []; if ((m.clippingPlanes?.length || 0) !== want.length || want[0] !== m.clippingPlanes?.[0]) { m.clippingPlanes = want; m.side = THREE.FrontSide; m.needsUpdate = true; } }); });
    /* v2.294: the cut face and the inside of the walls show blue. Back faces seen through the cut are drawn by a separate blue copy kept in the viewer scene (never a child of the model, so it can not reach an export). */
    removeHollowBlue();
    if (cutting && V?.scene) {
      const g = new THREE.Group(); g.name = 'shrinkHollowBlue'; g.userData.owner = model;
      const mat = new THREE.MeshBasicMaterial({ color: 0x2f86ff, side: THREE.BackSide, clippingPlanes: [hollowPlane] });
      model.updateWorldMatrix(true, true);
      model.traverse(o => { if (!o.isMesh) return; const m = new THREE.Mesh(o.geometry, mat); m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrixWorldNeedsUpdate = true; m.raycast = () => {}; g.add(m); });
      V.scene.add(g);
    }
    const out = $('v2HollowCutOut'); if (out) out.textContent = pct >= 99.5 ? 'off' : Math.round(pct) + '%';
    { const r = $('v2HollowCutRange'); if (r && Number(r.value) !== Math.round(pct)) r.value = String(Math.round(pct)); const v = $('v2HollowSlideRange'); if (v && Number(v.value) !== Math.round(pct)) v.value = String(Math.round(pct)); const vo = $('v2HollowSlideOut'); if (vo) vo.textContent = pct >= 99.5 ? 'off' : Math.round(pct) + '%'; }
  }
  // ---- v2.307 EDIT MODEL: basic shapes (join / cut) and a slice-off plane, both through Manifold (edit-core.js) ----
  let editStack = [], editBase = null;               // editBase = a copy of the model from before the FIRST edit, for RESET ALL EDITS                                   // clones of the working model before each edit, for UNDO
  function removeEditPreview() { const V = window.__shrinkViewer; const g = V?.scene?.getObjectByName?.('shrinkEditPreview'); if (!g) return; V.scene.remove(g); g.traverse(o => { if (o.geometry !== editPart?.geometry && !parked.some(r => r.part.geometry === o.geometry)) o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  window.addEventListener('shrink:model-opened', () => { removeEditPreview(); editStack = []; editBase = null; try { clearLasso(); if (!editPart) partRot = null; islandCache = null; if (editPart || parked.length) setTimeout(updateEditPreview, 500); sculptWork = null; sculptData = null; } catch {} });
  function editFrame() {
    const THREE = app()?.THREE, model = sourceModel(); if (!THREE || !model) return null;
    const box = new THREE.Box3().setFromObject(model, true); if (box.isEmpty()) return null;
    return { THREE, box, centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()), mm: Number(window.__shrinkPrint?.mmPerUnit?.()) || 1 };
  }
  const num = (id, d = 0) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : d; };
  function shapeSpec() {                                // the shape inputs (mm, offset from the model's centre) as a world-space matrix
    const f = editFrame(); if (!f) return null;
    const sx = Math.max(0.1, num('v2EdW', 10)) / f.mm, sy = Math.max(0.1, num('v2EdH', 10)) / f.mm, sz = Math.max(0.1, num('v2EdD', 10)) / f.mm;
    const px = f.centre.x + num('v2EdX') / f.mm, py = f.centre.y + num('v2EdY') / f.mm, pz = f.centre.z + num('v2EdZ') / f.mm;
    return { f, kind: $('v2EdKind').value, mode: $('v2EdMode').value, matrix: [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, px, py, pz, 1] };
  }
  // ---- v2.311: an uploaded part (e.g. a new head). editPart = { geometry (centred, Y-up, raw units), height (raw Y size), name }
  const pieceTool = () => { const t = $('v2EdTab')?.value; return t === 'part' || t === 'select'; };   // v2.329: both tools work on the floating pieces (Select has no file chooser and no handles)
  let editPart = null, parked = [];                    // v2.326: more floating pieces wait in `parked` (green, not joined) until WELD; editPart is the selected one
  async function loadPartFile(file) {
    const THREE = app()?.THREE; if (!THREE) throw new Error('The viewer is not ready.');
    const ext = (file.name.split('.').pop() || '').toLowerCase(), base = 'https://esm.sh/three@0.180.0/examples/jsm/loaders/', buf = await file.arrayBuffer();
    const geoms = [];
    const flat = (g, m) => { const pos = g.attributes.position, idx = g.index, out = []; const v = new THREE.Vector3(); const n = idx ? idx.count : pos.count; for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i); if (m) v.applyMatrix4(m); out.push(v.x, v.y, v.z); } return out; };
    let zUp = false, pts = [];
    if (ext === 'stl') { const { STLLoader } = await import(base + 'STLLoader.js'); pts = flat(new STLLoader().parse(buf)); zUp = true; }
    else if (ext === 'ply') { const { PLYLoader } = await import(base + 'PLYLoader.js'); pts = flat(new PLYLoader().parse(buf)); zUp = true; }
    else if (ext === 'obj') { const { OBJLoader } = await import(base + 'OBJLoader.js'); const g = new OBJLoader().parse(new TextDecoder().decode(buf)); g.updateMatrixWorld(true); g.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) pts.push(...flat(o.geometry, o.matrixWorld)); }); }
    else if (ext === 'glb' || ext === 'gltf') { const { GLTFLoader } = await import(base + 'GLTFLoader.js'); const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)); gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) pts.push(...flat(o.geometry, o.matrixWorld)); }); }
    else throw new Error('Use an STL, OBJ, PLY or GLB file.');
    if (!pts.length) throw new Error('No mesh data found in that file.');
    return partFromPoints(new Float32Array(pts), zUp, file.name);
  }
  function partFromPoints(arr, zUp, name) {
    const THREE = app()?.THREE, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (zUp) g.rotateX(-Math.PI / 2);                    // STL/PLY are Z-up, the viewer is Y-up
    g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()), size = g.boundingBox.getSize(new THREE.Vector3()); g.translate(-c.x, -c.y, -c.z);
    g.computeVertexNormals(); g.computeBoundingBox();
    return { geometry: g, height: Math.max(1e-6, size.y), size, name: name || 'part' };
  }
  function partVals() { const o = {}; ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'].forEach(a => { o[a] = num('v2EdPart' + a); }); o.H = num('v2EdPartH', 30); return o; }
  function parkCurrent() { if (editPart) parked.push({ part: editPart, vals: partVals(), rot: partRot ? partRot.clone() : null, mode: $('v2EdMode')?.value || 'join' }); }
  function takeParked(i) {                               // make parked piece i the selected one (the selected one goes to the side)
    const r = parked[i]; if (!r) return false; parked.splice(i, 1); parkCurrent(); editPart = r.part; partRot = r.rot;
    Object.entries(r.vals).forEach(([a, v]) => { const e = $(a === 'H' ? 'v2EdPartH' : 'v2EdPart' + a); if (e) e.value = String(v); });
    const md = $('v2EdMode'); if (md && md.value !== r.mode) { md.value = r.mode; md.dispatchEvent(new Event('change', { bubbles: true })); }
    updateEditPreview(); updateGoState(); return true;
  }
  function dropSelected() {                              // the selected piece is gone (welded or deleted): pick the last one that is waiting, if any
    editPart = null; partRot = null; if (parked.length) { const r = parked.pop(); editPart = r.part; partRot = r.rot; Object.entries(r.vals).forEach(([a, v]) => { const e = $(a === 'H' ? 'v2EdPartH' : 'v2EdPart' + a); if (e) e.value = String(v); }); const md = $('v2EdMode'); if (md && md.value !== r.mode) { md.value = r.mode; md.dispatchEvent(new Event('change', { bubbles: true })); } }
    updateEditPreview(); updateGoState();
  }
  function dupPart() {                                   // COPY PIECE: another green piece beside this one, the first stays where it is
    const pm = editPart && partMatrix(); if (!pm) return false; const cam = cameraSnap(), ax = camAxes(cam), k = new pm.f.THREE.Vector3().setFromMatrixScale(pm.m).x, w = (editPart.size?.length?.() || 1) * k * 0.75;
    parkCurrent(); editPart = { ...editPart, copied: true, origin: undefined }; ['X', 'Y', 'Z'].forEach((a, i) => { $('v2EdPart' + a).value = (num('v2EdPart' + a) + ax.right[i] * w * pm.f.mm).toFixed(2); });
    updateEditPreview(); updateGoState(); return true;
  }
  function setPart(part) {
    if (part && editPart) parkCurrent();                // v2.326: a new piece never replaces the one already floating
    editPart = part; partRot = null; const f = editFrame();
    if (part && f) {
      ['X', 'Y', 'Z'].forEach(a => { $('v2EdPartR' + a).value = '0'; });
      if (part.origin) {                                // a copied piece starts exactly where it came from, at its own size
        $('v2EdPartH').value = String(Math.round(part.height * f.mm * 100) / 100);
        $('v2EdPartX').value = ((part.origin.x - f.centre.x) * f.mm).toFixed(2); $('v2EdPartY').value = ((part.origin.y - f.centre.y) * f.mm).toFixed(2); $('v2EdPartZ').value = ((part.origin.z - f.centre.z) * f.mm).toFixed(2);
      } else { const h = Math.max(1, Math.round(f.size.y * f.mm * 0.3 * 10) / 10); $('v2EdPartH').value = String(h); ['X', 'Y', 'Z'].forEach(a => { $('v2EdPart' + a).value = '0'; }); }
    }
    $('v2EdPartInfo').textContent = part ? (part.copied ? 'Copied piece ready (the green ghost). Drag it, use the arrows and rings on it, then press WELD IT.' : `${part.name}: loaded. Set its height, turn and move it (the green ghost shows where it goes), then join it on.`) : 'STL, OBJ, PLY or GLB. It must be a closed solid, e.g. a new head. Slice the old head off first, then press SIT ON TOP.';
    updateEditPreview(); updateGoState();
  }
  function partMatrixOf(part, vals, rot, offsets = true) {
    const f = editFrame(); if (!f || !part) return null; const THREE = f.THREE;
    const k = (Math.max(0.1, vals.H) / f.mm) / part.height, rad = d => (vals[d] || 0) * Math.PI / 180;
    const m = new THREE.Matrix4().compose(offsets ? new THREE.Vector3(f.centre.x + vals.X / f.mm, f.centre.y + vals.Y / f.mm, f.centre.z + vals.Z / f.mm) : new THREE.Vector3(),
      (rot ? rot.clone() : new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rad('RX'), rad('RY'), rad('RZ'), 'XYZ'))), new THREE.Vector3(k, k, k));
    return { f, m };
  }
  function partMatrix(offsets = true) { return editPart ? partMatrixOf(editPart, partVals(), partRot, offsets) : null; }
  function partPlace(where) {                          // 'top' sits the part on the model's top (sunk 1 mm), 'centre' puts it in the middle
    const pm = partMatrix(false); if (!pm) return; const { f, m } = pm, THREE = f.THREE;
    const mesh = new THREE.Mesh(editPart.geometry); mesh.matrixAutoUpdate = false; mesh.matrix.copy(m); mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh, true), bc = b.getCenter(new THREE.Vector3());
    const offX = -bc.x * f.mm, offZ = -bc.z * f.mm;
    const offY = where === 'top' ? (f.box.max.y - 1 / f.mm - b.min.y - f.centre.y) * f.mm : -bc.y * f.mm;
    $('v2EdPartX').value = offX.toFixed(1); $('v2EdPartZ').value = offZ.toFixed(1); $('v2EdPartY').value = offY.toFixed(1); updateEditPreview();
  }
  function rootToPoints(root) {
    const out = []; root.updateMatrixWorld(true); const v = new (app().THREE.Vector3)();
    root.traverse(o => { if (!o.isMesh) return; const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count; for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); } });
    return new Float32Array(out);
  }
  // ---- v2.313: LASSO / RAZOR. Draw a loop on the screen; Manifold cuts a prism through the model (edit-core.js lassoPrism). The hole is always capped.
  let lassoSel = null, lassoDraw = null, lassoBusy = false, partRot = null, lastLz = '';
  const setHid = (el, v) => { if (el && el.hidden !== v) el.hidden = v; };
  const lzTool = () => { const t = $('v2EdTab')?.value; return t === 'lasso' || t === 'razor' ? t : ''; };
  function cameraSnap() {
    const c = window.__shrinkViewer?.camera; if (!c) return null; c.updateMatrixWorld(true);
    const persp = !!c.isPerspectiveCamera, z = c.zoom || 1;
    return { world: Array.from(c.matrixWorld.elements), persp, tanY: persp ? Math.tan(c.fov * Math.PI / 360) / z : 0, aspect: c.aspect || 1, halfW: persp ? 0 : (c.right - c.left) / 2 / z, halfH: persp ? 0 : (c.top - c.bottom) / 2 / z };
  }
  function depthRange(cam, f, mode) {                   // distances along the view direction: from just in front of the model to just behind it (or its middle)
    const e = cam.world, fw = [-e[8], -e[9], -e[10]]; let dmin = Infinity, dmax = -Infinity;
    for (const x of [f.box.min.x, f.box.max.x]) for (const y of [f.box.min.y, f.box.max.y]) for (const z of [f.box.min.z, f.box.max.z]) { const d = (x - e[12]) * fw[0] + (y - e[13]) * fw[1] + (z - e[14]) * fw[2]; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
    const pad = f.size.length() * 0.05; let near = dmin - pad, far = mode === 'front' ? (dmin + dmax) / 2 : dmax + pad;
    if (cam.persp) near = Math.max(near, dmax * 0.02, 1e-4);
    if (far <= near) far = near + pad * 2;
    return { near, far };
  }
  function lassoCanvas() {
    const v = $('viewer'); if (!v) return null; let c = $('v2LassoCv');
    if (!c) { c = document.createElement('canvas'); c.id = 'v2LassoCv'; c.className = 'v2-lasso-cv'; c.setAttribute('aria-hidden', 'true'); v.appendChild(c); }
    const w = v.clientWidth || 0, h = v.clientHeight || 0; if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
    return c;
  }
  function lassoPaint(pts, closed) {
    const c = lassoCanvas(), g = c?.getContext?.('2d'); if (!g) return; g.clearRect(0, 0, c.width, c.height); if (!pts || pts.length < 2) return;
    const razor = lzTool() === 'razor'; g.lineWidth = 2; g.lineJoin = 'round'; g.setLineDash([7, 5]); g.strokeStyle = razor ? '#ff6a5a' : '#ffffff'; g.fillStyle = razor ? 'rgba(255,106,90,.18)' : 'rgba(47,134,255,.22)';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); if (closed) g.closePath(); g.stroke(); if (closed) g.fill();
  }
  // v2.314: the red preview. Every surface triangle whose centre is inside the loop (and inside the depth range) is drawn red, so you see what DELETE / CUT OFF will take.
  function removeLassoRed() { const V = window.__shrinkViewer; const g = V?.scene?.getObjectByName?.('shrinkLassoRed'); if (!g) return; V.scene.remove(g); g.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  // v2.315: which triangles does the loop take? One mask per mesh (same traversal order everywhere). With `whole` it grows to every loose piece (separate shell) the loop touches.
  let islandCache = null;
  function islandsOf(model) {
    if (islandCache && islandCache.model === model) return islandCache.meshes;
    const THREE = app().THREE, f = editFrame(); model.updateWorldMatrix(true, true);
    const q = 1e6 / Math.max(1e-9, f.size.length()), key = new Map(), parent = [], v = new THREE.Vector3(), meshes = [];
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    model.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count, nt = Math.floor(n / 3), gid = new Int32Array(pos.count).fill(-1), tv = new Int32Array(nt * 3);
      const idOf = i => { let g = gid[i]; if (g >= 0) return g; v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const k = Math.round(v.x * q) + ',' + Math.round(v.y * q) + ',' + Math.round(v.z * q); g = key.get(k); if (g === undefined) { g = parent.length; parent.push(g); key.set(k, g); } gid[i] = g; return g; };
      for (let t = 0; t < nt; t++) { for (let c = 0; c < 3; c++) tv[t * 3 + c] = idOf(idx ? idx.getX(t * 3 + c) : t * 3 + c); uni(tv[t * 3], tv[t * 3 + 1]); uni(tv[t * 3], tv[t * 3 + 2]); }
      meshes.push({ nt, tv });
    });
    for (const m of meshes) { m.isl = new Int32Array(m.nt); for (let t = 0; t < m.nt; t++) m.isl[t] = find(m.tv[t * 3]); delete m.tv; }
    islandCache = { model, meshes }; return meshes;
  }
  const wholeOn = () => !!$('v2EdWhole')?.checked;
  const depthMode = () => { const v = $('v2EdDepth')?.value; return v === 'through' || v === 'front' ? v : 'near'; };   // near = the nearest part under the loop (auto), through = everything under it, front = half way
  function lassoMasks(sel, whole) {
    const f = editFrame(), model = sourceModel(); if (!f || !model) return null;
    const THREE = f.THREE, cam = sel.cam, mode = depthMode(), { near, far } = depthRange(cam, f, mode === 'front' ? 'front' : 'through');
    const inv = new THREE.Matrix4().fromArray(cam.world).invert(), poly = sel.pts, np = poly.length, out = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), g3 = new THREE.Vector3();
    const inside = (x, y) => { let r = false; for (let i = 0, j = np - 1; i < np; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r; } return r; };
    model.updateWorldMatrix(true, true); let count = 0, total = 0;
    model.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return; const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count, nt = Math.floor(n / 3), mw = o.matrixWorld, mask = new Uint8Array(nt), dep = new Float32Array(nt);
      for (let t = 0; t < nt; t++) {
        const i = t * 3; a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mw); b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mw); c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mw);
        g3.set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3).applyMatrix4(inv);
        const d = -g3.z; if (d < near || d > far) continue;
        const nx = cam.persp ? g3.x / (d * cam.tanY * cam.aspect) : g3.x / cam.halfW, ny = cam.persp ? g3.y / (d * cam.tanY) : g3.y / cam.halfH;
        if (inside(nx, ny)) { mask[t] = 1; count++; dep[t] = d; }
      }
      total += nt; out.push({ mesh: o, mask, dep });
    });
    if (mode === 'near' && count) {                       // v2.318: keep only the layer nearest the camera. A gap in the sorted distances separates it from whatever is behind (a hand in front of a body).
      const all = new Float32Array(count); let k = 0; out.forEach(m => { for (let t = 0; t < m.mask.length; t++) if (m.mask[t]) all[k++] = m.dep[t]; });
      all.sort(); const gapT = Math.max((far - near) * 0.08, 1e-9); let layerFar = all[0];
      for (let i = 1; i < all.length; i++) { if (all[i] - all[i - 1] > gapT) break; layerFar = all[i]; }
      count = 0; out.forEach(m => { for (let t = 0; t < m.mask.length; t++) if (m.mask[t]) { if (m.dep[t] > layerFar) m.mask[t] = 0; else count++; } });
      out.band = { near, far: Math.min(far, layerFar + gapT * 0.5) };
    }
    if (whole && count) {
      const isl = islandsOf(model), hit = new Set(); out.forEach((m, k) => { for (let t = 0; t < m.mask.length; t++) if (m.mask[t]) hit.add(isl[k].isl[t]); });
      count = 0; out.forEach((m, k) => { for (let t = 0; t < m.mask.length; t++) { const on = hit.has(isl[k].isl[t]) ? 1 : 0; m.mask[t] = on; count += on; } }); out.islands = hit.size;
    }
    out.count = count; out.total = total; return out;
  }
  function maskPoints(masks) {                          // world-space triangle soup of the masked triangles
    const out = [], v = new (app().THREE.Vector3)();
    for (const { mesh: o, mask } of masks) { const pos = o.geometry.attributes.position, idx = o.geometry.index; for (let t = 0; t < mask.length; t++) if (mask[t]) for (let c = 0; c < 3; c++) { const i = t * 3 + c; v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); } }
    return new Float32Array(out);
  }
  function lassoRed(sel) {
    removeLassoRed(); const V = window.__shrinkViewer, f = editFrame(); if (!sel || !V?.scene || !f) return 0;
    const masks = lassoMasks(sel, wholeOn()); if (!masks?.count) return 0; const THREE = f.THREE, pts = maskPoints(masks);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.raycast = () => {}; const grp = new THREE.Group(); grp.name = 'shrinkLassoRed'; grp.raycast = () => {}; grp.add(mesh); V.scene.add(grp);
    return masks.count;
  }
  // delete / copy / cut whole loose pieces straight on the mesh (no Manifold): the removed triangles are dropped from a copy of the model, the rest is untouched
  async function wholePieceEdit(model, sel, op, whole = true) {
    const THREE = app().THREE, masks = lassoMasks(sel, whole);
    if (!masks?.count) throw new Error('The loop did not catch any of the model. Draw it around the part you want.');
    if (masks.count >= masks.total && !whole) throw new Error('That would remove the whole model.');
    if (masks.count >= masks.total) throw new Error('This model is one connected piece, so there is no loose piece to grab. Switch off "Grab the whole loose piece" and use the loop instead.');
    const pts = maskPoints(masks), out = { whole, mesh: !whole, islands: masks.islands || 1, tris: masks.count };
    let vol = 0; for (let i = 0; i + 8 < pts.length; i += 9) vol += pts[i] * (pts[i + 4] * pts[i + 8] - pts[i + 5] * pts[i + 7]) - pts[i + 1] * (pts[i + 3] * pts[i + 8] - pts[i + 5] * pts[i + 6]) + pts[i + 2] * (pts[i + 3] * pts[i + 7] - pts[i + 4] * pts[i + 6]);
    out.pieceVolume = Math.abs(vol) / 6;
    if (op !== 'copy') {
      const root = cloneRoot(model), keep = new Map(); masks.forEach(m => keep.set(m.mesh, m.mask));
      const src = []; model.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) src.push(o); }); const dst = []; root.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) dst.push(o); });
      dst.forEach((o, k) => {                            // keep only the triangles that stay, and only the vertices they use (the precise bounding box reads every vertex)
        const mask = keep.get(src[k]), g = o.geometry, idx = g.index, remap = new Map(), kept = [];
        for (let t = 0; t < mask.length; t++) if (!mask[t]) for (let c = 0; c < 3; c++) { const old = idx ? idx.getX(t * 3 + c) : t * 3 + c; let nv = remap.get(old); if (nv === undefined) { nv = remap.size; remap.set(old, nv); } kept.push(nv); }
        const olds = new Uint32Array(remap.size); remap.forEach((nv, old) => { olds[nv] = old; });
        for (const name of Object.keys(g.attributes)) { const at = g.attributes[name], sz = at.itemSize, arr = new at.array.constructor(olds.length * sz); for (let i = 0; i < olds.length; i++) for (let c = 0; c < sz; c++) arr[i * sz + c] = at.array[olds[i] * sz + c]; g.setAttribute(name, new THREE.BufferAttribute(arr, sz, at.normalized)); }
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(kept), 1)); g.computeBoundingBox?.(); g.computeBoundingSphere?.();
      });
      root.updateMatrixWorld(true); out.root = root; out.pieces = null;
    }
    const grp = new THREE.Group(), pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pts, 3)); grp.add(new THREE.Mesh(pg, new THREE.MeshStandardMaterial())); grp.updateMatrixWorld(true);
    if (op !== 'delete') out.piece = grp;
    return out;
  }
  // ---- v2.316 SCULPT brush: smooth / pull / push the surface like clay. Works on the mesh itself (no Manifold), on a private copy that becomes the working model.
  let sculptWork = null, sculptData = null, sculptDown = false, sculptTouched = new Set(), sculptNormAt = 0, sculptLastAt = 0, sculptSized = false;
  const sculptMode = () => $('v2EdSculptMode')?.value || 'smooth';
  function sculptRadius() { const mm = Number(window.__shrinkPrint?.mmPerUnit?.()) || 1; return Math.max(1e-6, num('v2SculptSize', 6) / 2 / mm); }
  function sculptBuild(model) {
    const THREE = app().THREE, f = editFrame(); model.updateWorldMatrix(true, true);
    const q = 1e6 / Math.max(1e-9, f.size.length()), key = new Map(), P = [], meshes = [], v = new THREE.Vector3();
    model.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, nv = pos.count, n = idx ? idx.count : nv, nt = Math.floor(n / 3), gid = new Int32Array(nv).fill(-1), tg = new Int32Array(nt * 3);
      const idOf = i => { let g = gid[i]; if (g >= 0) return g; v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const k = Math.round(v.x * q) + ',' + Math.round(v.y * q) + ',' + Math.round(v.z * q); g = key.get(k); if (g === undefined) { g = P.length / 3; P.push(v.x, v.y, v.z); key.set(k, g); } gid[i] = g; return g; };
      for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) tg[t * 3 + c] = idOf(idx ? idx.getX(t * 3 + c) : t * 3 + c);
      for (let i = 0; i < nv; i++) idOf(i);                         // vertices no triangle uses still need an id
      meshes.push({ mesh: o, gid, tg, nt, inv: new THREE.Matrix4().copy(o.matrixWorld).invert().elements });
    });
    const gc = P.length / 3, deg = new Int32Array(gc + 1);
    for (const m of meshes) for (let t = 0; t < m.nt; t++) { const a = m.tg[t * 3], b = m.tg[t * 3 + 1], c = m.tg[t * 3 + 2]; deg[a] += 2; deg[b] += 2; deg[c] += 2; }
    const off = new Int32Array(gc + 1); for (let g = 0; g < gc; g++) off[g + 1] = off[g] + deg[g]; const fill = off.slice(0, gc), nbr = new Int32Array(off[gc]);
    for (const m of meshes) for (let t = 0; t < m.nt; t++) { const a = m.tg[t * 3], b = m.tg[t * 3 + 1], c = m.tg[t * 3 + 2]; nbr[fill[a]++] = b; nbr[fill[a]++] = c; nbr[fill[b]++] = a; nbr[fill[b]++] = c; nbr[fill[c]++] = a; nbr[fill[c]++] = b; }
    const vc = new Int32Array(gc + 1); meshes.forEach(m => { for (let i = 0; i < m.gid.length; i++) vc[m.gid[i] + 1]++; });
    const vOff = new Int32Array(gc + 1); for (let g = 0; g < gc; g++) vOff[g + 1] = vOff[g] + vc[g + 1]; const vf = vOff.slice(0, gc), vm = new Int32Array(vOff[gc]), vi = new Int32Array(vOff[gc]);
    meshes.forEach((m, k) => { for (let i = 0; i < m.gid.length; i++) { const g = m.gid[i], p = vf[g]++; vm[p] = k; vi[p] = i; } });
    return { model, P: Float32Array.from(P), gc, off, nbr, vOff, vm, vi, meshes, mark: new Int32Array(gc), stamp: 0 };
  }
  function sculptBegin() {                                      // one UNDO step per stroke; the first stroke (or the first after another tool changed the model) works on a fresh copy
    const model = sourceModel(); if (!model) return false;
    if (hollowResult && model === hollowResult) { $('v2EdResult').innerHTML = '<strong>Could not sculpt</strong><span>This model is already hollow. Sculpt the solid model before you hollow it.</span>'; return false; }
    const tris = modelTriangles(model); if (tris > SCULPT_MAX_TRIANGLES) { $('v2EdResult').innerHTML = '<strong>Could not sculpt</strong><span>This model has ' + tris.toLocaleString() + ' triangles, too many to sculpt in the browser. Press SHRINK first.</span>'; return false; }
    const snap = cloneRoot(model); if (!snap) return false;
    if (!editBase) editBase = cloneRoot(snap); editStack.push(snap); if (editStack.length > 6) editStack.shift();
    if (model !== sculptWork) { const work = cloneRoot(model); removeEditPreview(); installWorkingResult(work, 'edit'); sculptWork = work; sculptData = null; }
    $('v2EdUndo').hidden = !editStack.length; sculptTouched = new Set(); return true;
  }
  function sculptRefreshNormals(force) {
    const t = performance.now(); if (!force && t - sculptNormAt < 160) return; sculptNormAt = t;
    sculptTouched.forEach(m => { const g = m.mesh.geometry; if (g.attributes.normal && g.index) g.computeVertexNormals(); });
  }
  function sculptEnd() {
    if (!sculptDown) return; sculptDown = false; sculptRefreshNormals(true);
    sculptTouched.forEach(m => { const g = m.mesh.geometry; g.computeBoundingBox?.(); g.computeBoundingSphere?.(); try { g.boundsTree?.refit?.(); } catch {} });
    sculptTouched = new Set(); try { window.__shrinkStretchTick = (window.__shrinkStretchTick || 0) + 1; } catch {}
    setTimeout(updateHealthCard, 120);
  }
  // one dab: h = centre (world), start = gids to begin from, nrm = outward direction for pull / push
  function sculptDab(h, start, nrm) {
    const model = sourceModel(); if (!model) return false; if (!sculptData || sculptData.model !== model) sculptData = sculptBuild(model);
    const d = sculptData, { P, off, nbr, vOff, vm, vi, meshes } = d, R = sculptRadius(), s = Math.min(1, Math.max(0.02, num('v2SculptStrength', 5) / 10)), mode = sculptMode();
    const tag = ++d.stamp, G = [], dist = []; const q = start.slice(); start.forEach(g => { d.mark[g] = tag; });
    for (let head = 0; head < q.length && G.length < 120000; head++) {
      const g = q[head], dd = Math.hypot(P[g * 3] - h[0], P[g * 3 + 1] - h[1], P[g * 3 + 2] - h[2]); if (dd > R) continue; G.push(g); dist.push(dd);
      for (let k = off[g]; k < off[g + 1]; k++) { const n = nbr[k]; if (d.mark[n] !== tag) { d.mark[n] = tag; q.push(n); } }
    }
    if (!G.length) return false;
    const fall = dist.map(dd => { const t = dd / R, u = 1 - t * t; return mode === 'smooth' ? Math.min(1, u * 1.6) : u * u; });
    const smoothPass = lam => { const out = new Float32Array(G.length * 3); G.forEach((g, i) => { let ax = 0, ay = 0, az = 0, c = off[g + 1] - off[g]; if (!c) { out[i * 3] = P[g * 3]; out[i * 3 + 1] = P[g * 3 + 1]; out[i * 3 + 2] = P[g * 3 + 2]; return; } for (let k = off[g]; k < off[g + 1]; k++) { const n = nbr[k]; ax += P[n * 3]; ay += P[n * 3 + 1]; az += P[n * 3 + 2]; } const w = lam * fall[i]; out[i * 3] = P[g * 3] + w * (ax / c - P[g * 3]); out[i * 3 + 1] = P[g * 3 + 1] + w * (ay / c - P[g * 3 + 1]); out[i * 3 + 2] = P[g * 3 + 2] + w * (az / c - P[g * 3 + 2]); }); G.forEach((g, i) => { P[g * 3] = out[i * 3]; P[g * 3 + 1] = out[i * 3 + 1]; P[g * 3 + 2] = out[i * 3 + 2]; }); };
    if (mode === 'smooth') { smoothPass(0.6 * s); smoothPass(-0.64 * s); }
    else { const sg = mode === 'pull' ? 1 : -1, amt = sg * s * R * 0.015; G.forEach((g, i) => { P[g * 3] += nrm[0] * amt * fall[i]; P[g * 3 + 1] += nrm[1] * amt * fall[i]; P[g * 3 + 2] += nrm[2] * amt * fall[i]; }); smoothPass(0.3); }
    const touched = new Set();
    for (const g of G) for (let k = vOff[g]; k < vOff[g + 1]; k++) { const m = meshes[vm[k]], e = m.inv, X = P[g * 3], Y = P[g * 3 + 1], Z = P[g * 3 + 2]; m.mesh.geometry.attributes.position.setXYZ(vi[k], e[0] * X + e[4] * Y + e[8] * Z + e[12], e[1] * X + e[5] * Y + e[9] * Z + e[13], e[2] * X + e[6] * Y + e[10] * Z + e[14]); touched.add(m); }
    touched.forEach(m => { m.mesh.geometry.attributes.position.needsUpdate = true; sculptTouched.add(m); });
    return true;
  }
  function sculptPick(e) {
    const V = window.__shrinkViewer, model = sourceModel(), THREE = app()?.THREE; if (!V?.renderer || !V.camera || !model || !THREE) return null;
    const rect = V.renderer.domElement.getBoundingClientRect(); if (!rect.width) return null;
    const rc = new THREE.Raycaster(); rc.setFromCamera({ x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 }, V.camera);
    const hit = rc.intersectObject(model, true).find(x => x.object.isMesh && x.object.visible && x.face); if (!hit) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { point: hit.point.toArray(), normal: n.toArray(), mesh: hit.object, face: [hit.face.a, hit.face.b, hit.face.c] };
  }
  function sculptStart(hit) {                                   // gids of the hit triangle
    const d = sculptData; if (!d) return [];
    const m = d.meshes.find(x => x.mesh === hit.mesh); return m ? hit.face.map(i => m.gid[i]) : [];
  }
  function sculptRing(e, hit) {
    let r = $('v2SculptRing'); if (!r) { r = document.createElement('div'); r.id = 'v2SculptRing'; r.className = 'v2-brush-ring'; r.dataset.mode = 'sculpt'; r.hidden = true; r.innerHTML = '<span></span>'; document.body.appendChild(r); }
    if (!e) { setHid(r, true); return; }
    let px = 14; try { const V = window.__shrinkViewer, THREE = app().THREE, rect = V.renderer.domElement.getBoundingClientRect(), ref = hit ? new THREE.Vector3(...hit.point) : editFrame().centre; V.camera.updateMatrixWorld(); const right = new THREE.Vector3().setFromMatrixColumn(V.camera.matrixWorld, 0).normalize(), a = ref.clone().project(V.camera), b = ref.clone().addScaledVector(right, sculptRadius()).project(V.camera), dd = Math.abs(b.x - a.x) * rect.width / 2; if (Number.isFinite(dd) && dd > 0) px = dd; } catch {}
    const size = Math.max(8, Math.round(px * 2)); r.style.width = r.style.height = size + 'px'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; r.firstChild.textContent = num('v2SculptSize', 6).toFixed(1) + ' mm ' + sculptMode(); setHid(r, false);
  }
  function sculptStrokeAt(e) {
    const now = performance.now(); if (now - sculptLastAt < 16) return; sculptLastAt = now;
    const hit = sculptPick(e); sculptRing(e, hit); if (!hit) return;
    if (!sculptData || sculptData.model !== sourceModel()) sculptData = sculptBuild(sourceModel());
    if (sculptDab(hit.point, sculptStart(hit), hit.normal)) sculptRefreshNormals(false);
  }
  function wireSculpt() {
    const v = $('viewer'); if (!v || v.dataset.sculptWired) return; v.dataset.sculptWired = '1';
    const active = () => $('v2EdTab')?.value === 'sculpt' && editActive();
    v.addEventListener('pointerdown', e => { if (!active() || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return; e.stopPropagation(); e.preventDefault(); if (!sculptBegin()) return; sculptDown = true; sculptStrokeAt(e); }, true);
    v.addEventListener('pointermove', e => { if (!active() || e.ctrlKey || e.metaKey || e.altKey) { sculptRing(null); return; } if (sculptDown) { e.stopPropagation(); if ((e.buttons & 1) === 0) { sculptEnd(); return; } sculptStrokeAt(e); } else sculptRing(e, sculptPick(e)); }, true);
    v.addEventListener('pointerleave', () => sculptRing(null)); v.addEventListener('pointerup', sculptEnd, true); v.addEventListener('pointercancel', sculptEnd, true); window.addEventListener('pointerup', sculptEnd, true); window.addEventListener('blur', sculptEnd);
    const orbitLeft = pan => { const c = window.__shrinkViewer?.controls; if (c?.mouseButtons) c.mouseButtons.LEFT = pan ? 2 : 0; };
    window.addEventListener('keydown', e => { if (active() && (e.key === 'Meta' || e.key === 'Control')) { orbitLeft(true); sculptEnd(); } }, true);
    window.addEventListener('keyup', e => { if (active() && (e.key === 'Meta' || e.key === 'Control')) orbitLeft(false); }, true);
  }
  // test hook: one whole stroke at a world point
  function sculptAt(point, mm, strength, mode, normal, dabs = 1) {
    if (mm) { $('v2SculptSize').value = String(mm); } if (strength) $('v2SculptStrength').value = String(strength); if (mode) { const sel = $('v2EdSculptMode'); sel.value = mode; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    if (!sculptBegin()) return false; sculptDown = true; let ok = false;
    try { const model = sourceModel(); if (!sculptData || sculptData.model !== model) sculptData = sculptBuild(model); const d = sculptData; let best = 0, bd = Infinity; for (let g = 0; g < d.gc; g++) { const dd = Math.hypot(d.P[g * 3] - point[0], d.P[g * 3 + 1] - point[1], d.P[g * 3 + 2] - point[2]); if (dd < bd) { bd = dd; best = g; } } for (let i = 0; i < dabs; i++) ok = sculptDab(point, [best], normal || [0, 1, 0]); } finally { sculptEnd(); }
    return ok;
  }
  // v2.318: a failure shows in the viewer too (the text under the tool is easy to miss)
  let toastTimer = 0;
  function edToast(text) {
    const v = $('viewer'); if (!v) return; let t = $('v2EdToast');
    if (!t) { t = document.createElement('div'); t.id = 'v2EdToast'; t.className = 'v2-ed-toast'; t.setAttribute('role', 'alert'); t.hidden = true; v.appendChild(t); t.addEventListener('click', () => setHid(t, true)); }
    if (t.textContent !== text) t.textContent = text; setHid(t, false); clearTimeout(toastTimer); toastTimer = setTimeout(() => setHid(t, true), 12000);
  }
  function clearLasso() { lassoSel = null; lassoDraw = null; lassoPaint(null); removeLassoRed(); lassoBarState(); }
  function lassoBarState() { document.querySelectorAll('#v2EditCard .v2-lasso-act').forEach(b => { const off = !lassoSel || lassoBusy; if (b.disabled !== off) b.disabled = off; }); }
  function lassoEnd() {
    const d = lassoDraw; if (!d) return; lassoDraw = null;
    let area = 0; const p = d.px; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (p.length < 4 || Math.abs(area / 2) < 150) { lassoPaint(null); $('v2EdResult').innerHTML = '<strong>Draw a bigger loop</strong><span>Hold the mouse button down and go all the way round the part.</span>'; lassoBarState(); return; }
    const cam = cameraSnap(); if (!cam) { lassoPaint(null); return; }
    lassoSel = { pts: d.ndc, cam, px: p }; lassoPaint(p, true); lassoBarState(); const nRed = lassoRed(lassoSel);
    if (!nRed) { $('v2EdResult').innerHTML = '<strong>Nothing under the loop</strong><span>The loop did not catch any of the model. Press Esc and draw it round the part (or choose "Everything under the loop" if the part is further back).</span>'; edToast('Nothing under the loop. Draw it round the part.'); return; }
    $('v2EdResult').innerHTML = lzTool() === 'razor' ? '<strong>Red = what goes</strong><span>Press CUT OFF to remove it (the hole is closed flat), or CUT OFF & KEEP to take it with you. Esc clears the loop.</span>' : '<strong>Red = what goes</strong><span>Press DELETE (or the Delete key) to remove it, or COPY to paste it somewhere else. Esc clears the loop.</span>';
  }
  function wireLasso() {
    const v = $('viewer'); if (!v || v.dataset.lassoWired) return; v.dataset.lassoWired = '1';
    const on = e => lzTool() && editActive() && !lassoBusy && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ndcOf = e => { const r = v.getBoundingClientRect(); return [((e.clientX - r.left) / (r.width || 1)) * 2 - 1, -(((e.clientY - r.top) / (r.height || 1)) * 2 - 1)]; };
    v.addEventListener('pointerdown', e => { if (!on(e)) return; e.stopPropagation(); e.preventDefault(); lassoSel = null; lassoBarState(); const r = v.getBoundingClientRect(); lassoDraw = { px: [[e.clientX - r.left, e.clientY - r.top]], ndc: [ndcOf(e)] }; lassoCanvas(); lassoPaint(lassoDraw.px); }, true);
    v.addEventListener('pointermove', e => { if (!lassoDraw) return; e.stopPropagation(); if ((e.buttons & 1) === 0) { lassoEnd(); return; } const r = v.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, last = lassoDraw.px[lassoDraw.px.length - 1]; if (Math.hypot(x - last[0], y - last[1]) < 3) return; lassoDraw.px.push([x, y]); lassoDraw.ndc.push(ndcOf(e)); lassoPaint(lassoDraw.px); }, true);
    v.addEventListener('pointerup', lassoEnd, true); v.addEventListener('pointercancel', lassoEnd, true); window.addEventListener('pointerup', lassoEnd, true); window.addEventListener('blur', lassoEnd);
    const orbitLeft = pan => { const c = window.__shrinkViewer?.controls; if (c?.mouseButtons) c.mouseButtons.LEFT = pan ? 2 : 0; };
    window.addEventListener('keydown', e => { if (lzTool() && (e.key === 'Meta' || e.key === 'Control')) { orbitLeft(true); lassoDraw = null; lassoPaint(lassoSel ? lassoSel.px : null, !!lassoSel); } }, true);
    window.addEventListener('keyup', e => { if (e.key === 'Meta' || e.key === 'Control') orbitLeft(false); }, true);
    // the loop belongs to the view it was drawn in: turning the model clears it
    const ctl = window.__shrinkViewer?.controls; ctl?.addEventListener?.('change', () => { if (!lassoSel) return; const c = window.__shrinkViewer.camera; c.updateMatrixWorld(true); const a = c.matrixWorld.elements, b = lassoSel.cam.world; for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-6) { clearLasso(); return; } });
  }
  async function lassoApply(op, override) {
    const card = $('v2EditCard'), res = $('v2EdResult'), sel = override || lassoSel;
    if (lassoBusy) return;
    if (!sel) { res.innerHTML = '<strong>Draw a loop first</strong><span>Hold the mouse button down and go round the part.</span>'; return; }
    lassoBusy = true; lassoBarState(); setWorking(true, 0, op === 'delete' ? 'Cutting…' : 'Copying…');
    try {
      const model = sourceModel(); if (!model) throw new Error('Load a model first.');
      if (hollowResult && model === hollowResult) throw new Error('This model is already hollow. Edit the solid model before you hollow it.');
      const tris = modelTriangles(model), limit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES, whole = wholeOn();
      if (tris > SCULPT_MAX_TRIANGLES) throw new Error(`This model has ${tris.toLocaleString()} triangles, too many to edit in the browser. Press SHRINK first.`);
      const direct = whole || tris > limit;               // v2.318: big models are edited on the triangles themselves (DELETE leaves an open hole for FIX IT to close)
      if (!whole && tris > limit && op !== 'delete') throw new Error(`COPY and CUT OFF need a model under ${limit.toLocaleString()} triangles (this one has ${tris.toLocaleString()}). Press SHRINK first. DELETE still works on a model this big.`);
      const THREE0 = app()?.THREE, f = editFrame(); if (!f) throw new Error('Load a model first.');
      if (!direct) {
        progress(card, 10, 'Loading the solid tools…');
        for (let i = 0; i < 50 && !window.__shrinkFuse?.editModel; i++) await wait(100);
        if (!window.__shrinkFuse?.editModel) throw new Error('The solid tools are still loading. Try again in a moment.');
      }
      let { near, far } = depthRange(sel.cam, f, depthMode() === 'front' ? 'front' : 'through');
      if (!direct && depthMode() === 'near') { const band = lassoMasks(sel, false)?.band; if (band) { near = band.near; far = band.far; } }
      const snap = op !== 'copy' ? cloneRoot(model) : null;
      progress(card, 40, 'Working…'); await paintNow();
      const r = direct ? await wholePieceEdit(model, sel, op, whole) : await window.__shrinkFuse.editModel(model, { lasso: { pts: sel.pts, cam: sel.cam, near, far, op } });
      progress(card, 85, 'Checking the result…');
      if (r.root) { if (snap) { if (!editBase) editBase = cloneRoot(snap); editStack.push(snap); if (editStack.length > 6) editStack.shift(); } removeEditPreview(); installWorkingResult(r.root, 'edit'); $('v2EdUndo').hidden = !editStack.length; setTimeout(updateHealthCard, 80); }
      const mm = f.mm; let msg;
      if (r.piece) {
        const pts = rootToPoints(r.piece), bb = new THREE0.Box3(), v = new THREE0.Vector3();   // the world centre first: partFromPoints centres the array in place
        for (let i = 0; i < pts.length; i += 3) bb.expandByPoint(v.set(pts[i], pts[i + 1], pts[i + 2]));
        const part = partFromPoints(pts, false, 'Copied piece'); part.copied = true; part.origin = bb.getCenter(new THREE0.Vector3());
        setPart(part);
        if (op === 'copy') { const ax = camAxes(sel.cam), w = bb.getSize(new THREE0.Vector3()).length() * 0.75; ['X', 'Y', 'Z'].forEach((a, i) => { $('v2EdPart' + a).value = (num('v2EdPart' + a) + ax.right[i] * w * f.mm).toFixed(2); }); }   // v2.319: the model is still whole, so the copy starts beside it instead of hidden inside it
        { const md = $('v2EdMode'); md.value = 'join'; md.dispatchEvent(new Event('change', { bubbles: true })); }
        set$tool('part');
        msg = `<strong>✓ ${op === 'copy' ? 'Copied' : 'Cut off'}</strong><span>${(r.pieceVolume * mm * mm * mm / 1000).toFixed(1)} ml piece ready. It floats in green and stays there until you press WELD IT, so you can cut or copy more pieces first.</span>`;
      } else msg = r.mesh ? `<strong>✓ Deleted</strong><span>${r.tris.toLocaleString()} triangles removed. The model is too big to close the hole automatically, so it is open there. Press FIX IT (SHRINK & FINISH tab) to close it, or UNDO.</span>` : r.whole ? `<strong>✓ Deleted</strong><span>${r.islands} loose piece${r.islands === 1 ? '' : 's'} removed (${(r.pieceVolume * mm * mm * mm / 1000).toFixed(1)} ml). Press UNDO if that is not what you wanted.</span>` : `<strong>✓ Deleted</strong><span>Now ${(r.volume * mm * mm * mm / 1000).toFixed(1)} ml in ${r.pieces} piece${r.pieces === 1 ? '' : 's'}. The hole is closed flat. Press UNDO if that is not what you wanted.</span>`;
      res.innerHTML = msg; card.dataset.state = 'good'; progress(card, 100, 'Done.');
      lassoSel = null; lassoPaint(null); removeLassoRed();
    } catch (err) {
      card.dataset.state = 'warn'; progress(card, 100, 'Could not do that.');
      const em = `${err?.message || err}${/watertight|manifold|reject/i.test(String(err?.message || err)) ? ' Run FIX IT or FUSE IT first.' : ''}`;
      res.innerHTML = `<strong>Could not ${op === 'copy' ? 'copy' : 'cut'} that</strong><span>${em}</span>`; edToast('Could not ' + (op === 'copy' ? 'copy' : 'cut') + ' that. ' + em);
    } finally { lassoBusy = false; lassoBarState(); setWorking(false); }
  }
  // ---- v2.313: the arrow pad that pops up over the viewer while a part is waiting to be placed
  function camAxes(cam) { const e = (cam || cameraSnap())?.world; return e ? { right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]], fw: [-e[8], -e[9], -e[10]] } : { right: [1, 0, 0], up: [0, 1, 0], fw: [0, 0, -1] }; }
  function padAct(act) {
    const f = editFrame(); if (!f || !editPart) return; const THREE = f.THREE, lv = $('v2PadStep')?.value || 'm';
    const stepMm = Math.max(0.5, f.size.y * f.mm * 0.01) * { s: 1, m: 3, l: 10 }[lv], grow = { s: 1.03, m: 1.1, l: 1.3 }[lv], ang = { s: 5, m: 15, l: 45 }[lv] * Math.PI / 180, ax = camAxes();
    const mv = (vec, sgn) => ['X', 'Y', 'Z'].forEach((a, i) => { const el = $('v2EdPart' + a); el.value = (num('v2EdPart' + a) + vec[i] * sgn * stepMm).toFixed(1); });
    const tilt = (axis, sgn) => { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), sgn * ang); partRot = q.multiply(partRot || new THREE.Quaternion()); };
    switch (act) {
      case 'left': mv(ax.right, -1); break; case 'right': mv(ax.right, 1); break; case 'up': mv(ax.up, 1); break; case 'down': mv(ax.up, -1); break;
      case 'near': mv(ax.fw, -1); break; case 'far': mv(ax.fw, 1); break;
      case 'bigger': $('v2EdPartH').value = (num('v2EdPartH', 30) * grow).toFixed(2); break; case 'smaller': $('v2EdPartH').value = Math.max(0.1, num('v2EdPartH', 30) / grow).toFixed(2); break;
      case 'tiltL': tilt(ax.up, -1); break; case 'tiltR': tilt(ax.up, 1); break; case 'tiltU': tilt(ax.right, -1); break; case 'tiltD': tilt(ax.right, 1); break;
      case 'spinL': tilt(ax.fw, -1); break; case 'spinR': tilt(ax.fw, 1); break;
      default: return;
    }
    updateEditPreview();
  }
  function partTurnWorld(i, sgn) {                     // v2.320: X / Y / Z keys turn the floating part about the world axis (Shift = the other way)
    const f = editFrame(); if (!f || !editPart) return; const THREE = f.THREE, ang = { s: 5, m: 15, l: 45 }[$('v2PadStep')?.value || 'm'] * Math.PI / 180, ax = [0, 0, 0]; ax[i] = 1;
    partRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax), sgn * ang).multiply(partRot || new THREE.Quaternion()); updateEditPreview();
  }
  function ensurePad() {
    let pad = $('v2PartPad'); if (pad) return pad; const v = $('viewer'), host = $('v2EditPanel') || v; if (!host) return null;   // v2.322: the pad lives at the top of the EDIT panel (the old bottom-right corner of the 3D view can be below the visible screen)
    pad = document.createElement('div'); pad.id = 'v2PartPad'; pad.className = 'v2-part-pad'; pad.hidden = true;
    const b = (a, t, tip) => `<button type="button" data-pad="${a}" title="${tip}" aria-label="${tip}">${t}</button>`;
    pad.innerHTML = `<div class="v2-pad-title">Move the part</div>
      <div class="v2-pad-hint">Green pieces float here until you press WELD IT. Click a piece to pick it (it glows), drag it to move it. Arrows slide it along X / Y / Z, rings turn it (yaw, pitch, roll), − / + resize it.</div>
      <div id="v2PadJoin" class="v2-pad-join" aria-live="polite"></div>
      <div class="v2-pad-row"><div class="v2-pad-cross">${b('up', '▲', 'Move up')}<span></span>${b('left', '◀', 'Move left')}${b('down', '▼', 'Move down')}${b('right', '▶', 'Move right')}</div>
      <div class="v2-pad-col">${b('near', 'NEARER', 'Move towards you')}${b('far', 'FARTHER', 'Move away from you')}${b('bigger', 'BIGGER +', 'Enlarge')}${b('smaller', 'SMALLER −', 'Reduce')}</div></div>
      <div class="v2-pad-tilt"><span>Tilt</span>${b('tiltU', '⤒', 'Tilt top away')}${b('tiltD', '⤓', 'Tilt top towards you')}${b('tiltL', '↶', 'Tilt left')}${b('tiltR', '↷', 'Tilt right')}${b('spinL', '⟲', 'Spin anticlockwise')}${b('spinR', '⟳', 'Spin clockwise')}</div>
      <div class="v2-pad-foot"><select id="v2PadStep" aria-label="Step size"><option value="s">Fine steps</option><option value="m" selected>Medium steps</option><option value="l">Big steps</option></select><button type="button" id="v2PadPlace" class="v2-pad-go" title="Weld this piece onto the model (Ctrl/Cmd+V)">WELD IT</button><button type="button" id="v2PadCopy" title="Make another green piece like this one (Ctrl/Cmd+C)">COPY PIECE</button><button type="button" id="v2PadCancel" class="v2-pad-no" title="Throw this piece away (Delete)">DELETE PIECE</button></div>
      <div class="v2-pad-foot"><button type="button" id="v2PadAll" class="v2-pad-go" hidden>WELD ALL</button></div>`;
    pad.addEventListener('pointerdown', e => e.stopPropagation()); pad.addEventListener('wheel', e => e.stopPropagation());
    pad.addEventListener('click', e => { const bt = e.target.closest('button'); if (!bt) return; if (bt.dataset.pad) padAct(bt.dataset.pad); else if (bt.id === 'v2PadPlace') editModelNow(); else if (bt.id === 'v2PadCopy') dupPart(); else if (bt.id === 'v2PadAll') weldAll(); else if (bt.id === 'v2PadCancel') discardPiece();  });
    if (host.id === 'v2EditPanel') host.insertBefore(pad, $('v2EditPane') || null); else host.appendChild(pad); return pad;
  }
  // ---- v2.319: grab the ghost with the mouse. MOVE drags it in the screen plane (Shift = nearer / farther), TURN spins it like a ball, SIZE drags up / down.
  let partDrag = null, hoverAt = 0;
  function rayFor(cam, ndc) {
    const e = cam.world, right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], fw = [-e[8], -e[9], -e[10]], pos = [e[12], e[13], e[14]];
    if (cam.persp) { const a = ndc[0] * cam.tanY * cam.aspect, b = ndc[1] * cam.tanY, d = [fw[0] + right[0] * a + up[0] * b, fw[1] + right[1] * a + up[1] * b, fw[2] + right[2] * a + up[2] * b], l = Math.hypot(...d) || 1; return { o: pos, d: d.map(v => v / l), fw }; }
    const a = ndc[0] * cam.halfW, b = ndc[1] * cam.halfH; return { o: [pos[0] + right[0] * a + up[0] * b, pos[1] + right[1] * a + up[1] * b, pos[2] + right[2] * a + up[2] * b], d: fw, fw };
  }
  function partDragApply(mode, from, to, shift, camIn) {
    const pm = partMatrix(); if (!pm || !editPart) return false; const { f, m } = pm, THREE = f.THREE, cam = camIn || cameraSnap(); if (!cam) return false;
    if (mode === 'move') {
      const c = [m.elements[12], m.elements[13], m.elements[14]], r0 = rayFor(cam, from), r1 = rayFor(cam, to); let delta;
      if (shift) { const amt = (to[1] - from[1]) * f.size.length() * 0.8; delta = r0.fw.map(v => v * amt); }
      else {
        const hit = r => { const den = r.d[0] * r.fw[0] + r.d[1] * r.fw[1] + r.d[2] * r.fw[2]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - r.o[0]) * r.fw[0] + (c[1] - r.o[1]) * r.fw[1] + (c[2] - r.o[2]) * r.fw[2]) / den; return [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t]; };
        const a = hit(r0), b = hit(r1); if (!a || !b) return false; delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      }
      ['X', 'Y', 'Z'].forEach((ax, i) => { $('v2EdPart' + ax).value = (num('v2EdPart' + ax) + delta[i] * f.mm).toFixed(2); });
    } else if (mode === 'turn') {
      const ax = camAxes(cam), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax.up).normalize(), -(to[0] - from[0]) * Math.PI);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax.right).normalize(), -(to[1] - from[1]) * Math.PI)); partRot = q.multiply(partRot || new THREE.Quaternion());
    } else if (mode === 'size') {
      $('v2EdPartH').value = Math.max(0.1, num('v2EdPartH', 30) * Math.exp((to[1] - from[1]) * 1.5)).toFixed(2);
    } else return false;
    updateEditPreview(); return true;
  }
  function recHit(ndc, geometry, m, camIn) {
    const cam = camIn || cameraSnap(), THREE = app()?.THREE; if (!cam || !THREE) return false; const r = rayFor(cam, ndc), rc = new THREE.Raycaster(); rc.ray.set(new THREE.Vector3(...r.o), new THREE.Vector3(...r.d)); rc.near = 0; rc.far = Infinity;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.matrixAutoUpdate = false; mesh.matrix.copy(m); mesh.updateMatrixWorld(true); const hits = []; THREE.Mesh.prototype.raycast.call(mesh, rc, hits); mesh.material.dispose(); return hits.length > 0;
  }
  function parkedAt(ndc, camIn) { for (let i = parked.length - 1; i >= 0; i--) { const r = parked[i], pm = partMatrixOf(r.part, r.vals, r.rot); if (pm && recHit(ndc, r.part.geometry, pm.m, camIn)) return i; } return -1; }
  function ghostHit(ndc) {
    const cam = cameraSnap(), g = window.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'), mesh = g?.getObjectByName('shrinkPartGhost'); if (!cam || !mesh) return false;
    const THREE = app().THREE, r = rayFor(cam, ndc), rc = new THREE.Raycaster(); rc.ray.set(new THREE.Vector3(...r.o), new THREE.Vector3(...r.d)); rc.near = 0; rc.far = Infinity;
    mesh.updateMatrixWorld(true); const hits = []; THREE.Mesh.prototype.raycast.call(mesh, rc, hits); return hits.length > 0;
  }
  // ---- v2.325: handles ON the green piece: three arrows (slide along X / Y / Z), three rings (yaw about Y, pitch about X, roll about Z) and − / + to resize.
  const GZ_COL = [0xff4d4d, 0x6dff3a, 0x4d9dff], GZ_NAME = ['x', 'y', 'z'];
  function gizmoSize(pm) { const g = editPart.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const k = new pm.f.THREE.Vector3().setFromMatrixScale(pm.m).x; return Math.max(1e-6, (g.boundingSphere?.radius || 1) * k); }
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function gizmoPick(ndc, camIn) {
    const pm = editPart && partMatrix(); const cam = camIn || cameraSnap(); if (!pm || !cam) return null;
    const R = gizmoSize(pm), c = [pm.m.elements[12], pm.m.elements[13], pm.m.elements[14]], r = rayFor(cam, ndc), L = R * 2.2, Rr = R * 0.8;
    const depth = Math.max(1e-6, dot3([c[0] - r.o[0], c[1] - r.o[1], c[2] - r.o[2]], r.fw)), perNdc = cam.persp ? cam.tanY * depth : cam.halfH, tol = Math.max(R * 0.07, perNdc * 0.04);
    let best = null, bd = Infinity;
    for (let i = 0; i < 3; i++) {                        // arrows: ray against the segment c .. c + L u
      const u = [0, 0, 0]; u[i] = 1; const w = [c[0] - r.o[0], c[1] - r.o[1], c[2] - r.o[2]], b = dot3(u, r.d), d = dot3(u, w), e = dot3(r.d, w), den = 1 - b * b;
      let s = den > 1e-9 ? (b * e - d) / den : 0; s = Math.min(L, Math.max(R * 0.12, s)); const t = b * s + e; if (t < 0) continue;
      const P = [c[0] + u[0] * s, c[1] + u[1] * s, c[2] + u[2] * s], Q = [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t], dist = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]) - tol * 0.4;   // a small bias so an arrow wins over a ring it crosses
      if (dist < bd) { bd = dist; best = { kind: 'arrow', axis: i }; }
    }
    for (let i = 0; i < 3; i++) {                        // rings: where the ray meets the ring's plane, how far that is from the ring
      const n = [0, 0, 0]; n[i] = 1; const den = dot3(n, r.d); if (Math.abs(den) < 0.15) continue;
      const t = dot3(n, [c[0] - r.o[0], c[1] - r.o[1], c[2] - r.o[2]]) / den; if (t < 0) continue;
      const p = [r.o[0] + r.d[0] * t - c[0], r.o[1] + r.d[1] * t - c[1], r.o[2] + r.d[2] * t - c[2]], dist = Math.abs(Math.hypot(...p) - Rr);
      if (dist < bd) { bd = dist; best = { kind: 'ring', axis: i }; }
    }
    return bd <= tol ? best : null;
  }
  function gizmoApply(kind, axis, from, to, camIn) {
    const pm = editPart && partMatrix(); const cam = camIn || cameraSnap(); if (!pm || !cam) return false; const { f, m } = pm, THREE = f.THREE, c = [m.elements[12], m.elements[13], m.elements[14]], r0 = rayFor(cam, from), r1 = rayFor(cam, to);
    if (kind === 'arrow') {
      const u = [0, 0, 0]; u[axis] = 1; const par = r => { const w = [c[0] - r.o[0], c[1] - r.o[1], c[2] - r.o[2]], b = dot3(u, r.d), den = 1 - b * b; return Math.abs(den) < 1e-6 ? null : (b * dot3(r.d, w) - dot3(u, w)) / den; };
      const a = par(r0), b = par(r1); if (a === null || b === null) return false; const id = 'v2EdPart' + 'XYZ'[axis]; $(id).value = (num(id) + (b - a) * f.mm).toFixed(2);
    } else if (kind === 'ring') {
      const n = [0, 0, 0]; n[axis] = 1; const e1 = axis === 0 ? [0, 1, 0] : axis === 1 ? [0, 0, 1] : [1, 0, 0], e2 = axis === 0 ? [0, 0, 1] : axis === 1 ? [1, 0, 0] : [0, 1, 0];
      const ang = r => { const den = dot3(n, r.d); if (Math.abs(den) < 0.15) return null; const t = dot3(n, [c[0] - r.o[0], c[1] - r.o[1], c[2] - r.o[2]]) / den, p = [r.o[0] + r.d[0] * t - c[0], r.o[1] + r.d[1] * t - c[1], r.o[2] + r.d[2] * t - c[2]]; return Math.atan2(dot3(p, e2), dot3(p, e1)); };
      const a = ang(r0), b = ang(r1); if (a === null || b === null) return false; let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      partRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...n), d).multiply(partRot || new THREE.Quaternion());
    } else return false;
    updateEditPreview(); return true;
  }
  function gizmoBuild(THREE, pm) {
    const R = gizmoSize(pm), L = R * 2.2, Rr = R * 0.8, gz = new THREE.Group(); gz.name = 'shrinkPartGizmo'; gz.raycast = () => {};
    gz.position.set(pm.m.elements[12], pm.m.elements[13], pm.m.elements[14]);
    const mat = i => new THREE.MeshBasicMaterial({ color: GZ_COL[i], transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }), put = (mesh, i) => { mesh.renderOrder = 1002; mesh.raycast = () => {}; mesh.name = 'gizmo-' + GZ_NAME[i]; return mesh; };
    for (let i = 0; i < 3; i++) {
      const u = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u), arrow = new THREE.Group(); arrow.quaternion.copy(q); arrow.raycast = () => {};
      const shaft = put(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.04, R * 0.04, L * 0.8, 10), mat(i)), i); shaft.position.y = L * 0.4;
      const cone = put(new THREE.Mesh(new THREE.ConeGeometry(R * 0.12, L * 0.22, 14), mat(i)), i); cone.position.y = L * 0.9; arrow.add(shaft, cone); gz.add(arrow);
      const ring = put(new THREE.Mesh(new THREE.TorusGeometry(Rr, R * 0.016, 8, 72), mat(i)), i); ring.name = 'gizmo-ring-' + GZ_NAME[i]; ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), u); gz.add(ring);
    }
    return gz;
  }
  function ensureHud() {
    let h = $('v2PartHud'); if (h) return h; const v = $('viewer'); if (!v) return null;
    h = document.createElement('div'); h.id = 'v2PartHud'; h.className = 'v2-part-hud'; h.hidden = true;
    h.innerHTML = '<button type="button" data-hud="smaller" title="Reduce the piece (−)" aria-label="Reduce the piece">−</button><button type="button" data-hud="bigger" title="Enlarge the piece (+)" aria-label="Enlarge the piece">+</button>';
    h.addEventListener('pointerdown', e => e.stopPropagation(), true); h.addEventListener('wheel', e => e.stopPropagation());
    h.addEventListener('click', e => { const b = e.target.closest('button'); if (b) partScale(b.dataset.hud === 'bigger' ? 1.1 : 1 / 1.1); });
    v.appendChild(h); return h;
  }
  function partScale(fac) { if (!editPart) return; const id = 'v2EdPartH'; $(id).value = Math.max(0.1, num(id, 30) * fac).toFixed(2); updateEditPreview(); }
  let hudWired = false;
  function hudPlace() {
    const h = $('v2PartHud'); if (!h || h.hidden) return; const V = window.__shrinkViewer, pm = editPart && partMatrix(); if (!V?.camera || !pm) return;
    const THREE = pm.f.THREE, p = new THREE.Vector3(pm.m.elements[12], pm.m.elements[13], pm.m.elements[14]); V.camera.updateMatrixWorld(true); p.project(V.camera);
    const x = Math.min(94, Math.max(6, (p.x * 0.5 + 0.5) * 100)).toFixed(1) + '%', y = Math.min(94, Math.max(6, (-p.y * 0.5 + 0.5) * 100)).toFixed(1) + '%'; if (h.style.left !== x) h.style.left = x; if (h.style.top !== y) h.style.top = y;
  }
  function hudUpdate(show) {
    const h = show ? ensureHud() : $('v2PartHud'); setHid(h, !show); if (!show || !h) return;
    if (!hudWired) { const c = window.__shrinkViewer?.controls; if (c?.addEventListener) { hudWired = true; c.addEventListener('change', hudPlace); } } hudPlace();
  }
  function wirePartDrag() {
    const v = $('viewer'); if (!v || v.dataset.partWired) return; v.dataset.partWired = '1';
    const act = () => !!editPart && editActive() && pieceTool();
    const ndcOf = e => { const r = v.getBoundingClientRect(); return [((e.clientX - r.left) / (r.width || 1)) * 2 - 1, -(((e.clientY - r.top) / (r.height || 1)) * 2 - 1)]; };
    v.addEventListener('pointerdown', e => { if (!act() || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return; const n = ndcOf(e), hz = gizmoPick(n); let hit = !!hz || ghostHit(n); if (!hit) { const pi = parkedAt(n); if (pi < 0) return; takeParked(pi); hit = true; } e.stopPropagation(); e.preventDefault(); partDrag = { last: n, cam: cameraSnap(), hz }; v.classList.add('v2-cur-grabbing'); }, true);
    v.addEventListener('pointermove', e => {
      if (partDrag) { e.stopPropagation(); if ((e.buttons & 1) === 0) { partDragEnd(); return; } const n = ndcOf(e); if (partDrag.hz) gizmoApply(partDrag.hz.kind, partDrag.hz.axis, partDrag.last, n, partDrag.cam); else partDragApply('move', partDrag.last, n, e.shiftKey, partDrag.cam); partDrag.last = n; return; }
      const now = performance.now(); if (!act() || now - hoverAt < 80) return; hoverAt = now; const n = ndcOf(e), on = !!gizmoPick(n) || ghostHit(n) || parkedAt(n) >= 0; v.classList.toggle('v2-cur-grab', on);
    }, true);
    const partDragEnd = () => { if (!partDrag) return; partDrag = null; v.classList.remove('v2-cur-grabbing'); };
    v.addEventListener('pointerup', partDragEnd, true); v.addEventListener('pointercancel', partDragEnd, true); window.addEventListener('pointerup', partDragEnd, true); window.addEventListener('blur', partDragEnd);
  }
  // ---- v2.323: where the floating part overlaps the model it turns red, so you can see it is joined there. Point-in-mesh by a ray up the Y axis through a grid of the model's triangles (no BVH needed).
  let ovIndex = null, ovTimer = 0;
  function removeOverlap() { const V = window.__shrinkViewer, g = V?.scene?.getObjectByName?.('shrinkPartOverlap'); if (!g) return; V.scene.remove(g); g.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  function ovBuild(model) {
    const THREE = app().THREE, nt0 = modelTriangles(model), A = new Float32Array(nt0 * 9), v = new THREE.Vector3(); let k = 0; model.updateWorldMatrix(true, true);
    model.traverse(o => { if (!o.isMesh || !o.geometry?.attributes?.position) return; const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n && k + 9 <= A.length; i += 3) for (let c = 0; c < 3; c++) { v.fromBufferAttribute(pos, idx ? idx.getX(i + c) : i + c).applyMatrix4(o.matrixWorld); A[k++] = v.x; A[k++] = v.y; A[k++] = v.z; } });
    const nt = k / 9; let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < k; i += 3) { const x = A[i], z = A[i + 2]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (z < minz) minz = z; if (z > maxz) maxz = z; }
    const G = Math.max(8, Math.min(256, Math.round(Math.sqrt(nt) / 2))), cw = (maxx - minx) / G || 1, cd = (maxz - minz) / G || 1, cnt = new Int32Array(G * G + 1);
    const span = (a, b, c, lo, w) => [Math.max(0, Math.min(G - 1, Math.floor((Math.min(a, b, c) - lo) / w))), Math.max(0, Math.min(G - 1, Math.floor((Math.max(a, b, c) - lo) / w)))];
    for (let t = 0; t < nt; t++) { const o = t * 9, [x0, x1] = span(A[o], A[o + 3], A[o + 6], minx, cw), [z0, z1] = span(A[o + 2], A[o + 5], A[o + 8], minz, cd); for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) cnt[zz * G + xx + 1]++; }
    for (let i = 0; i < G * G; i++) cnt[i + 1] += cnt[i];
    const fill = cnt.slice(0, G * G), list = new Int32Array(cnt[G * G]);
    for (let t = 0; t < nt; t++) { const o = t * 9, [x0, x1] = span(A[o], A[o + 3], A[o + 6], minx, cw), [z0, z1] = span(A[o + 2], A[o + 5], A[o + 8], minz, cd); for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) list[fill[zz * G + xx]++] = t; }
    return { model, tick: window.__shrinkStretchTick || 0, A, G, minx, maxx, minz, maxz, cw, cd, start: cnt, list, jx: (maxx - minx) * 1.7e-6 + 1e-9, jz: (maxz - minz) * 2.3e-6 + 1e-9 };
  }
  function ovInside(ix, x, y, z) {
    x += ix.jx; z += ix.jz; if (x < ix.minx || x > ix.maxx || z < ix.minz || z > ix.maxz) return false;
    const G = ix.G, cx = Math.min(G - 1, Math.floor((x - ix.minx) / ix.cw)), cz = Math.min(G - 1, Math.floor((z - ix.minz) / ix.cd)), cell = cz * G + cx, A = ix.A; let hits = 0;
    for (let p = ix.start[cell]; p < ix.start[cell + 1]; p++) {
      const t = ix.list[p] * 9, ax = A[t], ay = A[t + 1], az = A[t + 2], bx = A[t + 3], by = A[t + 4], bz = A[t + 5], qx = A[t + 6], qy = A[t + 7], qz = A[t + 8];
      const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz); if (Math.abs(d) < 1e-18) continue;
      const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / d, l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue; if (l1 * ay + l2 * by + l3 * qy > y) hits++;
    }
    return (hits & 1) === 1;
  }
  function setJoinNote(text, state) { const e = $('v2PadJoin'); if (!e) return; if (e.textContent !== text) e.textContent = text; if (e.dataset.state !== state) e.dataset.state = state; }
  function overlapUpdate() {
    clearTimeout(ovTimer); removeOverlap(); const V = window.__shrinkViewer, model = sourceModel(), pm = partMatrix(); const on = editPart && editActive() && pieceTool();
    if (!on || !V?.scene || !model || !pm) { setJoinNote('', ''); return 0; }
    if (modelTriangles(model) > (window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES)) { setJoinNote('', ''); return 0; }
    if (!ovIndex || ovIndex.model !== model || ovIndex.tick !== (window.__shrinkStretchTick || 0)) ovIndex = ovBuild(model);
    const THREE = pm.f.THREE, g = editPart.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, nt = Math.floor(n / 3), step = Math.max(1, Math.ceil(nt / 200000)), m = pm.m, out = [], v = new THREE.Vector3(), w = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let t = 0; t < nt; t += step) {
      let any = false; for (let c = 0; c < 3; c++) { const i = idx ? idx.getX(t * 3 + c) : t * 3 + c; v.fromBufferAttribute(pos, i).applyMatrix4(m); w[c * 3] = v.x; w[c * 3 + 1] = v.y; w[c * 3 + 2] = v.z; if (!any && ovInside(ovIndex, v.x, v.y, v.z)) any = true; }
      if (any) out.push(...w);
    }
    const cut = $('v2EdMode')?.value === 'cut', joined = out.length / 9;
    if (joined) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); mesh.renderOrder = 1001; mesh.raycast = () => {};
      const grp = new THREE.Group(); grp.name = 'shrinkPartOverlap'; grp.raycast = () => {}; grp.add(mesh); V.scene.add(grp);
    }
    setJoinNote(joined ? (cut ? 'Red = the part of the model this will cut away.' : 'Red = where it overlaps the model, so it will be joined there.') : (cut ? 'It is not touching the model, so nothing would be cut.' : 'Not touching the model yet. Move it so a little of it overlaps, or it will stay a separate piece.'), joined ? 'joined' : 'apart');
    return joined;
  }
  function scheduleOverlap() {
    clearTimeout(ovTimer); const V = window.__shrinkViewer, g = V?.scene?.getObjectByName?.('shrinkPartOverlap'); if (g) g.visible = false;
    if (!editPart || !editActive() || !pieceTool()) { removeOverlap(); setJoinNote('', ''); return; }
    ovTimer = setTimeout(overlapUpdate, 160);
  }
  // ---- v2.328: save / load the floating pieces. One small file: "SHRINKPARTS1\n", 4-byte header length, JSON header, then every piece's triangle soup as raw float32 (exact, no rounding).
  function allPieces() { const l = parked.map(r => ({ part: r.part, vals: r.vals, rot: r.rot, mode: r.mode })); if (editPart) l.push({ part: editPart, vals: partVals(), rot: partRot, mode: $('v2EdMode')?.value || 'join' }); return l; }
  function soupOf(g) { const pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const j = idx ? idx.getX(i) : i; out[i * 3] = pos.getX(j); out[i * 3 + 1] = pos.getY(j); out[i * 3 + 2] = pos.getZ(j); } return out; }
  function buildPiecesFile() {
    const list = allPieces(); if (!list.length) return null; const bufs = [], head = { app: 'SHRINK 3D', kind: 'floating-pieces', v: 1, pieces: [] }; let off = 0;
    list.forEach((it, i) => { const a = soupOf(it.part.geometry); bufs.push(a); head.pieces.push({ name: it.part.name || 'piece ' + (i + 1), height: it.part.height, mode: it.mode, vals: it.vals, rot: it.rot ? it.rot.toArray() : null, off, count: a.length }); off += a.length; });
    const enc = new TextEncoder(), hj = enc.encode(JSON.stringify(head)), magic = enc.encode('SHRINKPARTS1\n'), out = new Uint8Array(magic.length + 4 + hj.length + off * 4);
    out.set(magic, 0); new DataView(out.buffer).setUint32(magic.length, hj.length, true); out.set(hj, magic.length + 4); let o = magic.length + 4 + hj.length;
    bufs.forEach(a => { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += a.byteLength; }); return out;
  }
  function loadPiecesBuffer(ab) {
    const u8 = new Uint8Array(ab), dec = new TextDecoder(), magic = 'SHRINKPARTS1\n'; if (dec.decode(u8.subarray(0, magic.length)) !== magic) throw new Error('That is not a SHRINK floating-pieces file.');
    const hl = new DataView(u8.buffer, u8.byteOffset).getUint32(magic.length, true), head = JSON.parse(dec.decode(u8.subarray(magic.length + 4, magic.length + 4 + hl))), base = magic.length + 4 + hl; let n = 0;
    for (const pc of head.pieces) {
      const arr = new Float32Array(u8.slice(base + pc.off * 4, base + (pc.off + pc.count) * 4).buffer), part = partFromPoints(arr, false, pc.name); part.copied = true; setPart(part);
      Object.entries(pc.vals).forEach(([a, v]) => { const e = $(a === 'H' ? 'v2EdPartH' : 'v2EdPart' + a); if (e) e.value = String(v); }); partRot = pc.rot ? new (app().THREE.Quaternion)(...pc.rot) : null;
      const md = $('v2EdMode'); if (md) { md.value = pc.mode || 'join'; md.dispatchEvent(new Event('change', { bubbles: true })); } n++;
    }
    if (n) { if (!editActive()) window.__shrinkTab?.('edit'); set$tool('part'); updateEditPreview(); }
    return n;
  }
  function savePiecesFile() {
    const data = buildPiecesFile(); if (!data) { edToast?.('There are no floating pieces to save.'); return false; }
    const name = `${(window.__shrinkDownloadStem?.(document.getElementById('fileName')?.textContent || 'model') || 'model')}-pieces.shrinkparts`, blob = new Blob([data], { type: 'application/octet-stream' });
    if (window.__shrinkCapture?.(blob, name)) return true; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000); return true;
  }
  function piecesUi() {                                  // buttons in the EDIT panel, and the tick box under DOWNLOAD IT
    const have = !!editPart || parked.length > 0, row = $('v2SavePiecesRow'); setHid(row, !have); const sv = $('v2PiecesSave'); if (sv && sv.disabled === have) sv.disabled = !have;
  }
  function ensurePiecesRow() {
    const pane = $('v2EditPane'); if (pane && !$('v2PiecesRow')) { const r = document.createElement('div'); r.id = 'v2PiecesRow'; r.className = 'v2-pieces-row';
    r.innerHTML = '<button type="button" id="v2PiecesSave" title="Save the floating green pieces to a file, to use on another model later" disabled>SAVE PIECES</button><button type="button" id="v2PiecesLoad" title="Bring saved floating pieces back">LOAD PIECES</button><input type="file" id="v2PiecesFile" accept=".shrinkparts" hidden>';
    pane.insertBefore(r, pane.firstChild); r.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'v2PiecesSave') savePiecesFile(); else $('v2PiecesFile').click(); });
    $('v2PiecesFile').addEventListener('change', async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const n = loadPiecesBuffer(await f.arrayBuffer()); $('v2EdResult').innerHTML = `<strong>✓ ${n} piece${n === 1 ? '' : 's'} loaded</strong><span>They float in green where they were saved, relative to the middle of this model. Move them, then WELD IT.</span>`; } catch (err) { edToast?.(String(err?.message || err)); } }); }
    const dl = document.querySelector('.v2-main-download'); if (dl && !$('v2SavePiecesRow')) { const lab = document.createElement('label'); lab.id = 'v2SavePiecesRow'; lab.className = 'v2-save-pieces'; lab.hidden = true; lab.innerHTML = '<input type="checkbox" id="v2SavePieces" checked> Also save my floating pieces (.shrinkparts)'; const b = $('v2DownloadBtn'); if (b && b.parentNode === dl) b.after(lab); else dl.appendChild(lab); }
  }
  function discardPiece() { if (!editPart) return; dropSelected(); if (!editPart && !parked.length) set$tool('none'); $('v2EdResult').innerHTML = '<strong>Piece thrown away</strong><span>Nothing was changed on the model.</span>'; }
  async function weldAll() { let guard = 0; while (editPart && guard++ < 30) { const cur = editPart; await editModelNow(); if (editPart === cur) break; } }
  function updatePad() { const show = !!editPart && editActive() && pieceTool(); const pad = show ? ensurePad() : $('v2PartPad'); setHid(pad, !show); hudUpdate(show && $('v2EdTab')?.value === 'part'); if (show) { const t = $('v2PartPad').querySelector('.v2-pad-title'), txt = parked.length ? `Move the part (${parked.length + 1} floating)` : 'Move the part'; if (t && t.textContent !== txt) t.textContent = txt; setHid($('v2PadAll'), !parked.length); wirePartDrag(); if (pad && pad.dataset.shown !== '1') { pad.dataset.shown = '1'; const pn = $('v2EditPanel'); if (pn) pn.scrollTop = 0; } } else if (pad && pad.dataset.shown) delete pad.dataset.shown; }
  function set$tool(t) { const sel = $('v2EdTab'); sel.value = t; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  function updateGoState() { const go = $('v2EdGo'); if (!go) return; const need = $('v2EdTab').value === 'part' && !editPart; if (go.dataset.needPart !== String(need)) go.dataset.needPart = String(need); }
  function sliceSpec() {                                // plane through the chosen spot; normal points to the side that is KEPT
    const f = editFrame(); if (!f) return null;
    const ax = $('v2EdAxis').value, i = { x: 0, y: 1, z: 2 }[ax], t = num('v2EdTilt') * Math.PI / 180;
    const other = ax === 'y' ? 0 : 1;                   // tilt a vertical-axis cut toward X, a sideways cut toward Y
    const n = [0, 0, 0]; n[i] = Math.cos(t); n[other] += Math.sin(t);
    const c = f.centre.clone(); const lo = f.box.min.getComponent(i), hi = f.box.max.getComponent(i); c.setComponent(i, lo + (hi - lo) * num('v2EdPos', 50) / 100);
    const dot = n[0] * c.x + n[1] * c.y + n[2] * c.z, removeHigh = $('v2EdSide').value === 'high';
    const normal = removeHigh ? n.map(v => -v) : n, offset = removeHigh ? -dot : dot;
    return { f, n, c, normal, offset };
  }
  function updateEditPreview() {
    removeEditPreview();
    ensurePiecesRow(); piecesUi(); updatePad(); scheduleOverlap(); const V = window.__shrinkViewer; const tool = $('v2EdTab')?.value, floating = !!editPart || parked.length > 0; if (!editActive() || !V?.scene || (['lasso', 'razor', 'sculpt', 'none'].includes(tool) && !floating)) return;
    const sl = tool === 'slice', isPart = tool === 'part', isSel = tool === 'select';
    const THREE = app()?.THREE; if (!THREE) return;
    const g = new THREE.Group(); g.name = 'shrinkEditPreview'; g.raycast = () => {};
    const ghost = (part, pm, mode, sel, tag) => {      // v2.326: every floating piece is drawn the same way; the selected one glows
      const col = mode === 'cut' ? 0xff9a2f : 0x35d6a0;
      [{ test: false, op: sel ? 0.4 : 0.28, ro: 998 }, { test: true, op: sel ? 0.85 : 0.6, ro: 999 }].forEach((c, i) => {
        const m = new THREE.Mesh(part.geometry, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: c.op, depthWrite: false, depthTest: c.test, side: THREE.DoubleSide }));
        m.name = (sel ? 'shrinkPartGhost' : 'shrinkParkedGhost') + (i ? '' : 'See'); m.userData.tag = tag; m.renderOrder = c.ro; m.matrixAutoUpdate = false; m.matrix.copy(pm.m); m.matrixWorldNeedsUpdate = true; m.raycast = () => {}; g.add(m);
      });
      if (sel) { const gl = new THREE.Mesh(part.geometry, new THREE.MeshBasicMaterial({ color: 0xd8fff0, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false, side: THREE.BackSide })); gl.name = 'shrinkPartGlow'; gl.renderOrder = 997; gl.matrixAutoUpdate = false; gl.matrix.copy(pm.m).multiply(new THREE.Matrix4().makeScale(1.06, 1.06, 1.06)); gl.matrixWorldNeedsUpdate = true; gl.raycast = () => {}; g.add(gl); }
    };
    parked.forEach((r, i) => { const pm = partMatrixOf(r.part, r.vals, r.rot); if (pm) ghost(r.part, pm, r.mode, false, i); });
    if (editPart) { const pm = partMatrix(); if (pm) { ghost(editPart, pm, $('v2EdMode').value, true, -1); if (isPart) g.add(gizmoBuild(THREE, pm)); } }
    if (isPart || isSel || ['lasso', 'razor', 'sculpt', 'none'].includes(tool)) {
      if (!g.children.length) return;
    } else if (sl) {
      const s = sliceSpec(); if (!s) return;
      const d = s.f.size.length() * 1.15, m = new THREE.Mesh(new THREE.PlaneGeometry(d, d), new THREE.MeshBasicMaterial({ color: 0x2f86ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      m.position.copy(s.c); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...s.n).normalize()); m.raycast = () => {}; g.add(m);
    } else {
      const s = shapeSpec(); if (!s) return;
      const geo = { cube: () => new THREE.BoxGeometry(1, 1, 1), ball: () => new THREE.SphereGeometry(0.5, 28, 18), cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 36), cone: () => new THREE.ConeGeometry(0.5, 1, 36) }[s.kind]();
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: s.mode === 'cut' ? 0xff9a2f : 0xff4fa0, transparent: true, opacity: 0.45, depthWrite: false }));
      m.matrixAutoUpdate = false; m.matrix.fromArray(s.matrix); m.matrixWorldNeedsUpdate = true; m.raycast = () => {}; g.add(m);
    }
    V.scene.add(g);
  }
  const editActive = () => { const p = $('v2EditPanel'); return !!p && !p.hidden; };   // v2.321: the EDIT tools have their own drop-down panel under the EDIT button
  function editTabChanged() {
    const t = $('v2EdTab').value, sl = t === 'slice';
    const lz = t === 'lasso' || t === 'razor';
    setHid($('v2EdShapeBox'), t !== 'shape'); setHid($('v2EdSliceBox'), !sl); setHid($('v2EdPartBox'), t !== 'part'); setHid($('v2EdLassoBox'), !lz); setHid($('v2EdSculptBox'), t !== 'sculpt'); setHid($('v2EdGo'), lz || t === 'sculpt' || t === 'select'); setHid($('v2EdModeRow'), !(t === 'shape' || t === 'part')); setHid($('v2EdRun'), t === 'none');
    { const tip = $('v2EdTip'); const msg = t === 'none' ? 'No tool selected. Pick one above.' : 'Click the tool again or press Esc to put it down.'; if (tip && tip.textContent !== msg) tip.textContent = msg; updateGoState(); }
    if (lz && t !== lastLz) { clearLasso(); const dp = $('v2EdDepth'); if (dp) dp.value = t === 'razor' ? 'through' : 'near'; const k = $('v2LassoKeepBtn'); if (k) { k.dataset.op = t === 'razor' ? 'cut' : 'copy'; k.querySelector('span').textContent = t === 'razor' ? 'CUT OFF & KEEP' : 'COPY'; } const d = $('v2LassoDelBtn'); if (d) d.querySelector('span').textContent = t === 'razor' ? 'CUT OFF' : 'DELETE'; const h = $('v2LassoHelp'); if (h) h.textContent = t === 'razor' ? 'The razor cuts straight through. Draw a loop round the piece you want off. The hole is always closed flat. Ctrl / ⌘ + drag turns the model.' : 'Hold the mouse button down and draw a loop round the part on the model. Ctrl / ⌘ + drag still turns the model.'; }
    if (!lz && lastLz) clearLasso(); lastLz = lz ? t : '';
    { const v = $('viewer'); if (v) { v.classList.toggle('v2-cur-lasso', t === 'lasso' && editActive()); v.classList.toggle('v2-cur-razor', t === 'razor' && editActive()); } }
    if (lz) wireLasso();
    updateEditHint();
    if (t === 'sculpt') { wireSculpt(); if (!sculptSized) { const f = editFrame(); if (f) { sculptSized = true; const v = Math.min(60, Math.max(2, Math.round(f.size.y * f.mm * 0.06 * 2) / 2)); $('v2SculptSize').value = String(v); $('v2SculptSizeOut').textContent = v + ' mm'; } } } else sculptRing(null);
    { const vw = $('viewer'); if (vw) vw.classList.toggle('v2-cur-sculpt', t === 'sculpt' && editActive()); }
    { const card = $('v2EditCard'); card?.querySelectorAll('.v2-icon-btn').forEach(b => { const sel = { tool: 'v2EdTab', kind: 'v2EdKind', mode: 'v2EdMode', smode: 'v2EdSculptMode' }[b.dataset.ed], on = $(sel)?.value === b.dataset.value; if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); }); }
    $('v2EdGo').textContent = sl ? 'SLICE OFF' : t === 'part' ? ($('v2EdMode').value === 'cut' ? 'CUT PART OUT' : editPart?.copied ? 'PASTE PART ON' : 'JOIN PART ON') : ($('v2EdMode').value === 'cut' ? 'CUT SHAPE OUT' : 'JOIN SHAPE ON');
    updateEditPreview(); updatePad();
  }
  // v2.308: the two tabs in the side column. EDIT (optional, do it first) and SHRINK & FINISH (shrink, fix, fuse, hollow); one working model, one viewer, one undo chain.
  function updateEditHint() {
    const hint = $('v2EdHint'); if (!hint) return;
    const m = sourceModel(); let msg = '';
    if (m) {
      const tris = modelTriangles(m), limit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES, t = $('v2EdTab')?.value || 'none';
      const meshOnly = t === 'sculpt' || (t === 'lasso' && wholeOn());          // these work on the triangles themselves, no Manifold
      if (t === 'none') msg = '';
      else if (t === 'select') msg = (editPart || parked.length) ? 'Click a green piece to pick it (it glows). Drag it to move it. DELETE PIECE, COPY PIECE and WELD IT are on the pad.' : 'Nothing is floating yet. Cut or copy a piece with the Lasso or Razor first, then come back and pick it here.';
      else if (appliedChanges.has('hollowed') && sourceModel() === hollowResult) msg = 'This model is already hollow. Edit the solid model before you hollow it.';
      else if (meshOnly && tris > SCULPT_MAX_TRIANGLES) msg = `This model has ${tris.toLocaleString()} triangles, too many for this tool in the browser. Go to SHRINK & FINISH and press SHRINK first.`;
      else if (t === 'lasso' && !meshOnly && tris > limit && tris <= SCULPT_MAX_TRIANGLES) msg = `This model has ${tris.toLocaleString()} triangles. DELETE works on the triangles directly and leaves an open hole, which FIX IT closes. COPY needs under ${limit.toLocaleString()}, so press SHRINK first for that.`;
      else if (!meshOnly && tris > limit) msg = `This model has ${tris.toLocaleString()} triangles. ${t === 'lasso' ? 'The lasso cut' : t === 'razor' ? 'The razor' : t === 'part' ? 'Pasting a part' : t === 'slice' ? 'Slicing' : 'Shapes'} needs under ${limit.toLocaleString()}, so press SHRINK first (SHRINK & FINISH tab).${t === 'lasso' ? ' Sculpt, or the lasso with "Grab the whole loose piece" ticked, work on bigger models.' : t === 'razor' || t === 'slice' || t === 'shape' || t === 'part' ? ' The Sculpt tool works on bigger models.' : ''}`;
      else if (!meshOnly && t !== 'sculpt' && lastHealth && lastHealth.model === m && lastHealth.h && !lastHealth.h.clean) msg = 'This model has open or broken edges, so shapes, slices and the lasso cannot cut it yet. Press FIX IT first (SHRINK & FINISH tab).';
    }
    if (hint.textContent !== msg) hint.textContent = msg; if (hint.hidden !== !msg) hint.hidden = !msg;
  }
  let editOpened = false;
  function setMainTab(tab) {
    const pn = $('v2EditPanel'); if (!pn) return;
    tab = tab === 'edit' ? 'edit' : 'finish'; setHid(pn, tab !== 'edit'); $('v2TabEdit')?.setAttribute('aria-pressed', String(tab === 'edit'));
    if (tab === 'edit' && !editOpened) { editOpened = true; const sel = $('v2EdTab'); if (sel && sel.value !== 'lasso') { sel.value = 'lasso'; sel.dispatchEvent(new Event('change', { bubbles: true })); } }   // v2.325: the first time EDIT opens the Lasso is already selected
    document.body.classList.toggle('v2-editing', tab === 'edit');          // v2.324: while EDIT is open the health box, SHRINK and DOWNLOAD step aside (CSS)
    if (tab === 'edit') { editTabChanged(); updateEditHint(); } else { removeEditPreview(); clearLasso(); updatePad(); const v = $('viewer'); v?.classList.remove('v2-cur-lasso', 'v2-cur-razor', 'v2-cur-sculpt'); sculptRing(null); }
  }
  window.__shrinkTab = setMainTab;
  async function editModelNow() {
    const btn = $('v2EdGo'), card = $('v2EditCard'), res = $('v2EdResult');
    if (!btn || btn.disabled) return;
    const sl = $('v2EdTab').value === 'slice';
    btn.disabled = true; setWorking(true, 0, 'Editing…');
    try {
      progress(card, 10, 'Loading the solid tools…');
      for (let i = 0; i < 50 && !window.__shrinkFuse?.editModel; i++) await wait(100);
      if (!window.__shrinkFuse?.editModel) throw new Error('The solid tools are still loading. Try again in a moment.');
      const model = sourceModel(); if (!model) throw new Error('Load a model first.');
      if (hollowResult && model === hollowResult) throw new Error('This model is already hollow. Edit the solid model before you hollow it.');
      const tris = modelTriangles(model), limit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES;
      if (tris > limit) throw new Error(`This model has ${tris.toLocaleString()} triangles, too many to edit in the browser. Press SHRINK first.`);
      const THREE0 = app()?.THREE; let snap = null;
      if (THREE0) { model.updateWorldMatrix(true, true); snap = model.clone(true); snap.traverse(o => { if (o.isMesh) o.geometry = o.geometry.clone(); }); snap.matrix.copy(model.matrixWorld); snap.matrix.decompose(snap.position, snap.quaternion, snap.scale); snap.updateMatrixWorld(true); }
      const isPart = pieceTool();
      if (isPart && !editPart) throw new Error('Choose a part file first.');
      const ops = isPart ? (() => { const pm = partMatrix(), mesh = new pm.f.THREE.Mesh(editPart.geometry, new pm.f.THREE.MeshStandardMaterial()); mesh.matrixAutoUpdate = false; mesh.matrix.copy(pm.m); const root = new pm.f.THREE.Group(); root.add(mesh); root.updateMatrixWorld(true); return { part: { root, mode: $('v2EdMode').value } }; })() : sl ? (() => { const s = sliceSpec(); return { slice: { normal: s.normal, offset: s.offset } }; })() : (() => { const s = shapeSpec(); return { shapes: [{ kind: s.kind, mode: s.mode, matrix: s.matrix }] }; })();
      progress(card, 40, 'Working…'); await paintNow();
      const r = await window.__shrinkFuse.editModel(model, ops);
      progress(card, 85, 'Checking the result…');
      if (snap) { if (!editBase) editBase = cloneRoot(snap); editStack.push(snap); if (editStack.length > 6) editStack.shift(); }
      removeEditPreview(); installWorkingResult(r.root, 'edit');
      const mm = Number(window.__shrinkPrint?.mmPerUnit?.()) || 1, ml = r.volume * mm * mm * mm / 1000;
      if (isPart) { dropSelected(); updatePad(); $('v2EdPartInfo').textContent = parked.length || editPart ? 'Welded. The other floating pieces are still waiting.' : 'Done. Choose another part file if you want to add more.'; try { $('v2EdPartFile').value = ''; } catch {} }
      res.innerHTML = `<strong>✓ ${sl ? 'Sliced' : ($('v2EdMode').value === 'cut' ? 'Cut' : 'Joined')}</strong><span>Now ${ml.toFixed(1)} ml in ${r.pieces} piece${r.pieces === 1 ? '' : 's'}. Press UNDO if that is not what you wanted.</span>`;
      card.dataset.state = 'good'; progress(card, 100, 'Done.');
      $('v2EdUndo').hidden = !editStack.length;
      setTimeout(() => { updateHealthCard(); updateEditPreview(); }, 80);
    } catch (err) {
      card.dataset.state = 'warn'; progress(card, 100, 'Could not edit this model.');
      res.innerHTML = `<strong>Could not edit</strong><span>${err?.message || err}${/watertight|manifold|reject/i.test(String(err?.message || err)) ? ' Run FIX IT or FUSE IT first.' : ''}</span>`;
    } finally { btn.disabled = false; setWorking(false); }
  }
  function cloneRoot(model) {
    const THREE0 = app()?.THREE; if (!THREE0 || !model) return null; model.updateWorldMatrix(true, true);
    const c = model.clone(true); c.traverse(o => { if (o.isMesh) o.geometry = o.geometry.clone(); }); c.matrix.copy(model.matrixWorld); c.matrix.decompose(c.position, c.quaternion, c.scale); c.updateMatrixWorld(true); return c;
  }
  // v2.312: RESET ALL EDITS: back to the model as it was before the first edit; brush strokes, the loaded part and the tool settings are cleared too
  function resetEdits() {
    const res = $('v2EdResult'); let did = false;
    try { if (window.__shrinkClay?.hasClay?.()) { window.__shrinkClay.clear(); did = true; } } catch {}
    if (parked.length) { parked = []; did = true; }
    if (editPart) { editPart = null; did = true; try { $('v2EdPartFile').value = ''; } catch {} $('v2EdPartInfo').textContent = 'STL, OBJ, PLY or GLB. It must be a closed solid, e.g. a new head. Slice the old head off first, then press SIT ON TOP.'; }
    if (editBase) {
      const base = editBase; editBase = null; editStack = []; removeEditPreview();
      const fresh = cloneRoot(base) || base; installWorkingResult(fresh, 'edit');
      appliedChanges.delete('edited'); renderAppliedChanges(); $('v2EdUndo').hidden = true; did = true; setTimeout(updateHealthCard, 80);
    }
    const set = (id, v) => { const e = $(id); if (e) e.value = v; };
    ['v2EdW', 'v2EdH', 'v2EdD'].forEach(i => set(i, '10')); ['v2EdX', 'v2EdY', 'v2EdZ', 'v2EdTilt', 'v2EdPartX', 'v2EdPartY', 'v2EdPartZ', 'v2EdPartRX', 'v2EdPartRY', 'v2EdPartRZ'].forEach(i => set(i, '0'));
    set('v2EdPos', '50'); set('v2EdAxis', 'y'); set('v2EdSide', 'high'); set('v2EdPartH', '30'); set('v2EdKind', 'cube'); set('v2EdMode', 'cut'); partRot = null; clearLasso(); sculptWork = null; sculptData = null;
    $('v2EdPosOut').textContent = '50%'; $('v2EdTiltOut').textContent = '0°';
    { const t = $('v2EdTab'); t.value = 'none'; t.dispatchEvent(new Event('change', { bubbles: true })); }
    res.innerHTML = did ? '<strong>Reset</strong><span>Every edit is undone and the tools are back to normal.</span>' : '<strong>Nothing to reset</strong><span>No edits have been made yet.</span>';
    updateEditPreview(); updateGoState();
  }
  function undoEdit() {
    const snap = editStack.pop(); if (!snap) return;
    removeEditPreview(); installWorkingResult(snap, 'edit');
    if (!editStack.length) { appliedChanges.delete('edited'); renderAppliedChanges(); }
    $('v2EdUndo').hidden = !editStack.length;
    $('v2EdResult').innerHTML = '<strong>Undone</strong><span>Back to how it was before the last edit.</span>';
    setTimeout(() => { updateHealthCard(); updateEditPreview(); }, 80);
  }
  window.__shrinkEdit = { reset: resetEdits, sculpt: sculptAt, lasso: lassoApply, hasSel: () => !!lassoSel, setSel: (pts, cam) => { lassoSel = pts ? { pts, cam, px: [] } : null; lassoBarState(); return lassoSel ? lassoRed(lassoSel) : (removeLassoRed(), 0); }, padVisible: () => { const e = $('v2PartPad'); return !!e && !e.hidden; }, pad: padAct, setPart: (pts, zUp, name) => setPart(partFromPoints(pts, !!zUp, name)), place: partPlace, hasPart: () => !!editPart, run: editModelNow, undo: undoEdit, depth: () => editStack.length, preview: updateEditPreview, overlap: overlapUpdate, turnWorld: partTurnWorld, drag: (mode, from, to, shift, cam) => partDragApply(mode, from, to, !!shift, cam), parked: () => parked.length, piecesFile: () => buildPiecesFile(), loadPieces: ab => loadPiecesBuffer(ab), savePieces: savePiecesFile, select: i => takeParked(i), dup: dupPart, weldAll, discard: discardPiece, parkedAt: (ndc, cam) => parkedAt(ndc, cam), gizmoDrag: (kind, axis, from, to, cam) => gizmoApply(kind, axis, from, to, cam), gizmoPick: (ndc, cam) => gizmoPick(ndc, cam), scale: fac => partScale(fac), hudVisible: () => { const h = $('v2PartHud'); return !!h && !h.hidden; }, partState: () => editPart ? { x: num('v2EdPartX'), y: num('v2EdPartY'), z: num('v2EdPartZ'), h: num('v2EdPartH'), rot: partRot ? partRot.toArray() : null } : null, ghosts: () => { const g = window.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'); return g ? g.children.length : 0; } };

  async function hollowModelNow() {
    const btn = $('v2HollowBtn'), card = $('v2HollowCard'), res = $('v2HollowResult');
    if (!btn || btn.disabled) return;
    btn.disabled = true; setWorking(true, 0, 'Hollowing…');
    const keepCut = (hollowResult && sourceModel() === hollowResult) ? Number($('v2HollowCutRange')?.value) : 100;   // v2.305: re-hollowing keeps the cut-away where it was
    try {
      progress(card, 10, 'Loading the solid tools…');
      for (let i = 0; i < 50 && !window.__shrinkFuse?.hollowModel; i++) await wait(100);
      if (!window.__shrinkFuse?.hollowModel) throw new Error('The solid tools are still loading. Try again in a moment.');
      let model = sourceModel(); if (!model) throw new Error('Load a model first.');
      /* v2.294: changing the wall and pressing again must start from the solid, not from the already hollow shell (that dug into the wall and left only thin skins) */
      if (hollowBase && hollowResult && model === hollowResult) model = hollowBase;
      else { const THREE0 = app()?.THREE; if (THREE0) { model.updateWorldMatrix(true, true); const c = model.clone(true); c.traverse(o => { if (o.isMesh) o.geometry = o.geometry.clone(); }); c.matrix.copy(model.matrixWorld); c.matrix.decompose(c.position, c.quaternion, c.scale); c.updateMatrixWorld(true); hollowBase = c; } }
      const tris = modelTriangles(model), limit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES;
      if (tris > limit) throw new Error(`This model has ${tris.toLocaleString()} triangles, too many to hollow in the browser. Press SHRINK first.`);
      const mm = Number(window.__shrinkPrint?.mmPerUnit?.()) || 1, wallMm = Number($('v2HollowWall')?.value) || 2, holes = Number($('v2HollowHoles')?.value ?? 2);
      progress(card, 35, 'Working out the inside… this can take a moment');
      await paintNow();
      const r = await window.__shrinkFuse.hollowModel(model, { wall: wallMm / mm, holes, holeRadius: (Number($('v2HollowHoleSize')?.value) || 3) / 2 / mm });
      progress(card, 85, 'Checking the result…');
      removeHollowBlue(); installWorkingResult(r.root, 'hollow'); hollowResult = r.root;
      const ml = v => (v * mm * mm * mm / 1000);
      res.innerHTML = `<strong>✓ Hollowed</strong><span>Resin volume ${ml(r.before).toFixed(1)} ml → ${ml(r.after).toFixed(1)} ml (${Math.round(r.saved * 100)}% saved). ${r.holes.length ? r.holes.length + ' drain hole' + (r.holes.length > 1 ? 's' : '') + ' in the base, about ' + (Number($('v2HollowHoleSize')?.value) || 3) + ' mm wide.' : '<b>No drain holes</b>: resin printers need them, add them in your slicer.'} Drag the cut-away slider to look inside.</span>`;
      card.dataset.state = 'good'; progress(card, 100, 'Done.');
      const cut = $('v2HollowCut'); if (cut) { cut.hidden = false; $('v2HollowCutRange').value = '100'; }
      if (Number.isFinite(keepCut) && keepCut < 99.5) { try { hollowClip(keepCut); } catch {} }
      setTimeout(updateHealthCard, 80);
    } catch (err) {
      card.dataset.state = 'warn'; progress(card, 100, 'Could not hollow this model.');
      res.innerHTML = `<strong>Could not hollow</strong><span>${err?.message || err}</span>`;
    } finally { btn.disabled = false; setWorking(false); }
  }

  // v2.245: a batch run showed SHRINK silently doing nothing on some models (the engine's button was still disabled, so shrinkModelInner just returned and the file went out unreduced).
  // Now we wait for the engine to be ready and say so if it never is; window.__shrinkShrinkNote keeps the reason for the diagnostic.
  async function shrinkModel(...a) {
    window.__shrinkShrinkNote = null;
    for (let i = 0; i < 600 && $('v2ShrinkBtn')?.dataset.checking; i++) await wait(100);
    if ($('v2ShrinkBtn')?.dataset.checking) { window.__shrinkShrinkNote = 'skipped: health check still running after 60 s'; throw new Error('the health check did not finish'); }
    const src = $('autoBtn'); for (let i = 0; i < 900 && src?.disabled; i++) await wait(100);
    if (src?.disabled) { window.__shrinkShrinkNote = 'skipped: the SHRINK engine button stayed disabled for 90 s'; throw new Error('the shrink engine was not ready'); }
    shrinkRunning = true; setWorking(true, 0, 'Shrinking…'); try { return await shrinkModelInner(...a); } finally { shrinkRunning = false; setWorking(false); const sb = $('v2ShrinkBtn'); if (sb?.dataset.checking) sb.disabled = true; } }
  const fixedShrinkReady = () => !!(window.__shrinkApplyDetail && window.__shrinkLive?.root && window.__shrinkShrinkTarget !== 0);
  async function shrinkModelInner() {
    const source = $('autoBtn');
    const btn = $('v2ShrinkBtn');
    const card = $('v2ShrinkCard');
    if (!source || source.disabled || !btn) return;
    btn.disabled = true;
    markStep(3, 'active');
    progress(card, 5, 'Preparing the current working model…');
    // Was the model clean going in? If so, a reduction that leaves it unclean is a side effect we should put right.
    let wasClean = null;
    try {
      const before = sourceModel();
      const known = lastHealth && lastHealth.model === before ? lastHealth.h : window.__shrinkPrintSafety?.topologySummary?.(before);
      wasClean = known ? known.clean === true : null;
    } catch { wasClean = null; }
    try {
      // v2.283: A second automatic SHRINK must not progressively shrink an already
      // reduced mesh. Rebase on the original so printer-based quality remains meaningful.
      const original = app()?.originalModel;
      if (original && appliedChanges.has('shrunk') && sourceModel() !== original) {
        setWorkingModel(original);
        clearApplied();
        wasClean = null;
      }
      if (window.__shrinkLiveUI?.rebaseWorking) await window.__shrinkLiveUI.rebaseWorking(sourceModel());
      window.__shrinkLive?.setTidy?.(wasClean === true);
    } catch (err) {
      btn.disabled = false;
      progress(card, 100, 'Could not prepare the current model.');
      $('v2ShrinkResult').innerHTML = `<strong>Could not SHRINK</strong><span>${err.message}</span>`;
      return;
    }
    // v2.331: SHRINK keeps a fixed share of the triangles (50% unless `window.__shrinkShrinkTarget` says otherwise; 0 = the old automatic search),
    // because the automatic search lost too much detail. The share goes through the same path as the Detail slider, so the slider reads it and can be moved afterwards.
    const target = fixedShrinkReady() ? Math.max(1, Math.min(100, Number(window.__shrinkShrinkCap) || 100, window.__shrinkShrinkTarget ?? 50)) : null;
    let pct = 8;
    if (target) { progress(card, 8, `Keeping ${target}% of the triangles…`); $('v2ShrinkResult').textContent = `SHRINK is keeping ${target}% of the triangles.`; }
    else { progress(card, 8, 'Finding the smallest version that still looks the same…'); $('v2ShrinkResult').textContent = 'SHRINK is testing different detail levels automatically.'; source.click(); }
    const timer = setInterval(() => {
      pct = Math.min(88, pct + 4);
      progress(card, pct, target ? 'Reducing…' : 'Comparing shape and detail…');
    }, 450);
    try {
      if (target) {
        await window.__shrinkApplyDetail(target, 'shrink');
        await new Promise(res => {                       // the reducer starts on a timer: wait for its busy -> idle, or carry on if it never started (the value did not change)
          let started = false; const off = () => { window.removeEventListener('shrink:live-busy', on); clearTimeout(t0); clearTimeout(t1); },
            on = e => { if (e.detail?.busy) { started = true; clearTimeout(t0); } else if (started) { off(); res(); } },
            t0 = setTimeout(() => { off(); res(); }, 2500), t1 = setTimeout(() => { off(); res(); }, 240000);
          window.addEventListener('shrink:live-busy', on);
        });
        detailManual = true;
      } else {
        for (let i = 0; i < 600; i++) {
          await wait(100);
          if (!source.disabled) break;
        }
      }
      const live = $('liveLine')?.innerText?.replace(/\s+/g, ' ').trim() || '';
      const verdict = $('verdictText')?.textContent || '';
      const reducedRoot = window.__shrinkLive?.root || app()?.optimizedModel;
      if (reducedRoot) setWorkingModel(reducedRoot);
      window.__shrinkEnforceMinHeight?.(); // An automatic height must survive model replacement during SHRINK.
      markApplied('shrunk');
      shrinkReady = true;
      $('v2ResizeBtn')?.classList.remove('glow');
      // The simplifier does not promise to keep a mesh manifold: on a model made of many small pieces it can leave a few
      // edges shared by three triangles. If the model was clean before SHRINK, put that right with the same gentle repair as FIX IT.
      const tidied = window.__shrinkLive?.last?.tidied || 0;
      const tidyNote = tidied ? ` · Tidied ${tidied} edge${tidied === 1 ? '' : 's'} the reduction disturbed.` : '';
      progress(card, 100, 'Done.');
      $('v2ShrinkResult').innerHTML = `<strong>✓ ${verdict || 'Optimised'}</strong><span>${live}${tidyNote}</span>`;
      card.dataset.state = 'good';
      markStep(3, 'done');
      markStep(4, 'active');
      setTimeout(updateHealthCard, 80);
    } finally {
      clearInterval(timer);
      btn.disabled = false;
    }
  }


  // ---- QUICK-FIX (top right): shrink, fix, fuse and centre in one go, each step only if it can ----

  // ---- lay the model flat and square to the grid (before centring) ----
  // Finds the flattest, most stable face within 50 degrees of "down", turns the model so that face sits on the bed, then
  // turns it about the vertical so its long side runs along X. Never flips a model more than 50 degrees (a standing figure stays standing).
  function levelModel() {
    const THREE = app()?.THREE, model = sourceModel();
    if (!THREE || !model) return { ok: false, text: 'nothing to level' };
    model.updateWorldMatrix(true, true);
    const tris = []; let total = 0;
    model.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) total += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
    const stride = Math.max(1, Math.ceil(total / 40000));
    let k = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    model.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count / 3 : pos.count / 3, m = o.matrixWorld;
      for (let t = 0; t < n; t++, k++) {
        if (k % stride) continue;
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    });
    const T = tris.length / 9; if (T < 4) return { ok: false, text: 'nothing to level' };
    const P = Float32Array.from(tris), N = new Float32Array(T * 3), A = new Float32Array(T);
    let lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
    for (let t = 0; t < T; t++) {
      const o = t * 9, ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2], vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l; A[t] = l / 2;
      for (let q = 0; q < 3; q++) for (let e = 0; e < 3; e++) { const v = P[o + q * 3 + e]; if (v < lo[e]) lo[e] = v; if (v > hi[e]) hi[e] = v; }
    }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, EPS = 0.012;
    const score = (d, epsF = EPS) => {
      const eps = diag * epsF;   // d = unit "down" direction
      let mx = -1e30, mn = 1e30;
      for (let t = 0; t < T; t++) for (let q = 0; q < 3; q++) { const o = t * 9 + q * 3, h = P[o] * d[0] + P[o + 1] * d[1] + P[o + 2] * d[2]; if (h > mx) mx = h; if (h < mn) mn = h; }
      let contact = 0, proj = 0, nsum = [0, 0, 0];
      for (let t = 0; t < T; t++) {
        const o = t * 9, h0 = P[o] * d[0] + P[o + 1] * d[1] + P[o + 2] * d[2], h1 = P[o + 3] * d[0] + P[o + 4] * d[1] + P[o + 5] * d[2], h2 = P[o + 6] * d[0] + P[o + 7] * d[1] + P[o + 8] * d[2];
        const dn = N[t * 3] * d[0] + N[t * 3 + 1] * d[1] + N[t * 3 + 2] * d[2];
        proj += A[t] * Math.abs(dn) * 0.5;
        if (mx - h0 < eps && mx - h1 < eps && mx - h2 < eps && Math.abs(dn) > 0.8) { const sg = dn < 0 ? -1 : 1; contact += A[t]; nsum[0] += sg * N[t * 3] * A[t]; nsum[1] += sg * N[t * 3 + 1] * A[t]; nsum[2] += sg * N[t * 3 + 2] * A[t]; }
      }
      const height = Math.max(mx - mn, diag * 1e-3);
      return { s: (contact + 0.05 * proj) / height, contact, nsum };
    };
    const cur = [0, -1, 0], base = score(cur);
    let best = { s: base.s, d: cur, nsum: base.nsum, contact: base.contact };
    // coarse pass over directions within 50 deg of straight down (wide contact band), then hill-climb the best few with a narrowing band
    const cone = Math.cos(50 * Math.PI / 180), NS = 360, ga = Math.PI * (3 - Math.sqrt(5)), coarse = [];
    for (let i = 0; i < NS; i++) {
      const y = 1 - (i + 0.5) / NS * 2, r = Math.sqrt(1 - y * y), d = [Math.cos(i * ga) * r, y, Math.sin(i * ga) * r];
      if (-d[1] < cone) continue;
      coarse.push({ d, s: score(d, 0.1).s });
    }
    coarse.sort((x, y) => y.s - x.s);
    const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const inCone = d => -d[1] >= cone;
    for (const c0 of coarse.slice(0, 6)) {
      let d = c0.d, rad = 9 * Math.PI / 180, ef = 0.05, cs = score(d, ef).s;
      for (let round = 0; round < 8; round++) {
        const w = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = unit([d[1] * w[2] - d[2] * w[1], d[2] * w[0] - d[0] * w[2], d[0] * w[1] - d[1] * w[0]]);
        const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
        let bd = d, bs = cs;
        for (const rr of [0.5, 1]) for (let k2 = 0; k2 < 8; k2++) {
          const an = k2 * Math.PI / 4, off = rad * rr, cd = unit([d[0] + Math.tan(off) * (Math.cos(an) * u[0] + Math.sin(an) * v[0]), d[1] + Math.tan(off) * (Math.cos(an) * u[1] + Math.sin(an) * v[1]), d[2] + Math.tan(off) * (Math.cos(an) * u[2] + Math.sin(an) * v[2])]);
          if (!inCone(cd)) continue;
          const sc = score(cd, ef).s; if (sc > bs) { bs = sc; bd = cd; }
        }
        d = bd; rad *= 0.6; ef = Math.max(EPS, ef * 0.7); cs = score(d, ef).s;
      }
      const fin = score(d);
      if (fin.s > best.s) best = { s: fin.s, d, nsum: fin.nsum, contact: fin.contact };
    }
    let tiltDeg = 0, turned = false;
    if (best.d !== cur && best.s > base.s * 1.25) {
      let d = new THREE.Vector3(...best.nsum); if (d.lengthSq() < 1e-12) d = new THREE.Vector3(...best.d); d.normalize();   // exact plane of the contact faces
      const q = new THREE.Quaternion().setFromUnitVectors(d, new THREE.Vector3(0, -1, 0));
      tiltDeg = Math.acos(Math.min(1, Math.max(-1, d.y * -1))) * 180 / Math.PI;
      if (tiltDeg > 0.3) { rotateAboutCentre(model, q, THREE); turned = true; }
    }
    // square to the grid: long side along X
    model.updateWorldMatrix(true, true);
    const pts = []; model.traverse(o => { if (!o.isMesh || !o.geometry?.attributes?.position) return; const pos = o.geometry.attributes.position, st = Math.max(1, Math.ceil(pos.count / 30000)), v = new THREE.Vector3(); for (let i = 0; i < pos.count; i += st) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.z); } });
    let mxx = 0, mzz = 0, mxz = 0, ax = 0, az = 0; const np = pts.length / 2;
    for (let i = 0; i < np; i++) { ax += pts[i * 2]; az += pts[i * 2 + 1]; } ax /= np; az /= np;
    for (let i = 0; i < np; i++) { const x = pts[i * 2] - ax, z = pts[i * 2 + 1] - az; mxx += x * x; mzz += z * z; mxz += x * z; }
    const tr = mxx + mzz, det = Math.sqrt(Math.max(0, (mxx - mzz) ** 2 / 4 + mxz * mxz)), l1 = tr / 2 + det, l2 = tr / 2 - det;
    let yawDeg = 0;
    if (l2 <= 0 || l1 / l2 > 1.15) {
      const th = 0.5 * Math.atan2(2 * mxz, mxx - mzz); yawDeg = th * 180 / Math.PI;
      if (Math.abs(yawDeg) > 1) rotateAboutCentre(model, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), th), THREE); else yawDeg = 0;
    }
    const bits = []; if (turned) bits.push(`tilted ${tiltDeg.toFixed(0)}° to sit flat`); if (yawDeg) bits.push(`turned ${Math.abs(yawDeg).toFixed(0)}° to line up with the grid`);
    return { ok: true, text: bits.length ? bits.join(' and ') : 'already sitting flat and square', changed: bits.length > 0, tiltDeg, yawDeg };
  }
  // World-space helpers: the working model may sit inside a parent with its own scale/rotation, so never add world offsets to .position directly
  // Compare needs the untouched original in the same place as the working model. Every move / turn / stretch of the working model root
  // adds its change to poseD, and app.js applies poseD to the original while Compare is on (it removes it again afterwards).
  let poseD = null;
  function notePose(model, fn) {
    model.updateWorldMatrix(true, true); const m0 = model.matrixWorld.clone();
    fn();
    model.updateWorldMatrix(true, true); const delta = model.matrixWorld.clone().multiply(m0.invert());
    poseD = poseD ? delta.multiply(poseD) : delta;
  }
  window.__shrinkComparePose = () => (poseD && poseD.elements.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-9)) ? poseD.clone() : null;
  function moveWorld(model, dWorld, THREE) { notePose(model, () => moveWorldRaw(model, dWorld, THREE)); }
  function rotateAboutCentre(model, qWorld, THREE) { notePose(model, () => rotateAboutCentreRaw(model, qWorld, THREE)); }
  function moveWorldRaw(model, dWorld, THREE) {
    model.updateWorldMatrix(true, false);
    const pw = model.getWorldPosition(new THREE.Vector3()), target = pw.clone().add(dWorld);
    if (model.parent) { model.parent.updateWorldMatrix(true, false); model.position.copy(model.parent.worldToLocal(target)); } else model.position.copy(target);
    model.updateWorldMatrix(true, true);
  }
  function rotateAboutCentreRaw(model, qWorld, THREE) {
    model.updateWorldMatrix(true, true);
    const c = new THREE.Box3().setFromObject(model, true).getCenter(new THREE.Vector3());
    const pw = model.getWorldPosition(new THREE.Vector3()), newPw = pw.sub(c).applyQuaternion(qWorld).add(c);
    if (model.parent) {
      model.parent.updateWorldMatrix(true, false);
      const pq = model.parent.getWorldQuaternion(new THREE.Quaternion());
      model.quaternion.premultiply(pq).premultiply(qWorld).premultiply(pq.clone().invert());
      model.position.copy(model.parent.worldToLocal(newPw));
    } else { model.quaternion.premultiply(qWorld); model.position.copy(newPw); }
    model.updateWorldMatrix(true, true);
  }
  window.__shrinkLevel = () => levelModel();
  function centreOnBed() {
    const model = sourceModel(), THREE = app()?.THREE;
    if (!model || !THREE) return { ok: false, text: 'nothing to centre' };
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model, true);
    if (box.isEmpty()) return { ok: false, text: 'nothing to centre' };
    const c = box.getCenter(new THREE.Vector3()), d = new THREE.Vector3(-c.x, -box.min.y, -c.z);
    if (d.length() < 1e-6) return { ok: true, text: 'already centred and flat on the bed' };
    moveWorld(model, d, THREE);
    // keep the view on the model: move the camera and orbit target by the same shift
    const v = window.__shrinkViewer;
    if (v?.camera && v?.controls) {
      v.camera.position.add(d); v.controls.target.add(d); v.camera.updateMatrixWorld(true); v.controls.update?.();
    }
    model.visible = true;
    return { ok: true, text: 'centred, with its base flat on the bed' };
  }

  // ---- manual TURN pad (v2.161): turn, tip or lean the model by hand before DOWNLOAD. Always about the model's centre, then back flat on the bed ----
  function turnModel(axisName, deg) {
    const model = sourceModel(), THREE = app()?.THREE; if (!model || !THREE) return false;
    const st = model.userData.shrinkStretch;
    if (st && (st.x !== 1 || st.z !== 1)) { app()?.setStatus?.('Turn needs the model unstretched: tick Uniform, or press the width and depth back to normal, then turn it.', true); return false; }
    const axis = axisName === 'y' ? new THREE.Vector3(0, 1, 0) : axisName === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    rotateAboutCentre(model, new THREE.Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180), THREE);
    reducedTick++; window.__shrinkStretchTick = (window.__shrinkStretchTick || 0) + 1;
    centreOnBed(); setTimeout(refreshDims, 50);
    try { showBedGuide(); } catch (e) { console.warn('bed guide', e); }
    return true;
  }
  window.__shrinkTurn = turnModel;
  function ensureTurnPad() {
    const viewer = $('viewer'); if (!viewer || $('v2TurnPad')) return;
    const pad = document.createElement('div'); pad.id = 'v2TurnPad'; pad.className = 'v2-turn';
    pad.innerHTML = `<b>TURN</b>
      <div class="v2-turn-row" title="Turn about the upright axis (green Y)"><button type="button" data-turn="y" data-sign="1" aria-label="Turn left">↺</button><button type="button" data-turn="y" data-sign="-1" aria-label="Turn right">↻</button></div>
      <small>Turn</small>
      <div class="v2-turn-row" title="Tip forward or back (about the red X arrow)"><button type="button" data-turn="x" data-sign="-1" aria-label="Tip forward">⤓</button><button type="button" data-turn="x" data-sign="1" aria-label="Tip back">⤒</button></div>
      <small>Tip</small>
      <div class="v2-turn-row" title="Lean left or right (about the blue Z arrow)"><button type="button" data-turn="z" data-sign="1" aria-label="Lean left">⇠</button><button type="button" data-turn="z" data-sign="-1" aria-label="Lean right">⇢</button></div>
      <small>Lean</small>
      <select id="v2TurnStep" aria-label="Step size"><option value="5">5°</option><option value="15" selected>15°</option><option value="45">45°</option><option value="90">90°</option></select>
      <small class="v2-turn-note">Front = blue Z arrow, up = green Y</small>`;
    viewer.appendChild(pad);
    pad.addEventListener('click', e => { const b = e.target.closest('[data-turn]'); if (!b) return; turnModel(b.dataset.turn, Number(b.dataset.sign) * (Number($('v2TurnStep').value) || 15)); });
    ['pointerdown', 'wheel'].forEach(t => pad.addEventListener(t, e => e.stopPropagation()));
  }

  // ---- matrix-style print bed + X/Y/Z arrows, shown once the model is centred ----
  function removeBedGuide() {
    const v = window.__shrinkViewer; if (!v) return;
    const g = v.scene.getObjectByName('shrinkBedGuide');
    if (g) {
      v.scene.remove(g);
      g.traverse(o => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
    }
    v.scene.children.forEach(o => { if (o.isGridHelper && o.userData._shrinkHidden) { o.visible = true; delete o.userData._shrinkHidden; } });
  }
  function showBedGuide() {
    const THREE = app()?.THREE, v = window.__shrinkViewer, model = sourceModel();
    if (!THREE || !v || !model) return;
    removeBedGuide();
    model.updateWorldMatrix(true, true);
    const mbox = new THREE.Box3().setFromObject(model, true), size = mbox.getSize(new THREE.Vector3()), mid = mbox.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, size.y * 0.8, 1e-6);
    const pow = Math.pow(10, Math.floor(Math.log10(span / 8)));
    const cell = [1, 2, 5, 10].map(m => m * pow).find(c => span * 1.7 / c <= 24) || 10 * pow;
    const half = Math.max(4, Math.ceil(span * 0.85 / cell)) * cell, n = Math.round(half * 2 / cell);
    const g = new THREE.Group(); g.name = 'shrinkBedGuide';
    const grid = new THREE.GridHelper(half * 2, n, 0x39ff7a, 0x14994a);
    grid.material.transparent = true; grid.material.opacity = 0.55; grid.material.depthWrite = false;
    grid.position.y = -span * 0.0005; g.add(grid);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshBasicMaterial({ color: 0x021a0c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = -span * 0.001; g.add(plane);
    const len = span * 0.7, head = len * 0.16;
    const axes = new THREE.Group(); axes.name = 'shrinkAxes'; axes.position.copy(mid); g.add(axes);      // the X/Y/Z arrows start at the middle of the whole model (v2.163)
    const label = (txt, col, pos) => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = col; x.fillText(txt, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
      sp.scale.setScalar(len * 0.16); sp.position.copy(pos); sp.renderOrder = 10; axes.add(sp);
    };
    [['X', 0xff4d4d, '#ff6b6b', new THREE.Vector3(1, 0, 0)], ['Y', 0x4dff7a, '#7dff9d', new THREE.Vector3(0, 1, 0)], ['Z', 0x4d9bff, '#7db4ff', new THREE.Vector3(0, 0, 1)]].forEach(([t, hex, css, dir]) => {
      const a = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), len, hex, head, head * 0.55);
      a.line.material.depthTest = false; a.cone.material.depthTest = false; a.renderOrder = 9; a.line.renderOrder = 9; a.cone.renderOrder = 9; axes.add(a);
      label(t, css, dir.clone().multiplyScalar(len + head * 1.1));
    });
    v.scene.add(g);
    v.scene.children.forEach(o => { if (o.isGridHelper && o.parent === v.scene) { o.userData._shrinkHidden = true; o.visible = false; } });
  }
  window.__shrinkBedGuide = { show: showBedGuide, remove: removeBedGuide };
  window.__shrinkCentre = () => centreOnBed();
  // Front view (v2.162): QUICK-FIX ends with the camera on the +Z side, so the blue Z arrow of the plate points at the person and the model's front faces them.
  function faceFront() {
    const model = sourceModel(), THREE = app()?.THREE, v = window.__shrinkViewer;
    if (!model || !THREE || !v?.camera || !v?.controls) return false;
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model, true); if (box.isEmpty()) return false;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const cam = v.camera, fov = (cam.fov || 45) * Math.PI / 180, aspect = cam.aspect || 1.5, el = 20 * Math.PI / 180;
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el)), right = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, Math.cos(el), -Math.sin(el));
    const corners = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    let dist = Math.max(size.x, size.y, size.z, 1e-6) / (2 * Math.tan(fov / 2)) * 2, target = c.clone();
    // the health box (left) and the TURN pad (right) cover about 250px at each side of the window, so a wide model is kept narrower than that
    const W = v.renderer?.domElement?.clientWidth || 900, hxLimit = Math.max(0.5, Math.min(0.84, 1 - 500 / W));
    const place = () => { cam.near = Math.max(dist / 1000, 1e-6); cam.far = dist * 1000; cam.position.copy(target).addScaledVector(dir, dist); cam.up.set(0, 1, 0); cam.lookAt(target); cam.updateProjectionMatrix?.(); cam.updateMatrixWorld(true); };
    // Fit so the whole model fills about 84% of the window and sits exactly in the middle: measure where the 8 corners land on screen, then nudge and zoom (a few rounds settle it)
    for (let i = 0; i < 8; i++) {
      place();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of corners) { const n = p.clone().project(cam); x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.max((x1 - x0) / 2 / hxLimit, (y1 - y0) / 2 / 0.84, 1e-6);
      const hh = dist * Math.tan(fov / 2), hw = hh * aspect;
      target.addScaledVector(right, cx * hw).addScaledVector(up, cy * hh);
      dist *= half;
    }
    place(); v.controls.target.copy(target); v.controls.update?.();
    return true;
  }
  window.__shrinkFaceFront = faceFront;
  // The same finishing view QUICK-FIX ends with, for a model that was just opened (BATCH row click): centred on the plate, XYZ arrows, front view.
  window.__shrinkPlatePreview = () => { try { const cr = centreOnBed(); if (cr.ok) showBedGuide(); faceFront(); return true; } catch (e) { console.warn('plate preview', e); return false; } };
  const FIX_FIRST_MAX = 600000;
  async function shrinkMyModel() {
    ensureHealthCard(); const btn = $('v2MagicBtn'), note = $('v2MagicNote');
    if (!btn || btn.disabled || !sourceModel()) return;
    btn.disabled = true; btn.dataset.busy = '1'; setWorking(true);
    autoReady = false; settingsDirty = false; detailUpdating = false; updateWorkflowButtons();
    const label = 'AUTO-SHRINK'; { const dl = $('v2MagicDownload'); if (dl) dl.disabled = true; }
    window.__shrinkLastVerdict = null; let verdict = null; const rows = []; const show = (busy) => { note.hidden = false; note.innerHTML = rows.map(r => `<div class="${r.cls}"><i>${r.icon}</i><span>${r.text}</span></div>`).join('') + (busy ? `<div class="busy"><i>…</i><span>${busy}</span></div>` : '') + '<button type="button" class="v2-magic-x" aria-label="Close" title="Close">×</button>'; };
    const done = (cls, icon, text) => { rows.push({ cls, icon, text }); show(); };
    try {
      const startTris = modelTriangles(sourceModel());
      // 0. REPAIR FIRST, at full detail (v2.147). Shrinking a model that still has holes bakes the holes into a coarse mesh that is much harder to
      //    close, so a model under FIX_FIRST_MAX triangles is repaired before it is reduced. Bigger ones are shrunk first (repair runs on the main thread).
      if (startTris <= FIX_FIRST_MAX) {
        btn.textContent = '1/4 Fixing…'; show('Checking and repairing at full detail…'); await updateHealthCard(); await paintNow();
        if ($('v2HealthScore')?.textContent !== '100' || window.__shrinkClay?.hasClay?.()) {
          try {
            await fixHealthModel(); await wait(60);
            const sc0 = Number($('v2HealthScore')?.textContent);
            done(sc0 === 100 ? 'ok' : 'warn', sc0 === 100 ? '✓' : '⚠', sc0 === 100 ? 'Repaired at full detail before shrinking' : `Repaired what it could at full detail (health ${Number.isFinite(sc0) ? sc0 + '/100' : 'unknown'})`);
          } catch (err) { done('warn', '⚠', `Could not repair first (${err.message || err})`); }
        }
      }
      // 1. SHRINK
      btn.textContent = '1/4 Shrinking…'; show('Shrinking…'); await paintNow();
      try { await shrinkModel(); const now = modelTriangles(sourceModel()); done('ok', '✓', `Shrunk: ${startTris.toLocaleString()} → ${now.toLocaleString()} triangles`); }
      catch (err) { done('warn', '⚠', `Could not shrink (${err.message || err})`); }
      // 1b. Too detailed to fuse (v2.185). 16K ultra can leave millions of triangles, and FUSE is refused above the limit. Step down one detail level at a time
      //     (16K, 8K fine, 8K, 4K) and shrink again until it fits, and say so. The file name tag then shows the level that was really used.
      const fuseLimit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES; let loweredFrom = null;
      if (modelTriangles(sourceModel()) > fuseLimit && fixedShrinkReady()) {         // v2.331: a fixed share cannot step down the printer ladder, so keep just enough triangles to fuse
        const o = modelTriangles(app()?.originalModel || sourceModel()) || 1, cap = Math.max(1, Math.floor(fuseLimit * 0.9 / o * 1000) / 10);
        btn.textContent = '1/4 Shrinking more…'; show(`Still ${modelTriangles(sourceModel()).toLocaleString()} triangles: too many to fuse. Keeping ${cap}% instead…`); await paintNow(); window.__shrinkShrinkCap = cap;
        try { await shrinkModel(); } catch (err) { console.warn('second shrink', err); } finally { window.__shrinkShrinkCap = null; }
        const now = modelTriangles(sourceModel()); done(now > fuseLimit ? 'warn' : 'ok', now > fuseLimit ? '⚠' : '✓', `Shrunk further for fusing: ${cap}% kept (${now.toLocaleString()} triangles)`);
      } else if (modelTriangles(sourceModel()) > fuseLimit && dashboard) {
        const type0 = dashboard.dataset.printerType || 'resin', ladder = ['ultra', 'fine', 'standard', 'large'].filter(k => PRINTER_LIST.some(x => x.type === type0 && x.quality === k)), q0 = dashboard.dataset.quality || 'standard'; 
        const from = currentPrinter(); let at = ladder.indexOf(q0);
        while (at >= 0 && at < ladder.length - 1 && modelTriangles(sourceModel()) > fuseLimit && type0 !== 'custom') {
          at++;
          loweredFrom = loweredFrom || from; setQuality(ladder[at]);
          btn.textContent = '1/4 Shrinking more…'; show(`Still ${modelTriangles(sourceModel()).toLocaleString()} triangles: too many to fuse. Shrinking more (${currentPrinter().tag})…`); await paintNow();
          try { await shrinkModel(); } catch (err) { console.warn('second shrink', err); break; }
        }
        if (loweredFrom) {
          try { localStorage.setItem(PRINTER_KEY, JSON.stringify({ type: type0, quality: q0 })); } catch { /* nothing to remember */ }   // the next model starts from your own choice again
          const now = modelTriangles(sourceModel());
          done(now > fuseLimit ? 'warn' : 'ok', now > fuseLimit ? '⚠' : '✓', `Shrunk further for fusing: printer detail went from ${loweredFrom.tag} to ${currentPrinter().tag} (${now.toLocaleString()} triangles)`);
        }
      }
      // 2. FIX (only if the health check says something is wrong)
      btn.textContent = '2/4 Fixing…'; show('Checking and fixing…'); await updateHealthCard(); await paintNow();
      if ($('v2HealthScore')?.textContent === '100' && !window.__shrinkClay?.hasClay?.()) done('ok', '✓', 'Already clean: nothing to fix');
      else {
        await fixHealthModel(); await wait(60);
        // v2.251: one repair pass can leave a few open edges (Tamara in a batch: health 45, 14 open edges; Tarak: 95 with 9 flipped faces and then fuse failed). Try again while it keeps improving and is below 100, at most twice more.
        for (let extra = 0; extra < 2 && Number($('v2HealthScore')?.textContent) < 100; extra++) {
          const before = Number($('v2HealthScore')?.textContent); show('Not perfectly clean yet: repairing again…'); await paintNow();
          try { await fixHealthModel(); await wait(60); } catch (e) { console.warn('extra repair pass', e); break; }
          if (!(Number($('v2HealthScore')?.textContent) > before)) break;
        }
        const sc = Number($('v2HealthScore')?.textContent);
        done(sc === 100 ? 'ok' : 'warn', sc === 100 ? '✓' : '⚠', sc === 100 ? 'Fixed: the model is watertight' : `Fixed what could be fixed (health ${Number.isFinite(sc) ? sc + '/100' : 'unknown'})`);
      }
      if (!(Number($('v2HealthScore')?.textContent) >= 95)) done('warn', '⚠', 'Still not fully sealed. Detail was kept, nothing was rebuilt.');
      // 3. FUSE
      btn.textContent = '3/4 Fusing…'; show('Fusing…'); await paintNow();
      const fc = $('v2FuseCard'); if (fc) fc.dataset.state = '';
      await fuseCheck(); await wait(60);
      const fs = fc?.dataset.state;
      done(fs === 'good' ? 'ok' : 'warn', fs === 'good' ? '✓' : '⚠', fs === 'good' ? 'Fused: touching parts joined' : 'Could not fuse this model (see the Fuse box). It is still fixed and shrunk');
      // The verdict (v2.185): said plainly, and kept in the health box (Separate pieces row) because the step list above is hidden.
      await updateHealthCard(); await wait(80);
      let pieces = null; for (let i = 0; i < 40 && !pieces; i++) { pieces = Number($('v2HealthRows')?.dataset.pieces) || null; if (!pieces) await wait(50); }
      const healthy = lastHealth?.h ? (lastHealth.h.clean === true || minorCount(lastHealth.h) > 0) : Number($('v2HealthScore')?.textContent) >= 95, oneSolid = pieces === 1;   // degenerate triangles alone do not make a model unfixed (v2.189)
      const why = modelTriangles(sourceModel()) > fuseLimit ? 'it still has too many triangles to fuse' : fs === 'good' ? 'the pieces do not all touch' : 'the fuse step could not finish (see the Fuse box)';
      // v2.253: already ONE watertight piece but Manifold refuses it (a few flipped faces, Tarak): there is nothing to fuse, and slicers take it. Not a failure.
      const alreadyOne = oneSolid && fs !== 'good' && healthy && lastHealth?.h && !(lastHealth.h.openEdges > 0) && modelTriangles(sourceModel()) <= fuseLimit;
      if (alreadyOne) { const i = rows.findIndex(r => /Could not fuse/.test(r.text)); if (i >= 0) rows[i] = { cls: 'ok', icon: '✓', text: 'Already one solid piece: nothing to fuse' }; }
      verdict = { healthy, pieces, fused: oneSolid && (fs === 'good' || alreadyOne), text: (healthy ? 'FIXED' : 'NOT FULLY FIXED') + ' · ' + (oneSolid && fs === 'good' ? 'FUSED into one solid' : alreadyOne ? 'ONE SOLID PIECE (nothing to fuse)' : oneSolid ? 'ONE PIECE, but the fuse step could not finish (see the Fuse box)' : pieces ? `NOT FUSED: ${pieces} separate pieces (${why})` : `fuse not confirmed (${why})`) };
      // 4. CENTRE
      btn.textContent = '4/4 Levelling…'; show('Levelling and centring…'); await paintNow();
      try { if (resetStretch()) done('ok', '✓', 'Width and depth set back to the original proportions'); } catch (e) { console.warn('stretch reset', e); }
      let lv = null; try { lv = levelModel(); } catch (e) { console.warn('level', e); }
      if (lv?.ok && lv.changed) done('ok', '✓', `Model ${lv.text}`);
      reducedTick++; const cr = centreOnBed(); setTimeout(refreshDims, 50); if (cr.ok) { try { showBedGuide(); } catch (e) { console.warn('bed guide', e); } } try { faceFront(); } catch (e) { console.warn('front view', e); } done(cr.ok ? 'ok' : 'warn', cr.ok ? '✓' : '⚠', cr.ok ? `Model ${cr.text}` : `Could not centre: ${cr.text}`);
      // 5. HOLLOW (v2.302): only when the box under AUTO-SHRINK is ticked. Last, because the drain holes go in the lowest point of the (now levelled) model.
      if ($('v2AutoHollow')?.checked && HOLLOW_ON) {
        btn.textContent = 'Hollowing…'; show('Hollowing to save resin…'); await paintNow();
        try {
          await hollowModelNow();
          const ok = $('v2HollowCard')?.dataset.state === 'good', msg = ($('v2HollowResult')?.textContent || '').replace(/\s+/g, ' ').trim();
          done(ok ? 'ok' : 'warn', ok ? '✓' : '⚠', ok ? msg.replace(/^✓\s*/, '') : (msg || 'Could not hollow this model'));
        } catch (e) { console.warn('auto hollow', e); done('warn', '⚠', 'Could not hollow this model'); }
      }
      window.__shrinkLastVerdict = verdict;
      if (verdict) { rows.push({ cls: verdict.healthy && verdict.fused ? 'ok' : 'warn', icon: verdict.healthy && verdict.fused ? '✓' : '⚠', text: verdict.text }); note.dataset.verdict = verdict.healthy && verdict.fused ? 'ok' : 'warn'; }
      rows.push({ cls: 'end', icon: '', text: 'Ready: press Download when you are happy.' }); show();
      markStep?.(4, 'active');
      markWorkflowReady();
    } catch (err) {
      console.error('[SHRINK 3D] SHRINK MY MODEL failed', err);
      done('warn', '⚠', `Stopped: ${err.message || err}`);
    } finally {
      try { await updateHealthCard(); } catch (e) { console.warn('health refresh', e); }      // show the final result in one go, not the in-between checks
      setWorking(false);
      delete btn.dataset.busy; btn.disabled = false; btn.textContent = label;
      updateWorkflowButtons();
    }
  }


  // ---- diagnostic report (v2.188): one button copies everything needed to see what the page is really doing ----
  const logRing = []; for (const k of ['warn', 'error']) { const orig = console[k].bind(console); console[k] = (...a) => { try { logRing.push(k + ': ' + a.map(x => (x && x.message) || (typeof x === 'object' ? JSON.stringify(x).slice(0, 200) : String(x))).join(' ').slice(0, 300)); if (logRing.length > 40) logRing.shift(); } catch {} orig(...a); }; }
  async function diagReport() {
    const L = []; const add = (k, v) => L.push(`${k}: ${v}`);
    const model = sourceModel(); add('Height input (mm)', $('v2Height')?.value); add('Native export height (mm)', nativeValue('figureHeightMm', '?')); add('Height sizing', manualHeight ? 'manual' : 'automatic'); add('SHRINK release', document.querySelector('.version-badge')?.textContent || '?'); add('When', new Date().toISOString());
    add('Browser', navigator.userAgent); add('Printer', `${currentPrinter().tag} (${dashboard?.dataset.printerType}/${dashboard?.dataset.quality})`);
    add('fuse-export build', window.__shrinkFuseBuild || 'OLD (the shell-splitting fuse is NOT loaded: hard-refresh the page)');
    add('Fuse triangle limit', window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES);
    const tris = model ? modelTriangles(model) : 0; add('Working model triangles', tris.toLocaleString());
    add('Shrink applied', !!shrinkReady); add('Applied chips', [...appliedChanges].join(', ') || 'none'); add('Last fuse', JSON.stringify(window.__shrinkLastFuse || 'not run this session')); add('Last Make watertight', JSON.stringify(window.__shrinkLastWatertight || 'not run this session'));
    add('Health score', $('v2HealthScore')?.textContent); add('Health rows', [...document.querySelectorAll('#v2HealthRows .v2-health-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    const np = await countPieces(model); add('Separate pieces now', np); add('Triangles per piece (largest first)', (window.__shrinkPieceInfo || []).slice(0, 15).join(', '));
    add('Fuse card says', ($('v2FuseResult')?.textContent || '').replace(/\s+/g, ' ').trim()); add('Last verdict', JSON.stringify(window.__shrinkLastVerdict || null));
    try { const b = new THREE_().Box3().setFromObject(model, true), s = b.getSize(new (THREE_().Vector3)()); add('Size mm-ish (units)', [s.x, s.y, s.z].map(x => x.toFixed(2)).join(' x ')); } catch {}
    add('Recent console warnings/errors', logRing.length ? '\n  ' + logRing.slice(-25).join('\n  ') : 'none');
    return L.join('\n');
  }
  const THREE_ = () => app()?.THREE;
  window.__shrinkDiagReport = diagReport;
  // v2.245: a small synchronous snapshot for the batch's secret diagnostic (one per file)
  window.__shrinkSnap = () => {
    const o = {}; try {
      const m = sourceModel(), orig = app()?.originalModel;
      o.trisNow = m ? modelTriangles(m) : null; o.trisOriginal = orig ? modelTriangles(orig) : null;
      o.printer = currentPrinter()?.tag; o.type = dashboard?.dataset.printerType; o.quality = dashboard?.dataset.quality;
      o.nativeExportHeightMm = nativeValue('figureHeightMm', null); o.heightSizing = manualHeight ? 'manual' : 'automatic'; o.heightInputMm = $('v2Height')?.value; o.widthMm = $('v2Width')?.value; o.depthMm = $('v2Depth')?.value; o.uniform = $('v2Uniform')?.checked;
      o.detailSlider = $('v2Detail')?.value; o.shrinkApplied = !!shrinkReady; o.chips = [...appliedChanges].join(',');
      o.health = $('v2HealthScore')?.textContent; o.healthRows = [...document.querySelectorAll('#v2HealthRows .v2-health-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
      o.pieces = $('v2HealthRows')?.dataset.pieces || null; if (o.pieces) o.pieceTris = (window.__shrinkPieceInfo || []).slice(0, 8); o.shrinkNote = window.__shrinkShrinkNote || null;
      if (m) { const b = new (THREE_().Box3)().setFromObject(m, true), v = b.getSize(new (THREE_().Vector3)()); o.sizeUnits = [v.x, v.y, v.z].map(x => +x.toFixed(3)); }
      if (orig) { const b = new (THREE_().Box3)().setFromObject(orig, true), v = b.getSize(new (THREE_().Vector3)()); o.originalSizeUnits = [v.x, v.y, v.z].map(x => +x.toFixed(3)); o.originalMeshes = (() => { let n = 0; orig.traverse(x => { if (x.isMesh) n++; }); return n; })(); }
      o.liveLine = ($('liveLine')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200); o.verdictText = ($('verdictText')?.textContent || '').slice(0, 200);
      o.verdict = window.__shrinkLastVerdict || null; o.fuse = window.__shrinkLastFuse || null;
    } catch (e) { o.error = String(e?.message || e); }
    return o;
  };
  function ensureDiagButton() {
    const host = document.querySelector('#v2AdvTools'); if (!host || $('v2DiagRow')) return;
    const row = document.createElement('div'); row.id = 'v2DiagRow'; row.className = 'v2-diag-row';
    row.innerHTML = '<button id="v2DiagBtn" type="button" title="Copies a plain-text report of what this page is doing, to paste back to the developer.">COPY DIAGNOSTIC REPORT</button><small id="v2DiagNote"></small>';
    const grid = host.querySelector('.v2-action-grid'); if (grid) grid.before(row); else host.appendChild(row);
    $('v2DiagBtn').addEventListener('click', async () => {
      const note = $('v2DiagNote'); note.textContent = 'Collecting…';
      let text = ''; try { text = await diagReport(); } catch (e) { text = 'Report failed: ' + (e && e.message); }
      try { await navigator.clipboard.writeText(text); note.textContent = 'Copied. Paste it into the chat.'; }
      catch { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:8px;top:8px;width:60vw;height:40vh;z-index:9999'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); note.textContent = 'Copied. Paste it into the chat.'; } catch { note.textContent = 'Select all in the box and copy.'; } setTimeout(() => ta.remove(), 15000); }
    });
  }

  // v2.235: the big green SHRINK button and the "Reduced from…" note sit in one stack under the health box
  function sideStack() {
    const viewer = $('viewer'), card = $('v2HealthCard'); if (!viewer || !card) return null;
    let st = $('v2SideStack');
    if (!st) { st = document.createElement('div'); st.id = 'v2SideStack'; st.className = 'v2-side-stack'; viewer.appendChild(st); }
    const place = () => { st.style.top = (card.offsetTop + card.offsetHeight + 8) + 'px'; };
    place(); requestAnimationFrame(place);
    if (!st._ro && window.ResizeObserver) { st._ro = new ResizeObserver(place); st._ro.observe(card); }
    return st;
  }
  function ensureMagicButton() {
    if ($('v2MagicBtn')) return;
    const top = document.querySelector('.topbar'); if (!top) return;
    const wrap = document.createElement('div'); wrap.className = 'v2-magic-wrap';
    wrap.innerHTML = '<button id="v2MagicBtn" class="v2-magic" type="button" title="One press does it all: repairs, shrinks, joins touching pieces, turns the model flat and centres it on the bed. You do not need it: any tool on the left works on its own, in any order.">AUTO-SHRINK</button><button id="v2MagicDownload" class="v2-magic v2-magic-dl" type="button" disabled title="Available when automatic SHRINK or manual detail preview has finished. Downloads your finished model.">DOWNLOAD</button><button id="v2MagicReset" class="v2-magic v2-magic-reset" type="button" title="Choose a different model to load. Anything you have done to the current model is left behind.">RELOAD</button>';
    const pill = top.querySelector('.privacy-pill'); if (pill) top.insertBefore(wrap, pill); else top.appendChild(wrap);
    { ensureHealthCard(); const st = sideStack(); if (st) { const mb = $('v2MagicBtn'); mb.classList.add('v2-magic-side'); st.insertBefore(mb, st.firstChild);
      { const hr = $('v2Height')?.closest('.v2-size-row'), rb = $('v2ResizeBtn'); if (hr && !hr.closest('#v2SideStack')) { const box = document.createElement('div'); box.className = 'v2-side-height'; box.appendChild(hr); if (rb) box.appendChild(rb); st.insertBefore(box, mb); } }   // v2.330: Finished height (+ RESIZE) lives above the green SHRINK button, not in ADVANCED
      const dl = $('v2MagicDownload'); if (dl) { dl.classList.add('v2-magic-side'); st.insertBefore(dl, mb.nextSibling);
        { const lab = document.createElement('label'); lab.className = 'v2-auto-hollow'; lab.title = 'Also hollow the model to save resin (2 mm walls, 2 drain holes in the base) as the last step of AUTO-SHRINK. Fine-tune it in ADVANCED.'; lab.innerHTML = '<input id="v2AutoHollow" type="checkbox" autocomplete="off"> <span>Hollow it too (saves resin)</span>'; st.insertBefore(lab, mb.nextSibling); }   /* v2.302: off by default */
        const g = document.createElement('details'); g.id = 'v2SideGlb'; g.className = 'v2-side-glb';   // v2.236: "Other formats" menu (was the lone download GLB link)
        g.innerHTML = '<summary title="Convert the loaded model without AUTO-SHRINK (geometry only)">Other formats / Convert</summary><div class="v2-more-menu"><button type="button" data-fmt="glb">GLB</button><button type="button" data-fmt="obj">OBJ</button><button type="button" data-fmt="3mf">3MF</button><button type="button" data-fmt="usdz">USDZ</button></div>';
        g.addEventListener('click', e => {
          const b = e.target.closest('[data-fmt]'); if (!b) return;
          g.open = false;
          if (g.dataset.available !== 'yes' || !sourceModel()) return;
          window.__shrinkExportFormat?.(b.dataset.fmt);
        });
        st.insertBefore(g, dl.nextSibling); } } }   // v2.235: moves out of the top bar, under the health box
    $('v2MagicBtn').addEventListener('click', shrinkMyModel);
    { const status = document.createElement('small'); status.id = 'v2WorkflowStatus'; status.className = 'v2-workflow-status'; $('v2MagicDownload')?.insertAdjacentElement('afterend', status); updateWorkflowButtons(); }
    $('v2MagicReset').addEventListener('click', () => { const f = $('fileInput'); if (f) { f.value = ''; f.click(); } });
    $('v2MagicDownload').addEventListener('click', () => { const b = $('v2DownloadBtn'); if (b && !b.disabled) b.click(); });
  }

  let activePegCut = 0;

  // ---- peg report: plain words + colour for every peg, so a peg sticking out of the model is obvious ----
  function renderPegStatus() {
    const box = $('v2PegStatus'); if (!box) return;
    const split = window.__shrinkSplit;
    const mode = $('splitMode')?.value || 'off', pegsOn = ($('splitJoint')?.value || 'pegs') !== 'flat';
    const report = (mode !== 'off' && pegsOn) ? (split?.pegReport?.() || []) : [];
    const showBest = mode === '2';
    if ($('v2BestCutRow') && $('v2BestCutRow').hidden === showBest) $('v2BestCutRow').hidden = !showBest;
    let html = '';
    if (report.length) {
      const bad = report.filter(r => r.status === 'bad').length, warn = report.filter(r => r.status === 'warn').length;
      const multi = new Set(report.map(r => r.cut)).size > 1;
      const head = bad ? `<strong class="bad">${bad} peg${bad === 1 ? '' : 's'} stick${bad === 1 ? 's' : ''} out of the model — move ${bad === 1 ? 'it' : 'them'} or change the cut height. Pegs marked red are left out of the download.</strong>`
        : warn ? `<strong class="warn">${warn} peg${warn === 1 ? ' is' : 's are'} tight — check ${warn === 1 ? 'it' : 'them'} before printing.</strong>`
        : '<strong class="ok">All pegs fit inside the model.</strong>';
      const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const rows = report.map(r => `<div class="v2-peg-row ${r.status}"><i></i><b>${multi ? `Cut ${r.cut + 1} · ` : ''}Peg ${r.peg + 1}</b><span>${esc(r.text)}</span></div>`).join('');
      html = head + rows;
      if (bad || warn) html += '<p>Tip: turn on <em>Manual</em> in Advanced split settings and slide the peg, press <em>Snap pegs to safest spot</em>, or try <em>Find best cut</em>.</p>';
    } else if (mode !== 'off' && pegsOn) {
      html = '<strong class="warn">No safe place for pegs at this cut — the download will be a flat cut. Try a different cut height.</strong>';
    }
    if (box.innerHTML !== html) box.innerHTML = html;
    if (box.hidden !== !html) box.hidden = !html;
  }

  function refreshPegAxisControls() {
    const manual=$('v2PegPosition')?.value==='manual';
    if($('v2PegAxisPanel')) $('v2PegAxisPanel').hidden=!manual;
    if(!manual) return;

    const count=Math.max(1,window.__shrinkSplit?.cutCount?.()||1);
    activePegCut=Math.max(0,Math.min(count-1,activePegCut));
    const cutSel=$('v2PegCut');
    if(cutSel){
      const needed=Array.from({length:count},(_,i)=>`<option value="${i}">Cut ${i+1}</option>`).join('');
      if(cutSel.innerHTML!==needed) cutSel.innerHTML=needed;
      cutSel.value=String(activePegCut);
      $('v2PegCutWrap').hidden=count<=1;
    }

    const info=window.__shrinkSplit?.getManualPegControls?.(activePegCut);
    const pegs=info?.pegs||[];
    const setSlider=(id,value,enabled=true)=>{
      const el=$(id); if(!el)return;
      if(document.activeElement!==el && Number.isFinite(value)) el.value=String(value);
      el.disabled=!enabled;
    };
    setSlider('v2Peg1X',pegs[0]?.leftRight,!!pegs[0]);
    setSlider('v2Peg1Z',pegs[0]?.backForward,!!pegs[0]);
    setSlider('v2Peg2X',pegs[1]?.leftRight,!!pegs[1]);
    setSlider('v2Peg2Z',pegs[1]?.backForward,!!pegs[1]);
  }

  function movePegFromSlider(pegIndex,axis,id) {
    const value=Number($(id)?.value);
    if(!Number.isFinite(value)) return;
    const info=window.__shrinkSplit?.moveManualPegAxis?.(activePegCut,pegIndex,axis,value);
    const peg=info?.pegs?.[pegIndex];
    if(!peg) return;
    const xId=pegIndex===0?'v2Peg1X':'v2Peg2X', zId=pegIndex===0?'v2Peg1Z':'v2Peg2Z';
    if(document.activeElement!==$(xId)) $(xId).value=String(peg.leftRight);
    if(document.activeElement!==$(zId)) $(zId).value=String(peg.backForward);
  }

  function syncSplitControls() {
    const select = $('v2SplitMode');
    if (!select) return;
    const src = $('splitMode');
    if (src && select.value !== (src.value || 'off')) select.value = src.value || 'off';
    const joint = $('v2Joint');
    if (joint && $('splitJoint') && joint.value !== $('splitJoint').value) joint.value = $('splitJoint').value;
    const pegPos = $('v2PegPosition');
    if (pegPos && $('splitPegPosition') && pegPos.value !== $('splitPegPosition').value) pegPos.value = $('splitPegPosition').value;
    if ($('v2PegReset')) $('v2PegReset').hidden = !pegPos || pegPos.value !== 'manual';
    if ($('v2PegHelp')) $('v2PegHelp').hidden = !pegPos || pegPos.value !== 'manual';
    refreshPegAxisControls();
    renderPegStatus();
    // This runs from a MutationObserver on the whole page, so it must only write when something actually changed:
    // rewriting the same text re-triggers the observer and would loop forever.
    const set = (el, prop, value) => { if (el && el[prop] !== value) el[prop] = value; };
    { const badge = $('v2SplitBadge'), txt = select.value === 'off' ? '' : '· ' + (select.value === 'max' ? 'AUTO' : select.value + ' PARTS'); set(badge, 'textContent', txt); }
    const showCut = select.value === '2';
    set($('v2CutWrap'), 'hidden', !showCut);
    if (showCut && $('splitCutHeight')) {
      set($('v2Cut'), 'value', $('splitCutHeight').value);
      set($('v2CutLabel'), 'textContent', `${$('splitCutHeight').value}%`);
    }
    const maxWrap = $('v2MaxWrap');
    if (maxWrap) {
      set(maxWrap, 'hidden', select.value !== 'max');
      if (!maxWrap.hidden && $('splitMaxHeight') && document.activeElement !== $('v2MaxHeight')) set($('v2MaxHeight'), 'value', $('splitMaxHeight').value);
    }
  }

  function chooseSplit() {
    const mode = $('v2SplitMode')?.value || 'off';
    setNative('splitMode', mode, 'change');
    $('v2CutWrap').hidden = mode !== '2';
    if ($('v2MaxWrap')) $('v2MaxWrap').hidden = mode !== 'max';
    if (mode !== 'off') markStep(4, 'active');
  }

  function syncAdvancedToNative() {
    setNative('splitJoint', $('v2Joint')?.value || 'pegs', 'change');
    if ($('v2PegPosition')) setNative('splitPegPosition', $('v2PegPosition').value || 'auto', 'change');
    if ($('v2PegDiameter')) setNative('pegDiameter', $('v2PegDiameter').value, 'input');
    if ($('v2PegDepth')) setNative('pegDepth', $('v2PegDepth').value, 'input');
    if ($('v2PegClearance')) setNative('pegClearance', $('v2PegClearance').value, 'input');
    if ($('v2Zup')) setNative('zUpToggle', $('v2Zup').checked, 'change');
  }

  function download() {
    window.__shrinkEnforceMinHeight?.(); // Synchronise the native STL exporter before saving.
    syncAdvancedToNative();
    chooseSplit();
    // Fuse is an explicit tool (FUSE IT) that already advanced the working model. Download exports the current
    // working model as it is, or splits it. It must never switch Fuse on, or the Fuse export would swallow the split.
    if ($('fuseSolidToggle')) setNative('fuseSolidToggle', false, 'change');
    markStep(4, 'done');
    $('saveStlBtn')?.click();
    if ($('v2SavePieces')?.checked && (editPart || parked.length)) setTimeout(savePiecesFile, 400);   // v2.328: the solid STL as usual, plus the floating pieces in their own file
  }

  function buildMainCard() {
    const card = ensureHealthCard(), stack = dashboard.querySelector('.v2-left-stack'); if (!card || !stack || stack.querySelector('.v2-main-card')) return;
    const hold = document.createElement('div'); hold.className = 'v2-legacy-hold'; hold.hidden = true;
    const main = document.createElement('div'); main.className = 'v2-main-controls';
    const sizeBox = document.createElement('div'); sizeBox.className = 'v2-main-size';
    const setup = dashboard.querySelector('.v2-setup-card');
    ['.v2-size-row:not(.v2-dim-row)', '.v2-uniform-row', '.v2-dim-row'].forEach(q => { const el = setup?.querySelector(q); if (el) sizeBox.appendChild(el); });
    { const rb = document.createElement('button'); rb.type = 'button'; rb.id = 'v2ResizeBtn'; rb.className = 'v2-resize-btn'; rb.textContent = 'RESIZE';
      rb.title = 'Apply the new size, then press AUTO-SHRINK to re-optimise before downloading.';
      rb.addEventListener('click', () => { rb.classList.remove('glow'); updateHeight(); refreshDims(); });
      // v2.279: typing or dragging the Height makes RESIZE glow until it is pressed (programmatic fits on open do not fire input events)
      ['v2Height', 'v2HeightRange'].forEach(id => $(id)?.addEventListener('input', () => rb.classList.add('glow')));
      window.addEventListener('shrink:model-opened', () => rb.classList.remove('glow'));
      sizeBox.appendChild(rb); }
    const detail = $('v2Detail')?.closest('label'); const detailBox = document.createElement('div'); detailBox.className = 'v2-main-detail'; { const pick = setup?.querySelector('.v2-printer-pick') || dashboard.querySelector('.v2-printer-pick'); if (pick) detailBox.appendChild(pick); }   /* v2.261: the printer dropdown (resin 16K/8K/4K, FDM, custom) sits above Detail kept again; it had been swept into the hidden legacy block */
    if (detail) detailBox.appendChild(detail);
    const actions = document.createElement('div'); actions.className = 'v2-main-actions';
    ['v2ShrinkCard', 'v2FixCard', 'v2FuseCard', 'v2HollowCard'].forEach(id => { const el = $(id); if (el) actions.appendChild(el); });
    { const panel = document.createElement('div'); panel.id = 'v2EditPanel'; panel.className = 'v2-edit-panel'; panel.hidden = true;   // v2.321: dropped down from the EDIT button (moved into the viewer panel below), so ADVANCED can stay closed
      panel.innerHTML = '<div class="v2-edit-panel-head"><strong>EDIT</strong><span>optional</span><button type="button" class="v2-edit-close" aria-label="Close the edit tools" title="Close">✕</button></div>';
      const pane = document.createElement('div'); pane.id = 'v2EditPane'; pane.className = 'v2-edit-pane';
      ['v2EditCard', 'v2ClayCard'].forEach(id => { const el = $(id); if (el) pane.appendChild(el); }); panel.appendChild(pane); dashboard.appendChild(panel); }
    // Keep the native export controls available to BATCH, but show only the
    // one DOWNLOAD beneath MODEL HEALTH to users.
    const dl = document.createElement('div'); dl.className = 'v2-main-download';
    ['v2DownloadBtn', 'v2DownloadGlb'].forEach(id => { const el = $(id); if (el) dl.appendChild(el); });
    /* v2.244: splitting is back as an optional, folded-away section above DOWNLOAD IT (the controls already exist in the Download card; they are moved, not rebuilt) */
    { const sm = document.createElement('details'); sm.className = 'v2-split-menu'; sm.id = 'v2SplitMenu';
      sm.innerHTML = '<summary>Split into parts <span id="v2SplitBadge"></span></summary><div class="v2-split-body"></div>';
      const body = sm.querySelector('.v2-split-body');
      ['.v2-download-options', '#v2MaxWrap', '#v2CutWrap', '#v2BestCutRow', '#v2PegStatus'].forEach(q => { const el = dashboard.querySelector(q); if (el) body.appendChild(el); });
      { const adv = $('v2PegPosition')?.closest('details'); if (adv) body.appendChild(adv); }   /* the peg settings fold, found through its own control: other .v2-advanced blocks exist */
      dl.insertBefore(sm, dl.firstChild); }
    main.append(sizeBox, detailBox, actions, dl);
    // v2.222: the health box stays in the 3D view on the right, always visible; the tools live in their own foldable card on the left.
    const mainCard = document.createElement('div'); mainCard.className = 'v2-main-card';
    const hdr = document.createElement('div'); hdr.className = 'v2-main-title'; hdr.textContent = 'Pick just what you need, in any order. Or press SHRINK under the health box.';
    mainCard.dataset.tab = 'finish';
    mainCard.append(hdr, main);
    const tgl = $('v2LeftToggle');
    while (stack.firstChild) { if (stack.firstChild === tgl) { stack.removeChild(tgl); continue; } hold.appendChild(stack.firstChild); }
    if (tgl) stack.appendChild(tgl);
    stack.appendChild(mainCard); stack.appendChild(hold);
  }

  function createDashboard() {
    if (dashboard || document.querySelector('.print-v2-dashboard')) return;
    const workspace = $('workspace');
    const chooser = document.querySelector('.mode-chooser');
    if (!workspace || !chooser) return;
    viewerPanel = workspace.querySelector('.viewer-panel');
    if (!viewerPanel) return;
    viewerHome = viewerPanel.parentElement;
    viewerNext = viewerPanel.nextSibling;

    dashboard = document.createElement('section');
    dashboard.className = 'print-v2-dashboard';
    dashboard.dataset.printerType = 'resin';
    dashboard.dataset.quality = 'standard';
    dashboard.innerHTML = `
      <div class="v2-top-grid">
        <div class="v2-left-stack">
          <button type="button" id="v2LeftToggle" class="v2-left-toggle" aria-expanded="false" title="Show or hide the printer, size and advanced tools"></button>
          <section class="v2-card v2-setup-card">
            <div class="v2-card-head"><span class="v2-num">1</span><div><h2>Choose your printer & size</h2><p>No model numbers needed — just choose the kind of printer.</p></div></div>
            <label class="v2-printer-pick"><span>Printer detail</span><select id="v2PrinterSel">${PRINTER_LIST.map(x => `<option value="${x.id}">${x.label}</option>`).join('')}</select></label>
            <div class="v2-legacy-printer" hidden>
              <button type="button" class="v2-choice active" data-printer="resin"></button>
              <button type="button" class="v2-choice" data-printer="fdm"></button>
              <button type="button" class="v2-choice" data-printer="custom"></button>
            </div>
            <div class="v2-size-row">
              <label><span>Finished height</span><div><input id="v2Height" type="number" min="1" max="500" step="1" value="75"><em>mm</em></div></label>
              <input id="v2HeightRange" type="range" min="10" max="300" step="1" value="75">
            </div>
            <label class="v2-check v2-uniform-row" title="On: Width, Depth and Height always scale together. Untick to stretch Width and Depth on their own."><input id="v2Uniform" type="checkbox" checked> Uniform <small>(keep proportions)</small></label>
            <div class="v2-size-row v2-dim-row" title="Width and depth follow the height, so the model is always scaled in proportion. Type any of the three to resize.">
              <label><span>Width</span><div><input id="v2Width" type="number" min="1" step="0.1" value="" placeholder="–"><em>mm</em></div></label>
              <label><span>Depth</span><div><input id="v2Depth" type="number" min="1" step="0.1" value="" placeholder="–"><em>mm</em></div></label>
              <div class="v2-scale-btns"><button id="v2ScaleDown" type="button" title="Make 10% smaller, in proportion">−10%</button><button id="v2ScaleUp" type="button" title="Make 10% bigger, in proportion">+10%</button></div>
            </div>
            <div class="v2-quality-row v2-legacy-printer" hidden>
              <button type="button" class="active" data-quality="standard"></button>
              <button type="button" data-quality="fine"></button>
              <button type="button" data-quality="ultra"></button>
              <button type="button" data-quality="large"></button>
            </div>
            <div id="v2Step1Summary" class="v2-summary">Resin · 75 mm high</div>
            <details class="v2-advanced"><summary>Advanced printer settings</summary><div class="v2-advanced-body"><label id="v2CustomPrinter" hidden>Smallest detail to keep (mm)<input id="v2PrinterDetail" type="number" min="0.005" step="0.005" value="0.05"></label><p>Technical users can set the printer's smallest visible detail here. SHRINK uses this when judging whether a change will be visible.</p></div></details>
          </section>

          <details id="v2AdvTools" class="v2-adv-tools" open>
            <summary><span>ADVANCED</span><strong>Shrink, fix and fuse</strong><small>SHRINK (under the health box) does shrink, fix and fuse for you. Open this to use the tools separately </small></summary>
          <section id="v2ClayCard" class="v2-card v2-clay-card" hidden><div id="v2ClayHost"></div></section>

          <div class="v2-action-grid">
            <section id="v2ShrinkCard" class="v2-card v2-action-card v2-shrink-card">
              <div class="v2-card-head"><div><h2>SHRINK my model</h2><p>Automatically find the smallest version that still looks the same.</p></div></div>
              <div class="v2-protect">
                <div class="v2-protect-head">
                  <div><strong>Protect detail <em>(optional)</em></strong><small>Paint over faces, hands or fine ornament you don't want reduced.</small></div>
                  <button id="v2ProtectBtn" class="v2-protect-btn" type="button" aria-pressed="false">PROTECT DETAIL</button>
                </div>
                <div id="v2ProtectTools" class="v2-protect-tools" hidden>
                  <label>Brush size <input id="v2ProtectRadius" type="range" min="0.5" max="20" step="0.5" value="3"><output id="v2ProtectRadiusValue">3.0 mm</output></label>
                  <button id="v2ProtectClear" class="v2-protect-clear" type="button">CLEAR PAINT</button>
                </div>
              </div>
              <button id="v2ShrinkBtn" class="v2-mega v2-green" type="button">SHRINK IT</button>
              <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
              <div id="v2ShrinkResult" class="v2-result">SHRINK compares the reduced model with the original and stops before the difference should be visible.</div>
              <details class="v2-advanced" open><summary>Advanced optimisation settings</summary><div class="v2-advanced-body"><label>Detail kept<div class="v2-detail-control"><input id="v2Detail" type="range" min="1" max="100" step="0.1" value="70"><div class="v2-detail-number"><input id="v2DetailNumber" type="number" min="1" max="100" step="0.1" value="70" inputmode="decimal" aria-label="Detail kept percentage"><span>%</span></div></div></label><p>Drag the slider or type the percentage you want to keep.</p><p id="v2DetailNote" class="v2-detail-note"></p><div class="v2-detail-quick"><span>Smallest safe for</span><button type="button" id="v2Q16" data-pid="r16">16K</button><button type="button" id="v2Q8" data-pid="r8">8K</button></div></div></details>
            </section>

            <section id="v2FixCard" class="v2-card v2-action-card v2-fix-card">
              <div class="v2-card-head"><div><h2>Fix it</h2><p>Mend holes, flipped faces and loose edges. Nothing is joined or removed.</p></div></div>
              <button id="v2FixBigBtn" class="v2-mega v2-red" type="button">FIX IT</button>
              <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
              <div id="v2FixResult" class="v2-result">Check the Model Health box on the right first. FIX IT repairs what it can.</div>
            </section>

            <section id="v2FuseCard" class="v2-card v2-action-card v2-fuse-card">
              <div class="v2-card-head"><div><h2>Fuse it</h2><p>Repair mesh problems and join parts that genuinely touch or overlap.</p></div></div>
              <button id="v2FuseBtn" class="v2-mega v2-purple" type="button">FUSE IT</button>
              <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
              <div id="v2FuseResult" class="v2-result">SHRINK repairs the mesh and joins touching parts. Separate watertight parts are fine and will be left intact.</div>
              <details class="v2-advanced"><summary>Advanced repair settings & diagnostics</summary><div class="v2-advanced-body"><p>Welds near-duplicate vertices, removes bad triangles and joins touching/overlapping parts. Multiple closed components are valid; SHRINK only reports a repair problem when the mesh itself is open or non-manifold.</p></div></details>
            </section>

            <section id="v2EditCard" class="v2-card v2-action-card v2-edit-card">
              <div class="v2-card-head"><div><h2>Edit model</h2><p>Lasso a part to delete or copy it, cut a piece off with the razor, add a shape, paste a part, or slice a piece off.</p></div></div>
              <div id="v2EdHint" class="v2-edit-hint" hidden></div>
              <div class="v2-icon-row v2-icon-row-6" role="group" aria-label="Edit tool">${iconBtn('tool', 'select', 'Select')}${iconBtn('tool', 'lasso', 'Lasso')}${iconBtn('tool', 'razor', 'Razor')}${iconBtn('tool', 'sculpt', 'Sculpt')}${iconBtn('tool', 'shape', 'Shape', true)}${iconBtn('tool', 'part', 'Paste part')}${iconBtn('tool', 'slice', 'Slice off')}</div>
              <select id="v2EdTab" autocomplete="off" hidden><option value="none">None</option><option value="select">Select</option><option value="lasso">Lasso</option><option value="razor">Razor</option><option value="sculpt">Sculpt</option><option value="shape" selected>Shape</option><option value="part">Paste part</option><option value="slice">Slice off</option></select>
              <div id="v2EdTip" class="v2-edit-hint-plain">Click the tool again or press Esc to put it down.</div>
              <div id="v2EdModeRow"><div class="v2-icon-row v2-icon-row-2" role="group" aria-label="Join or cut">${iconBtn('mode', 'join', 'Join (add on)')}${iconBtn('mode', 'cut', 'Cut (make a hole)', true)}</div>
                <select id="v2EdMode" autocomplete="off" hidden><option value="join">Join (add on)</option><option value="cut" selected>Cut (make a hole)</option></select></div>
              <div id="v2EdShapeBox">
                <div class="v2-icon-row v2-icon-row-4" role="group" aria-label="Shape">${iconBtn('kind', 'cube', 'Cube', true)}${iconBtn('kind', 'ball', 'Ball')}${iconBtn('kind', 'cylinder', 'Cylinder')}${iconBtn('kind', 'cone', 'Cone')}</div>
                <select id="v2EdKind" autocomplete="off" hidden><option value="cube">Cube</option><option value="ball">Ball</option><option value="cylinder">Cylinder</option><option value="cone">Cone</option></select>
                <div class="v2-edit-grid"><span>Size mm</span><input id="v2EdW" type="number" min="0.1" step="1" value="10" title="Width"><input id="v2EdH" type="number" min="0.1" step="1" value="10" title="Height"><input id="v2EdD" type="number" min="0.1" step="1" value="10" title="Depth"></div>
                <div class="v2-edit-grid"><span>Move mm</span><input id="v2EdX" type="number" step="1" value="0" title="Left / right"><input id="v2EdY" type="number" step="1" value="0" title="Up / down"><input id="v2EdZ" type="number" step="1" value="0" title="Front / back"></div>
              </div>
              <div id="v2EdLassoBox" hidden>
                <div id="v2LassoHelp" class="v2-edit-hint-plain">Hold the mouse button down and draw a loop round the part on the model. Ctrl / ⌘ + drag still turns the model.</div>
                <label class="v2-edit-hint-plain" style="display:flex;gap:6px;align-items:flex-start"><input type="checkbox" id="v2EdWhole" autocomplete="off"><span>Grab the whole loose piece. For a part that is its own separate shell (a horn, a leaf, a floating bit): touch it with the loop and all of it turns red. Not for a branch that is fused into the body.</span></label>
                <div class="v2-hollow-row"><label for="v2EdDepth">Which part</label><select id="v2EdDepth" autocomplete="off" title="Nearest part: only the part closest to you under the loop (a hand held up in front of a body). Everything under the loop: all the way through the model."><option value="near" selected>Nearest part (auto)</option><option value="through">Everything under the loop</option><option value="front">Half way through</option></select></div>
                <div class="v2-icon-row v2-icon-row-2"><button id="v2LassoDelBtn" type="button" class="v2-icon-btn v2-lasso-act" data-op="delete" disabled>${icon('cut')}<span>DELETE</span></button><button id="v2LassoKeepBtn" type="button" class="v2-icon-btn v2-lasso-act" data-op="copy" disabled>${icon('copy')}<span>COPY</span></button></div>
              </div>
              <div id="v2EdSculptBox" hidden>
                <div class="v2-edit-hint-plain">Paint on the model like clay. SMOOTH blends the surface (lined faces, rough scans), PULL raises it, PUSH presses it in. Bigger tip = broader strokes. Ctrl / ⌘ + drag turns the model. It works on the model's own triangles, so keep plenty of them: sculpt before you SHRINK.</div>
                <div class="v2-icon-row v2-icon-row-3" role="group" aria-label="Sculpt mode">${iconBtn('smode', 'smooth', 'Smooth', true)}${iconBtn('smode', 'pull', 'Pull out')}${iconBtn('smode', 'push', 'Push in')}</div>
                <select id="v2EdSculptMode" autocomplete="off" hidden><option value="smooth" selected>Smooth</option><option value="pull">Pull out</option><option value="push">Push in</option></select>
                <div class="v2-hollow-row"><label for="v2SculptSize">Tip size</label><input id="v2SculptSize" type="range" min="1" max="120" step="0.5" value="8" autocomplete="off"><output id="v2SculptSizeOut">8 mm</output></div>
                <div class="v2-hollow-row"><label for="v2SculptStrength">Strength</label><input id="v2SculptStrength" type="range" min="1" max="10" step="1" value="5" autocomplete="off"><output id="v2SculptStrengthOut">5</output></div>
              </div>
              <div id="v2EdPartBox" hidden>
                <label class="v2-part-file"><input type="file" id="v2EdPartFile" accept=".stl,.obj,.ply,.glb,.gltf"><span>CHOOSE A PART FILE</span></label>
                <div class="v2-edit-hint-plain" id="v2EdPartOr">or use Copy / cut to take a piece from this model.</div>
                <div id="v2EdPartInfo" class="v2-edit-hint-plain">STL, OBJ, PLY or GLB. It must be a closed solid, e.g. a new head. Slice the old head off first, then press SIT ON TOP.</div>
                <details class="v2-advanced v2-exact"><summary>Exact numbers</summary><div class="v2-edit-grid"><span>Height mm</span><input id="v2EdPartH" type="number" min="0.1" step="1" value="30" title="Part height"><button id="v2EdPartTop" type="button" class="v2-edit-small" title="Put the part on top of the model, centred, sunk in by 1 mm so it joins">SIT ON TOP</button><button id="v2EdPartCentre" type="button" class="v2-edit-small" title="Put the part in the middle of the model">CENTRE</button></div>
                <div class="v2-edit-grid"><span>Turn °</span><input id="v2EdPartRX" type="number" step="15" value="0" title="Turn about left/right"><input id="v2EdPartRY" type="number" step="15" value="0" title="Turn about up/down"><input id="v2EdPartRZ" type="number" step="15" value="0" title="Turn about front/back"></div>
                <div class="v2-edit-grid"><span>Move mm</span><input id="v2EdPartX" type="number" step="1" value="0" title="Left / right"><input id="v2EdPartY" type="number" step="1" value="0" title="Up / down"><input id="v2EdPartZ" type="number" step="1" value="0" title="Front / back"></div></details>
              </div>
              <div id="v2EdSliceBox" hidden>
                <div class="v2-hollow-row"><label for="v2EdAxis">Cut across</label><select id="v2EdAxis" autocomplete="off"><option value="y" selected>Up / down (height)</option><option value="x">Left / right</option><option value="z">Front / back</option></select></div>
                <div class="v2-hollow-row"><label for="v2EdPos">Position</label><input id="v2EdPos" type="range" min="0" max="100" step="1" value="50" autocomplete="off"><output id="v2EdPosOut">50%</output></div>
                <div class="v2-hollow-row"><label for="v2EdTilt">Tilt</label><input id="v2EdTilt" type="range" min="-60" max="60" step="1" value="0" autocomplete="off"><output id="v2EdTiltOut">0°</output></div>
                <div class="v2-hollow-row"><label for="v2EdSide">Remove</label><select id="v2EdSide" autocomplete="off"><option value="high" selected>the top / far side</option><option value="low">the bottom / near side</option></select></div>
              </div>
              <div class="v2-edit-actions"><button id="v2EdUndo" class="v2-edit-undo" type="button" hidden>UNDO LAST EDIT</button><button id="v2EdReset" class="v2-edit-undo v2-edit-reset" type="button" title="Undo every edit, clear the lasso loop and the loaded part, and put the tools back to normal">RESET ALL EDITS</button></div>
              <div id="v2EdRun">
                <button id="v2EdGo" class="v2-mega v2-teal" type="button">CUT SHAPE OUT</button>
                <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
                <div id="v2EdResult" class="v2-result">The preview (pink = join, orange = cut, green = part, blue plane = slice) shows where it will go. Needs one watertight model: run FIX IT or FUSE IT first if it says no.</div>
              </div>
            </section>

            <section id="v2HollowCard" class="v2-card v2-action-card v2-hollow-card" hidden>
              <div class="v2-card-head"><div><h2>Hollow it</h2><p>Save resin: empty the inside, keep a wall you choose, and open drain holes in the base.</p></div></div>
              <p class="v2-hollow-note">Resin printing: a solid model fills with expensive resin that nobody sees. Hollowing leaves a shell, so the print uses far less resin (and is lighter). The drain holes let uncured resin run out; without them it stays trapped inside and can crack the print.</p>
              <div class="v2-hollow-row"><label for="v2HollowWall">Wall</label><input id="v2HollowWall" type="range" min="1" max="5" step="0.5" value="2" autocomplete="off"><output id="v2HollowWallOut">2 mm</output></div>
              <div class="v2-hollow-row"><label for="v2HollowHoles">Drain holes</label><select id="v2HollowHoles" autocomplete="off"><option value="2" selected>2 (recommended)</option><option value="1">1</option><option value="0">None</option></select></div>
              <div class="v2-hollow-row"><label for="v2HollowHoleSize">Hole size</label><input id="v2HollowHoleSize" type="range" min="2" max="8" step="0.5" value="3" autocomplete="off"><output id="v2HollowHoleSizeOut">3 mm</output></div>
              <button id="v2HollowBtn" class="v2-mega v2-teal" type="button">HOLLOW IT</button>
              <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
              <div id="v2HollowResult" class="v2-result">Works best after SHRINK with fix and fuse, on one watertight piece.</div>
              <div id="v2HollowCut" class="v2-hollow-row" hidden><label for="v2HollowCutRange">Cut-away</label><input id="v2HollowCutRange" type="range" min="0" max="100" step="1" value="100" autocomplete="off"><output id="v2HollowCutOut">off</output></div>
            </section>


          </div>
          </details>

          <div class="v2-action-grid v2-download-grid">
            <section class="v2-card v2-action-card v2-download-card">
              <div class="v2-card-head"><div><h2>Download</h2><p>Save one STL, or split it into printable sections with pegs.</p></div></div>
              <div class="v2-download-options"><label>Split into<select id="v2SplitMode"><option value="off">One STL</option><option value="2">2 parts</option><option value="3">3 parts</option><option value="max">Auto by maximum height</option></select></label><label>Joint<select id="v2Joint"><option value="pegs">Keyed twin pegs</option><option value="flat">Flat cut — no pegs</option></select></label></div>
              <div id="v2MaxWrap" class="v2-cut-row" hidden><div><span>Maximum part height</span><strong>mm</strong></div><input id="v2MaxHeight" type="number" min="20" max="500" step="5" value="80"></div>
              <div id="v2CutWrap" class="v2-cut-row" hidden><div><span>Cut height</span><strong id="v2CutLabel">50%</strong></div><input id="v2Cut" type="range" min="10" max="90" step="0.5" value="50"></div>
              <div id="v2BestCutRow" class="v2-bestcut-row" hidden><label class="v2-check"><input id="v2AutoCut" type="checkbox" checked> Pick the best cut for me</label><button id="v2BestCut" class="v2-peg-reset" type="button">FIND AGAIN</button><span id="v2BestCutNote">Chooses a cut through one solid outline, away from thin arms and axes, with room for pegs. Drag the Cut height yourself to take over.</span></div><div id="v2PegStatus" class="v2-peg-status" role="status" aria-live="polite" hidden></div><button id="v2DownloadBtn" class="v2-mega v2-red" type="button">DOWNLOAD IT</button><button id="v2DownloadGlb" class="v2-glb-btn" type="button" title="The whole model as a GLB (game engines, viewers). Split pieces and pegs only come in the STL.">or download as GLB</button>
              <details class="v2-advanced"><summary>Advanced split settings</summary><div class="v2-advanced-body v2-advanced-grid"><label>Peg position<select id="v2PegPosition"><option value="auto">Auto — safest position</option><option value="manual">Manual — position with sliders</option></select></label><button id="v2PegReset" class="v2-peg-reset" type="button" hidden>SNAP PEGS TO SAFEST SPOT</button><div id="v2PegAxisPanel" class="v2-peg-axis-panel" hidden><label id="v2PegCutWrap" class="v2-peg-cut" hidden>Cut<select id="v2PegCut"></select></label><div class="v2-peg-axis-group v2-peg1"><strong><i></i> Peg 1</strong><label><span>Left</span><input id="v2Peg1X" type="range" min="0" max="100" step="0.25" value="50"><span>Right</span></label><label><span>Back</span><input id="v2Peg1Z" type="range" min="0" max="100" step="0.25" value="50"><span>Forward</span></label></div><div class="v2-peg-axis-group v2-peg2"><strong><i></i> Peg 2</strong><label><span>Left</span><input id="v2Peg2X" type="range" min="0" max="100" step="0.25" value="50"><span>Right</span></label><label><span>Back</span><input id="v2Peg2Z" type="range" min="0" max="100" step="0.25" value="50"><span>Forward</span></label></div></div><label>Peg diameter (mm)<input id="v2PegDiameter" type="number" min="1" max="20" step="0.5" value="4"></label><label>Peg depth (mm)<input id="v2PegDepth" type="number" min="2" max="30" step="0.5" value="6"></label><label>Socket clearance (mm)<input id="v2PegClearance" type="number" min="0.05" max="1" step="0.05" value="0.20"></label><label class="v2-check"><input id="v2Zup" type="checkbox" checked> Z-up for Lychee / Chitubox</label><p id="v2PegHelp" class="v2-peg-help" hidden>Use the sliders for smooth left/right and forward/back movement. The viewer shows the actual peg shape; pegs stop automatically at unsafe edges.</p></div></details>
            </section>
          </div>
        </div>

        <div class="v2-viewer-slot"></div>
      </div>`;

    chooser.insertAdjacentElement('afterend', dashboard);
    dashboard.querySelector('.v2-viewer-slot').appendChild(viewerPanel);
    ensureHealthCard();
    renderAppliedChanges();
    if (!workingModel) setWorkingModel(app()?.originalModel);
    setTimeout(updateHealthCard, 80);

    // v2.215: the left column is gone. One big MODEL HEALTH card holds the size, detail, tools and download; the old printer, split and peg controls stay in a hidden holder because BATCH and the tests drive them.
    buildMainCard();
    // v2.288: ADVANCED shares the viewer toolbar's flex row instead of overlaying Compare.
    const advancedToggle = $('v2LeftToggle');
    const viewerActions = viewerPanel?.querySelector('.viewer-toolbar .viewer-actions');
    if (advancedToggle && viewerActions) viewerActions.insertBefore(advancedToggle, viewerActions.firstChild);
    // v2.321: EDIT sits right of ADVANCED on the top menu; its tools drop down in their own panel over the viewer, so the ADVANCED column can stay shut and the model keeps the room.
    { const ed = document.createElement('button'); ed.type = 'button'; ed.id = 'v2TabEdit'; ed.className = 'v2-edit-toggle'; ed.setAttribute('aria-pressed', 'false'); ed.textContent = 'EDIT'; ed.title = 'Lasso, razor, sculpt, shapes and paste a part';
      if (viewerActions) viewerActions.insertBefore(ed, advancedToggle ? advancedToggle.nextSibling : viewerActions.firstChild); else (viewerPanel || dashboard).appendChild(ed);
      const pn = $('v2EditPanel'); if (pn) (viewerPanel || dashboard).appendChild(pn);
      ed.addEventListener('click', () => setMainTab(editActive() ? 'finish' : 'edit')); pn?.querySelector('.v2-edit-close')?.addEventListener('click', () => setMainTab('finish')); }
    // The panel folds away again (as before v2.215); the choice is remembered.
    { const tg = $('v2LeftToggle');
      const setLeft = open => { dashboard.dataset.left = open ? 'open' : 'closed'; tg.setAttribute('aria-expanded', String(open)); tg.textContent = 'ADVANCED' /* v2.236: just the one word, open or closed */; };
      setLeft(false);   // v2.223: always starts closed on load; the old remembered choice is ignored
      tg.addEventListener('click', () => { const o = dashboard.dataset.left !== 'open'; setLeft(o); window.dispatchEvent(new Event('resize')); dimRetry = 0; refreshDims(); });
      window.__shrinkLeftPanel = setLeft; }
    dashboard.querySelectorAll('[data-printer]').forEach(b => b.addEventListener('click', () => choosePrinter(b.dataset.printer)));
    dashboard.querySelectorAll('[data-quality]').forEach(b => b.addEventListener('click', () => setQuality(b.dataset.quality)));
    $('v2PrinterSel').addEventListener('change', e => { const x = PRINTER_LIST.find(y => y.id === e.target.value); if (!x) return; choosePrinter(x.type); if (x.type !== 'custom') setQuality(x.quality); syncPrinterSel(); });
    $('v2Height').addEventListener('input', () => { manualHeight = true; updateHeight(); });
    // Width / Depth apply when you stop typing (about 0.7 s), on Enter and when you leave the box, so the model follows without having to press Tab (v2.182)
    [['v2Width', 'x'], ['v2Depth', 'z']].forEach(([id, axis]) => {
      const el = $(id); let t = null, last = '';
      const go = () => { clearTimeout(t); if (el.value === last || el.value === '') return; last = el.value; dimInput(axis); };
      el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(go, 700); });
      el.addEventListener('change', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      el.addEventListener('focus', () => { last = ''; });
    });
    $('v2Uniform').addEventListener('change', () => { if ($('v2Uniform').checked) resetStretch(); dimRetry = 0; refreshDims(); markSettingsChanged(); });
    $('v2ScaleUp').addEventListener('click', () => scaleBy(1.1));
    $('v2ScaleDown').addEventListener('click', () => scaleBy(0.9));
    window.addEventListener('shrink:reduced', () => { reducedTick++; refreshDims(); });
    // v2.256: a newly opened model starts at ITS OWN height (STL/OBJ units are mm, a GLB is metres), not at a fixed 75 mm. BATCH sets its own height after this.
    function fitHeightToModel() {
      if (manualHeight) return; // Do not overwrite a height entered before the delayed model-open fit.
      const units = window.__shrinkPrint?.state?.modelHeightUnits || 0; if (!(units > 0)) return;
      const glb = window.__shrinkApp?.sourceKind === 'glb', raw = Math.round((glb && units < 10 ? units * 1000 : units) * 10) / 10;
      // v2.274: under 30 mm (including a model in cm/inches/metres that reads as a few units) is brought up to 30 mm; 30 mm and taller keep their own height; over 500 keeps the normal default.
      if (raw > 500) return;
      const mm = raw < 30 ? 30 : raw;
      const n = $('v2Height'); if (!n) return;
      n.value = String(mm); const r = $('v2HeightRange'); if (r) r.value = String(Math.max(10, Math.min(300, mm)));
      updateHeight();
    }
    // v2.280: safety net: whatever else wrote the Height on open (BATCH, the file's own units, a restored value), nothing under 30 mm is left on a freshly opened model
    function enforceMinHeight() {
      const n = $('v2Height'); if (!n || manualHeight || !sourceModel()) return;
      const v = Number(n.value);
      if (!Number.isFinite(v) || v <= 0 || v < 30) {
        n.value = '30'; updateHeight();
      } else if (Math.abs(Number(nativeValue('figureHeightMm', v)) - v) > 0.001) {
        updateHeight(); // A visible 30 mm is useless if the native export is still 2.8 mm.
      }
      refreshDims();
    }
    window.__shrinkEnforceMinHeight = enforceMinHeight;
    window.__shrinkMarkAutoHeight = () => { manualHeight = false; enforceMinHeight(); };
    window.__shrinkFitHeight = fitHeightToModel;
    window.addEventListener('shrink:model-opened', () => { autoReady = false; settingsDirty = false; detailUpdating = false; updateWorkflowButtons(); manualHeight = false; const u = $('v2Uniform'); if (u) u.checked = true; setTimeout(() => { try { fitHeightToModel(); } catch (e) { console.warn('height from model', e); } refreshDims(); }, 150); [600, 1500].forEach(ms => setTimeout(() => { try { enforceMinHeight(); } catch {} }, ms)); });
    setTimeout(refreshDims, 300);
    $('v2HeightRange').addEventListener('input', () => { manualHeight = true; $('v2Height').value = $('v2HeightRange').value; updateHeight(); });
    $('v2PrinterDetail').addEventListener('input', () => { setNative('printerPreset', 'custom'); setNative('printerDetailMm', $('v2PrinterDetail').value, 'input'); markSettingsChanged(); });
    $('v2FuseBtn').addEventListener('click', fuseCheck);
    /* v2.307: EDIT MODEL wiring */
    { const ed = $('v2EditCard'); if (ed) {
      ed.addEventListener('click', e => { const b = e.target.closest('.v2-icon-btn'); if (!b) return; const sel = $({ tool: 'v2EdTab', kind: 'v2EdKind', mode: 'v2EdMode', smode: 'v2EdSculptMode' }[b.dataset.ed]); if (!sel) return; sel.value = (b.dataset.ed === 'tool' && b.getAttribute('aria-pressed') === 'true') ? 'none' : b.dataset.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); });
      $('v2EdKind').addEventListener('change', editTabChanged);
      ['v2EdPartH', 'v2EdPartRX', 'v2EdPartRY', 'v2EdPartRZ', 'v2EdPartX', 'v2EdPartY', 'v2EdPartZ'].forEach(id => { $(id).addEventListener('input', updateEditPreview); $(id).addEventListener('change', updateEditPreview); });
      $('v2SculptSize').addEventListener('input', () => { $('v2SculptSizeOut').textContent = $('v2SculptSize').value + ' mm'; }); $('v2SculptStrength').addEventListener('input', () => { $('v2SculptStrengthOut').textContent = $('v2SculptStrength').value; }); $('v2EdSculptMode').addEventListener('change', editTabChanged);
      $('v2EdDepth').addEventListener('change', () => { if (lassoSel) lassoRed(lassoSel); }); $('v2EdWhole').addEventListener('change', () => { updateEditHint(); if (lassoSel) lassoRed(lassoSel); });
      $('v2LassoDelBtn').addEventListener('click', () => lassoApply('delete')); $('v2LassoKeepBtn').addEventListener('click', e => lassoApply(e.currentTarget.dataset.op || 'copy'));
      $('v2EdPartTop').addEventListener('click', () => partPlace('top')); $('v2EdPartCentre').addEventListener('click', () => partPlace('centre'));
      $('v2EdPartFile').addEventListener('change', async e => { const file = e.target.files?.[0]; if (!file) return; $('v2EdPartInfo').textContent = 'Reading ' + file.name + '…'; try { setPart(await loadPartFile(file)); partPlace('top'); } catch (err) { editPart = null; $('v2EdPartInfo').textContent = 'Could not read that file: ' + (err?.message || err); updateEditPreview(); updateGoState(); } });
      $('v2EdTab').addEventListener('change', editTabChanged);
      $('v2EdMode').addEventListener('change', editTabChanged);
      ['v2EdKind', 'v2EdW', 'v2EdH', 'v2EdD', 'v2EdX', 'v2EdY', 'v2EdZ', 'v2EdAxis', 'v2EdSide', 'v2EdPos', 'v2EdTilt'].forEach(id => { $(id).addEventListener('input', () => { $('v2EdPosOut').textContent = $('v2EdPos').value + '%'; $('v2EdTiltOut').textContent = $('v2EdTilt').value + '°'; updateEditPreview(); }); $(id).addEventListener('change', updateEditPreview); });
      window.addEventListener('keydown', e => { if (e.key === 'Escape' && editActive() && lassoSel) { clearLasso(); return; } if ((e.key === 'Delete' || e.key === 'Backspace') && editActive() && lassoSel && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); lassoApply('delete'); return; } if (e.key === 'Escape' && editActive() && $('v2EdTab').value !== 'none') { $('v2EdTab').value = 'none'; $('v2EdTab').dispatchEvent(new Event('change', { bubbles: true })); } });
      $('v2EdReset').addEventListener('click', resetEdits);
      // v2.320: keyboard shortcuts in the EDIT tab (never while typing in a box)
      window.addEventListener('keydown', e => {
        if (!editActive() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') || e.altKey) return; const k = e.key;
        if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); if (editStack.length && !lassoBusy) undoEdit(); return; }
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (k === 'v' || k === 'V') && editPart && pieceTool()) { e.preventDefault(); editModelNow(); return; }   // Cmd/Ctrl+V pastes (places) the floating part
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (k === 'c' || k === 'C') && editPart && pieceTool()) { e.preventDefault(); dupPart(); return; }
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && lassoSel && lzTool() && (k === 'c' || k === 'C' || k === 'x' || k === 'X')) { e.preventDefault(); lassoApply(k.toLowerCase() === 'c' ? 'copy' : 'cut'); return; }   // Cmd/Ctrl+C copies the red part, +X cuts it off and keeps it
        if (e.metaKey || e.ctrlKey) return;
        if ((k === 'Delete' || k === 'Backspace') && editPart && pieceTool()) { e.preventDefault(); discardPiece(); return; }
        if ($('v2EdTab')?.value === 'sculpt' && /^[-+=_]$/.test(k)) { e.preventDefault(); const r = $('v2SculptSize'), up = k === '+' || k === '=', lo = Number(r.min) || 1, hi = Number(r.max) || 120, cur = Number(r.value) || lo; let nv = Math.round(cur * (up ? 1.15 : 1 / 1.15) * 10) / 10; if (nv === cur) nv += up ? 0.5 : -0.5; r.value = String(Math.min(hi, Math.max(lo, nv))); r.dispatchEvent(new Event('input', { bubbles: true })); return; }
        if (editPart && $('v2EdTab')?.value === 'part' && /^[-+=_]$/.test(k)) { e.preventDefault(); partScale(k === '+' || k === '=' ? 1.1 : 1 / 1.1); return; }
        if (editPart && $('v2EdTab')?.value === 'part' && /^[xyzXYZ]$/.test(k)) { e.preventDefault(); partTurnWorld('xyz'.indexOf(k.toLowerCase()), k === k.toLowerCase() ? 1 : -1); }
      });
      $('v2EdGo').addEventListener('click', editModelNow); $('v2EdUndo').addEventListener('click', undoEdit); editTabChanged(); } }
    $('v2HollowBtn')?.addEventListener('click', hollowModelNow);
    $('v2HollowWall')?.addEventListener('input', () => { $('v2HollowWallOut').textContent = $('v2HollowWall').value + ' mm'; });
    /* v2.305: once the model is hollow, letting go of the wall slider (or changing the drain holes) rebuilds it straight away so the new thickness shows in the cut-away */
    { let t = 0; const again = () => { clearTimeout(t); t = setTimeout(() => { if (hollowResult && sourceModel() === hollowResult && !$('v2HollowBtn')?.disabled) hollowModelNow(); }, 350); };
      $('v2HollowWall')?.addEventListener('change', again); $('v2HollowHoles')?.addEventListener('change', again); $('v2HollowHoleSize')?.addEventListener('change', again);
      $('v2HollowHoleSize')?.addEventListener('input', () => { $('v2HollowHoleSizeOut').textContent = $('v2HollowHoleSize').value + ' mm'; }); }
    $('v2HollowCutRange')?.addEventListener('input', e => hollowClip(Number(e.target.value)));
    $('v2FixBigBtn').addEventListener('click', fixHealthModel);
    $('v2ProtectBtn').addEventListener('click', () => {
      const native = $('protectBtn');
      native?.click();
      setTimeout(() => {
        const on = !!native?.classList.contains('active');
        $('v2ProtectBtn').classList.toggle('active', on);
        $('v2ProtectBtn').setAttribute('aria-pressed', String(on));
        $('v2ProtectBtn').textContent = on ? 'PAINTING ON' : 'PROTECT DETAIL';
        $('v2ProtectTools').hidden = !on;
      }, 30);
    });
    $('v2ProtectRadius').addEventListener('input', () => {
      const v = $('v2ProtectRadius').value;
      setNative('protectRadius', v, 'input');
      $('v2ProtectRadiusValue').textContent = `${Number(v).toFixed(1)} mm`;
    });
    $('v2ProtectClear').addEventListener('click', () => $('protectClearBtn')?.click());
    $('v2ShrinkBtn').addEventListener('click', shrinkModel);
    $('v2SplitMode').addEventListener('change', chooseSplit);
    $('v2Joint').addEventListener('change', syncAdvancedToNative);
    $('v2PegPosition').addEventListener('change', () => {
      syncAdvancedToNative();
      const manual=$('v2PegPosition').value==='manual';
      $('v2PegReset').hidden=!manual; $('v2PegHelp').hidden=!manual;
      window.__shrinkSplit?.updatePreview?.();
      setTimeout(refreshPegAxisControls,0);
    });
    $('v2PegReset').addEventListener('click', () => { window.__shrinkSplit?.resetManualPegPositions?.(); setTimeout(refreshPegAxisControls,0); });
    $('v2PegCut').addEventListener('change', () => { activePegCut=Number($('v2PegCut').value)||0; refreshPegAxisControls(); });
    $('v2Peg1X').addEventListener('input', () => movePegFromSlider(0,'x','v2Peg1X'));
    $('v2Peg1Z').addEventListener('input', () => movePegFromSlider(0,'z','v2Peg1Z'));
    $('v2Peg2X').addEventListener('input', () => movePegFromSlider(1,'x','v2Peg2X'));
    $('v2Peg2Z').addEventListener('input', () => movePegFromSlider(1,'z','v2Peg2Z'));
    window.addEventListener('shrink:peg-position-changed', () => { refreshPegAxisControls(); renderPegStatus(); });
    window.addEventListener('shrink:peg-preview-updated', () => { refreshPegAxisControls(); renderPegStatus(); });
    $('v2BestCut')?.addEventListener('click', () => { window.__shrinkSplit?.applyBestCut?.(); });
    $('v2AutoCut')?.addEventListener('change', () => window.__shrinkSplit?.setAutoCut?.($('v2AutoCut').checked));
    window.addEventListener('shrink:autocut-changed', e => { const el = $('v2AutoCut'); if (el && el.checked !== !!e.detail?.on) el.checked = !!e.detail?.on; });
    window.addEventListener('shrink:autocut', e => {
      const note = $('v2BestCutNote'), d = e.detail || {}; if (!note) return;
      const text = d.state === 'searching' ? `Looking for the best cut… ${Math.round((d.progress || 0) * 100)}%`
        : d.state === 'done' ? `Best cut: ${d.best.pct}% of the height${d.best.islands > 1 ? ' (thin parts are still crossed at every height)' : ' — through one solid outline'}.`
        : d.state === 'failed' ? `Couldn't search for a better cut (${d.error || 'unknown'}). Use the Cut height slider.` : '';
      if (text && note.textContent !== text) note.textContent = text;
    });
    $('v2Cut').addEventListener('input', () => { $('v2CutLabel').textContent = `${$('v2Cut').value}%`; setNative('splitCutHeight', $('v2Cut').value, 'input'); });
    $('v2MaxHeight').addEventListener('input', () => setNative('splitMaxHeight', Math.max(20, Number($('v2MaxHeight').value) || 80), 'input'));
    ['v2PegDiameter','v2PegDepth','v2PegClearance'].forEach(id => $(id).addEventListener('input', syncAdvancedToNative));
    $('v2Zup').addEventListener('change', syncAdvancedToNative);
    $('v2DownloadBtn').addEventListener('click', download);
    window.addEventListener('shrink:live-updated', () => { if (detailUpdating && !settingsDirty) { detailUpdating = false; updateWorkflowButtons(); } });
    // v2.277: the button says what it will export right now (detail kept + height), so it is clear it is ready again after the slider settles
    function updateDownloadInfo() {
      const b = $('v2DownloadBtn'); if (!b) return;
      const d = Number($('v2Detail')?.value), h = Number($('v2Height')?.value);
      const bits = []; if (Number.isFinite(d) && d > 0) bits.push(`${Math.round(d * 10) / 10}% detail`); if (Number.isFinite(h) && h > 0) bits.push(`${h} mm`);
      const t = bits.join(' · '); if (b.dataset.info !== t) b.dataset.info = t;
    }
    ['input', 'change'].forEach(ev => { $('v2Detail')?.addEventListener(ev, () => setTimeout(updateDownloadInfo, 0)); $('v2DetailNumber')?.addEventListener(ev, () => setTimeout(updateDownloadInfo, 0)); $('v2Height')?.addEventListener(ev, () => setTimeout(updateDownloadInfo, 0)); });
    ['shrink:reduced', 'shrink:auto-found', 'shrink:model-opened'].forEach(ev => window.addEventListener(ev, () => setTimeout(updateDownloadInfo, 200)));
    setTimeout(updateDownloadInfo, 400);
    $('v2DownloadGlb').addEventListener('click', () => window.__shrinkExportGlb?.());
    async function ensureLiveRebased() {
      const live = window.__shrinkLive;
      if (live?.root && sourceModel() && sourceModel() !== live.root && window.__shrinkLiveUI?.rebaseWorking) {
        rebasing = rebasing || (async () => {
          try {
            const model = sourceModel();
            const known = lastHealth && lastHealth.model === model ? lastHealth.h : window.__shrinkPrintSafety?.topologySummary?.(model);
            await window.__shrinkLiveUI.rebaseWorking(model);
            detailScale = Math.max(0.0001, Math.min(1, modelTriangles(model) / origTrisOf()));
            window.__shrinkLive?.setTidy?.(known ? known.clean === true : false);
          } finally { rebasing = null; }
        })();
        await rebasing;
      }
    }
    const pickPrinter = id => { const sel = $('v2PrinterSel'); if (!sel || sel.value === id) return; sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); };
    const markQuick = () => { const id = currentPrinter().id; ['v2Q16', 'v2Q8'].forEach(b => $(b)?.classList.toggle('active', $(b)?.dataset.pid === id)); };
    ['v2Q16', 'v2Q8'].forEach(bid => $(bid)?.addEventListener('click', async () => {
      const btns = ['v2Q16', 'v2Q8'].map($); if (btns.some(b => b?.disabled) || !window.__shrinkLiveUI?.autoFind) return;
      btns.forEach(b => { if (b) b.disabled = true; });
      try { detailManual = false; manualLevel = ''; pickPrinter($(bid).dataset.pid); markQuick(); await ensureLiveRebased(); await window.__shrinkLiveUI.autoFind(); }
      catch (e) { console.warn('quick detail', e); } finally { btns.forEach(b => { if (b) b.disabled = false; }); markQuick(); try { updateHealthCard(); } catch {} }
    }));
    // Hand-set Detail kept: after each measurement say what it still prints safely at and switch the 16K/8K printer label to match.
    window.addEventListener('shrink:measured', e => {
      if (!detailManual) return; const d = e.detail || {}; if (d.mode !== 'print') return;
      const lvl = d.p995mm <= 0.018 ? '16K' : d.p99mm <= 0.05 ? '8K' : 'below 8K';
      const cur = currentPrinter().id;
      if ((cur === 'r16' || cur === 'r8') && lvl !== 'below 8K') pickPrinter(lvl === '16K' ? 'r16' : 'r8');
      if (manualLevel !== lvl) { manualLevel = lvl; try { updateHealthCard(); } catch {} }
      markQuick();
    });
    window.addEventListener('shrink:auto-found', () => setTimeout(markQuick, 0));
    async function applyDetailValue(raw, source = 'slider') {
      let value = Number(raw);
      if (!Number.isFinite(value)) value = Number($('v2Detail')?.value || 70);
      value = Math.max(1, Math.min(100, value));
      const text = String(Math.round(value * 10) / 10);
      detailManual = true; manualLevel = '';
      markManualPending();
      $('v2Detail').value = text;
      $('v2DetailNumber').value = text;

      let reverted = false;
      { const live = window.__shrinkLive;
        // v2.279: no "is the reducer's own root on screen" test here: after a first slider move the reducer is re-based ON the fixed/fused model (live.root === working model), and 100% must still mean the untouched upload
        const processed = ['shrunk', 'fixed', 'fused', 'rebuilt', 'clay', 'hollowed', 'edited'].some(k => appliedChanges.has(k)) || detailScale < 0.999;
        if (live?.root && sourceModel() && app()?.originalModel && sourceModel() !== app().originalModel && processed) {
          const cur = Math.min(1, modelTriangles(sourceModel()) / origTrisOf());
          if (value >= 99.95 || value / 100 > cur * 1.05) {            // asking for more detail than the processed model has: go back to the upload
            window.__shrinkSetWorkingModel?.(app().originalModel); clearApplied(); fuseReady = false; shrinkReady = false; reverted = true;
            const note = $('v2DetailNote'); if (note) note.textContent = 'Back to the original model. FIX IT and FUSE IT were undone: run them again if you still need them.';
          }
        } }
      await ensureLiveRebased();
      if (reverted) detailScale = 1;
      const nativeVal = detailScale < 1 ? Math.min(100, value / detailScale) : value;
      setNative('geometry', String(Math.round(nativeVal * 10) / 10), 'input');
      if (reverted && value < 100) { appliedChanges.add('shrunk'); renderAppliedChanges(); }
    }

    window.__shrinkApplyDetail = applyDetailValue;

    // SHRINK found its own level: show it in the slider (no input event, the reducer is already there) and say what limited it.
    window.addEventListener('shrink:auto-found', e => {
      const d = e.detail || {}; if (!(d.ratio > 0)) return;
      detailManual = false;
      const text = String(Math.round(Math.max(1, Math.min(100, d.ratio * 100 * detailScale)) * 10) / 10);
      if ($('v2Detail').value !== text) $('v2Detail').value = text;
      if ($('v2DetailNumber').value !== text) $('v2DetailNumber').value = text;
      const note = $('v2DetailNote'); if (!note) return;
      const mm = Number(d.detailMM);
      note.textContent = d.ratio >= 0.999 ? `Nothing could be removed without moving the surface more than ${mm} mm (${d.strict} of it).`
        : d.ratio >= 0.5 ? `Limited by the printer detail: going lower would move more than ${d.strict} of the surface by over ${mm} mm. A coarser printer setting keeps fewer triangles.`
        : `Smallest size that keeps ${d.strict} of the surface within ${mm} mm.`;
    });
    $('v2Detail').addEventListener('input', () => applyDetailValue($('v2Detail').value, 'slider'));
    $('v2DetailNumber').addEventListener('input', () => {
      const v = $('v2DetailNumber').value;
      if (v === '' || v === '-' || v === '.') return;
      applyDetailValue(v, 'number');
    });
    $('v2DetailNumber').addEventListener('change', () => applyDetailValue($('v2DetailNumber').value, 'number'));

    const h = Number(nativeValue('figureHeightMm', 75)) || 75;
    $('v2Height').value = h; $('v2HeightRange').value = Math.max(10, Math.min(300, h));
    const geom = 70; $('v2Detail').value = geom; $('v2DetailNumber').value = geom;   /* v2.268: always the recommended 70 on load; the browser's restored form value (an earlier 100%) is not used */
    { const sp = savedPrinter(), okT = ['resin', 'fdm', 'custom'], okQ = ['standard', 'fine', 'ultra', 'large'];
      restoringPrinter = true;
      try { choosePrinter(sp && okT.includes(sp.type) ? sp.type : 'resin'); setQuality(sp && okQ.includes(sp.quality) ? sp.quality : 'ultra'); } finally { restoringPrinter = false; } }
    syncSplitControls();

    new MutationObserver(syncSplitControls).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('shrink:model-opened', e => { autoReady = false; settingsDirty = false; detailUpdating = false; updateWorkflowButtons(); poseD = null; { const cur = currentPrinter(); if (cur.type === 'resin' && cur.id !== 'r16') { try { restoringPrinter = true; const sel = $('v2PrinterSel'); if (sel) { sel.value = 'r16'; sel.dispatchEvent(new Event('change', { bubbles: true })); } } finally { restoringPrinter = false; } } } window.__shrinkLastFuse = null; window.__shrinkLastVerdict = null; detailManual = false; manualLevel = ''; detailScale = 1; { const d = $('v2Detail'), n = $('v2DetailNumber'); if (d) d.value = '70'; if (n) n.value = '70'; } { const n = $('v2DetailNote'); if (n) n.textContent = ''; } { const dl = $('v2MagicDownload'); if (dl) dl.disabled = true; } removeBedGuide(); setWorkingModel(app()?.originalModel); clearApplied(); fuseReady = false; shrinkReady = false; markStep(1, 'done'); markStep(2, 'active'); syncSplitControls(); setTimeout(updateHealthCard, 80); });
    window.addEventListener('shrink:reduced', () => setTimeout(updateHealthCard, 80));
  }

  function activate() {
    const workspace = $('workspace');
    if (!workspace || workspace.classList.contains('hidden') || !app()?.originalModel) {
      if (dashboard) dashboard.hidden = true;
      return;
    }
    createDashboard();
    if (!dashboard || !viewerPanel) return;
    dashboard.hidden = false;
    workspace.classList.add('print-v2-native-hidden');
    document.body.classList.add('print-v2-active');
    syncSplitControls();
  }

  function deactivate() {
    if (!dashboard) return;
    dashboard.hidden = true;
    document.body.classList.remove('print-v2-active');
    const workspace = $('workspace');
    if (workspace) workspace.classList.remove('print-v2-native-hidden');
    if (viewerPanel && viewerHome && viewerPanel.parentElement !== viewerHome) viewerHome.insertBefore(viewerPanel, viewerNext);
  }

  function onMode() {
    ensureMagicButton(); ensureDiagButton();
    { const mb = $('v2MagicBtn'); if (mb && !mb.dataset.busy) mb.disabled = !sourceModel() || mb.dataset.state === 'checking'; } updateWorkflowButtons();
    const print = document.body.classList.contains('app-mode-print');
    if (!print) removeBedGuide();
    if (print) activate(); else deactivate();
  }

  window.addEventListener('shrink:ui-mode', onMode);
  window.addEventListener('shrink:model-opened', () => setTimeout(onMode, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onMode, { once: true }); else onMode();
})();
