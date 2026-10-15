// SHRINK 3D v2.87 — Tron (beta): the flat-faceted low-poly car maker. Pure maths, no DOM, no imports, so it runs in a Worker and in the tests.
//
// A dense scanned/AI car (hundreds of thousands of triangles) goes in; out comes
//   - a solid body of a few hundred to a few thousand flat triangles, each face painted one colour sampled from the original, and
//   - four wheel descriptions (centre, radius, width) so the page can build separate, spinnable wheels.
// Steps: find the wheels -> drop them -> mark the car's skin in a voxel grid -> close gaps, fill the inside, drop thin spikes
// -> cut the wheel arches -> smooth + Surface Nets (a mesh from the grid) -> simplify with meshoptimizer -> flat colours.
//
// Expects: Y up, the car's length along X (the page rotates a car that is long in Z), width along Z.
// Everything is deterministic: the same input gives the same car.

export const TRON_MIN_FACES = 300, TRON_MAX_FACES = 5000;

// More triangles asked for -> a finer voxel grid, so the extra triangles have shape to follow. 800 -> 0.02, 2500 -> 0.0113 of the car length.
export function resFor(faces) { return Math.min(0.03, Math.max(0.008, 0.02 * Math.sqrt(800 / faces))); }

/* ---------- small grid helpers (6-connected, like scipy's default) ---------- */
function dilate6(g, nx, ny, nz) {
  const out = new Uint8Array(g.length), sy = nx, sz = nx * ny;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = k * sz + j * sy + i;
    out[p] = (g[p] || (i > 0 && g[p - 1]) || (i < nx - 1 && g[p + 1]) || (j > 0 && g[p - sy]) || (j < ny - 1 && g[p + sy]) || (k > 0 && g[p - sz]) || (k < nz - 1 && g[p + sz])) ? 1 : 0;
  }
  return out;
}
function erode6(g, nx, ny, nz) {   // outside the grid counts as empty
  const out = new Uint8Array(g.length), sy = nx, sz = nx * ny;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = k * sz + j * sy + i;
    out[p] = (g[p] && i > 0 && g[p - 1] && i < nx - 1 && g[p + 1] && j > 0 && g[p - sy] && j < ny - 1 && g[p + sy] && k > 0 && g[p - sz] && k < nz - 1 && g[p + sz]) ? 1 : 0;
  }
  return out;
}
function floodFrom(seedFn, passable, nx, ny, nz) {   // 6-connected flood over cells where passable(p) is true, from the cells seedFn lists
  const seen = new Uint8Array(nx * ny * nz), q = new Int32Array(nx * ny * nz), sy = nx, sz = nx * ny;
  let head = 0, tail = 0;
  seedFn(p => { if (!seen[p] && passable(p)) { seen[p] = 1; q[tail++] = p; } });
  while (head < tail) {
    const p = q[head++], i = p % nx, j = ((p / nx) | 0) % ny, k = (p / sz) | 0;
    if (i > 0) { const r = p - 1; if (!seen[r] && passable(r)) { seen[r] = 1; q[tail++] = r; } }
    if (i < nx - 1) { const r = p + 1; if (!seen[r] && passable(r)) { seen[r] = 1; q[tail++] = r; } }
    if (j > 0) { const r = p - sy; if (!seen[r] && passable(r)) { seen[r] = 1; q[tail++] = r; } }
    if (j < ny - 1) { const r = p + sy; if (!seen[r] && passable(r)) { seen[r] = 1; q[tail++] = r; } }
    if (k > 0) { const r = p - sz; if (!seen[r] && passable(r)) { seen[r] = 1; q[tail++] = r; } }
    if (k < nz - 1) { const r = p + sz; if (!seen[r] && passable(r)) { seen[r] = 1; q[tail++] = r; } }
  }
  return seen;
}
// Close small gaps in the skin (dilate then erode), then fill every hollow: for each of the three directions, every slice is flooded from its edge
// and whatever the flood cannot reach becomes solid. A real car is not watertight (open windows, missing glass), so a 3D flood would leak and fill nothing.
function fillSlices(g, nx, ny, nz) {
  const dims = [nx, ny, nz], strides = [1, nx, nx * ny], out = Uint8Array.from(g);
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, v = (a + 2) % 3, nu = dims[u], nv = dims[v], su = strides[u], sv = strides[v], sa = strides[a];
    const seen = new Uint8Array(nu * nv), q = new Int32Array(nu * nv);
    for (let s = 0; s < dims[a]; s++) {
      seen.fill(0); let head = 0, tail = 0;
      const at = (iu, iv) => s * sa + iu * su + iv * sv;
      const push = (iu, iv) => { const id = iv * nu + iu; if (!seen[id] && !out[at(iu, iv)]) { seen[id] = 1; q[tail++] = id; } };
      for (let iu = 0; iu < nu; iu++) { push(iu, 0); push(iu, nv - 1); }
      for (let iv = 0; iv < nv; iv++) { push(0, iv); push(nu - 1, iv); }
      while (head < tail) {
        const id = q[head++], iu = id % nu, iv = (id / nu) | 0;
        if (iu > 0) push(iu - 1, iv); if (iu < nu - 1) push(iu + 1, iv); if (iv > 0) push(iu, iv - 1); if (iv < nv - 1) push(iu, iv + 1);
      }
      for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) if (!seen[iv * nu + iu]) out[at(iu, iv)] = 1;
    }
  }
  return out;
}
export function fillInside(occ, nx, ny, nz) {
  const closed = erode6(dilate6(occ, nx, ny, nz), nx, ny, nz);
  return fillSlices(closed, nx, ny, nz);
}
function largestPart(g, nx, ny, nz) {
  const label = new Int32Array(g.length); let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < g.length; s++) {
    if (!g[s] || label[s]) continue;
    id++;
    const seen = floodFrom(add => add(s), p => g[p] && !label[p], nx, ny, nz);
    let count = 0; for (let p = 0; p < seen.length; p++) if (seen[p]) { label[p] = id; count++; }
    if (count > best) { best = count; bestId = id; }
  }
  const out = new Uint8Array(g.length); for (let p = 0; p < g.length; p++) out[p] = label[p] === bestId && bestId ? 1 : 0;
  return out;
}
function blur(g, nx, ny, nz, rounds = 2) {   // [1 2 1]/4 along each axis, repeated: close enough to a Gaussian of sigma 1
  let a = Float32Array.from(g), b = new Float32Array(a.length);
  const sy = nx, sz = nx * ny;
  for (let r = 0; r < rounds; r++) for (const [step, n, outer1, outer2, s1, s2] of [[1, nx, ny, nz, sy, sz], [sy, ny, nx, nz, 1, sz], [sz, nz, nx, ny, 1, sy]]) {
    for (let o2 = 0; o2 < outer2; o2++) for (let o1 = 0; o1 < outer1; o1++) {
      const base = o1 * s1 + o2 * s2;
      for (let t = 0; t < n; t++) { const p = base + t * step, lo = t > 0 ? a[p - step] : a[p], hi = t < n - 1 ? a[p + step] : a[p]; b[p] = 0.25 * lo + 0.5 * a[p] + 0.25 * hi; }
    }
    [a, b] = [b, a];
  }
  return a;
}

