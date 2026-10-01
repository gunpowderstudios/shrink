// SHRINK 3D v1.76 — keep live reduced preview materials independent from the Original.
// Protect Detail and heatmap overlays toggle vertexColors on the original materials.
// Claude's live preview clones the object hierarchy but, by default, Three.js shares materials.
// Clone those materials once when the live preview is ready so Compare never renders the
// reduced side black when the Original has a protect/heat overlay.
(() => {
  function isolatePreviewMaterials() {
    const app = window.__shrinkApp;
    const reduced = app?.optimizedModel;
    const original = app?.originalModel;
    if (!reduced || reduced === original) return;

    reduced.traverse(obj => {
      if (!obj.isMesh || obj.userData._shrinkPreviewMaterialsIsolated) return;
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(mat => mat?.clone ? mat.clone() : mat);
      } else if (obj.material?.clone) {
        obj.material = obj.material.clone();
      }
      obj.userData._shrinkPreviewMaterialsIsolated = true;
    });
  }

  window.addEventListener('shrink:live-ready', () => {
    // live-reduce calls setPreview() before emitting live-ready, so optimizedModel exists here.
    isolatePreviewMaterials();
  });

  // Also cover rebuilt previews or timing differences without touching finished exports.
  window.addEventListener('shrink:live-updated', isolatePreviewMaterials);
})();
