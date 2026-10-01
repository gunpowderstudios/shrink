// SHRINK v1.7 live-preview bridge for the existing proven app/viewer core.
// Keeps the current loader/export pipeline but lets the v1.7 worker own a temporary reduced preview.
(() => {
  const app = window.__shrinkApp;
  const view = window.__shrinkViewer;
  if (!app || !view) return;

  const { renderer, scene, camera } = view;
  const originalBtn = document.getElementById('showOriginalBtn');
  const reducedBtn = document.getElementById('showOptimizedBtn');
  let preview = null;
  let current = 'original';
  let compare = false;
  let split = 0.5;
  let version = 0;
  const nativeRender = renderer.render.bind(renderer);

  function original() { return app.originalModel; }
  function remove(model) { if (model && scene.children.includes(model)) scene.remove(model); }
  function add(model) { if (model && !scene.children.includes(model)) scene.add(model); }

  function disposePreview() {
    if (!preview) return;
    remove(preview);
    preview.traverse(o => { if (o.isMesh) o.geometry?.dispose?.(); });
    preview = null;
  }

  function show(which) {
    compare = false;
    remove(original());
    remove(preview);
    current = which === 'optimized' && preview ? 'optimized' : 'original';
    add(current === 'optimized' ? preview : original());
    originalBtn?.classList.toggle('active', current === 'original');
    reducedBtn?.classList.toggle('active', current === 'optimized');
    window.dispatchEvent(new CustomEvent('shrink:compare', { detail: { on: false } }));
  }

  function setCompare(on) {
    on = !!on && !!original() && !!preview;
    compare = on;
    remove(original()); remove(preview);
    if (on) {
      add(original()); add(preview);
      originalBtn?.classList.remove('active'); reducedBtn?.classList.remove('active');
    } else {
      add(current === 'optimized' && preview ? preview : original());
      originalBtn?.classList.toggle('active', current !== 'optimized');
      reducedBtn?.classList.toggle('active', current === 'optimized');
    }
    window.dispatchEvent(new CustomEvent('shrink:compare', { detail: { on } }));
    return true;
  }

  renderer.render = function(sceneArg, cameraArg) {
    if (!compare || sceneArg !== scene || !original() || !preview) return nativeRender(sceneArg, cameraArg);
    const size = renderer.getSize(new app.THREE.Vector2());
    const sx = Math.max(1, Math.round(size.x * split));
    renderer.setScissorTest(true);
    original().visible = true; preview.visible = false;
    renderer.setScissor(0, 0, sx, size.y);
    nativeRender(scene, cameraArg || camera);
    original().visible = false; preview.visible = true;
    renderer.setScissor(sx, 0, Math.max(1, size.x - sx), size.y);
    nativeRender(scene, cameraArg || camera);
    original().visible = true; preview.visible = true;
    renderer.setScissorTest(false);
  };

  Object.defineProperty(app, 'optimizedModel', { configurable: true, get: () => preview });
  Object.defineProperty(app, 'currentModel', { configurable: true, get: () => current === 'optimized' && preview ? preview : original() });
  Object.defineProperty(app, 'optimizedIsPreview', { configurable: true, get: () => !!preview });
  Object.defineProperty(app, 'reducedVersion', { configurable: true, get: () => version });

  app.setPreview = root => {
    const wasPreview = current === 'optimized';
    disposePreview();
    preview = root;
    reducedBtn && (reducedBtn.disabled = false);
    if (compare) { add(preview); }
    else if (wasPreview) { current = 'optimized'; add(preview); }
  };
  app.clearPreview = () => {
    const wasPreview = current === 'optimized';
    compare = false;
    disposePreview();
    if (wasPreview) { current = 'original'; add(original()); }
    if (reducedBtn) reducedBtn.disabled = true;
  };
  app.notifyReduced = meta => {
    version++;
    window.dispatchEvent(new CustomEvent('shrink:reduced', { detail: { ...meta, version } }));
  };
  app.show = show;
  app.setCompare = setCompare;
  app.isCompare = () => compare;
  app.setCompareSplit = value => { split = Math.max(0.03, Math.min(0.97, Number(value) || 0.5)); };
  app.getCompareSplit = () => split;

  // Capture the old viewer buttons before app.js' original handlers see the click.
  originalBtn?.addEventListener('click', e => { if (!preview) return; e.stopImmediatePropagation(); show('original'); }, true);
  reducedBtn?.addEventListener('click', e => { if (!preview) return; e.stopImmediatePropagation(); show('optimized'); }, true);

  // Preserve STL topology for reduction; only change the shading used to display it.
  window.addEventListener('shrink:model-opened', () => {
    current = 'original'; compare = false; version = 0; disposePreview();
    if (app.sourceKind === 'stl') {
      original()?.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m && 'flatShading' in m) { m.flatShading = true; m.needsUpdate = true; } });
      });
    }
  });
})();
