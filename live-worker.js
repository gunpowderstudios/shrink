// Background worker: keeps the heavy mesh data and answers "reduce to X%" requests without freezing the page.
import { MeshoptSimplifier } from 'https://esm.sh/meshoptimizer@0.24.0';
import { reduceIndices } from './reduce-core.js?v=2.17';

const meshes = new Map();
let ready = null;

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      meshes.clear();
      for (const item of m.meshes) meshes.set(item.key, { positions: item.positions, indices: item.indices, lock: item.lock || null });
      self.postMessage({ type: 'loaded' });
    } else if (m.type === 'lock') {
      for (const item of m.locks) { const mesh = meshes.get(item.key); if (mesh) mesh.lock = item.lock || null; }
      self.postMessage({ type: 'locked', id: m.id });
    } else if (m.type === 'run') {
      ready = ready || MeshoptSimplifier.ready;
      await ready;
      const t0 = performance.now();
      const results = [];
      for (const job of m.jobs) {
        const mesh = meshes.get(job.key);
        if (!mesh) continue;
        const r = reduceIndices({ simplifier: MeshoptSimplifier, positions: mesh.positions, indices: mesh.indices, lock: mesh.lock, ratio: job.ratio, error: job.error, protectKeep: job.protectKeep });
        results.push({ key: job.key, indices: r.indices, keepUsed: r.protectKeepUsed, protectedTriangles: r.protectedTriangles });
      }
      self.postMessage({ type: 'result', id: m.id, results, ms: performance.now() - t0 }, results.map(r => r.indices.buffer));
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
