// SHRINK 3D v1.86 — verify that the GLB build matches the live reduced preview.
(() => {
  const VERSION = '2.13';
  const $ = id => document.getElementById(id);
  let previewTriangles = null;

  function countTriangles(model) {
    let triangles = 0;
    model?.traverse?.(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const g = o.geometry;
      triangles += g.index ? Math.floor(g.index.count / 3) : Math.floor(g.attributes.position.count / 3);
    });
    return triangles;
  }

  function capturePreview() {
    if (window.__shrinkUI?.getMode?.() === 'print') {
      previewTriangles = null;
      return;
    }
    const app = window.__shrinkApp;
    previewTriangles = app?.optimizedIsPreview && app?.optimizedModel
      ? countTriangles(app.optimizedModel)
      : null;
  }

  function install() {
    const saveButton = $('optimizeBtn');
    if (saveButton && !saveButton.dataset.saveGuard186) {
      saveButton.dataset.saveGuard186 = '1';
      saveButton.addEventListener('click', capturePreview, true);
    }
  }

  install();
  window.addEventListener('shrink:model-opened', () => { previewTriangles = null; install(); });
  window.addEventListener('shrink:optimized', event => {
    if (!previewTriangles || event.detail?.liveExport) return;
    const saved = Number(event.detail?.triangles || 0);
    if (!saved) return;

    const difference = Math.abs(saved - previewTriangles) / Math.max(1, previewTriangles);
    if (difference > 0.10) {
      const badge = $('savingBadge');
      if (badge) badge.textContent = 'Preview mismatch';
      window.__shrinkApp?.setStatus?.(
        `Warning — the live preview shows ${previewTriangles.toLocaleString()} triangles but the saved GLB contains ${saved.toLocaleString()}.`,
        true
      );
      console.warn(`[SHRINK 3D ${VERSION}] Saved GLB differs from live preview`, {
        previewTriangles,
        savedTriangles: saved,
        differencePercent: difference * 100
      });
    }
  });
})();
