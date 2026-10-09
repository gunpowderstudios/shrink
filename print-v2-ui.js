// SHRINK 3D v2.67 — smooth axis sliders for manual split-peg positioning.
(() => {
  const VERSION = '2.67';
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
    // If the source already ends in a height such as H37mm, replace it with the
    // current print height rather than creating H37mm-H100.
    return String(base || 'model')
      .replace(/[-_ ]H\d+(?:\.\d+)?(?:mm)?$/i, '')
      .replace(/[-_ ]+$/g, '') || 'model';
  }

  function downloadStem(base) {
    const parts = [cleanBaseName(base)];
    const height = Math.max(1, Number($('v2Height')?.value || $('figureHeightMm')?.value || 75));
    const hText = Number.isInteger(height) ? String(height) : String(Number(height.toFixed(1))).replace('.', 'p');
    parts.push(`H${hText}`, 'SHRINK');

    if (appliedChanges.has('fixed')) parts.push('FIX');
    if (appliedChanges.has('rebuilt')) parts.push('REBUILD');
    if (appliedChanges.has('fused')) parts.push('FUSE');

    if (appliedChanges.has('shrunk')) {
      const original = modelTriangles(app()?.originalModel);
      const current = modelTriangles(sourceModel());
      if (original > 0 && current > 0) {
        const pct = current / original * 100;
        const r = pct < 10 ? Math.max(0.1, Math.round(pct * 10) / 10) : Math.round(pct);
        parts.push(`R${String(r).replace('.', 'p')}`);
      } else {
        parts.push('REDUCED');
      }
    }
    return parts.join('-');
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
    markApplied(kind === 'rebuild' ? 'rebuilt' : 'fixed');
    window.__shrinkPrintSafety?.clearDiagnostic?.();
    return root;
  }
  window.__shrinkInstallWorkingModel = installWorkingResult;
  window.__shrinkRefreshHealth = () => updateHealthCard();
  function renderAppliedChanges() {
    const wrap = $('v2HealthChanges');
    if (!wrap) return;
    const order = ['fixed','rebuilt','fused','shrunk'];
    const labels = { fixed:'FIXED', rebuilt:'REBUILT', fused:'FUSED', shrunk:'SHRUNK' };
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
      <button id="v2HealthFixBtn" class="v2-health-fix" type="button">FIX IT</button>
    `;
    card.querySelector('#v2HealthFixBtn')?.addEventListener('click', fixHealthModel);
    viewer.appendChild(card);
    return card;
  }

  let healthRun = 0;
  let rebasing = null;                          // a re-base of the live reducer that is in flight (the slider waits for it)
  let lastHealth = null;                         // { model, h }: the newest health result and the model it belongs to
  async function updateHealthCard() {
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
      const fixBtn = $('v2HealthFixBtn');
      if (fixBtn) {
        const healthyNow = rating.score === 100;
        fixBtn.hidden = healthyNow;
        if (!healthyNow) {
          fixBtn.textContent = 'FIX IT';
          fixBtn.disabled = false;
        }
      }
    } catch (err) {
      card.className = 'v2-health-card bad';
      $('v2HealthLabel').textContent = 'Check failed';
      $('v2HealthScore').textContent = '—';
      $('v2HealthRows').innerHTML = '<div class="v2-health-checking">Could not analyse this mesh.</div>';
      console.warn('[SHRINK 3D v2.55] Health card check failed', err);
    }
  }

  async function fixHealthModel() {
    const btn = $('v2HealthFixBtn');
    const model = healthModel();
    if (!btn || !model || btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'FIXING…';
    try {
      for (let i = 0; i < 50 && !window.__shrinkFuse?.repairModel; i++) await wait(100);
      if (!window.__shrinkFuse?.repairModel) throw new Error('The repair engine is still loading.');
      const { root } = window.__shrinkFuse.repairModel(model);
      installWorkingResult(root, 'repair');
      btn.textContent = 'FIXED';
      await wait(80);
      await updateHealthCard();
      const card = $('v2HealthCard');
      if (card && $('v2HealthScore')?.textContent === '100') btn.hidden = true;
    } catch (err) {
      console.error('[SHRINK 3D v2.55] Health repair failed', err);
      btn.textContent = 'COULD NOT FIX';
      window.__shrinkPrintSafety?.showDiagnostic?.('Fuse', err?.message || String(err));
      setTimeout(() => { if (btn) btn.textContent = 'FIX IT'; }, 1800);
    } finally {
      btn.disabled = false;
      if (!btn.hidden && btn.textContent === 'FIXING…') btn.textContent = old;
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
  }

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

  let activePegCut = 0;

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
            <div class="v2-quality-row">
              <span>Quality</span>
              <button type="button" class="active" data-quality="standard">Standard</button>
              <button type="button" data-quality="fine">Fine detail</button>
              <button type="button" data-quality="large">Large / fast</button>
            </div>
            <div id="v2Step1Summary" class="v2-summary">Resin · 75 mm high</div>
            <details class="v2-advanced"><summary>Advanced printer settings</summary><div class="v2-advanced-body"><label id="v2CustomPrinter" hidden>Smallest detail to keep (mm)<input id="v2PrinterDetail" type="number" min="0.005" step="0.005" value="0.05"></label><p>Technical users can set the printer's smallest visible detail here. SHRINK uses this when judging whether a change will be visible.</p></div></details>
          </section>

          <div class="v2-tool-intro">
            <span>3D PRINT MULTITOOL</span>
            <strong>USE ANY TOOL YOU NEED</strong>
            <small>Fuse it, shrink it, download it — use one, two or all three.</small>
          </div>

          <div class="v2-action-grid">
            <section id="v2FuseCard" class="v2-card v2-action-card v2-fuse-card">
              <div class="v2-card-head"><div><h2>Fuse it</h2><p>Repair mesh problems and join parts that genuinely touch or overlap.</p></div></div>
              <button id="v2FuseBtn" class="v2-mega v2-purple" type="button">FUSE IT</button>
              <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
              <div id="v2FuseResult" class="v2-result">SHRINK repairs the mesh and joins touching parts. Separate watertight parts are fine and will be left intact.</div>
              <details class="v2-advanced"><summary>Advanced repair settings & diagnostics</summary><div class="v2-advanced-body"><p>Welds near-duplicate vertices, removes bad triangles and joins touching/overlapping parts. Multiple closed components are valid; SHRINK only reports a repair problem when the mesh itself is open or non-manifold.</p></div></details>
            </section>

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

            <section class="v2-card v2-action-card v2-download-card">
              <div class="v2-card-head"><div><h2>Download</h2><p>Save one STL, or split it into printable sections with pegs.</p></div></div>
              <div class="v2-download-options"><label>Split into<select id="v2SplitMode"><option value="off">One STL</option><option value="2">2 parts</option><option value="3">3 parts</option><option value="max">Auto by maximum height</option></select></label><label>Joint<select id="v2Joint"><option value="pegs">Keyed twin pegs</option><option value="flat">Flat cut — no pegs</option></select></label></div>
              <div id="v2MaxWrap" class="v2-cut-row" hidden><div><span>Maximum part height</span><strong>mm</strong></div><input id="v2MaxHeight" type="number" min="20" max="500" step="5" value="80"></div>
              <div id="v2CutWrap" class="v2-cut-row" hidden><div><span>Cut height</span><strong id="v2CutLabel">50%</strong></div><input id="v2Cut" type="range" min="10" max="90" step="0.5" value="50"></div>
              <button id="v2DownloadBtn" class="v2-mega v2-red" type="button">DOWNLOAD IT</button>
              <details class="v2-advanced"><summary>Advanced split settings</summary><div class="v2-advanced-body v2-advanced-grid"><label>Peg position<select id="v2PegPosition"><option value="auto">Auto — safest position</option><option value="manual">Manual — position pegs</option></select></label><button id="v2PegReset" class="v2-peg-reset" type="button" hidden>RESET PEG POSITIONS</button><div id="v2PegAxisPanel" class="v2-peg-axis-panel" hidden><label id="v2PegCutWrap" class="v2-peg-cut" hidden>Cut<select id="v2PegCut"></select></label><div class="v2-peg-axis-group v2-peg1"><strong><i></i> Peg 1</strong><label><span>Left</span><input id="v2Peg1X" type="range" min="0" max="100" step="0.25" value="50"><span>Right</span></label><label><span>Back</span><input id="v2Peg1Z" type="range" min="0" max="100" step="0.25" value="50"><span>Forward</span></label></div><div class="v2-peg-axis-group v2-peg2"><strong><i></i> Peg 2</strong><label><span>Left</span><input id="v2Peg2X" type="range" min="0" max="100" step="0.25" value="50"><span>Right</span></label><label><span>Back</span><input id="v2Peg2Z" type="range" min="0" max="100" step="0.25" value="50"><span>Forward</span></label></div></div><label>Peg diameter (mm)<input id="v2PegDiameter" type="number" min="1" max="20" step="0.5" value="4"></label><label>Peg depth (mm)<input id="v2PegDepth" type="number" min="2" max="30" step="0.5" value="6"></label><label>Socket clearance (mm)<input id="v2PegClearance" type="number" min="0.05" max="1" step="0.05" value="0.20"></label><label class="v2-check"><input id="v2Zup" type="checkbox" checked> Z-up for Lychee / Chitubox</label><p id="v2PegHelp" class="v2-peg-help" hidden>Use the sliders for smooth left/right and forward/back movement. You can still drag the handles in the viewer. Pegs stop automatically at unsafe edges.</p></div></details>
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
    $('v2HeightRange').addEventListener('input', () => { $('v2Height').value = $('v2HeightRange').value; updateHeight(); });
    $('v2PrinterDetail').addEventListener('input', () => { setNative('printerPreset', 'custom'); setNative('printerDetailMm', $('v2PrinterDetail').value, 'input'); });
    $('v2FuseBtn').addEventListener('click', fuseCheck);
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
    window.addEventListener('shrink:peg-position-changed', refreshPegAxisControls);
    window.addEventListener('shrink:peg-preview-updated', refreshPegAxisControls);
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
    window.addEventListener('shrink:model-opened', () => { setWorkingModel(app()?.originalModel); clearApplied(); fuseReady = false; shrinkReady = false; markStep(1, 'done'); markStep(2, 'active'); syncSplitControls(); setTimeout(updateHealthCard, 80); });
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
    const print = document.body.classList.contains('app-mode-print');
    if (print) activate(); else deactivate();
  }

  window.addEventListener('shrink:ui-mode', onMode);
  window.addEventListener('shrink:model-opened', () => setTimeout(onMode, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onMode, { once: true }); else onMode();
})();
