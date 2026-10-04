// SHRINK 3D v2.33 — dockable desktop workspace panels.
// Controls/viewer may be swapped left/right. Preference is stored per browser.
(() => {
  const RELEASE = '2.33';
  const KEY = 'shrink-panel-side';
  const body = document.body;
  const $ = s => document.querySelector(s);
  let side = 'left';

  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'left' || saved === 'right') side = saved;
  } catch {}

  function save() {
    try { localStorage.setItem(KEY, side); } catch {}
  }

  const heightCache = new WeakMap();

  function setWorkspaceHeight(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = Math.max(0, Math.min(window.innerHeight - 1, rect.top));
    const available = Math.max(220, Math.min(window.innerHeight - 8, Math.floor(window.innerHeight - top - 8)));
    if (Math.abs((heightCache.get(el) || 0) - available) < 2) return;
    heightCache.set(el, available);
    el.style.setProperty('--shrink-workspace-height', available + 'px');
  }

  function sizeDesktopWorkspace() {
    if (window.innerWidth <= 900) {
      document.documentElement.classList.remove('shrink-app-locked');
      return;
    }

    const simpleLoaded = body.classList.contains('app-mode-print') && body.classList.contains('ui-simple') && body.classList.contains('simple-has-model');
    document.documentElement.classList.toggle('shrink-app-locked', simpleLoaded);
    if (simpleLoaded && window.scrollY !== 0) {
      window.scrollTo(0, 0);
      requestAnimationFrame(sizeDesktopWorkspace);
      return;
    }

    const simpleGrid = document.querySelector('.app-mode-print.ui-simple .v2-top-grid');
    if (simpleGrid && !simpleGrid.closest('[hidden]')) setWorkspaceHeight(simpleGrid);

    const native = document.getElementById('workspace');
    if (native && !native.classList.contains('hidden') && !body.classList.contains('print-v2-active')) setWorkspaceHeight(native);
  }

  let appliedSide = null;
  function apply() {
    body.classList.toggle('panels-controls-left', side === 'left');
    body.classList.toggle('panels-controls-right', side === 'right');
    document.querySelectorAll('.module-dragbar').forEach(bar => {
      const role = bar.dataset.moduleRole;
      const where = role === 'controls' ? side : (side === 'left' ? 'right' : 'left');
      bar.title = `${role === 'controls' ? 'Controls' : 'Viewer'} currently on the ${where}. Drag or click to swap sides.`;
      bar.setAttribute('aria-label', bar.title);
    });
    if (appliedSide !== side) {
      appliedSide = side;
      window.dispatchEvent(new CustomEvent('shrink:panel-layout', { detail: { controls: side } }));
    }
    requestAnimationFrame(sizeDesktopWorkspace);
  }

  function swap() {
    side = side === 'left' ? 'right' : 'left';
    save();
    apply();
  }

  function makeBar(host, role) {
    if (!host || host.querySelector(':scope > .module-dragbar')) return false;
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'module-dragbar';
    bar.dataset.moduleRole = role;
    bar.draggable = true;
    bar.innerHTML = `<span class="module-grip" aria-hidden="true">⠿</span><span>${role === 'controls' ? 'Controls' : '3D viewer'}</span><span class="module-swap" aria-hidden="true">↔</span>`;

    bar.addEventListener('click', swap);
    bar.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-shrink-module', role);
      body.classList.add('module-dragging');
      setTimeout(() => bar.classList.add('drag-source'), 0);
    });
    bar.addEventListener('dragend', () => {
      body.classList.remove('module-dragging');
      bar.classList.remove('drag-source');
      document.querySelectorAll('.module-drop-target').forEach(x => x.classList.remove('module-drop-target'));
    });
    host.insertBefore(bar, host.firstChild);
    return true;
  }

  function wireDrop(host) {
    if (!host || host.dataset.moduleDropWired === 'true') return;
    host.dataset.moduleDropWired = 'true';
    host.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/x-shrink-module')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      host.classList.add('module-drop-target');
    });
    host.addEventListener('dragleave', e => {
      if (!host.contains(e.relatedTarget)) host.classList.remove('module-drop-target');
    });
    host.addEventListener('drop', e => {
      const role = e.dataTransfer.getData('text/x-shrink-module');
      if (role !== 'controls' && role !== 'viewer') return;
      e.preventDefault();
      host.classList.remove('module-drop-target');
      swap();
    });
  }

  function install() {
    let changed = false;

    // Game/Tools native workspace.
    const nativeControls = $('#workspace > .control-panel');
    const nativeViewer = $('#workspace > .viewer-panel');
    changed = makeBar(nativeControls, 'controls') || changed;
    changed = makeBar(nativeViewer, 'viewer') || changed;
    wireDrop(nativeControls);
    wireDrop(nativeViewer);

    // Print dashboard viewer.
    const viewerSlot = $('.print-v2-dashboard .v2-viewer-slot');
    const printViewer = viewerSlot?.querySelector('.viewer-panel');
    changed = makeBar(printViewer, 'viewer') || changed;
    wireDrop(viewerSlot || printViewer);

    // Simple Print controls can be either the normal card or the preflight card.
    const simpleCard = $('#simpleCard');
    const preflight = $('#simplePreflightCard');
    changed = makeBar(simpleCard, 'controls') || changed;
    changed = makeBar(preflight, 'controls') || changed;
    wireDrop(simpleCard);
    wireDrop(preflight);

    if (changed || appliedSide === null) apply();
    else sizeDesktopWorkspace();
  }

  window.addEventListener('resize', () => requestAnimationFrame(sizeDesktopWorkspace));

  // Retry briefly while the async UI modules mount, then stop. Do not observe the
  // whole DOM forever: status text/result changes must not resize the viewer.
  let tries = 0;
  const boot = setInterval(() => {
    install();
    if (++tries >= 100) clearInterval(boot);
  }, 100);
  setTimeout(() => clearInterval(boot), 10000);

  window.addEventListener('shrink:model-opened', () => setTimeout(install, 80));
  window.addEventListener('shrink:ui-mode', () => setTimeout(install, 30));
  window.addEventListener('shrink:ui-level', () => setTimeout(install, 30));
  window.addEventListener('shrink:preflight-ready', () => setTimeout(install, 30));
  window.addEventListener('shrink:preflight-continued', () => setTimeout(install, 30));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.__shrinkPanelLayout = {
    version: RELEASE,
    get controlsSide() { return side; },
    setControlsSide(value) {
      if (value !== 'left' && value !== 'right') return;
      side = value; save(); apply();
    },
    swap,
    resize: sizeDesktopWorkspace
  };
})();