/* ---------- Surface Nets: a mesh of the iso-surface of a scalar grid (one vertex per mixed cell, one quad per crossed edge) ---------- */
export function surfaceNets(f, nx, ny, nz, iso, lo, res) {
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cell = new Int32Array(cx * cy * cz).fill(-1), sy = nx, sz = nx * ny;
  const pos = [], EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float64Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = f[(k + (c >> 2 & 1)) * sz + (j + (c >> 1 & 1)) * sy + i + (c & 1)]; val[c] = v; if (v > iso) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy2 = 0, sz2 = 0, n = 0;
    for (const [a, b] of EDGES) {
      if ((val[a] > iso) === (val[b] > iso)) continue;
      const t = (iso - val[a]) / (val[b] - val[a]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy2 += (a >> 1 & 1) + ((b >> 1 & 1) - (a >> 1 & 1)) * t; sz2 += (a >> 2 & 1) + ((b >> 2 & 1) - (a >> 2 & 1)) * t; n++;
    }
    cell[(k * cy + j) * cx + i] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * res, lo[1] + (j + sy2 / n) * res, lo[2] + (k + sz2 / n) * res);
  }
  const idx = [], dims = [nx, ny, nz];
  const cellAt = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) ? -1 : cell[(k * cy + j) * cx + i];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = k * sz + j * sy + i, c = [i, j, k];
    for (let a = 0; a < 3; a++) {
      if (c[a] >= dims[a] - 1) continue;
      const q = p + (a === 0 ? 1 : a === 1 ? sy : sz);
      const pin = f[p] > iso;
      if (pin === (f[q] > iso)) continue;
      const u = (a + 1) % 3, v = (a + 2) % 3, ids = [];
      for (const [du, dv] of [[-1, -1], [0, -1], [0, 0], [-1, 0]]) { const cc = c.slice(); cc[u] += du; cc[v] += dv; ids.push(cellAt(cc[0], cc[1], cc[2])); }
      if (ids.some(x => x < 0)) continue;
      if (pin) idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); else idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
    }
  }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  if (signedVolume(positions, indices) < 0) for (let t = 0; t < indices.length; t += 3) { const x = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = x; }
  return { positions, indices };
}
export function signedVolume(P, I) {
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    s += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return s / 6;
}

