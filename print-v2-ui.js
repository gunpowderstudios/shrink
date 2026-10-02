// SHRINK 3D v2.00 — simplified home-user print workflow.
(() => {
  const VERSION = '2.10';
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  let dashboard = null;
  let viewerPanel = null;
  let viewerHome = null;
  let viewerNext = null;
  let fuseReady = false;
  let shrinkReady = false;

  function sourceModel() { return app()?.originalModel || app()?.optimizedModel || null; }

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
      progress(card, 36, 'Repairing seams…');
      await wait(20);
      const built = await window.__shrinkFuse.modelToSolid(model);
      progress(card, 78, 'Checking the solid…');
      if (built.components !== 1) {
        try { built.solid?.delete?.(); } catch {}
        throw new Error(`The model still has ${built.components} separate solid parts after repair.`);
      }
      try { built.solid?.delete?.(); } catch {}
      setNative('fuseSolidToggle', true, 'change');
      fuseReady = true;
      progress(card, 100, 'Ready — SHRINK can fuse this model when you download it.');
      $('v2FuseResult').innerHTML = '<strong>✓ Ready to fuse</strong><span>This model can be made into one clean printable solid.</span>';
      card.dataset.state = 'good';
      markStep(2, 'done');
      markStep(3, 'active');
      window.__shrinkPrintSafety?.clearDiagnostic?.();
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
      shrinkReady = true;
      progress(card, 100, 'Done.');
      $('v2ShrinkResult').innerHTML = `<strong>✓ ${verdict || 'Optimised'}</strong><span>${live}</span>`;
      card.dataset.state = 'good';
      markStep(3, 'done');
      markStep(4, 'active');
    } finally {
      clearInterval(timer);
      btn.disabled = false;
    }
  }

  function syncSplitControls() {
    const select = $('v2SplitMode');
    if (!select) return;
    const src = $('splitMode');
    if (src) select.value = src.value || 'off';
    const joint = $('v2Joint');
    if (joint && $('splitJoint')) joint.value = $('splitJoint').value;
    const showCut = select.value === '2';
    $('v2CutWrap').hidden = !showCut;
    if (showCut && $('splitCutPct')) {
      $('v2Cut').value = $('splitCutPct').value;
      $('v2CutLabel').textContent = `${$('splitCutPct').value}%`;
    }
  }

  function chooseSplit() {
    const mode = $('v2SplitMode')?.value || 'off';
    setNative('splitMode', mode, 'change');
    $('v2CutWrap').hidden = mode !== '2';
    if (mode !== 'off') markStep(4, 'active');
  }

  function syncAdvancedToNative() {
    setNative('splitJoint', $('v2Joint')?.value || 'pegs', 'change');
    if ($('v2PegDiameter')) setNative('pegDiameter', $('v2PegDiameter').value, 'input');
    if ($('v2PegDepth')) setNative('pegDepth', $('v2PegDepth').value, 'input');
    if ($('v2PegClearance')) setNative('pegClearance', $('v2PegClearance').value, 'input');
    if ($('v2Zup')) setNative('zUpToggle', $('v2Zup').checked, 'change');
  }

  function download() {
    syncAdvancedToNative();
    chooseSplit();
    if ($('fuseSolidToggle')) $('fuseSolidToggle').checked = fuseReady || $('v2SplitMode')?.value !== 'off';
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
      <div class="v2-progress">
        <div class="v2-progress-line"><i id="v2ProgressFill"></i></div>
        <div class="v2-progress-step active"><b>1</b><span><strong>Printer & size</strong><small>Tell us what you're making</small></span></div>
        <div class="v2-progress-step"><b>2</b><span><strong>Fuse it baby!</strong><small>Make one clean solid</small></span></div>
        <div class="v2-progress-step"><b>3</b><span><strong>SHRINK my model</strong><small>Keep the detail, lose the bulk</small></span></div>
        <div class="v2-progress-step"><b>4</b><span><strong>Download</strong><small>Split, peg and export</small></span></div>
      </div>

      <div class="v2-top-grid">
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
        <div class="v2-viewer-slot"></div>
      </div>

      <div class="v2-action-grid">
        <section id="v2FuseCard" class="v2-card v2-action-card v2-fuse-card">
          <div class="v2-card-head"><span class="v2-num">2</span><div><h2>Fuse it baby!</h2><p>Fix common mesh problems and check it can become one printable solid.</p></div></div>
          <button id="v2FuseBtn" class="v2-mega v2-purple" type="button">🔗 FUSE IT BABY!</button>
          <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
          <div id="v2FuseResult" class="v2-result">SHRINK will try the quick repair first. If the model is stubborn, you'll get a simple Make watertight option.</div>
          <details class="v2-advanced"><summary>Advanced repair settings & diagnostics</summary><div class="v2-advanced-body"><p>Welds near-duplicate vertices, removes bad triangles, then asks Manifold to build one closed solid. Detailed errors appear under the viewer if this fails.</p></div></details>
        </section>

        <section id="v2ShrinkCard" class="v2-card v2-action-card v2-shrink-card">
          <div class="v2-card-head"><span class="v2-num">3</span><div><h2>SHRINK my model</h2><p>Automatically find the smallest version that still looks the same.</p></div></div>
          <button id="v2ShrinkBtn" class="v2-mega v2-green" type="button">✨ SHRINK MY MODEL</button>
          <div class="v2-card-progress"><i></i></div><div class="v2-card-progress-label">Ready when you are.</div>
          <div id="v2ShrinkResult" class="v2-result">SHRINK compares the reduced model with the original and stops before the difference should be visible.</div>
          <details class="v2-advanced"><summary>Advanced optimisation settings</summary><div class="v2-advanced-body"><label>Detail kept<input id="v2Detail" type="range" min="1" max="100" step="0.1" value="70"></label><p>Use this only if you want to override the automatic result manually.</p></div></details>
        </section>

        <section class="v2-card v2-action-card v2-download-card">
          <div class="v2-card-head"><span class="v2-num">4</span><div><h2>Download</h2><p>Save one STL, or split it into printable sections with pegs.</p></div></div>
          <div class="v2-download-options"><label>Split into<select id="v2SplitMode"><option value="off">One STL</option><option value="2">2 parts</option><option value="3">3 parts</option><option value="max">Auto by maximum height</option></select></label><label>Joint<select id="v2Joint"><option value="pegs">Keyed twin pegs</option><option value="flat">Flat cut — no pegs</option></select></label></div>
          <div id="v2CutWrap" class="v2-cut-row" hidden><div><span>Cut height</span><strong id="v2CutLabel">50%</strong></div><input id="v2Cut" type="range" min="10" max="90" step="0.5" value="50"></div>
          <button id="v2DownloadBtn" class="v2-mega v2-red" type="button">⬇ DOWNLOAD STL</button>
          <details class="v2-advanced"><summary>Advanced split settings</summary><div class="v2-advanced-body v2-advanced-grid"><label>Peg diameter (mm)<input id="v2PegDiameter" type="number" min="1" max="20" step="0.5" value="4"></label><label>Peg depth (mm)<input id="v2PegDepth" type="number" min="2" max="30" step="0.5" value="6"></label><label>Socket clearance (mm)<input id="v2PegClearance" type="number" min="0.05" max="1" step="0.05" value="0.20"></label><label class="v2-check"><input id="v2Zup" type="checkbox" checked> Z-up for Lychee / Chitubox</label></div></details>
        </section>
      </div>`;

    chooser.insertAdjacentElement('afterend', dashboard);
    dashboard.querySelector('.v2-viewer-slot').appendChild(viewerPanel);

    dashboard.querySelectorAll('[data-printer]').forEach(b => b.addEventListener('click', () => choosePrinter(b.dataset.printer)));
    dashboard.querySelectorAll('[data-quality]').forEach(b => b.addEventListener('click', () => setQuality(b.dataset.quality)));
    $('v2Height').addEventListener('input', updateHeight);
    $('v2HeightRange').addEventListener('input', () => { $('v2Height').value = $('v2HeightRange').value; updateHeight(); });
    $('v2PrinterDetail').addEventListener('input', () => { setNative('printerPreset', 'custom'); setNative('printerDetailMm', $('v2PrinterDetail').value, 'input'); });
    $('v2FuseBtn').addEventListener('click', fuseCheck);
    $('v2ShrinkBtn').addEventListener('click', shrinkModel);
    $('v2SplitMode').addEventListener('change', chooseSplit);
    $('v2Joint').addEventListener('change', syncAdvancedToNative);
    $('v2Cut').addEventListener('input', () => { $('v2CutLabel').textContent = `${$('v2Cut').value}%`; setNative('splitCutPct', $('v2Cut').value, 'input'); });
    ['v2PegDiameter','v2PegDepth','v2PegClearance'].forEach(id => $(id).addEventListener('input', syncAdvancedToNative));
    $('v2Zup').addEventListener('change', syncAdvancedToNative);
    $('v2DownloadBtn').addEventListener('click', download);
    $('v2Detail').addEventListener('input', () => setNative('geometry', $('v2Detail').value, 'input'));

    const h = Number(nativeValue('figureHeightMm', 75)) || 75;
    $('v2Height').value = h; $('v2HeightRange').value = Math.max(10, Math.min(300, h));
    const geom = Number(nativeValue('geometry', 70)) || 70; $('v2Detail').value = geom;
    choosePrinter('resin');
    setQuality('standard');
    syncSplitControls();

    new MutationObserver(syncSplitControls).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('shrink:model-opened', () => { fuseReady = false; shrinkReady = false; markStep(1, 'done'); markStep(2, 'active'); syncSplitControls(); });
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
