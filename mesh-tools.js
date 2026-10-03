// Shrink mesh tools — pure algorithms (no DOM). Works in the browser and in Node tests.
// three / three-mesh-bvh are injected by the caller so this file has no hard dependency on how they are loaded.
import { compactPrimitive, getPrimitiveVertexCount, weld } from '@gltf-transform/functions';
import { reduceIndices } from './reduce-core.js?v=2.14';

/* ------------------------------------------------------------------ */
/* Size estimates                                                      */
/* ------------------------------------------------------------------ */
export function stlBytes(tris) { return 84 + 50 * tris; }
export function objBytesEstimate(tris) { return Math.round(tris * 42); }
export function glbBytesEstimate(tris, { meshopt = true, textureBytes = 0 } = {}) {
  const verts = tris / 2;
  const raw = verts * 32 + tris * 12;
  return Math.round((meshopt ? raw * 0.4 : raw) + textureBytes);
}

/* ------------------------------------------------------------------ */
/* Protection dabs (world-space spheres) -> per-vertex lock flags      */
/* ------------------------------------------------------------------ */
export class DabIndex {
  constructor(dabs) {
    this.dabs = dabs;
    this.count = dabs.length / 4;
    let maxR = 0;
    for (let i = 0; i < this.count; i++) maxR = Math.max(maxR, dabs[i * 4 + 3]);
    this.cell = Math.max(maxR, 1e-9);
    this.map = new Map();
    for (let i = 0; i < this.count; i++) {
      const key = this._key(dabs[i * 4], dabs[i * 4 + 1], dabs[i * 4 + 2]);
      let list = this.map.get(key);
      if (!list) this.map.set(key, list = []);
      list.push(i);
    }
  }
  _key(x, y, z) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`; }
  contains(x, y, z) {
    const c = this.cell, ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c), d = this.dabs;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const list = this.map.get(`${ix + a},${iy + b},${iz + e}`);
      if (!list) continue;
      for (const i of list) {
        const dx = x - d[i * 4], dy = y - d[i * 4 + 1], dz = z - d[i * 4 + 2], r = d[i * 4 + 3];
        if (dx * dx + dy * dy + dz * dz <= r * r) return true;
      }
    }
    return false;
  }
}

function applyMat(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

/* ------------------------------------------------------------------ */
/* Reduction with protected (locked) regions                           */
/* ------------------------------------------------------------------ */
// Mirrors @gltf-transform/functions simplify(), but passes a per-vertex lock array to meshoptimizer so painted
// areas keep their triangles and the rest of the model absorbs the reduction.
export async function simplifyWithProtection(document, { ratio, error = 0.05, dabs = [], simplifier, lockBorder = false, protectKeep = 1 } = {}) {
  await simplifier.ready;

  // Some game GLBs contain triangle primitives without an index accessor. The live Three.js reducer can
  // reduce those, but the old file-save path skipped them completely. Give every triangle primitive a simple
  // sequential index first, then let weld merge duplicate vertices/seams where it safely can. This keeps the
  // saved GLB on the same reduction path as the live preview instead of silently leaving whole meshes untouched.
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || prim.getIndices()) continue;
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const count = position.getCount();
      const arr = count <= 65534 ? new Uint16Array(count) : new Uint32Array(count);
      for (let i = 0; i < count; i++) arr[i] = i;
      const buffer = position.getBuffer() || document.getRoot().listBuffers()[0] || document.createBuffer();
      prim.setIndices(document.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer));
    }
  }

  await document.transform(weld({ overwrite: false }));
  const index = dabs.length ? new DabIndex(dabs) : null;
  let before = 0, after = 0, locked = 0, protectedTris = 0, keepUsed = 1;

  for (const mesh of document.getRoot().listMeshes()) {
    const parentNode = mesh.listParents().find(p => p.propertyType === 'Node');
    const world = parentNode ? parentNode.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const srcVertexCount = getPrimitiveVertexCount(prim, 'upload');
      const srcIndexCount = getPrimitiveVertexCount(prim, 'render');
      if (srcIndexCount < srcVertexCount / 2) compactPrimitive(prim);

      const position = prim.getAttribute('POSITION');
      const srcIndices = prim.getIndices();
      if (!position || !srcIndices) continue;
      let positions = position.getArray();
      if (!(positions instanceof Float32Array)) {
        const out = new Float32Array(positions.length);
        const el = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) { position.getElement(i, el); out.set(el, i * 3); }
        positions = out;
      }
      let indices = srcIndices.getArray();
      if (!(indices instanceof Uint32Array)) indices = new Uint32Array(indices);

      let lock = null;
      if (index) {
        lock = new Uint8Array(position.getCount());
        for (let i = 0; i < lock.length; i++) {
          const w = applyMat(world, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
          if (index.contains(w[0], w[1], w[2])) { lock[i] = 1; locked++; }
        }
      }

      const r = reduceIndices({ simplifier, positions, indices, lock, ratio, error, protectKeep, lockBorder });
      const dst = r.indices;
      keepUsed = Math.min(keepUsed, r.protectKeepUsed);
      protectedTris += r.protectedTriangles;

      before += indices.length / 3;
      after += dst.length / 3;
      const newIdx = document.createAccessor().setType('SCALAR').setArray(dst).setBuffer(srcIndices.getBuffer());
      prim.setIndices(newIdx);
      if (srcIndices.listParents().filter(p => p.propertyType !== 'Root').length === 0) srcIndices.dispose();

      // Important for file size: remove vertices/attributes that are no longer referenced by the reduced index list.
      compactPrimitive(prim);
      const dstVertexCount = getPrimitiveVertexCount(prim, 'upload');
      if (dstVertexCount <= 65534) prim.getIndices().setArray(new Uint16Array(prim.getIndices().getArray()));
    }
  }
  return { before, after, lockedVertices: locked, protectedTriangles: protectedTris, protectKeepUsed: keepUsed, reachedTarget: after <= Math.ceil(before * ratio * 1.03) };
}

/* ------------------------------------------------------------------ */
/* Detail-loss measurement                                             */
/* ------------------------------------------------------------------ */
export async function computeDetailLoss({ THREE, MeshBVH, original, reduced, onProgress, chunk = 12000, stride = 1, yieldToUi = true }) {
  original.updateMatrixWorld(true);
  reduced.updateMatrixWorld(true);

  const targets = [];
  reduced.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const bvh = new MeshBVH(o.geometry, { targetLeafSize: 8 });
    targets.push({ mesh: o, bvh, inv: new THREE.Matrix4().copy(o.matrixWorld).invert(), mw: o.matrixWorld });
  });
  if (!targets.length) throw new Error('The reduced model has no meshes to measure against.');

  const meshes = [];
  let total = 0;
  original.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) { meshes.push(o); total += o.geometry.attributes.position.count; } });

  const w = new THREE.Vector3(), local = new THREE.Vector3(), back = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const results = [];
  let done = 0;

  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const distances = new Float32Array(pos.count).fill(stride > 1 ? NaN : 0);
    for (let start = 0; start < pos.count; start += chunk) {
      const end = Math.min(pos.count, start + chunk);
      for (let i = start; i < end; i += stride) {
        w.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        let best = Infinity;
        for (const t of targets) {
          local.copy(w).applyMatrix4(t.inv);
          t.bvh.closestPointToPoint(local, hit);
          back.copy(hit.point).applyMatrix4(t.mw);
          const d = back.distanceTo(w);
          if (d < best) best = d;
        }
        distances[i] = best;
      }
      done += end - start;
      if (onProgress) onProgress(done / total);
      if (yieldToUi) await new Promise(r => setTimeout(r, 0));
    }
    results.push({ mesh, distances });
  }

  let sum = 0, max = 0, n = 0;
  const sample = [];
  const keepEvery = Math.max(1, Math.floor(total / stride / 120000));
  let seen = 0;
  for (const r of results) for (let i = 0; i < r.distances.length; i++) {
    const d = r.distances[i]; if (Number.isNaN(d)) continue;
    sum += d; n++; if (d > max) max = d;
    if (seen++ % keepEvery === 0) sample.push(d);
  }
  sample.sort((a, b) => a - b);
  const pct = p => sample.length ? sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] : 0;
  return { results, stats: { count: n, mean: n ? sum / n : 0, max, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) } };
}

const RAMP = [
  [0.0, [0.10, 0.25, 0.95]],
  [0.5, [0.10, 0.75, 0.95]],
  [1.0, [0.20, 0.85, 0.30]],
  [3.0, [0.95, 0.85, 0.15]],
  [6.0, [0.95, 0.15, 0.10]]
];
export function heatColor(ratio, out = [0, 0, 0]) {
  if (ratio <= RAMP[0][0]) { out[0] = RAMP[0][1][0]; out[1] = RAMP[0][1][1]; out[2] = RAMP[0][1][2]; return out; }
  for (let i = 1; i < RAMP.length; i++) {
    if (ratio <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i], f = (ratio - t0) / (t1 - t0);
      out[0] = c0[0] + (c1[0] - c0[0]) * f; out[1] = c0[1] + (c1[1] - c0[1]) * f; out[2] = c0[2] + (c1[2] - c0[2]) * f;
      return out;
    }
  }
  const last = RAMP[RAMP.length - 1][1]; out[0] = last[0]; out[1] = last[1]; out[2] = last[2];
  return out;
}

export function heatColorArray(distances, mmPerUnit, detailMM) {
  const colors = new Float32Array(distances.length * 3), c = [0, 0, 0];
  for (let i = 0; i < distances.length; i++) {
    heatColor((distances[i] * mmPerUnit) / detailMM, c);
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  return colors;
}

/* ------------------------------------------------------------------ */
/* Exporters                                                           */
/* ------------------------------------------------------------------ */
function collectTriangles(THREE, model, { mmPerUnit = 1, zUp = true }) {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const meshes = [];
  let triCount = 0;
  model.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
    triCount += Math.floor(n / 3);
    meshes.push(o);
  });
  const place = (mesh, i, out) => {
    v.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(mmPerUnit);
    if (zUp) out.set(v.x, -v.z, v.y); else out.copy(v);
    return out;
  };
  return { meshes, triCount, place };
}

export function buildBinaryStl({ THREE, model, mmPerUnit = 1, zUp = true }) {
  const { meshes, triCount, place } = collectTriangles(THREE, model, { mmPerUnit, zUp });
  const buffer = new ArrayBuffer(84 + 50 * triCount);
  const dv = new DataView(buffer);
  const header = 'Shrink STL (mm)';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, triCount, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  let off = 84;
  for (const mesh of meshes) {
    const idx = mesh.geometry.index;
    const count = idx ? idx.count : mesh.geometry.attributes.position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      place(mesh, i0, a); place(mesh, i1, b); place(mesh, i2, c);
      n.subVectors(c, b); e.subVectors(a, b); n.cross(e).normalize();
      dv.setFloat32(off, n.x, true); dv.setFloat32(off + 4, n.y, true); dv.setFloat32(off + 8, n.z, true);
      dv.setFloat32(off + 12, a.x, true); dv.setFloat32(off + 16, a.y, true); dv.setFloat32(off + 20, a.z, true);
      dv.setFloat32(off + 24, b.x, true); dv.setFloat32(off + 28, b.y, true); dv.setFloat32(off + 32, b.z, true);
      dv.setFloat32(off + 36, c.x, true); dv.setFloat32(off + 40, c.y, true); dv.setFloat32(off + 44, c.z, true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
  }
  return { buffer, triangles: triCount };
}

export function buildObjBlob({ THREE, model, mmPerUnit = 1, zUp = true }) {
  const { meshes, place } = collectTriangles(THREE, model, { mmPerUnit, zUp });
  const parts = [`# Shrink OBJ (units: mm, ${zUp ? 'Z-up' : 'Y-up'})\n`];
  const p = new THREE.Vector3();
  let base = 0, tris = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position;
    parts.push(`o mesh${parts.length}\n`);
    let chunk = [];
    for (let i = 0; i < pos.count; i++) {
      place(mesh, i, p);
      chunk.push(`v ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)}\n`);
      if (chunk.length >= 20000) { parts.push(chunk.join('')); chunk = []; }
    }
    parts.push(chunk.join(''));
    chunk = [];
    const idx = g.index, count = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = (idx ? idx.getX(t) : t) + 1 + base, i1 = (idx ? idx.getX(t + 1) : t + 1) + 1 + base, i2 = (idx ? idx.getX(t + 2) : t + 2) + 1 + base;
      chunk.push(`f ${i0} ${i1} ${i2}\n`);
      tris++;
      if (chunk.length >= 20000) { parts.push(chunk.join('')); chunk = []; }
    }
    parts.push(chunk.join(''));
    base += pos.count;
  }
  return { blob: new Blob(parts, { type: 'text/plain' }), triangles: tris };
}