/* ---------- wheel detection ---------- */
function percentile(arr, q) { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; }
// Best circle in the side view (x,y) for one end of the car; ring density minus what lies just outside it. rfix keeps a radius shared with the other axle.
function fitAxle(Q, nv, sx, L, ymin, W, rfix) {
  const cand = [];
  for (let i = 0; i < nv; i++) { const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2]; if (x * sx > 0 && y < ymin + 0.25 * L && Math.abs(z) > 0.6 * W) cand.push(i); }
  const step = Math.max(1, Math.ceil(cand.length / 3000)), xs = [], ys = [];
  for (let t = 0; t < cand.length; t += step) { xs.push(Q[cand[t] * 3]); ys.push(Q[cand[t] * 3 + 1]); }
  let best = null; const m = xs.length;
  for (let cx = 0.22 * L; cx <= 0.42 * L; cx += 0.005 * L) {
    const X = cx * sx;
    for (let cy = ymin + 0.05 * L; cy <= ymin + 0.22 * L; cy += 0.005 * L) {
      const rs = rfix ? [rfix] : []; if (!rfix) for (let r = 0.05 * L; r <= 0.13 * L; r += 0.0025 * L) rs.push(r);
      const cnt = new Float64Array(rs.length * 2);
      for (let t = 0; t < m; t++) {
        const d = Math.hypot(xs[t] - X, ys[t] - cy);
        for (let ri = 0; ri < rs.length; ri++) {
          const r = rs[ri];
          if (d > r - 0.005 * L && d < r + 0.0025 * L) cnt[ri * 2]++;
          else if (d > r + 0.0075 * L && d < r + 0.02 * L) cnt[ri * 2 + 1]++;
        }
      }
      for (let ri = 0; ri < rs.length; ri++) { const score = cnt[ri * 2] - cnt[ri * 2 + 1]; if (!best || score > best.score) best = { score, x: X, y: cy, r: rs[ri] }; }
    }
  }
  return best;
}

