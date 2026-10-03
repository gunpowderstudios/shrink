import * as THREE from 'https://esm.sh/three@0.180.0';
import { reduceIndices } from './reduce-core.js?v=2.16';

/* Live reduction: keeps a lightweight "preview" copy of the model whose index buffers are re-simplified in a
 * background worker whenever the slider moves. Vertices/attributes are copied once; only triangle lists change,
 * so updates are fast and the page never freezes. */

export function createLiveReducer(app) {
  const R = {
    worker: null, workerFailed: false, nextId: 1, waiting: new Map(),
    sources: [],            // [{ key, mesh (original), preview (clone), positions, indices, skip }]
    root: null, registered: false,
    wanted: null, busy: false, locked: false, timer: 0,
    last: { ratio: 1, triangles: 0, ms: 0, keepUsed: 1 },
    originalTriangles: 0, mainSimplifier: null
  };

  /* ---------------- worker plumbing ---------------- */
  function ensureWorker() {
    if (R.worker || R.workerFailed) return R.worker;
    try {
      R.worker = new Worker(new URL('./live-worker.js?v=2.16', import.meta.url), { type: 'module' });
      R.worker.onmessage = e => {
        const m = e.data, w = R.waiting.get(m.id ?? 'load');
        if (m.type === 'loaded') { const p = R.waiting.get('load'); R.waiting.delete('load'); p?.resolve(m); return; }
        if (!w) return;
        R.waiting.delete(m.id);
        if (m.type === 'error') w.reject(new Error(m.message)); else w.resolve(m);
      };
      R.worker.onerror = err => {
        console.warn('Live worker failed, using the main thread instead.', err);
        R.workerFailed = true; R.worker = null;
        for (const [, w] of R.waiting) w.reject(new Error('worker failed'));
        R.waiting.clear();
      };
    } catch (err) {
      console.warn('Could not start the live worker.', err); R.workerFailed = true; R.worker = null;
    }
    return R.worker;
  }
  const post = (msg, transfer = []) => new Promise((resolve, reject) => {
    const id = msg.type === 'load' ? 'load' : R.nextId++;
    R.waiting.set(id, { resolve, reject });
    ensureWorker().postMessage({ ...msg, id }, transfer);
  });

  async function mainSimplifier() {
    if (!R.mainSimplifier) { const mod = await import('meshoptimizer'); await mod.MeshoptSimplifier.ready; R.mainSimplifier = mod.MeshoptSimplifier; }
    return R.mainSimplifier;
  }

  /* ---------------- building the preview ---------------- */
  function disposePreview() {
    for (const s of R.sources) if (s.preview && s.previewOwned) s.preview.geometry.dispose();
    R.sources = []; R.root = null;
  }

  async function prepare() {
    clearTimeout(R.timer); R.wanted = null;
    if (R.root) app.clearPreview?.();
    disposePreview();
    const original = app.originalModel;
    if (!original) return;
    original.updateMatrixWorld(true);
    const clone = original.clone(true);
    const originals = [], clones = [];
    original.traverse(o => { if (o.isMesh) originals.push(o); });
    clone.traverse(o => { if (o.isMesh) clones.push(o); });

    const loadMeshes = [], transfer = [];
    let key = 0, tris = 0;
    originals.forEach((mesh, i) => {
      const g = mesh.geometry, pos = g?.attributes?.position;
      const src = { key: key++, mesh, preview: clones[i], skip: true, previewOwned: false };
      R.sources.push(src);
      if (!pos || !clones[i] || (g.groups && g.groups.length > 1)) return;
      const n = pos.count, positions = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) { positions[v * 3] = pos.getX(v); positions[v * 3 + 1] = pos.getY(v); positions[v * 3 + 2] = pos.getZ(v); }
      const count = g.index ? g.index.count : n;
      const indices = new Uint32Array(count);
      if (g.index) for (let t = 0; t < count; t++) indices[t] = g.index.getX(t); else for (let t = 0; t < count; t++) indices[t] = t;
      // the preview owns its own attribute copies so its GPU buffers can be freed without touching the original
      const pg = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) pg.setAttribute(name, g.attributes[name].clone());
      pg.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
      if (g.boundingBox) pg.boundingBox = g.boundingBox.clone();
      if (g.boundingSphere) pg.boundingSphere = g.boundingSphere.clone();
      clones[i].geometry = pg;
      src.skip = false; src.previewOwned = true; src.positions = positions; src.indices = indices; src.count = count;
      tris += count / 3;
      loadMeshes.push({ key: src.key, positions: positions.slice(), indices: indices.slice(), lock: null });
    });
    R.originalTriangles = tris;
    R.root = clone;
    R.last = { ratio: 1, triangles: tris, ms: 0, keepUsed: 1 };
    R.registered = false;

    if (ensureWorker()) {
      try { await post({ type: 'load', meshes: loadMeshes }, loadMeshes.flatMap(m => [m.positions.buffer, m.indices.buffer])); }
      catch (err) { console.warn('Live worker load failed; using main thread.', err); R.workerFailed = true; R.worker = null; }
    }
    await syncLocks();
    app.setPreview(R.root);
    R.registered = true;
    window.dispatchEvent(new CustomEvent('shrink:live-ready', { detail: { triangles: tris } }));
  }

  /* ---------------- protect-brush locks ---------------- */
  async function syncLocks() {
    const locks = window.__shrinkPrint?.getLocks?.() || [];
    R.locks = new Map();
    for (const l of locks) { const s = R.sources.find(x => x.mesh === l.mesh); if (s && !s.skip) R.locks.set(s.key, l.mask.slice()); }
    if (R.worker && !R.workerFailed) {
      const items = R.sources.filter(s => !s.skip).map(s => ({ key: s.key, lock: R.locks.get(s.key) || null }));
      try { await post({ type: 'lock', locks: items }); } catch { /* falls back below */ }
    }
  }

  /* ---------------- running a reduction ---------------- */
  async function compute(ratio, opts) {
    const error = 0.05, protectKeep = opts.protectKeep ?? 1;
    const jobs = R.sources.filter(s => !s.skip).map(s => ({ key: s.key, ratio, error, protectKeep }));
    if (R.worker && !R.workerFailed) {
      try { return await post({ type: 'run', jobs }); } catch (err) { console.warn('Worker run failed, retrying on the main thread', err); R.workerFailed = true; }
    }
    const simplifier = await mainSimplifier();
    const t0 = performance.now(), results = [];
    for (const job of jobs) {
      const s = R.sources.find(x => x.key === job.key);
      const r = reduceIndices({ simplifier, positions: s.positions, indices: s.indices, lock: R.locks?.get(job.key) || null, ratio, error, protectKeep });
      results.push({ key: job.key, indices: r.indices, keepUsed: r.protectKeepUsed, protectedTriangles: r.protectedTriangles });
      await new Promise(r2 => setTimeout(r2, 0));
    }
    return { results, ms: performance.now() - t0 };
  }

  function apply(ratio, output) {
    let tris = 0, keepUsed = 1;
    const byKey = new Map((output?.results || []).map(r => [r.key, r]));
    for (const s of R.sources) {
      if (s.skip) { tris += (s.mesh.geometry.index ? s.mesh.geometry.index.count : s.mesh.geometry.attributes.position.count) / 3; continue; }
      const r = byKey.get(s.key);
      const idx = r ? r.indices : s.indices;
      if (r) keepUsed = Math.min(keepUsed, r.keepUsed ?? 1);
      const old = s.preview.geometry;
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(old.attributes)) g.setAttribute(name, old.attributes[name]);
      g.setIndex(new THREE.BufferAttribute(r ? idx : idx.slice(), 1));
      if (old.boundingBox) g.boundingBox = old.boundingBox; if (old.boundingSphere) g.boundingSphere = old.boundingSphere;
      s.preview.geometry = g;
      old.dispose();
      tris += idx.length / 3;
    }
    R.last = { ratio, triangles: tris, ms: output?.ms || 0, keepUsed };
    app.notifyReduced?.({ triangles: tris, ratio, keepUsed, preview: true });
    window.dispatchEvent(new CustomEvent('shrink:live-updated', { detail: { ...R.last } }));
    return R.last;
  }

  async function runJob(job) {
    if (!R.root) return null;
    window.dispatchEvent(new CustomEvent('shrink:live-busy', { detail: { busy: true, ratio: job.ratio } }));
    try {
      const out = job.ratio >= 0.999 ? { results: [], ms: 0 } : await compute(job.ratio, job);
      return apply(job.ratio, out);
    } catch (err) {
      console.error(err);
      window.dispatchEvent(new CustomEvent('shrink:live-error', { detail: { message: err.message } }));
      return null;
    } finally {
      window.dispatchEvent(new CustomEvent('shrink:live-busy', { detail: { busy: false } }));
    }
  }

  async function pump() {
    if (R.busy) return;
    R.busy = true;
    try { while (R.wanted) { const job = R.wanted; R.wanted = null; await runJob(job); } }
    finally { R.busy = false; }
  }

  // Slider-style request: only the newest value matters.
  function request(ratio, opts = {}, delay = 140) {
    if (R.locked) return;
    R.wanted = { ratio, ...opts };
    clearTimeout(R.timer);
    R.timer = setTimeout(pump, delay);
  }

  // Exact request that waits for its own result (used by Auto).
  async function runExact(ratio, opts = {}) {
    clearTimeout(R.timer); R.wanted = null;
    while (R.busy) await new Promise(r => setTimeout(r, 20));
    R.busy = true;
    try { return await runJob({ ratio, ...opts }); } finally { R.busy = false; }
  }

  return {
    prepare, request, runExact, syncLocks,
    lock(v) { R.locked = !!v; },
    get root() { return R.root; },
    get last() { return R.last; },
    get originalTriangles() { return R.originalTriangles; },
    get ready() { return !!R.root && R.registered; },
    get usingWorker() { return !!R.worker && !R.workerFailed; }
  };
}
