// SHRINK 3D v2.87 — Tron (beta) worker: runs the flatten off the page's main thread so the viewer stays smooth.
import { MeshoptSimplifier } from 'https://esm.sh/meshoptimizer@0.24.0';
import { flattenCar } from './tron-core.js?v=2.87';

let data = null, ready = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'load') { data = m.data; return; }
  if (m.type !== 'run') return;
  try {
    if (!data) throw new Error('No model loaded');
    ready = ready || MeshoptSimplifier.ready; await ready;
    const r = flattenCar(data, { faces: m.faces, simplifier: MeshoptSimplifier, onProgress: text => self.postMessage({ type: 'progress', id: m.id, text }) });
    self.postMessage({ type: 'done', id: m.id, result: r }, [r.body.positions.buffer, r.body.normals.buffer, r.body.colors.buffer]);
  } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err?.message || err) }); }
};
