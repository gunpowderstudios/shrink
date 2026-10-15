// SHRINK 3D v2.89 — Tron (beta) worker: runs the flatten off the page's main thread so the viewer stays smooth.
import { MeshoptSimplifier } from 'https://esm.sh/meshoptimizer@0.24.0';
import { flattenCar } from './tron-core.js?v=2.89';

let data = null, ready = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'load') { data = m.data; return; }
  if (m.type !== 'run') return;
  try {
    if (!data) throw new Error('No model loaded');
    ready = ready || MeshoptSimplifier.ready; await ready;
    const r = flattenCar(data, { faces: m.faces, bake: m.bake || null, simplifier: MeshoptSimplifier, onProgress: text => self.postMessage({ type: 'progress', id: m.id, text }) });
    const bufs = new Set(); const grab = o => { if (!o || typeof o !== 'object') return; if (ArrayBuffer.isView(o)) { bufs.add(o.buffer); return; } for (const k of Object.keys(o)) grab(o[k]); }; grab(r);
    self.postMessage({ type: 'done', id: m.id, result: r }, [...bufs]);
  } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err?.message || err) }); }
};