/* ------------------------------------------------------------------ */
/* Model helpers                                                       */
/* ------------------------------------------------------------------ */
export function modelHeight(THREE, model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  return box.isEmpty() ? 0 : box.max.y - box.min.y;
}

export function smoothNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Printability: is the surface watertight?                            */
/* ------------------------------------------------------------------ */
export function analyzeTopology(THREE, model) {
  model.updateMatrixWorld(true);
  let openEdges = 0, nonManifold = 0, triangles = 0, degenerate = 0;
  model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const g = mesh.geometry, pos = g.attributes.position, n = pos.count;
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const px = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = k === 0 ? pos.getX(i) : k === 1 ? pos.getY(i) : pos.getZ(i); px[i * 3 + k] = v; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    const q = 100000 / ext, K = 131072;
    const canon = new Int32Array(n), seen = new Map();
    for (let i = 0; i < n; i++) {
      const key = ((Math.round((px[i * 3] - min[0]) * q) * K) + Math.round((px[i * 3 + 1] - min[1]) * q)) * K + Math.round((px[i * 3 + 2] - min[2]) * q);
      const c = seen.get(key);
      if (c === undefined) { seen.set(key, i); canon[i] = i; } else canon[i] = c;
    }
    const idx = g.index, count = idx ? idx.count : n, tri = Math.floor(count / 3);
    const keys = new Float64Array(tri * 3);
    let e = 0;
    for (let t = 0; t < tri; t++) {
      const a = canon[idx ? idx.getX(t * 3) : t * 3], b = canon[idx ? idx.getX(t * 3 + 1) : t * 3 + 1], c = canon[idx ? idx.getX(t * 3 + 2) : t * 3 + 2];
      if (a === b || b === c || a === c) { degenerate++; continue; }
      keys[e++] = Math.min(a, b) * n + Math.max(a, b);
      keys[e++] = Math.min(b, c) * n + Math.max(b, c);
      keys[e++] = Math.min(c, a) * n + Math.max(c, a);
      triangles++;
    }
    const sorted = keys.subarray(0, e).sort();
    for (let i = 0; i < sorted.length;) {
      let j = i + 1; while (j < sorted.length && sorted[j] === sorted[i]) j++;
      const run = j - i; if (run === 1) openEdges++; else if (run > 2) nonManifold++;
      i = j;
    }
  });
  return { openEdges, nonManifold, triangles, degenerate, watertight: openEdges === 0 && nonManifold === 0 };
}