/* ---------- the whole thing ---------- */
// src: { positions: Float32Array xyz, indices: Uint32Array, normals?: Float32Array, colors?: Uint8Array rgb (0-255, sRGB) }
// opt: { faces, res?, simplifier: { simplify(indices, positions, 3, targetIndexCount, targetError, flags) -> [indices, error] }, onProgress?(text) }
export function flattenCar(src, opt) {
  const { positions: P0, indices: I0, normals: N0, colors: C0 } = src;
  const faces = Math.round(Math.min(TRON_MAX_FACES, Math.max(TRON_MIN_FACES, opt.faces || 800)));
  const nv = P0.length / 3, nt = I0.length / 3, say = opt.onProgress || (() => {});
  if (nt < 10) throw new Error('This model has too few triangles to flatten.');
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const L = maxx - minx, ymin = miny, W = (maxz - minz) / 2, ox = (minx + maxx) / 2, oz = (minz + maxz) / 2;
  if (!(L > 0) || !(W > 0)) throw new Error('This model is flat or empty.');
  const Q = new Float32Array(P0.length);   // centred in X and Z: the wheel search then looks the same at both ends
  for (let i = 0; i < nv; i++) { Q[i * 3] = P0[i * 3] - ox; Q[i * 3 + 1] = P0[i * 3 + 1]; Q[i * 3 + 2] = P0[i * 3 + 2] - oz; }

  // 1. wheels
  say('Finding the wheels…');
  const fits = { '-1': fitAxle(Q, nv, -1, L, ymin, W), '1': fitAxle(Q, nv, 1, L, ymin, W) };
  let wheels = [], z0 = 0, z1 = 0, frontSign = -1;
  if (fits['-1'] && fits['1']) {
    const good = fits['-1'].score >= fits['1'].score ? -1 : 1, rr = fits[good].r;
    fits[-good] = fitAxle(Q, nv, -good, L, ymin, W, rr) || fits[-good];
    const ok = fits['-1'].score > 40 && fits['1'].score > 40;
    if (ok) {
      const zs = [];
      for (const sx of [-1, 1]) {
        const f = fits[sx], arr = [];
        for (let i = 0; i < nv; i++) if (Math.hypot(Q[i * 3] - f.x, Q[i * 3 + 1] - f.y) < f.r * 1.05 && Math.abs(Q[i * 3 + 2]) > 0.5 * W) arr.push(Math.abs(Q[i * 3 + 2]));
        zs.push([percentile(arr, 0.01), percentile(arr, 0.995)]);
      }
      z0 = (zs[0][0] + zs[1][0]) / 2; z1 = (zs[0][1] + zs[1][1]) / 2;
      if (z1 - z0 > 0.02 * L) wheels = [-1, 1].map(sx => ({ sx, x: fits[sx].x, y: fits[sx].y, r: fits[sx].r }));
    }
  }
  // the front is guessed from where the roof sits: the roof is nearer the rear, so the front is on the other side of it
  if (wheels.length) {
    const ys = new Float32Array(nv); for (let i = 0; i < nv; i++) ys[i] = Q[i * 3 + 1];
    const ytop = percentile(ys, 0.93), xs = [];   // a percentile, not the very top: an aerial or wiper would drag the answer
    for (let i = 0; i < nv; i++) if (Q[i * 3 + 1] > ytop) xs.push(Q[i * 3]);
    const mid = percentile(xs, 0.5);
    frontSign = mid > 0 ? -1 : 1;
  }
  const inWheel = (x, y, z, k) => { for (const w of wheels) if (Math.hypot(x - w.x, y - w.y) < w.r * k && Math.abs(z) > z0 * 0.9) return true; return false; };

  // 2. grid sized to the car minus its wheels; mark the skin
  const res = (opt.res || resFor(faces)) * L;
  say('Building the solid…');
  const keepTri = new Uint8Array(nt);
  let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
  for (let t = 0; t < nt; t++) {
    const a = I0[t * 3] * 3, b = I0[t * 3 + 1] * 3, c = I0[t * 3 + 2] * 3;
    const cxm = (Q[a] + Q[b] + Q[c]) / 3, cym = (Q[a + 1] + Q[b + 1] + Q[c + 1]) / 3, czm = (Q[a + 2] + Q[b + 2] + Q[c + 2]) / 3;
    if (wheels.length && inWheel(cxm, cym, czm, 1.1)) continue;
    keepTri[t] = 1;
    for (const o of [a, b, c]) {
      if (Q[o] < bx0) bx0 = Q[o]; if (Q[o] > bx1) bx1 = Q[o]; if (Q[o + 1] < by0) by0 = Q[o + 1]; if (Q[o + 1] > by1) by1 = Q[o + 1]; if (Q[o + 2] < bz0) bz0 = Q[o + 2]; if (Q[o + 2] > bz1) bz1 = Q[o + 2];
    }
  }
  if (bx1 <= bx0) throw new Error('Nothing left of the body after taking the wheels off.');
  const lo = [bx0 - res * 3, by0 - res * 3, bz0 - res * 3];
  const nx = Math.ceil((bx1 + res * 3 - lo[0]) / res) + 1, ny = Math.ceil((by1 + res * 3 - lo[1]) / res) + 1, nz = Math.ceil((bz1 + res * 3 - lo[2]) / res) + 1;
  if (nx * ny * nz > 40e6) throw new Error('The grid is too big: lower the triangle count.');
  let occ = new Uint8Array(nx * ny * nz);
  const exX = [], exN = [], exC = [];   // extra colour samples on big triangles (a big flat triangle has no vertices of its own in the middle)
  const mark = (x, y, z) => {
    const i = Math.floor((x - lo[0]) / res), j = Math.floor((y - lo[1]) / res), k = Math.floor((z - lo[2]) / res);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) occ[(k * ny + j) * nx + i] = 1;
  };
  for (let t = 0; t < nt; t++) {
    if (!keepTri[t]) continue;
    const a = I0[t * 3] * 3, b = I0[t * 3 + 1] * 3, c = I0[t * 3 + 2] * 3;
    mark(Q[a], Q[a + 1], Q[a + 2]); mark(Q[b], Q[b + 1], Q[b + 2]); mark(Q[c], Q[c + 1], Q[c + 2]);
    const e = Math.max(Math.hypot(Q[a] - Q[b], Q[a + 1] - Q[b + 1], Q[a + 2] - Q[b + 2]), Math.hypot(Q[a] - Q[c], Q[a + 1] - Q[c + 1], Q[a + 2] - Q[c + 2]), Math.hypot(Q[b] - Q[c], Q[b + 1] - Q[c + 1], Q[b + 2] - Q[c + 2]));
    const n = Math.min(48, Math.ceil(e / (0.7 * res)));
    if (n <= 1) { mark((Q[a] + Q[b] + Q[c]) / 3, (Q[a + 1] + Q[b + 1] + Q[c + 1]) / 3, (Q[a + 2] + Q[b + 2] + Q[c + 2]) / 3); continue; }
    const ia = I0[t * 3], ib = I0[t * 3 + 1], ic = I0[t * 3 + 2], keepX = C0 && exX.length < 6e6 && e > 1.5 * res;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      const x = Q[a] * w + Q[b] * u + Q[c] * v, y = Q[a + 1] * w + Q[b + 1] * u + Q[c + 1] * v, z = Q[a + 2] * w + Q[b + 2] * u + Q[c + 2] * v;
      mark(x, y, z);
      if (keepX && i % 2 === 0 && j % 2 === 0) {
        exX.push(x, y, z);
        for (let q = 0; q < 3; q++) { exC.push(C0[ia * 3 + q] * w + C0[ib * 3 + q] * u + C0[ic * 3 + q] * v); exN.push(N0 ? N0[ia * 3 + q] * w + N0[ib * 3 + q] * u + N0[ic * 3 + q] * v : 0); }
      }
    }
  }
  if (opt.debug) { let o = 0; for (const v of occ) o += v; opt.debug({ occ: o, grid: [nx, ny, nz], wheels: wheels.length, res }); }
  let solid = fillInside(occ, nx, ny, nz); occ = null;
  if (opt.debug) { let o = 0; for (const v of solid) o += v; opt.debug({ filled: o }); }
  solid = dilate6(dilate6(erode6(erode6(solid, nx, ny, nz), nx, ny, nz), nx, ny, nz), nx, ny, nz);   // opening: thin spikes (aerials, wipers) go
  solid = largestPart(solid, nx, ny, nz);
  if (wheels.length) {   // cut the wheel arches so the wheels sit in cut-outs
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p = (k * ny + j) * nx + i;
      if (solid[p] && inWheel(lo[0] + i * res, lo[1] + j * res, lo[2] + k * res, 1.08)) solid[p] = 0;
    }
  }
  let count = 0; for (let p = 0; p < solid.length; p++) count += solid[p];
  if (count < 50) throw new Error('Could not build a solid from this model.');

  // 3. mesh + simplify
  say('Making the flat faces…');
  const field = blur(solid, nx, ny, nz, 2);
  const mesh = surfaceNets(field, nx, ny, nz, 0.5, lo, res);
  if (mesh.indices.length < 12) throw new Error('Could not make a surface from this model.');
  let { positions: SP, indices: SI } = mesh;
  if (SI.length / 3 > faces) {
    const out = opt.simplifier.simplify(SI, SP, 3, faces * 3, 1, []);
    SI = out[0];
  }
  // keep only the vertices that are used
  const remap = new Int32Array(SP.length / 3).fill(-1), used = [];
  for (let t = 0; t < SI.length; t++) if (remap[SI[t]] < 0) { remap[SI[t]] = used.length; used.push(SI[t]); }
  const nf = SI.length / 3, bodyPos = new Float32Array(nf * 9), bodyNor = new Float32Array(nf * 9), bodyCol = new Uint8Array(nf * 9);
  const cen = new Float32Array(nf * 3), fnor = new Float32Array(nf * 3);
  for (let t = 0; t < nf; t++) {
    const A = SI[t * 3] * 3, B = SI[t * 3 + 1] * 3, Cc = SI[t * 3 + 2] * 3;
    const ux = SP[B] - SP[A], uy = SP[B + 1] - SP[A + 1], uz = SP[B + 2] - SP[A + 2], vx = SP[Cc] - SP[A], vy = SP[Cc + 1] - SP[A + 1], vz = SP[Cc + 2] - SP[A + 2];
    let nxn = uy * vz - uz * vy, nyn = uz * vx - ux * vz, nzn = ux * vy - uy * vx; const l = Math.hypot(nxn, nyn, nzn) || 1; nxn /= l; nyn /= l; nzn /= l;
    fnor[t * 3] = nxn; fnor[t * 3 + 1] = nyn; fnor[t * 3 + 2] = nzn;
    cen[t * 3] = (SP[A] + SP[B] + SP[Cc]) / 3; cen[t * 3 + 1] = (SP[A + 1] + SP[B + 1] + SP[Cc + 1]) / 3; cen[t * 3 + 2] = (SP[A + 2] + SP[B + 2] + SP[Cc + 2]) / 3;
    [A, B, Cc].forEach((o, q) => {
      bodyPos[t * 9 + q * 3] = SP[o] + ox; bodyPos[t * 9 + q * 3 + 1] = SP[o + 1]; bodyPos[t * 9 + q * 3 + 2] = SP[o + 2] + oz;
      bodyNor[t * 9 + q * 3] = nxn; bodyNor[t * 9 + q * 3 + 1] = nyn; bodyNor[t * 9 + q * 3 + 2] = nzn;
    });
  }

  // 4. each face takes the colour of the original skin next to it (facing the same way, so the inside of the roof is ignored)
  say('Painting the faces…');
  const colourSet = new Set();
  if (C0) {
    const ne = exX.length / 3, ns = nv + ne, SQ = new Float32Array(ns * 3), SC = new Float32Array(ns * 3), SN = N0 ? new Float32Array(ns * 3) : null;
    SQ.set(Q); SC.set(C0); if (SN) SN.set(N0); SQ.set(exX, nv * 3); SC.set(exC, nv * 3); if (SN) SN.set(exN, nv * 3);
    const cs = res * 1.5, sxn = Math.max(1, Math.ceil((bx1 - bx0) / cs) + 3), syn = Math.max(1, Math.ceil((by1 - by0) / cs) + 3), szn = Math.max(1, Math.ceil((bz1 - bz0) / cs) + 3);
    const cellOf = (x, y, z) => [Math.min(sxn - 1, Math.max(0, Math.floor((x - bx0) / cs) + 1)), Math.min(syn - 1, Math.max(0, Math.floor((y - by0) / cs) + 1)), Math.min(szn - 1, Math.max(0, Math.floor((z - bz0) / cs) + 1))];
    const start = new Int32Array(sxn * syn * szn + 1), vertOk = new Uint8Array(ns).fill(1); vertOk.fill(0, 0, nv);
    for (let t = 0; t < nt; t++) if (keepTri[t]) for (let q = 0; q < 3; q++) vertOk[I0[t * 3 + q]] = 1;
    const cellIdx = new Int32Array(ns).fill(-1);
    for (let i = 0; i < ns; i++) if (vertOk[i]) { const [a, b, c] = cellOf(SQ[i * 3], SQ[i * 3 + 1], SQ[i * 3 + 2]); cellIdx[i] = (c * syn + b) * sxn + a; start[cellIdx[i] + 1]++; }
    for (let i = 0; i < start.length - 1; i++) start[i + 1] += start[i];
    const fillAt = start.slice(0, -1), items = new Int32Array(start[start.length - 1]);
    for (let i = 0; i < ns; i++) if (cellIdx[i] >= 0) items[fillAt[cellIdx[i]]++] = i;
    const cand = [];
    for (let t = 0; t < nf; t++) {
      const cx = cen[t * 3], cy = cen[t * 3 + 1], cz = cen[t * 3 + 2], nx0 = fnor[t * 3], ny0 = fnor[t * 3 + 1], nz0 = fnor[t * 3 + 2];
      let rgb = null;
      for (let pass = 0; pass < 4 && !rgb; pass++) {
        const rad = cs * (pass === 3 ? 1.5 : 1) * (pass === 0 ? 0.75 : pass === 1 ? 1.2 : 2.2) , useN = N0 && pass < 3;
        const rr = Math.ceil(rad / cs), [ci, cj, ck] = cellOf(cx, cy, cz); cand.length = 0;
        for (let c = Math.max(0, ck - rr); c <= Math.min(szn - 1, ck + rr); c++) for (let b = Math.max(0, cj - rr); b <= Math.min(syn - 1, cj + rr); b++) for (let a = Math.max(0, ci - rr); a <= Math.min(sxn - 1, ci + rr); a++) {
          const cellId = (c * syn + b) * sxn + a;
          for (let q = start[cellId]; q < start[cellId + 1]; q++) {
            const i = items[q];
            if (Math.hypot(SQ[i * 3] - cx, SQ[i * 3 + 1] - cy, SQ[i * 3 + 2] - cz) > rad) continue;
            if (useN && SN[i * 3] * nx0 + SN[i * 3 + 1] * ny0 + SN[i * 3 + 2] * nz0 < 0.5) continue;
            cand.push(i);
          }
        }
        if (cand.length >= (pass < 3 ? 5 : 1)) {
          const stepc = Math.max(1, Math.ceil(cand.length / 64)), r = [], g = [], b = [];
          for (let q = 0; q < cand.length; q += stepc) { const i = cand[q]; r.push(SC[i * 3]); g.push(SC[i * 3 + 1]); b.push(SC[i * 3 + 2]); }
          const med = arr => { arr.sort((x, y) => x - y); return arr[arr.length >> 1]; };
          rgb = [med(r), med(g), med(b)];
        }
      }
      if (!rgb) rgb = [160, 160, 160];
      rgb = rgb.map(v => Math.min(255, Math.floor(v / 12) * 12 + 6));   // a few steps per channel: flatter, fewer colours
      colourSet.add(rgb.join(','));
      for (let q = 0; q < 3; q++) { bodyCol[t * 9 + q * 3] = rgb[0]; bodyCol[t * 9 + q * 3 + 1] = rgb[1]; bodyCol[t * 9 + q * 3 + 2] = rgb[2]; }
    }
  } else bodyCol.fill(160);

  const out = [];
  for (const w of wheels) for (const sz of [-1, 1]) {
    out.push({ name: `Wheel_${w.x * frontSign > 0 ? 'F' : 'R'}${sz === frontSign ? 'R' : 'L'}`, x: w.x + ox, y: w.y, z: sz * (z0 + z1) / 2 + oz, radius: w.r, width: z1 - z0 });
  }
  return { body: { positions: bodyPos, normals: bodyNor, colors: bodyCol, faces: nf }, wheels: out, info: { faces: nf, res: res / L, grid: [nx, ny, nz], wheelsFound: wheels.length > 0, frontSign, colours: colourSet.size, length: L } };
}
