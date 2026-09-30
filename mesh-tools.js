// Shrink mesh tools — pure algorithms (no DOM). Works in the browser and in Node tests.
// three / three-mesh-bvh are injected by the caller so this file has no hard dependency on how they are loaded.
import { compactPrimitive, getPrimitiveVertexCount, weld } from '@gltf-transform/functions';

/* ------------------------------------------------------------------ */
/* Size estimates                                                      */
/* ------------------------------------------------------------------ */
export function stlBytes(tris) { return 84 + 50 * tris; }                       // binary STL is exact
export function objBytesEstimate(tris) { return Math.round(tris * 42); }         // text, ~6 decimals, indexed
export function glbBytesEstimate(tris, { meshopt = true, textureBytes = 0 } = {}) {
  const verts = tris / 2;
  const raw = verts * 32 + tris * 12;            // pos+normal+uv + 32-bit indices
  return Math.round((meshopt ? raw * 0.4 : raw) + textureBytes);
}

/* ------------------------------------------------------------------ */
/* Protection dabs (world-space spheres) -> per-vertex lock flags      */
/* ------------------------------------------------------------------ */
export class DabIndex {
  constructor(dabs) {
    this.dabs = dabs;                              // flat array [x,y,z,r, x,y,z,r, ...]
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

function applyMat(m, x, y, z) {                    // column-major 4x4 (gl-matrix / glTF layout)
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
  await document.transform(weld({ overwrite: false }));
  const index = dabs.length ? new DabIndex(dabs) : null;
  let before = 0, after = 0, locked = 0, protectedTris = 0, keepUsed = 1;

  for (const mesh of document.getRoot().listMeshes()) {
    const parentNode = mesh.listParents().find(p => p.propertyType === 'Node');
    const world = parentNode ? parentNode.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;          // triangles only
      const srcVertexCount = getPrimitiveVertexCount(prim, 'upload');
      const srcIndexCount = getPrimitiveVertexCount(prim, 'render');
      if (srcIndexCount < srcVertexCount / 2) compactPrimitive(prim);

      const position = prim.getAttribute('POSITION');
      const srcIndices = prim.getIndices();
      if (!srcIndices) continue;
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

      const target = Math.floor(ratio * indices.length / 3) * 3;
      const flags = lockBorder ? ['LockBorder'] : [];
      const dummy = new Float32Array(position.getCount());
      const run = (idx, lk, tgt) => simplifier.simplifyWithAttributes(idx, positions, 3, dummy, 1, [0], lk, tgt, error, flags)[0];

      let work = indices;
      if (lock) {
        let prot = 0;
        for (let t = 0; t < indices.length; t += 3) if (lock[indices[t]] && lock[indices[t + 1]] && lock[indices[t + 2]]) prot++;
        // The painted area may use at most ~60% of the triangle budget; beyond that it is thinned a little
        // so the rest of the model is not destroyed to pay for it.
        const cap = 0.6 * (target / 3);
        const keepEff = prot ? Math.min(protectKeep, cap / prot) : 1;
        keepUsed = Math.min(keepUsed, keepEff);
        if (keepEff < 1) {
          // Stage A: freeze everything OUTSIDE the painted area and thin only the painted area.
          const inverse = new Uint8Array(lock.length);
          for (let i = 0; i < lock.length; i++) inverse[i] = lock[i] ? 0 : 1;
          const total = indices.length / 3;
          const targetA = Math.max(0, Math.min(total, Math.floor(total - prot * (1 - keepEff)))) * 3;
          work = run(indices, inverse, targetA);
        }
      }
      // Stage B: freeze the painted area, let everything else absorb the reduction.
      const dst = run(work, lock, target);
      if (lock) for (let t = 0; t < dst.length; t += 3) if (lock[dst[t]] && lock[dst[t + 1]] && lock[dst[t + 2]]) protectedTris++;

      before += indices.length / 3;
      after += dst.length / 3;
      const newIdx = document.createAccessor().setType('SCALAR').setArray(dst).setBuffer(srcIndices.getBuffer());
      prim.setIndices(newIdx);
      if (srcIndices.listParents().filter(p => p.propertyType !== 'Root').length === 0) srcIndices.dispose();
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
// For every vertex of the ORIGINAL model, measure how far it now sits from the REDUCED surface.
// (Measuring reduced -> original would read ~0 because decimation keeps a subset of original vertices.)
export async function computeDetailLoss({ THREE, MeshBVH, original, reduced, onProgress, chunk = 12000 }) {
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
    const distances = new Float32Array(pos.count);
    for (let start = 0; start < pos.count; start += chunk) {
      const end = Math.min(pos.count, start + chunk);
      for (let i = start; i < end; i++) {
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
      await new Promise(r => setTimeout(r, 0));
    }
    results.push({ mesh, distances });
  }

  // statistics (sampled for percentiles)
  let sum = 0, max = 0, n = 0;
  const sample = [];
  const stride = Math.max(1, Math.floor(total / 120000));
  for (const r of results) for (let i = 0; i < r.distances.length; i++) {
    const d = r.distances[i]; sum += d; n++; if (d > max) max = d;
    if (i % stride === 0) sample.push(d);
  }
  sample.sort((a, b) => a - b);
  const pct = p => sample.length ? sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] : 0;
  return { results, stats: { count: n, mean: n ? sum / n : 0, max, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) } };
}

// ratio = loss / printer detail. Blue = invisible at print resolution, green = about one pixel, yellow/red = visible.
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
/* Exporters (from a three.js model, so they work for edited/optimised) */
/* ------------------------------------------------------------------ */
// opts: { THREE, mmPerUnit, zUp }  -> transform: world * mmPerUnit, optional Y-up -> Z-up (x, -z, y)
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

// Area-weighted smooth vertex normals for an indexed triangle mesh.
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
