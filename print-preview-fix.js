// SHRINK v1.64 — print preview fidelity + clearer live/reduced states.
(() => {
  const originalBtn = document.getElementById('showOriginalBtn');
  const reducedBtn = document.getElementById('showOptimizedBtn');
  const geometry = document.getElementById('geometry');
  const target = document.getElementById('targetTris');
  const estimate = document.getElementById('estimateLine');
  const panel = document.getElementById('printPanel');

  function app() { return window.__shrinkApp; }
  function isPrintMode() { return document.body.classList.contains('app-mode-print'); }

  function nativeStyleStlPreview() {
    const a = app();
    if (!a?.originalModel || a.sourceKind !== 'stl') return;

    a.originalModel.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
      if (mesh.userData._shrinkNativePreview) return;

      // The import pipeline welds STL vertices for later optimisation. For the ORIGINAL
      // viewer we split them back into independent triangles so Three.js shades the
      // dropped STL like a native facet model instead of smoothing across shell seams.
      if (mesh.geometry.index) {
        const old = mesh.geometry;
        mesh.geometry = old.toNonIndexed();
        old.dispose?.();
      }
      mesh.geometry.computeVertexNormals();

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => {
        if (!m) return;
        m.flatShading = true;
        m.needsUpdate = true;
      });
      mesh.userData._shrinkNativePreview = true;
    });
  }

  function syncPrintLabels() {
    if (!isPrintMode()) return;
    if (originalBtn) originalBtn.textContent = 'Original';
    if (reducedBtn) reducedBtn.textContent = 'Reduced';
  }

  function addLiveHint() {
    if (!panel || panel.querySelector('.live-estimate-hint')) return;
    const hint = document.createElement('div');
    hint.className = 'hint live-estimate-hint';
    hint.textContent = 'Triangle and file-size estimates update live. The 3D mesh changes only when you press Reduce print model.';
    const anchor = estimate || target?.closest('.field');
    anchor?.insertAdjacentElement('afterend', hint);
  }

  window.addEventListener('shrink:model-opened', () => {
    if (app()?.sourceKind === 'stl') nativeStyleStlPreview();
    syncPrintLabels();
    addLiveHint();
  });

  window.addEventListener('shrink:ui-mode', () => {
    syncPrintLabels();
    addLiveHint();
  });

  // The core already builds the reduced model only on demand. Make the result state
  // explicit and ensure the viewer lands on it after the reduction has completed.
  window.addEventListener('shrink:optimized', () => {
    if (!isPrintMode()) return;
    app()?.show?.('optimized');
    syncPrintLabels();
  });

  geometry?.addEventListener('input', syncPrintLabels);
  target?.addEventListener('input', syncPrintLabels);
})();