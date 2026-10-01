// SHRINK v1.7 compatibility layer for the existing print tools.
// Adds the live-preview helpers expected by live-ui.js without changing the proven export/paint code.
(() => {
  const mode = () => window.__shrinkUI?.getMode?.() || 'game';
  const detailInput = document.getElementById('printerDetailMm');
  const compareBtn = document.getElementById('compareBtn');
  const heatBtn = document.getElementById('heatBtn');

  function install() {
    const p = window.__shrinkPrint;
    if (!p || p.__v17Compat) return false;
    const state = p.state;
    const oldMmPerUnit = p.mmPerUnit?.bind(p);

    p.printMmPerUnit = () => oldMmPerUnit ? oldMmPerUnit() : 1;
    p.mmPerUnit = () => {
      if (mode() !== 'game') return p.printMmPerUnit();
      return state?.modelHeightUnits > 0 ? 100 / state.modelHeightUnits : 1;
    };
    p.detailMM = () => mode() === 'game' ? 0.2 : Math.max(0.001, Number(detailInput?.value) || 0.05);
    p.unitLabel = () => mode() === 'game' ? '%' : ' mm';
    p.getLocks = () => state?.dabs?.length && state?.protectMeshes
      ? state.protectMeshes.map(pm => ({ mesh: pm.mesh, mask: pm.mask }))
      : [];
    p.__v17Compat = true;
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 25);
    setTimeout(() => clearInterval(timer), 5000);
  }

  window.addEventListener('shrink:reduced', e => {
    const p = window.__shrinkPrint;
    const s = p?.state;
    if (!s) return;
    s.optimizedTriangles = e.detail?.triangles || 0;
    if (compareBtn) compareBtn.disabled = false;
    if (heatBtn) heatBtn.disabled = false;
    if (s.heat) {
      s.heat.distances = null;
      s.heat.stats = null;
      s.heat.forBytes = null;
    }
    window.__shrinkPrintRefreshLabels?.();
  });
})();
