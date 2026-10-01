// Shrink v1.7 — mode chooser + plain-language wording for each destination (Game / 3D Print).
(() => {
  const VERSION = '1.7';
  const body = document.body;
  const $ = id => document.getElementById(id);
  const header = document.querySelector('.topbar');
  const dropZone = $('dropZone'), fileInput = $('fileInput'), subtitle = document.querySelector('.subtitle');
  const badge = document.querySelector('.version-badge');
  if (badge) badge.textContent = `v${VERSION}`;

  const chooser = document.createElement('section');
  chooser.className = 'mode-chooser';
  chooser.innerHTML = `
    <button type="button" class="mode-card" data-mode="game" aria-pressed="false">
      <span class="mode-icon">🎮</span>
      <span><strong>Game model</strong><small>Keep textures, make the GLB light enough for a game.</small></span>
    </button>
    <button type="button" class="mode-card" data-mode="print" aria-pressed="false">
      <span class="mode-icon">🖨</span>
      <span><strong>3D print / modelling</strong><small>Keep the shape, drop the rest. Saves STL / OBJ in millimetres.</small></span>
    </button>`;
  header?.insertAdjacentElement('afterend', chooser);
  const steps = document.createElement('div');
  steps.className = 'workflow-strip';
  chooser.insertAdjacentElement('afterend', steps);

  const TEXT = {
    game: {
      subtitle: 'Make a model light enough for a game — and see exactly what you gave up.',
      steps: '<b>Game model</b><span>1&nbsp; Target</span><i>→</i><span>2&nbsp; Detail</span><i>→</i><span>3&nbsp; Touch up</span><i>→</i><span>4&nbsp; Save</span>',
      setupTitle: 'Where will it be used?', setupSub: 'Pick one — it sets sensible limits for you.',
      detailSub: 'Drag the slider — the model on the right updates live.',
      extraNum: '3', extraTitle: 'Touch up (optional)', extraSub: 'Paint out stickers, plates or marks on the textures.',
      saveNum: '4', saveTitle: 'Save', saveSub: 'Builds the final GLB (resized textures, compressed mesh) and downloads it.',
      btn: 'Save game GLB',
      drop: ['Drop a model here', 'GLB for games · STL, OBJ or PLY also work'],
      accept: '.glb,.stl,.obj,.ply,model/gltf-binary'
    },
    print: {
      subtitle: 'Shrink a heavy sculpt to a size that is easy to send, without losing detail your printer can show.',
      steps: '<b>3D print</b><span>1&nbsp; Size</span><i>→</i><span>2&nbsp; Detail</span><i>→</i><span>3&nbsp; Protect</span><i>→</i><span>4&nbsp; Check</span><i>→</i><span>5&nbsp; Save</span>',
      setupTitle: 'How big will it be printed?', setupSub: 'Height and printer decide how much detail is actually visible.',
      detailSub: 'Drag the slider — the model updates live. Then use Compare and Detail loss above the model.',
      extraNum: '3', extraTitle: 'Protect key details (optional)', extraSub: 'Paint faces or fine ornament so they keep their detail.',
      saveNum: '4', saveTitle: 'Save for printing', saveSub: 'STL works in every slicer. OBJ is a fallback.',
      btn: 'Also save GLB (keeps colours)',
      drop: ['Drop a sculpt here', 'STL, OBJ, PLY or GLB — from ShapeLab, Cinema 4D, Blender…'],
      accept: '.stl,.obj,.ply,.glb,model/gltf-binary'
    }
  };

  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  function currentMode() { return body.classList.contains('app-mode-print') ? 'print' : 'game'; }

  function setMode(mode, announce = false) {
    mode = mode === 'print' ? 'print' : 'game';
    const t = TEXT[mode];
    body.classList.toggle('app-mode-game', mode === 'game');
    body.classList.toggle('app-mode-print', mode === 'print');
    chooser.querySelectorAll('.mode-card').forEach(btn => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on));
    });
    if (subtitle) subtitle.textContent = t.subtitle;
    steps.innerHTML = t.steps;
    ['setupTitle', 'setupSub', 'detailSub', 'extraNum', 'extraTitle', 'extraSub', 'saveNum', 'saveTitle', 'saveSub'].forEach(k => setText(k, t[k]));
    const btn = $('optimizeBtn');
    if (btn) { btn.dataset.label = t.btn; if (!btn.disabled) btn.textContent = t.btn; }
    const s = dropZone?.querySelector('strong'), sp = dropZone?.querySelector('span');
    if (s) s.textContent = t.drop[0]; if (sp) sp.textContent = t.drop[1];
    if (fileInput) fileInput.accept = t.accept;
    try { localStorage.setItem('shrink-mode', mode); } catch {}
    window.dispatchEvent(new CustomEvent('shrink:ui-mode', { detail: { mode } }));
    if (announce) window.__shrinkApp?.setStatus?.(mode === 'print'
      ? 'Print mode — set the finished height and printer, then drag the detail slider.'
      : 'Game mode — pick where it will be used, then drag the detail slider.');
  }

  chooser.addEventListener('click', e => { const b = e.target.closest('.mode-card'); if (b) setMode(b.dataset.mode, true); });
  const sniff = name => { if (/\.(stl|obj|ply)$/i.test(name || '')) setMode('print'); };
  fileInput?.addEventListener('change', () => sniff(fileInput.files?.[0]?.name));
  dropZone?.addEventListener('drop', e => sniff(e.dataTransfer?.files?.[0]?.name), true);
  window.addEventListener('shrink:model-opened', () => { const k = window.__shrinkApp?.sourceKind; if (k && k !== 'glb') setMode('print'); });

  window.__shrinkUI = { setMode, getMode: currentMode };
  let saved = 'game'; try { saved = localStorage.getItem('shrink-mode') || 'game'; } catch {}
  setMode(saved);
})();
