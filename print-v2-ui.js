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
  function downloadStem(base) {
    return `${cleanBaseName(base)}-SHRINK`;
  }

  window.__shrinkDownloadStem = downloadStem;


  // Make a tool's result the new current working model: show it, keep the camera, tell the rest of the app,
  // record the change chip and clear the red warning. Fix It, Make watertight and any future tool go through here.
  function installWorkingResult(root, kind) {
    const view = app()?.getViewState?.();
    app()?.setPreview?.(root);
    setWorkingModel(root);
    app()?.show?.('optimized');
    if (view) app()?.restoreViewState?.(view);
    app()?.notifyReduced?.({ kind });
    markApplied(kind === 'rebuild' ? 'rebuilt' : kind === 'clay' ? 'clay' : 'fixed');
    window.__shrinkPrintSafety?.clearDiagnostic?.();
    return root;
  }
  window.__shrinkInstallWorkingModel = installWorkingResult;
  window.__shrinkRefreshHealth = () => updateHealthCard();
  function renderAppliedChanges() {
    const wrap = $('v2HealthChanges');
    if (!wrap) return;
    const order = ['clay','fixed','rebuilt','fused','shrunk'];
    const labels = { clay:'CLAY', fixed:'FIXED', rebuilt:'REBUILT', fused:'FUSED', shrunk:'SHRUNK' };
    const chips = order.filter(k => appliedChanges.has(k))
      .map(k => `<span class="v2-change-chip ${k}"><i></i>${labels[k]}</span>`)
      .join('');
    wrap.innerHTML = chips
      ? `<small>CHANGES</small><div>${chips}</div>`
      : '<small>CHANGES</small><div class="v2-change-none">None yet</div>';
  }

  function markApplied(kind) {
    appliedChanges.add(kind);
    renderAppliedChanges();
  }

  function clearApplied() {
    appliedChanges.clear();
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

  function healthScore(h) {
    if (!h) return { score: 0, label: 'Checking…', level: 'checking' };
    let score = 100;
    if (h.openEdges > 0) score -= 35;
    if (h.pinchedEdges > 0) score -= 35;
    if (h.flippedEdges > 0) score -= 20;
    if (h.degenerateTriangles > 0) score -= 10;
    score = Math.max(0, score);
    const label = score === 100 ? 'Excellent' : score >= 80 ? 'Good' : score >= 55 ? 'Needs attention' : 'Poor';
    const level = score === 100 ? 'good' : score >= 80 ? 'fair' : 'bad';
    return { score, label, level };
  }

  function healthRow(label, value, ok) {
    return `<div class="v2-health-row"><span>${label}</span><strong class="${ok ? 'ok' : 'issue'}">${value}</strong></div>`;
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
    `;
    viewer.appendChild(card);
    $('v2MagicNote').addEventListener('click', () => { $('v2MagicNote').hidden = true; });
    return card;
  }

  let healthRun = 0;
  let rebasing = null;                          // a re-base of the live reducer that is in flight (the slider waits for it)
  let lastHealth = null;                         // { model, h }: the newest health result and the model it belongs to
  // A yellow triangle above the tools while the working model is too detailed to fuse or fix without freezing the tab.
  function updateSizeWarning() {
    const anchor = $('v2ShrinkCard'); if (!anchor) return;
    let el = $('v2SizeWarn');
    if (!el) { el = document.createElement('div'); el.id = 'v2SizeWarn'; el.className = 'v2-size-warn'; el.hidden = true; el.setAttribute('role', 'status'); anchor.before(el); }
    const model = sourceModel(), tris = model ? modelTriangles(model) : 0, limit = window.__shrinkFuseTriLimit || FUSE_MAX_TRIANGLES;
    const big = tris > limit;
    if (big) el.innerHTML = `<span class="v2-size-warn-icon" aria-hidden="true">⚠</span><div><strong>This model is very detailed (${tris.toLocaleString()} triangles)</strong><span>Press <b>SHRINK IT</b> first, then <b>FIX IT</b> or <b>FUSE IT</b>. Fusing or fixing this many triangles can freeze the page.</span></div>`;
    if (el.hidden === big) el.hidden = !big;
  }
  window.__shrinkRefreshSizeWarning = updateSizeWarning;

  async function updateHealthCard() {
    updateSizeWarning();
    const card = ensureHealthCard();
    const model = healthModel();
    if (!card || !model) return;
    const run = ++healthRun;
    card.className = 'v2-health-card checking';
    $('v2HealthLabel').textContent = 'Checking…';
    $('v2HealthScore').textContent = '—';
    $('v2HealthRows').innerHTML = '<div class="v2-health-checking">Running mesh checks…</div>';
    await wait(60);
    if (run !== healthRun) return;
    try {
      for (let i = 0; i < 40 && !window.__shrinkPrintSafety?.topologySummary; i++) await wait(50);
      const h = window.__shrinkPrintSafety?.topologySummary?.(model);
      if (!h || run !== healthRun) return;
      lastHealth = { model, h };
      const rating = healthScore(h);
      card.className = `v2-health-card ${rating.level}`;
      $('v2HealthLabel').textContent = rating.label;
      $('v2HealthScore').textContent = String(rating.score);
      const watertight = h.openEdges === 0;
      const manifold = h.pinchedEdges === 0;
      const oriented = h.flippedEdges === 0;
      const cleanDegens = h.degenerateTriangles === 0;
      $('v2HealthRows').innerHTML =
        healthRow('Watertight', watertight ? 'YES' : 'NO', watertight) +
        healthRow('Open edges', new Intl.NumberFormat().format(h.openEdges), h.openEdges === 0) +
        healthRow('Non-manifold', new Intl.NumberFormat().format(h.pinchedEdges), manifold) +
        healthRow('Flipped faces', new Intl.NumberFormat().format(h.flippedEdges), oriented) +
        healthRow('Degenerates', new Intl.NumberFormat().format(h.degenerateTriangles), cleanDegens);
    } catch (err) {
      card.className = 'v2-health-card bad';
      $('v2HealthLabel').textContent = 'Check failed';
      $('v2HealthScore').textContent = '—';
      $('v2HealthRows').innerHTML = '<div class="v2-health-checking">Could not analyse this mesh.</div>';
      console.warn('[SHRINK 3D v2.55] Health card check failed', err);
    }
  }

  // Little progress bar in the health card while FIX IT works. The repair itself is one blocking step, so the bar is staged (it is painted before each step)
  // and carries a sliding stripe (a CSS transform animation keeps moving while the page is busy).
  const paintNow = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));
  async function fixStep(pct, text) {
    const box = $('v2FixProgress'); if (!box) return;
    box.hidden = false; box.dataset.busy = pct < 100 ? '1' : '';
    $('v2FixFill').style.width = `${pct}%`; $('v2FixLabel').textContent = text || '';
    progress($('v2FixCard'), pct, text);
    await paintNow();
  }
  async function fixHealthModel() {
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
  }


  // ---- Width / Depth read-outs: the print is always scaled uniformly from the height, so width and depth follow it ----
  let sizeCache = { key: '', size: null }, reducedTick = 0;
  function modelSize() {
    const THREE = app()?.THREE, model = sourceModel();
    if (!THREE || !model) return null;
    model.updateWorldMatrix(true, true);
    const key = [model.uuid, reducedTick, ...model.matrixWorld.elements.map(v => v.toFixed(4))].join('|');
    if (sizeCache.key === key) return sizeCache.size;
    const b = new THREE.Box3().setFromObject(model, true);
    const size = b.isEmpty() ? null : b.getSize(new THREE.Vector3());
    sizeCache = { key, size }; return size;
  }
  function refreshDims() {
    const w = $('v2Width'), d = $('v2Depth'); if (!w || !d) return;
    const sz = modelSize(), h = Number($('v2Height')?.value) || 0;
    const ok = !!(sz && sz.y > 1e-9 && h);
    [w, d].forEach(i => { i.disabled = !ok; });
    $('v2ScaleUp') && ($('v2ScaleUp').disabled = !ok); $('v2ScaleDown') && ($('v2ScaleDown').disabled = !ok);
    if (!ok) { if (w.value !== '') w.value = ''; if (d.value !== '') d.value = ''; return; }
    const k = h / sz.y, set = (el, v) => { if (document.activeElement !== el) { const t = (Math.round(v * 10) / 10).toString(); if (el.value !== t) el.value = t; } };
    set(w, sz.x * k); set(d, sz.z * k);
  }
  function setHeightMm(h) {
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

  function choosePrinter(type) {
    dashboard.dataset.printerType = type;
    dashboard.querySelectorAll('[data-printer]').forEach(b => b.classList.toggle('active', b.dataset.printer === type));
    if (type === 'resin') setNative('printerPreset', '0.05');
    if (type === 'fdm') setNative('printerPreset', '0.2');
    if (type === 'custom') setNative('printerPreset', 'custom');
    $('v2CustomPrinter').hidden = type !== 'custom';
    updateStep1Summary();
    markStep(1, 'done');
  }

  function setQuality(kind) {
    dashboard.dataset.quality = kind;
    dashboard.querySelectorAll('[data-quality]').forEach(b => b.classList.toggle('active', b.dataset.quality === kind));
    const type = dashboard.dataset.printerType || 'resin';
    let detail = type === 'fdm' ? 0.2 : 0.05;
    if (kind === 'fine') detail = type === 'fdm' ? 0.15 : 0.03;
    if (kind === 'large') detail = type === 'fdm' ? 0.3 : 0.1;
    setNative('printerPreset', 'custom');
    setNative('printerDetailMm', detail, 'input');
    const adv = $('v2PrinterDetail'); if (adv) adv.value = String(detail);
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
  async function fuseCheck() {
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
      markApplied('fused');
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

  async function shrinkModel() {
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
      if (window.__shrinkLiveUI?.rebaseWorking) await window.__shrinkLiveUI.rebaseWorking(sourceModel());
      window.__shrinkLive?.setTidy?.(wasClean === true);
    } catch (err) {
      btn.disabled = false;
      progress(card, 100, 'Could not prepare the current model.');
      $('v2ShrinkResult').innerHTML = `<strong>Could not SHRINK</strong><span>${err.message}</span>`;
      return;
    }
    progress(card, 8, 'Finding the smallest version that still looks the same…');
    $('v2ShrinkResult').textContent = 'SHRINK is testing different detail levels automatically.';
    source.click();
    let pct = 8;
    const timer = setInterval(() => {
      pct = Math.min(88, pct + 4);
      progress(card, pct, 'Comparing shape and detail…');
    }, 450);
    try {
      for (let i = 0; i < 600; i++) {
        await wait(100);
        if (!source.disabled) break;
      }
      const live = $('liveLine')?.innerText?.replace(/\s+/g, ' ').trim() || '';
      const verdict = $('verdictText')?.textContent || '';
      const reducedRoot = window.__shrinkLive?.root || app()?.optimizedModel;
      if (reducedRoot) setWorkingModel(reducedRoot);
      markApplied('shrunk');
      shrinkReady = true;
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
    const size = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
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
    const label = (txt, col, pos) => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = col; x.fillText(txt, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
      sp.scale.setScalar(len * 0.16); sp.position.copy(pos); sp.renderOrder = 10; g.add(sp);
    };
    [['X', 0xff4d4d, '#ff6b6b', new THREE.Vector3(1, 0, 0)], ['Y', 0x4dff7a, '#7dff9d', new THREE.Vector3(0, 1, 0)], ['Z', 0x4d9bff, '#7db4ff', new THREE.Vector3(0, 0, 1)]].forEach(([t, hex, css, dir]) => {
      const a = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), len, hex, head, head * 0.55);
      a.line.material.depthTest = false; a.cone.material.depthTest = false; a.renderOrder = 9; a.line.renderOrder = 9; a.cone.renderOrder = 9; g.add(a);
      label(t, css, dir.clone().multiplyScalar(len + head * 1.1));
    });
    v.scene.add(g);
    v.scene.children.forEach(o => { if (o.isGridHelper && o.parent === v.scene) { o.userData._shrinkHidden = true; o.visible = false; } });
  }
  window.__shrinkBedGuide = { show: showBedGuide, remove: removeBedGuide };
  window.__shrinkCentre = () => centreOnBed();
  async function shrinkMyModel() {
    ensureHealthCard(); const btn = $('v2MagicBtn'), note = $('v2MagicNote');
    if (!btn || btn.disabled || !sourceModel()) return;
    btn.disabled = true; btn.dataset.busy = '1'; const label = btn.textContent; { const dl = $('v2MagicDownload'); if (dl) dl.disabled = true; }
    const rows = []; const show = (busy) => { note.hidden = false; note.innerHTML = rows.map(r => `<div class="${r.cls}"><i>${r.icon}</i><span>${r.text}</span></div>`).join('') + (busy ? `<div class="busy"><i>…</i><span>${busy}</span></div>` : '') + '<button type="button" class="v2-magic-x" aria-label="Close" title="Close">×</button>'; };
    const done = (cls, icon, text) => { rows.push({ cls, icon, text }); show(); };
    try {
      const startTris = modelTriangles(sourceModel());
      // 1. SHRINK
      btn.textContent = '1/4 Shrinking…'; show('Shrinking…'); await paintNow();
      try { await shrinkModel(); const now = modelTriangles(sourceModel()); done('ok', '✓', `Shrunk: ${startTris.toLocaleString()} → ${now.toLocaleString()} triangles`); }
      catch (err) { done('warn', '⚠', `Could not shrink (${err.message || err})`); }
      // 2. FIX (only if the health check says something is wrong)
      btn.textContent = '2/4 Fixing…'; show('Checking and fixing…'); await updateHealthCard(); await paintNow();
      if ($('v2HealthScore')?.textContent === '100' && !window.__shrinkClay?.hasClay?.()) done('ok', '✓', 'Already clean: nothing to fix');
      else {
        await fixHealthModel(); await wait(60);
        const sc = Number($('v2HealthScore')?.textContent);
        done(sc === 100 ? 'ok' : 'warn', sc === 100 ? '✓' : '⚠', sc === 100 ? 'Fixed: the model is watertight' : `Fixed what could be fixed (health ${Number.isFinite(sc) ? sc + '/100' : 'unknown'})`);
      }
      // 3. FUSE
      btn.textContent = '3/4 Fusing…'; show('Fusing…'); await paintNow();
      const fc = $('v2FuseCard'); if (fc) fc.dataset.state = '';
      await fuseCheck(); await wait(60);
      const fs = fc?.dataset.state;
      done(fs === 'good' ? 'ok' : 'warn', fs === 'good' ? '✓' : '⚠', fs === 'good' ? 'Fused: touching parts joined' : 'Could not fuse this model (see the Fuse box). It is still fixed and shrunk');
      // 4. CENTRE
      btn.textContent = '4/4 Levelling…'; show('Levelling and centring…'); await paintNow();
      try { if (resetStretch()) done('ok', '✓', 'Width and depth set back to the original proportions'); } catch (e) { console.warn('stretch reset', e); }
      let lv = null; try { lv = levelModel(); } catch (e) { console.warn('level', e); }
      if (lv?.ok && lv.changed) done('ok', '✓', `Model ${lv.text}`);
      reducedTick++; const cr = centreOnBed(); setTimeout(refreshDims, 50); if (cr.ok) { try { showBedGuide(); } catch (e) { console.warn('bed guide', e); } } done(cr.ok ? 'ok' : 'warn', cr.ok ? '✓' : '⚠', cr.ok ? `Model ${cr.text}` : `Could not centre: ${cr.text}`);
      rows.push({ cls: 'end', icon: '', text: 'Ready: press Download when you are happy.' }); show();
      markStep?.(4, 'active');
      { const dl = $('v2MagicDownload'); if (dl) dl.disabled = false; }
    } catch (err) {
      console.error('[SHRINK 3D] SHRINK MY MODEL failed', err);
      done('warn', '⚠', `Stopped: ${err.message || err}`);
    } finally {
      delete btn.dataset.busy; btn.disabled = false; btn.textContent = label;
    }
  }

  function ensureMagicButton() {
    if ($('v2MagicBtn')) return;
    const top = document.querySelector('.topbar'); if (!top) return;
    const wrap = document.createElement('div'); wrap.className = 'v2-magic-wrap';
    wrap.innerHTML = '<button id="v2MagicBtn" class="v2-magic" type="button" title="Shrinks, fixes and fuses your model, then centres it flat on the print bed, as far as it can.">QUICK-FIX (shrink, fix and fuse)</button><button id="v2MagicDownload" class="v2-magic v2-magic-dl" type="button" disabled title="Switches on when QUICK-FIX has finished. Downloads your finished model.">DOWNLOAD</button>';
    const pill = top.querySelector('.privacy-pill'); if (pill) top.insertBefore(wrap, pill); else top.appendChild(wrap);
    $('v2MagicBtn').addEventListener('click', shrinkMyModel);
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
    syncAdvancedToNative();
    chooseSplit();
    // Fuse is an explicit tool (FUSE IT) that already advanced the working model. Download exports the current
    // working model as it is, or splits it. It must never switch Fuse on, or the Fuse export would swallow the split.
    if ($('fuseSolidToggle')) setNative('fuseSolidToggle', false, 'change');
    markStep(4, 'done');
    $('saveStlBtn')?.click();
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
          <section class="v2-card v2-setup-card">
            <div class="v2-card-head"><span class="v2-num">1</span><div><h2>Choose your printer & size</h2><p>No model numbers needed — just choose the kind of printer.</p></div></div>
            <div class="v2-printer-grid">
              <button type="button" class="v2-choice active" data-printer="resin"><span>💧</span><strong>Resin printer</strong><small>Best for miniatures & fine detail</small></button>
              <button type="button" class="v2-choice" data-printer="fdm"><span>🧱</span><strong>FDM printer</strong><small>Best for larger, tougher parts</small></button>
              <button type="button" class="v2-choice" data-printer="custom"><span>⚙️</span><strong>Custom</strong><small>Set your own detail limit</small></button>
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
            <div class="v2-quality-row">
              <span>Quality</span>
              <button type="button" class="active" data-quality="standard">Standard</button>
              <button type="button" data-quality="fine">Fine detail</button>
              <button type="button" data-quality="large">Large / fast</button>
            </div>
            <div id="v2Step1Summary" class="v2-summary">Resin · 75 mm high</div>
            <details class="v2-advanced"><summary>Advanced printer settings</summary><div class="v2-advanced-body"><label id="v2CustomPrinter" hidden>Smallest detail to keep (mm)<input id="v2PrinterDetail" type="number" min="0.005" step="0.005" value="0.05"></label><p>Technical users can set the printer's smallest visible detail here. SHRINK uses this when judging whether a change will be visible.</p></div></details>
          </section>

          <details id="v2AdvTools" class="v2-adv-tools">
            <summary><span>ADVANCED</span><strong>Clay, shrink, fix and fuse</strong><small>QUICK-FIX (top right) does shrink, fix and fuse for you. Open this to use the tools separately or to paint clay.</small></summary>
          <section id="v2ClayCard" class="v2-card v2-clay-card"><div id="v2ClayHost"></div></section>

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
              <details class="v2-advanced"><summary>Advanced optimisation settings</summary><div class="v2-advanced-body"><label>Detail kept<div class="v2-detail-control"><input id="v2Detail" type="range" min="1" max="100" step="0.1" value="70"><div class="v2-detail-number"><input id="v2DetailNumber" type="number" min="1" max="100" step="0.1" value="70" inputmode="decimal" aria-label="Detail kept percentage"><span>%</span></div></div></label><p>Drag the slider or type the percentage you want to keep.</p></div></details>
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

          </div>
          </details>

          <div class="v2-action-grid v2-download-grid">
            <section class="v2-card v2-action-card v2-download-card">
              <div class="v2-card-head"><div><h2>Download</h2><p>Save one STL, or split it into printable sections with pegs.</p></div></div>
              <div class="v2-download-options"><label>Split into<select id="v2SplitMode"><option value="off">One STL</option><option value="2">2 parts</option><option value="3">3 parts</option><option value="max">Auto by maximum height</option></select></label><label>Joint<select id="v2Joint"><option value="pegs">Keyed twin pegs</option><option value="flat">Flat cut — no pegs</option></select></label></div>
              <div id="v2MaxWrap" class="v2-cut-row" hidden><div><span>Maximum part height</span><strong>mm</strong></div><input id="v2MaxHeight" type="number" min="20" max="500" step="5" value="80"></div>
              <div id="v2CutWrap" class="v2-cut-row" hidden><div><span>Cut height</span><strong id="v2CutLabel">50%</strong></div><input id="v2Cut" type="range" min="10" max="90" step="0.5" value="50"></div>
              <div id="v2BestCutRow" class="v2-bestcut-row" hidden><label class="v2-check"><input id="v2AutoCut" type="checkbox" checked> Pick the best cut for me</label><button id="v2BestCut" class="v2-peg-reset" type="button">FIND AGAIN</button><span id="v2BestCutNote">Chooses a cut through one solid outline, away from thin arms and axes, with room for pegs. Drag the Cut height yourself to take over.</span></div><div id="v2PegStatus" class="v2-peg-status" role="status" aria-live="polite" hidden></div><button id="v2DownloadBtn" class="v2-mega v2-red" type="button">DOWNLOAD IT</button>
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

    dashboard.querySelectorAll('[data-printer]').forEach(b => b.addEventListener('click', () => choosePrinter(b.dataset.printer)));
    dashboard.querySelectorAll('[data-quality]').forEach(b => b.addEventListener('click', () => setQuality(b.dataset.quality)));
    $('v2Height').addEventListener('input', updateHeight);
    $('v2Width').addEventListener('change', () => dimInput('x'));
    $('v2Depth').addEventListener('change', () => dimInput('z'));
    $('v2Uniform').addEventListener('change', () => { if ($('v2Uniform').checked) resetStretch(); });
    $('v2ScaleUp').addEventListener('click', () => scaleBy(1.1));
    $('v2ScaleDown').addEventListener('click', () => scaleBy(0.9));
    window.addEventListener('shrink:reduced', () => { reducedTick++; refreshDims(); });
    window.addEventListener('shrink:model-opened', () => { const u = $('v2Uniform'); if (u) u.checked = true; setTimeout(refreshDims, 150); });
    setTimeout(refreshDims, 300);
    $('v2HeightRange').addEventListener('input', () => { $('v2Height').value = $('v2HeightRange').value; updateHeight(); });
    $('v2PrinterDetail').addEventListener('input', () => { setNative('printerPreset', 'custom'); setNative('printerDetailMm', $('v2PrinterDetail').value, 'input'); });
    $('v2FuseBtn').addEventListener('click', fuseCheck);
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
    async function applyDetailValue(raw, source = 'slider') {
      let value = Number(raw);
      if (!Number.isFinite(value)) value = Number($('v2Detail')?.value || 70);
      value = Math.max(1, Math.min(100, value));
      const text = String(Math.round(value * 10) / 10);
      $('v2Detail').value = text;
      $('v2DetailNumber').value = text;

      // The control drives the live reducer's own preview. If another tool (FIX IT, FUSE IT, Make watertight) has since replaced the
      // working model, that preview is no longer on screen, so re-base the reducer on the current model before moving it.
      const live = window.__shrinkLive;
      if (live?.root && sourceModel() && sourceModel() !== live.root && window.__shrinkLiveUI?.rebaseWorking) {
        rebasing = rebasing || (async () => {
          try {
            const model = sourceModel();
            const known = lastHealth && lastHealth.model === model ? lastHealth.h : window.__shrinkPrintSafety?.topologySummary?.(model);
            await window.__shrinkLiveUI.rebaseWorking(model);
            window.__shrinkLive?.setTidy?.(known ? known.clean === true : false);
          } finally { rebasing = null; }
        })();
        await rebasing;
      }
      setNative('geometry', text, 'input');
    }

    $('v2Detail').addEventListener('input', () => applyDetailValue($('v2Detail').value, 'slider'));
    $('v2DetailNumber').addEventListener('input', () => {
      const v = $('v2DetailNumber').value;
      if (v === '' || v === '-' || v === '.') return;
      applyDetailValue(v, 'number');
    });
    $('v2DetailNumber').addEventListener('change', () => applyDetailValue($('v2DetailNumber').value, 'number'));

    const h = Number(nativeValue('figureHeightMm', 75)) || 75;
    $('v2Height').value = h; $('v2HeightRange').value = Math.max(10, Math.min(300, h));
    const geom = Number(nativeValue('geometry', 70)) || 70; $('v2Detail').value = geom; $('v2DetailNumber').value = geom;
    choosePrinter('resin');
    setQuality('standard');
    syncSplitControls();

    new MutationObserver(syncSplitControls).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('shrink:model-opened', () => { poseD = null; { const dl = $('v2MagicDownload'); if (dl) dl.disabled = true; } removeBedGuide(); setWorkingModel(app()?.originalModel); clearApplied(); fuseReady = false; shrinkReady = false; markStep(1, 'done'); markStep(2, 'active'); syncSplitControls(); setTimeout(updateHealthCard, 80); });
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
    ensureMagicButton();
    { const mb = $('v2MagicBtn'); if (mb && !mb.dataset.busy) mb.disabled = !sourceModel(); }
    const print = document.body.classList.contains('app-mode-print');
    if (!print) removeBedGuide();
    if (print) activate(); else deactivate();
  }

  window.addEventListener('shrink:ui-mode', onMode);
  window.addEventListener('shrink:model-opened', () => setTimeout(onMode, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onMode, { once: true }); else onMode();
})();
