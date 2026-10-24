// SHRINK 3D v2.141 — CLAY: pure geometry helpers (no DOM, no three.js), tested in Node by clay.test.mjs.
// A clay stroke is a row of overlapping balls ("dabs") laid along the model's surface. The page shows them in pink; when the person
// presses FIX IT the "add" balls are joined to the model and the "cut" balls are carved out of it.

// unit icosphere: level 0 = 20 triangles, each level splits every triangle in four. Triangles face outward.
export function icosphere(level = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(p => { const l = Math.hypot(...p); return p.map(c => c / l); });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map(), next = [];
    const mid = (a, b) => {
      const k = a < b ? a * 100000 + b : b * 100000 + a;
      if (cache.has(k)) return cache.get(k);
      const p = v[a].map((c, i) => (c + v[b][i]) / 2), len = Math.hypot(...p);
      v.push(p.map(c => c / len)); cache.set(k, v.length - 1); return v.length - 1;
    };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = next;
  }
  const pos = new Float32Array(v.length * 3); v.forEach((p, i) => pos.set(p, i * 3));
  const idx = new Uint32Array(f.length * 3); f.forEach((tri, i) => idx.set(tri, i * 3));
  // make sure the winding really is outward (positive volume) whatever the table above says
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const x = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = x; }
  return { positions: pos, indices: idx };
}

// All balls as one triangle soup (each ball is its own closed shell). dabs: [{x, y, z, r}]
export function dabSoup(dabs, level = 2) {
  const u = icosphere(level), nv = u.positions.length / 3, nt = u.indices.length;
  const positions = new Float32Array(dabs.length * nv * 3), indices = new Uint32Array(dabs.length * nt);
  dabs.forEach((d, k) => {
    for (let i = 0; i < nv; i++) { positions[(k * nv + i) * 3] = d.x + u.positions[i * 3] * d.r; positions[(k * nv + i) * 3 + 1] = d.y + u.positions[i * 3 + 1] * d.r; positions[(k * nv + i) * 3 + 2] = d.z + u.positions[i * 3 + 2] * d.r; }
    for (let i = 0; i < nt; i++) indices[k * nt + i] = u.indices[i] + k * nv;
  });
  return { positions, indices };
}

// Balls from `a` (excluded) to `b` (included), no more than `step` × radius apart so they overlap into a smooth rope.
export function dabsAlong(a, b, r, step = 0.4) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
  const n = Math.max(1, Math.ceil(d / Math.max(1e-9, r * step))), out = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + dx * i / n, y: a.y + dy * i / n, z: a.z + dz * i / n, r });
  return out;
}

// Join two triangle soups.
export function joinSoups(a, b) {
  const positions = new Float32Array(a.positions.length + b.positions.length); positions.set(a.positions); positions.set(b.positions, a.positions.length);
  const off = a.positions.length / 3, indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices); for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + off;
  return { positions, indices };
}

// Keep only one ball per `cell` (a grid of size r*0.25) so a long slow drag does not pile up thousands of identical balls.
export function thin(dabs, cellFactor = 0.25) {
  const seen = new Set(), out = [];
  for (const d of dabs) { const c = Math.max(1e-9, d.r * cellFactor), k = `${Math.round(d.x / c)},${Math.round(d.y / c)},${Math.round(d.z / c)},${d.r}`; if (!seen.has(k)) { seen.add(k); out.push(d); } }
  return out;
}
