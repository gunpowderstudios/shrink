// Shrink v0.8 paint interaction patch.
// Loaded before paint3d.js so Cmd/Ctrl can temporarily hand pointer events to OrbitControls.
(() => {
  const viewer = document.getElementById('viewer');
  if (!viewer) return;

  const nativeAdd = viewer.addEventListener.bind(viewer);
  const paintHandlers = new Set(['handlePointerDown', 'handlePointerMove', 'stopPaint']);

  viewer.addEventListener = function(type, listener, options) {
    if (['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].includes(type) && listener && paintHandlers.has(listener.name)) {
      const wrapped = function(event) {
        // Cmd on Mac / Ctrl on Windows temporarily means orbit, not paint.
        if (event.metaKey || event.ctrlKey || viewer.classList.contains('modifier-rotate')) return;
        return listener.call(this, event);
      };
      return nativeAdd(type, wrapped, options);
    }
    return nativeAdd(type, listener, options);
  };

  function setModifierRotate(on) {
    viewer.classList.toggle('modifier-rotate', on);
    const help = document.querySelector('.viewer-help');
    if (help && viewer.classList.contains('direct-paint')) {
      help.textContent = on
        ? 'ROTATE · release Cmd / Ctrl to continue painting'
        : 'PAINT · drag on model · hold Cmd / Ctrl to rotate · scroll to zoom';
    }
  }

  window.addEventListener('keydown', (event) => {
    if ((event.key === 'Meta' || event.key === 'Control') && viewer.classList.contains('direct-paint')) {
      setModifierRotate(true);
      // End a paint stroke cleanly if the modifier is pressed mid-stroke.
      viewer.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    }
  }, true);

  window.addEventListener('keyup', (event) => {
    if (event.key === 'Meta' || event.key === 'Control') setModifierRotate(false);
  }, true);

  window.addEventListener('blur', () => setModifierRotate(false));

  // paint3d.js creates these buttons after this file runs. Rename/simplify once they exist.
  const tidyControls = () => {
    const paint = document.getElementById('paintModelBtn');
    const sample = document.getElementById('sampleModelBtn');
    const navigate = document.getElementById('navigateModelBtn');
    if (!paint || !sample || !navigate) return false;

    paint.textContent = 'Paint';
    sample.textContent = 'Pick colour';
    sample.title = 'Eyedropper: click the model to pick a colour from its texture';
    navigate.style.display = 'none';

    const help = document.querySelector('.viewer-help');
    if (help && viewer.classList.contains('direct-paint')) {
      help.textContent = 'PAINT · drag on model · hold Cmd / Ctrl to rotate · scroll to zoom';
    }
    return true;
  };

  if (!tidyControls()) {
    const observer = new MutationObserver(() => {
      if (tidyControls()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();