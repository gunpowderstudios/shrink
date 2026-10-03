// SHRINK 3D v2.18 — rebuild a messy model as one watertight solid (runs in a worker; main-thread fallback).
import * as THREE from 'https://esm.sh/three@0.180.0';

const VERSION = '2.18';

export function gatherWorldMesh(model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  let vertTotal = 0, idxTotal = 0;
  model.traverse(o => {
    const g = o.geometry;
    if (!o.isMesh || !g?.attributes?.position) return;
    meshes.push(o);
    vertTotal += g.attributes.position.count;
    idxTotal += g.index ? g.index.count : g.attributes.position.count;
  });
  if (!meshes.length) throw Object.assign(new Error('There is no surface to rebuild.'), { code: 'REMESH_EMPTY' });
  const positions = new Float32Array(vertTotal * 3);
  const indices = new Uint32Array(idxTotal - (idxTotal % 3));
  const v = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions[(vo + i) * 3] = v.x; positions[(vo + i) * 3 + 1] = v.y; positions[(vo + i) * 3 + 2] = v.z;
    }
    const count = g.index ? g.index.count : pos.count;
    const flip = mesh.matrixWorld.determinant() < 0;      // mirrored parts have reversed winding
    for (let t = 0; t + 2 < count && io + 2 < indices.length + 0; t += 3) {
      const a = g.index ? g.index.getX(t) : t, b = g.index ? g.index.getX(t + 1) : t + 1, c = g.index ? g.index.getX(t + 2) : t + 2;
      indices[io++] = a + vo; indices[io++] = flip ? c + vo : b + vo; indices[io++] = flip ? b + vo : c + vo;
    }
    vo += pos.count;
  }
  return { positions, indices: indices.subarray(0, io) };
}

export function buildRoot(positions, indices, stats) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.72, metalness: 0 }));
  mesh.name = 'SHRINK solid rebuild';
  const root = new THREE.Group();
  root.name = 'SHRINK solid rebuild';
  root.add(mesh);
  root.userData.shrinkSolidRebuild = true;
  root.userData.rebuildStats = stats;
  root.updateMatrixWorld(true);
  return root;
}

function runInWorker(job, onStatus, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Cancelled.'), { code: 'CANCELLED' })); return; }
    let worker;
    try { worker = new Worker(new URL(`./remesh-worker.js?v=${VERSION}`, import.meta.url), { type: 'module' }); }
    catch (e) { reject(Object.assign(new Error('worker-unavailable'), { code: 'WORKER_UNAVAILABLE' })); return; }
    const done = () => { try { worker.terminate(); } catch {} };
    signal?.addEventListener?.('abort', () => { done(); reject(Object.assign(new Error('Cancelled.'), { code: 'CANCELLED' })); }, { once: true });
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') onStatus?.(m.text, m.pct);
      else if (m.type === 'done') { done(); resolve({ positions: m.positions, indices: m.indices, stats: m.stats }); }
      else if (m.type === 'error') { done(); reject(Object.assign(new Error(m.message), { code: m.code, growth: m.growth, ratio: m.ratio })); }
    };
    worker.onerror = ev => { done(); reject(Object.assign(new Error(ev?.message || 'The background worker failed to start.'), { code: 'WORKER_UNAVAILABLE' })); };
    worker.postMessage({ type: 'run', ...job.data }, job.transfer);
  });
}

async function runOnMainThread(job, onStatus) {
  onStatus?.('Your browser cannot use a background worker, so the page may pause for a moment…', 2);
  const [{ rebuildSolidCore }, wasm] = await Promise.all([import(`./solid-core.js?v=${VERSION}`), window.__shrinkFuse?.loadManifold?.()]);
  if (!wasm) throw Object.assign(new Error('The solid builder could not load in this browser.'), { code: 'REMESH_ENGINE' });
  const { MeshoptSimplifier } = await import('meshoptimizer');
  const r = await rebuildSolidCore({ ...job.data, wasm, simplifier: MeshoptSimplifier, onProgress: (pct, text) => onStatus?.(text, pct) });
  return { positions: r.positions, indices: r.indices, stats: r.stats };
}

// Returns { root, stats }. `detailUnits` is the smallest detail to keep, in model units (0 = automatic).
export async function rebuildSolid(model, { detailUnits = 0, maxCells = 30e6, maxTris = 300000, onStatus, signal } = {}) {
  const { positions, indices } = gatherWorldMesh(model);
  const job = { data: { positions, indices, detailUnits, maxCells, maxTris }, transfer: [positions.buffer, indices.buffer] };
  let result;
  try { result = await runInWorker(job, onStatus, signal); }
  catch (err) {
    if (err?.code !== 'WORKER_UNAVAILABLE') throw err;
    const again = gatherWorldMesh(model);   // the first copy was handed to the worker
    result = await runOnMainThread({ data: { positions: again.positions, indices: again.indices, detailUnits, maxCells, maxTris } }, onStatus);
  }
  return { root: buildRoot(result.positions, result.indices, result.stats), stats: result.stats };
}
