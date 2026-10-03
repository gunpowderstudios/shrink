import { rebuildSolid } from './solid-rebuild.js?v=2.13';

// SHRINK 3D v2.13 — "Make watertight": rebuild the model as one closed solid.
// The surface is traced into a voxel grid, small gaps are sealed, everything the outside cannot reach becomes solid,
// and the result is turned back into a smooth, guaranteed-watertight mesh. See solid-core.js.
const VERSION = '2.13';

function disposeRoot(root) {
  root?.traverse?.(o => {
    if (!o.isMesh) return;
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => m?.dispose?.());
  });
}

function countTriangles(model) {
  let triangles = 0;
  model?.traverse?.(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    triangles += Math.floor((g.index?.count || g.attributes.position.count) / 3);
  });
  return triangles;
}

function cellBudget(quality) {
  if (quality === 'high') return 48e6;
  if (quality === 'fast') return 12e6;
  return 30e6;
}

const TRIANGLE_LIMIT = 1500000;

export function remeshPreflight(model, quality = 'balanced') {
  const triangles = countTriangles(model);
  return { triangles, triangleLimit: TRIANGLE_LIMIT, approxGridSamples: cellBudget(quality), quality, safe: triangles <= TRIANGLE_LIMIT };
}

export async function makeWatertight(model, quality = 'balanced', onStatus = () => {}) {
  if (!model) throw new Error('No model is loaded.');
  // Rebuild from the original file when we can: it still has all the fine detail the shrink step trimmed away.
  const original = window.__shrinkApp?.originalModel;
  const source = original && countTriangles(original) <= TRIANGLE_LIMIT ? original : model;
  const preflight = remeshPreflight(source, quality);
  if (!preflight.safe) {
    const err = new Error(`This model is too heavy to rebuild safely in your browser (${new Intl.NumberFormat().format(preflight.triangles)} triangles). SHRINK it first, then try again.`);
    err.code = 'REMESH_TOO_HEAVY';
    err.preflight = preflight;
    throw err;
  }
  const P = window.__shrinkPrint;
  const mmPerUnit = P?.mmPerUnit?.() || 1;
  const detailUnits = (P?.detailMM?.() || 0) / mmPerUnit;
  const { root, stats } = await rebuildSolid(source, { detailUnits, maxCells: cellBudget(quality), maxTris: 300000, onStatus: (text, pct) => onStatus(`${text}${pct ? ` ${Math.round(pct)}%` : ''}`) });
  root.name = 'SHRINK watertight rebuild';
  root.userData.shrinkWatertight = true;
  root.userData.remeshMethod = 'voxel-flood-closing';
  return { root, edgeLength: stats.voxel, quality, preflight, stats, method: 'voxel-flood-closing' };
}

export function installWatertightRoot(root, meta = {}) {
  if (window.__shrinkRepair?.root && window.__shrinkRepair.root !== root) disposeRoot(window.__shrinkRepair.root);
  window.__shrinkRepair = { root, ...meta, version: VERSION };
  return window.__shrinkRepair;
}

export function clearWatertightRoot() {
  if (window.__shrinkRepair?.root) disposeRoot(window.__shrinkRepair.root);
  window.__shrinkRepair = null;
}
