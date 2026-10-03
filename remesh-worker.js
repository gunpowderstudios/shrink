// SHRINK 3D v2.13 — background worker for the solid rebuild (keeps the page responsive while it works).
import { rebuildSolidCore } from './solid-core.js?v=2.13';
import { MeshoptSimplifier } from 'https://esm.sh/meshoptimizer@0.24.0';

const MANIFOLD_JS = 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.js';
const MANIFOLD_WASM = 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.wasm';
let wasmPromise = null;
function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = import(MANIFOLD_JS).then(async mod => {
      const wasm = await mod.default({ locateFile: path => path.endsWith('.wasm') ? MANIFOLD_WASM : new URL(path, MANIFOLD_JS).href });
      wasm.setup();
      return wasm;
    });
  }
  return wasmPromise;
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type !== 'run') return;
  try {
    self.postMessage({ type: 'progress', pct: 1, text: 'Loading the solid builder…' });
    let wasm;
    try { wasm = await loadWasm(); }
    catch (e) { self.postMessage({ type: 'error', code: 'WORKER_UNAVAILABLE', message: `The solid builder could not start in the background: ${e?.message || e}` }); return; }
    const r = await rebuildSolidCore({
      positions: m.positions, indices: m.indices, detailUnits: m.detailUnits, maxCells: m.maxCells, maxTris: m.maxTris,
      wasm, simplifier: MeshoptSimplifier,
      onProgress: (pct, text) => self.postMessage({ type: 'progress', pct, text })
    });
    self.postMessage({ type: 'done', positions: r.positions, indices: r.indices, stats: r.stats }, [r.positions.buffer, r.indices.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', code: err?.code || '', message: String(err?.message || err), growth: err?.growth, ratio: err?.ratio });
  }
};
