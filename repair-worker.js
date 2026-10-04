// SHRINK 3D v2.18 core — runs the mesh repair / health check off the main thread so the page never freezes.
import { repairMesh, meshHealth } from './repair-core.js?v=2.27';

self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'repair') {
      const r = repairMesh({ positions: m.positions, indices: m.indices, onProgress: (pct, text) => self.postMessage({ type: 'progress', pct, text }) });
      self.postMessage({ type: 'done', positions: r.positions, indices: r.indices, stats: r.stats }, [r.positions.buffer, r.indices.buffer]);
    } else if (m.type === 'health') {
      self.postMessage({ type: 'done', health: meshHealth(m.positions, m.indices) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
