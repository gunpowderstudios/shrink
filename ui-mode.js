// Shrink v1.63 — simple two-mode UI layer.
(() => {
  const VERSION = '1.63';
  const body = document.body;
  const header = document.querySelector('.topbar');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const subtitle = document.querySelector('.subtitle');
  const textureEditor = document.getElementById('textureEditor');
  const printPanel = document.getElementById('printPanel');
  const optimizeBtn = document.getElementById('optimizeBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resultLabel = document.querySelector('#resultCard .result-top span');
  const compareBtn = document.getElementById('compareBtn');
  const heatBtn = document.getElementById('heatBtn');
  const preset = document.getElementById('preset');
  const geometry = document.getElementById('geometry');

  const badge = document.querySelector('.version-badge');
  if (badge) badge.textContent = `v${VERSION}`;

  if (preset) {
    const names = {
      safe: 'High quality',
      game: 'Balanced',
      small: 'Small file',
      aggressive: 'Maximum reduction',
      custom: 'Custom'
    };
    [...preset.options].forEach(o => { if (names[o.value]) o.textContent = names[o.value]; });
  }

  const chooser = document.createElement('section');
  chooser.className = 'mode-chooser';
  chooser.innerHTML = `
    <button type="button" class="mode-card active" data-mode="game" aria-pressed="true">
      <span class="mode-icon">🎮</span>
      <span><strong>Game Model</strong><small>Edit textures and make GLBs smaller for games.</small></span>
    </button>
    <button type="button" class="mode-card" data-mode="print" aria-pressed="false">
      <span class="mode-icon">◩</span>
      <span><strong>3D Print</strong><small>Reduce and inspect meshes for resin printing.</small></span>
    </button>`;
  header?.insertAdjacentElement('afterend', chooser);

  const workflow = document.createElement('div');
  workflow.className = 'workflow-strip';
  chooser.insertAdjacentElement('afterend', workflow);

  textureEditor?.classList.add('game-only');
  printPanel?.classList.add('print-only');
  heatBtn?.classList.add('print-only-inline');

  const presetBlock = preset?.closest('.control-block');
  presetBlock?.classList.add('game-only');

  const textureSize = document.getElementById('textureSize');
  const textureQuality = document.getElementById('textureQuality');
  const textureSizeBlock = textureSize?.closest('.control-block');
  const textureQualityBlock = textureQuality?.closest('.control-block');
  const toggles = document.querySelector('.toggles');

  if (textureSizeBlock && textureQualityBlock && toggles) {
    const advanced = document.createElement('details');
    advanced.className = 'advanced-settings game-only';
    advanced.innerHTML = '<summary>Advanced game settings</summary><div class="advanced-inner"></div>';
    const inner = advanced.querySelector('.advanced-inner');
    textureSizeBlock.parentNode.insertBefore(advanced, textureSizeBlock);
    inner.append(textureSizeBlock, textureQualityBlock, toggles);
  }

  const geometryBlock = geometry?.closest('.control-block');
  if (geometryBlock) geometryBlock.classList.add('geometry-block');

  function currentMode() {
    return body.classList.contains('app-mode-print') ? 'print' : 'game';
  }

  function updateDropText(mode) {
    const strong = dropZone?.querySelector('strong');
    const span = dropZone?.querySelector('span');
    if (mode === 'print') {
      if (strong) strong.textContent = 'Drop a 3D print model here';
      if (span) span.textContent = 'STL, OBJ, PLY or GLB — or click to choose a file';
      if (fileInput) fileInput.accept = '.stl,.obj,.ply,.glb,model/gltf-binary';
    } else {
      if (strong) strong.textContent = 'Drop a GLB game model here';
      if (span) span.textContent = 'GLB — or click to choose a file';
      if (fileInput) fileInput.accept = '.glb,model/gltf-binary';
    }
  }

  function setMode(mode, announce = false) {
    mode = mode === 'print' ? 'print' : 'game';
    body.classList.toggle('app-mode-game', mode === 'game');
    body.classList.toggle('app-mode-print', mode === 'print');

    chooser.querySelectorAll('.mode-card').forEach(btn => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });

    if (mode === 'game') {
      if (subtitle) subtitle.textContent = 'Edit, paint and optimise GLB models for browser and video games.';
      workflow.innerHTML = '<b>Game Model</b><span>1&nbsp; Edit</span><i>→</i><span>2&nbsp; Optimize</span><i>→</i><span>3&nbsp; Save GLB</span>';
      if (optimizeBtn) optimizeBtn.textContent = 'Optimize game model';
      if (downloadBtn) downloadBtn.textContent = 'Save optimized GLB';
      if (resultLabel) resultLabel.textContent = 'Optimized';
      if (compareBtn) compareBtn.title = 'Compare the original and optimized game model';
    } else {
      if (subtitle) subtitle.textContent = 'Reduce heavy sculpt meshes while keeping the detail your resin printer can actually show.';
      workflow.innerHTML = '<b>3D Print</b><span>1&nbsp; Size</span><i>→</i><span>2&nbsp; Protect</span><i>→</i><span>3&nbsp; Reduce</span><i>→</i><span>4&nbsp; Check</span><i>→</i><span>5&nbsp; Save</span>';
      if (optimizeBtn) optimizeBtn.textContent = 'Reduce print model';
      if (downloadBtn) downloadBtn.textContent = 'Save reduced GLB';
      if (resultLabel) resultLabel.textContent = 'Reduced';
      if (compareBtn) compareBtn.title = 'Compare the original and reduced print model';
    }

    updateDropText(mode);
    window.dispatchEvent(new CustomEvent('shrink:ui-mode', { detail: { mode } }));
    if (announce) window.__shrinkApp?.setStatus?.(mode === 'print'
      ? '3D Print mode — set the intended print height, protect important detail, then reduce.'
      : 'Game Model mode — edit the GLB if needed, optimize it, then save the smaller GLB.');
  }

  chooser.addEventListener('click', e => {
    const button = e.target.closest('.mode-card');
    if (button) setMode(button.dataset.mode, true);
  });

  fileInput?.addEventListener('change', () => {
    const name = fileInput.files?.[0]?.name?.toLowerCase() || '';
    if (/\.(stl|obj|ply)$/.test(name)) setMode('print');
  });
  dropZone?.addEventListener('drop', e => {
    const name = e.dataTransfer?.files?.[0]?.name?.toLowerCase() || '';
    if (/\.(stl|obj|ply)$/.test(name)) setMode('print');
  }, true);

  window.addEventListener('shrink:model-opened', () => {
    const kind = window.__shrinkApp?.sourceKind;
    if (kind && kind !== 'glb') setMode('print');
  });

  window.__shrinkUI = { setMode, getMode: currentMode };
  setMode('game');
})();