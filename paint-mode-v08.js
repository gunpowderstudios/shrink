// Paint interaction helper: Cmd on Mac / Ctrl on Windows temporarily hands pointer events to OrbitControls.
(() => {
  const viewer = document.getElementById('viewer');
  if (!viewer) return;

  const badge = document.querySelector('.version-badge');
  if (badge) badge.textContent = 'v1.88';

  // Load multi-step undo after the 3D paint controls exist.
  import('./multi-undo.js?v=1.88').catch(err => console.warn('Could not load multi-step undo:', err));

  const nativeAdd = viewer.addEventListener.bind(viewer);
  const paintHandlers = new Set(['handlePointerDown', 'handlePointerMove', 'stopPaint']);

  viewer.addEventListener = function(type, listener, options) {
    if (['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].includes(type) && listener && paintHandlers.has(listener.name)) {
      const wrapped = function(event) {
        const rotating = !!(event.metaKey || event.ctrlKey);
        viewer.classList.toggle('modifier-rotate', rotating);
        if (rotating) return;
        return listener.call(this, event);
      };
      return nativeAdd(type, wrapped, options);
    }
    return nativeAdd(type, listener, options);
  };

  function normalHelpText() {
    const clone = document.getElementById('cloneModelBtn');
    if (clone?.classList.contains('active')) {
      return 'CLONE · Option/Alt-click a clean source · drag to clone · Cmd/Ctrl to rotate';
    }
    return 'PAINT · drag on model · hold Cmd / Ctrl to rotate · scroll to zoom';
  }

  function syncModifier(event) {
    const on = !!(event?.metaKey || event?.ctrlKey);
    viewer.classList.toggle('modifier-rotate', on);
    const help = document.querySelector('.viewer-help');
    if (help && viewer.classList.contains('direct-paint')) {
      help.textContent = on ? 'ROTATE · release Cmd / Ctrl to continue' : normalHelpText();
    }
  }

  window.addEventListener('keydown', event => {
    if ((event.key === 'Meta' || event.key === 'Control') && viewer.classList.contains('direct-paint')) {
      syncModifier(event);
      viewer.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    }
  }, true);
  window.addEventListener('keyup', event => {
    if (event.key === 'Meta' || event.key === 'Control') syncModifier(event);
  }, true);
  viewer.addEventListener('pointerdown', syncModifier, true);
  viewer.addEventListener('pointermove', syncModifier, true);
  viewer.addEventListener('pointerup', syncModifier, true);
  window.addEventListener('blur', () => viewer.classList.remove('modifier-rotate'));

  const tidyControls = () => {
    const paint = document.getElementById('paintModelBtn');
    const clone = document.getElementById('cloneModelBtn');
    const sample = document.getElementById('sampleModelBtn');
    const navigate = document.getElementById('navigateModelBtn');
    if (!paint || !clone || !sample || !navigate) return false;
    paint.textContent = 'Paint';
    clone.textContent = 'Clone';
    clone.title = 'Option-click (Mac) or Alt-click (Windows) a clean source, then drag to clone it';
    sample.textContent = 'Pick colour';
    sample.title = 'Eyedropper: click the model to pick a colour from its texture';
    navigate.style.display = 'none';
    return true;
  };

  if (!tidyControls()) {
    const observer = new MutationObserver(() => {
      if (tidyControls()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
