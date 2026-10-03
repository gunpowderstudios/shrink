// SHRINK 3D v2.14 — solid rebuild core (no imports, so it runs in a Web Worker, on the main thread and in Node tests).
//
// Idea: a messy sculpt (holes, flipped faces, overlapping parts) cannot be trusted to say what is inside.
// Instead of asking the surface, we
//   1. trace the surface into a 3D grid of voxels (anything the surface touches),
//   2. seal small gaps by growing that skin a few voxels, then flood from OUTSIDE the grid,
//   3. call everything the flood could not reach "solid" and shrink the skin back (a morphological closing),
//   4. smooth the staircase and let Manifold turn it into a guaranteed-watertight surface,
//   5. simplify that surface back down so the file stays light.
// If the gaps are too big for the flood to be stopped, we say so instead of returning a damaged model.

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

/* ----------------------------- triangle / voxel overlap ----------------------------- */
// Separating-axis test of a triangle against a box centred at the origin (half sizes hx, hy, hz).
// Vertices are given relative to the box centre.
function triBoxOverlap(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z, hx, hy, hz,
  e0x, e0y, e0z, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz) {
  let p0, p1, p2, mn, mx, rad;
  const f0x = Math.abs(e0x), f0y = Math.abs(e0y), f0z = Math.abs(e0z);
  const f1x = Math.abs(e1x), f1y = Math.abs(e1y), f1z = Math.abs(e1z);
  const f2x = Math.abs(e2x), f2y = Math.abs(e2y), f2z = Math.abs(e2z);
  // edge 0
  p0 = e0z * v0y - e0y * v0z; p2 = e0z * v2y - e0y * v2z; mn = Math.min(p0, p2); mx = Math.max(p0, p2); rad = f0z * hy + f0y * hz; if (mn > rad || mx < -rad) return false;
  p0 = -e0z * v0x + e0x * v0z; p2 = -e0z * v2x + e0x * v2z; mn = Math.min(p0, p2); mx = Math.max(p0, p2); rad = f0z * hx + f0x * hz; if (mn > rad || mx < -rad) return false;
  p1 = e0y * v1x - e0x * v1y; p2 = e0y * v2x - e0x * v2y; mn = Math.min(p1, p2); mx = Math.max(p1, p2); rad = f0y * hx + f0x * hy; if (mn > rad || mx < -rad) return false;
  // edge 1
  p0 = e1z * v0y - e1y * v0z; p2 = e1z * v2y - e1y * v2z; mn = Math.min(p0, p2); mx = Math.max(p0, p2); rad = f1z * hy + f1y * hz; if (mn > rad || mx < -rad) return false;
  p0 = -e1z * v0x + e1x * v0z; p2 = -e1z * v2x + e1x * v2z; mn = Math.min(p0, p2); mx = Math.max(p0, p2); rad = f1z * hx + f1x * hz; if (mn > rad || mx < -rad) return false;
  p0 = e1y * v0x - e1x * v0y; p1 = e1y * v1x - e1x * v1y; mn = Math.min(p0, p1); mx = Math.max(p0, p1); rad = f1y * hx + f1x * hy; if (mn > rad || mx < -rad) return false;
  // edge 2
  p0 = e2z * v0y - e2y * v0z; p1 = e2z * v1y - e2y * v1z; mn = Math.min(p0, p1); mx = Math.max(p0, p1); rad = f2z * hy + f2y * hz; if (mn > rad || mx < -rad) return false;
  p0 = -e2z * v0x + e2x * v0z; p1 = -e2z * v1x + e2x * v1z; mn = Math.min(p0, p1); mx = Math.max(p0, p1); rad = f2z * hx + f2x * hz; if (mn > rad || mx < -rad) return false;
  p1 = e2y * v1x - e2x * v1y; p2 = e2y * v2x - e2x * v2y; mn = Math.min(p1, p2); mx = Math.max(p1, p2); rad = f2y * hx + f2x * hy; if (mn > rad || mx < -rad) return false;
  // box face axes
  mn = Math.min(v0x, v1x, v2x); mx = Math.max(v0x, v1x, v2x); if (mn > hx || mx < -hx) return false;
  mn = Math.min(v0y, v1y, v2y); mx = Math.max(v0y, v1y, v2y); if (mn > hy || mx < -hy) return false;
  mn = Math.min(v0z, v1z, v2z); mx = Math.max(v0z, v1z, v2z); if (mn > hz || mx < -hz) return false;
  // triangle plane
  const d = nx * v0x + ny * v0y + nz * v0z;
  return Math.abs(d) <= hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
}

// Mark every voxel the triangle touches. Coordinates are in grid units (one voxel = 1).
// Big triangles are split first so the work stays proportional to surface area.
function rasterTriangle(S, nx, ny, nz, stack, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const EPS = 1e-6, HALF = 0.5 + EPS;
  stack.length = 0;
  stack.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  let marked = 0;
  while (stack.length) {
    cz = stack.pop(); cy = stack.pop(); cx = stack.pop(); bz = stack.pop(); by = stack.pop(); bx = stack.pop(); az = stack.pop(); ay = stack.pop(); ax = stack.pop();
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    let i0 = Math.max(0, Math.floor(minX - EPS)), i1 = Math.min(nx - 1, Math.floor(maxX + EPS));
    let j0 = Math.max(0, Math.floor(minY - EPS)), j1 = Math.min(ny - 1, Math.floor(maxY + EPS));
    let k0 = Math.max(0, Math.floor(minZ - EPS)), k1 = Math.min(nz - 1, Math.floor(maxZ + EPS));
    if (i0 > i1 || j0 > j1 || k0 > k1) continue;
    const cells = (i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1);
    if (cells > 48) {
      // split the longest edge in two
      const lab = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
      const lbc = (bx - cx) ** 2 + (by - cy) ** 2 + (bz - cz) ** 2;
      const lca = (cx - ax) ** 2 + (cy - ay) ** 2 + (cz - az) ** 2;
      if (Math.max(lab, lbc, lca) > 2.25) {
        if (lab >= lbc && lab >= lca) { const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2; stack.push(ax, ay, az, mx, my, mz, cx, cy, cz, mx, my, mz, bx, by, bz, cx, cy, cz); }
        else if (lbc >= lca) { const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2; stack.push(ax, ay, az, bx, by, bz, mx, my, mz, ax, ay, az, mx, my, mz, cx, cy, cz); }
        else { const mx = (cx + ax) / 2, my = (cy + ay) / 2, mz = (cz + az) / 2; stack.push(ax, ay, az, bx, by, bz, mx, my, mz, mx, my, mz, bx, by, bz, cx, cy, cz); }
        continue;
      }
    }
    const e0x = bx - ax, e0y = by - ay, e0z = bz - az;
    const e1x = cx - bx, e1y = cy - by, e1z = cz - bz;
    const e2x = ax - cx, e2y = ay - cy, e2z = az - cz;
    const nxx = e0y * e1z - e0z * e1y, nyy = e0z * e1x - e0x * e1z, nzz = e0x * e1y - e0y * e1x;
    for (let k = k0; k <= k1; k++) {
      const ccz = k + 0.5;
      for (let j = j0; j <= j1; j++) {
        const ccy = j + 0.5;
        let idx = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, idx++) {
          if (S[idx]) continue;
          const ccx = i + 0.5;
          if (triBoxOverlap(ax - ccx, ay - ccy, az - ccz, bx - ccx, by - ccy, bz - ccz, cx - ccx, cy - ccy, cz - ccz, HALF, HALF, HALF,
            e0x, e0y, e0z, e1x, e1y, e1z, e2x, e2y, e2z, nxx, nyy, nzz)) { S[idx] = 1; marked++; }
        }
      }
    }
  }
  return marked;
}

/* ----------------------------- morphology / flood on a binary grid ----------------------------- */
// One separable pass of a box filter along `axis`. mode: 'dilate' (any 1 in window) | 'erode' (all 1 in window).
function boxPass(src, dst, nx, ny, nz, axis, r, mode) {
  const len = axis === 0 ? nx : axis === 1 ? ny : nz;
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const lines = axis === 0 ? ny * nz : axis === 1 ? nx * nz : nx * ny;
  const full = 2 * r + 1;
  const dil = mode === 'dilate';
  for (let line = 0; line < lines; line++) {
    let base;
    if (axis === 0) base = line * nx;
    else if (axis === 1) { const x = line % nx, z = (line / nx) | 0; base = x + z * nx * ny; }
    else base = line;
    let cnt = 0;
    for (let q = 0; q < r && q < len; q++) cnt += src[base + q * stride];
    for (let p = 0; p < len; p++) {
      const add = p + r; if (add < len) cnt += src[base + add * stride];
      const rem = p - r - 1; if (rem >= 0) cnt -= src[base + rem * stride];
      dst[base + p * stride] = dil ? (cnt > 0 ? 1 : 0) : (cnt === full ? 1 : 0);
    }
  }
}

// Blur pass on 0..255 values (window 3). `scaleIn` lets the first pass read a 0/1 grid.
function blurPass(src, dst, nx, ny, nz, axis, scaleIn) {
  const len = axis === 0 ? nx : axis === 1 ? ny : nz;
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const lines = axis === 0 ? ny * nz : axis === 1 ? nx * nz : nx * ny;
  for (let line = 0; line < lines; line++) {
    let base;
    if (axis === 0) base = line * nx;
    else if (axis === 1) { const x = line % nx, z = (line / nx) | 0; base = x + z * nx * ny; }
    else base = line;
    for (let p = 0; p < len; p++) {
      const a = p > 0 ? src[base + (p - 1) * stride] : 0;
      const b = src[base + p * stride];
      const c = p + 1 < len ? src[base + (p + 1) * stride] : 0;
      dst[base + p * stride] = (((a + b + c) * scaleIn + 1) / 3) | 0;
    }
  }
}

// Mark every empty voxel reachable from the outside of the grid (6-connected). Returns the number reached.
function floodOutside(D, O, nx, ny, nz) {
  O.fill(0);
  const border = 2 * (nx * ny + ny * nz + nx * nz);
  const cap = 4 * border + (1 << 20);
  const queue = new Int32Array(cap);
  let head = 0, tail = 0, count = 0, reached = 0;
  const push = idx => { if (count === cap) throw err('REMESH_FLOOD', 'The fill ran out of working space. Try a lower detail setting.'); queue[tail] = idx; tail = tail + 1 === cap ? 0 : tail + 1; count++; };
  const plane = nx * ny;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i && j && k && i < nx - 1 && j < ny - 1 && k < nz - 1) { i = nx - 2; continue; }   // interior row: jump to the far border cell
    const idx = i + nx * (j + ny * k);
    if (!D[idx] && !O[idx]) { O[idx] = 1; push(idx); reached++; }
  }
  while (count) {
    const idx = queue[head]; head = head + 1 === cap ? 0 : head + 1; count--;
    const i = idx % nx, rest = (idx / nx) | 0, j = rest % ny, k = (rest / ny) | 0;
    let n;
    if (i > 0) { n = idx - 1; if (!D[n] && !O[n]) { O[n] = 1; push(n); reached++; } }
    if (i < nx - 1) { n = idx + 1; if (!D[n] && !O[n]) { O[n] = 1; push(n); reached++; } }
    if (j > 0) { n = idx - nx; if (!D[n] && !O[n]) { O[n] = 1; push(n); reached++; } }
    if (j < ny - 1) { n = idx + nx; if (!D[n] && !O[n]) { O[n] = 1; push(n); reached++; } }
    if (k > 0) { n = idx - plane; if (!D[n] && !O[n]) { O[n] = 1; push(n); reached++; } }
    if (k < nz - 1) { n = idx + plane; if (!D[n] && !O[n]) { O[n] = 1; push(n); reached++; } }
  }
  return reached;
}

function sumGrid(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }

/* ----------------------------- manifold helpers ----------------------------- */
function manifoldStatusOk(solid) {
  try {
    if (solid.isEmpty?.()) return false;
    const s = solid.status?.();
    return s == null || s === 0 || String(s).toLowerCase() === 'noerror';
  } catch { return false; }
}

function meshFromSolid(solid) {
  const m = solid.getMesh();
  const n = Math.floor(m.vertProperties.length / m.numProp);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = m.vertProperties[i * m.numProp];
    positions[i * 3 + 1] = m.vertProperties[i * m.numProp + 1];
    positions[i * 3 + 2] = m.vertProperties[i * m.numProp + 2];
  }
  const indices = new Uint32Array(m.triVerts);
  try { m.delete?.(); } catch {}
  return { positions, indices };
}

function compactMesh(positions, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1);
  let used = 0;
  for (let i = 0; i < indices.length; i++) if (remap[indices[i]] < 0) remap[indices[i]] = used++;
  const out = new Float32Array(used * 3);
  for (let v = 0; v < remap.length; v++) { const r = remap[v]; if (r >= 0) { out[r * 3] = positions[v * 3]; out[r * 3 + 1] = positions[v * 3 + 1]; out[r * 3 + 2] = positions[v * 3 + 2]; } }
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) idx[i] = remap[indices[i]];
  return { positions: out, indices: idx };
}

function isWatertight(wasm, positions, indices) {
  let mesh = null, solid = null;
  try {
    mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
    solid = new wasm.Manifold(mesh);
    return manifoldStatusOk(solid);
  } catch { return false; }
  finally { try { mesh?.delete?.(); } catch {} try { solid?.delete?.(); } catch {} }
}

/* ----------------------------- surface extraction (marching tetrahedra) ----------------------------- */
// Turns the smoothed 0..255 field into a closed triangle surface. Every cube is cut into the same six tetrahedra, so
// neighbouring cubes agree on shared faces and the result is watertight by construction. Vertices sit on grid edges
// and are shared through a hash, so the mesh is indexed and manifold.
const KUHN = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]];

function extractSurface(field, nx, ny, nz, box, ox, oy, oz, h) {
  const plane = nx * ny;
  const off = [0, 1, nx, nx + 1, plane, plane + 1, plane + nx, plane + nx + 1];
  let P = new Float32Array(1 << 20), nv = 0;
  let I = new Uint32Array(1 << 21), ni = 0;
  const edge = new Map();
  const cv = new Float64Array(8), cx = new Float64Array(8), cy = new Float64Array(8), cz = new Float64Array(8), cg = new Float64Array(8);
  const ev = [0, 0, 0, 0, 0, 0];               // scratch: vertex ids of the (up to 4) edge points
  const ins = [0, 0, 0, 0], out = [0, 0, 0, 0];

  const vertexOn = (ca, cb) => {            // ca < cb (corner numbers), cb has all bits of ca
    const key = cg[ca] * 8 + (cb - ca);
    let id = edge.get(key);
    if (id !== undefined) return id;
    const fa = cv[ca], fb = cv[cb], t = (127.5 - fa) / (fb - fa);
    if (nv * 3 + 3 > P.length) { const q = new Float32Array(P.length * 2); q.set(P); P = q; }
    P[nv * 3] = cx[ca] + (cx[cb] - cx[ca]) * t; P[nv * 3 + 1] = cy[ca] + (cy[cb] - cy[ca]) * t; P[nv * 3 + 2] = cz[ca] + (cz[cb] - cz[ca]) * t;
    id = nv++; edge.set(key, id);
    return id;
  };
  const emit = (a, b, c, dx, dy, dz) => {   // orient so the normal points out of the solid (along d = outside - inside)
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const dot = (uy * vz - uz * vy) * dx + (uz * vx - ux * vz) * dy + (ux * vy - uy * vx) * dz;
    if (ni + 3 > I.length) { const q = new Uint32Array(I.length * 2); q.set(I); I = q; }
    if (dot >= 0) { I[ni++] = a; I[ni++] = b; I[ni++] = c; } else { I[ni++] = a; I[ni++] = c; I[ni++] = b; }
  };

  const [x0, y0, z0, x1, y1, z1] = box;      // inclusive cube ranges
  for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) {
    let base = x0 + nx * (j + ny * k);
    for (let i = x0; i <= x1; i++, base++) {
      let any = 0, all = 1;
      for (let c = 0; c < 8; c++) { const v = field[base + off[c]]; cv[c] = v; if (v > 127) any = 1; else all = 0; }
      if (!any || all) continue;
      for (let c = 0; c < 8; c++) { cx[c] = ox + (i + (c & 1) + 0.5) * h; cy[c] = oy + (j + ((c >> 1) & 1) + 0.5) * h; cz[c] = oz + (k + ((c >> 2) & 1) + 0.5) * h; cg[c] = base + off[c]; }
      for (let t = 0; t < 6; t++) {
        const tet = KUHN[t];
        let ni_ = 0, no_ = 0;
        for (let q = 0; q < 4; q++) { if (cv[tet[q]] > 127) ins[ni_++] = tet[q]; else out[no_++] = tet[q]; }
        if (ni_ === 0 || ni_ === 4) continue;
        // direction from the inside vertices towards the outside vertices
        let ix = 0, iy = 0, iz = 0, qx = 0, qy = 0, qz = 0;
        for (let q = 0; q < ni_; q++) { ix += cx[ins[q]]; iy += cy[ins[q]]; iz += cz[ins[q]]; }
        for (let q = 0; q < no_; q++) { qx += cx[out[q]]; qy += cy[out[q]]; qz += cz[out[q]]; }
        const dx = qx / no_ - ix / ni_, dy = qy / no_ - iy / ni_, dz = qz / no_ - iz / ni_;
        const e = (a, b) => (a < b ? vertexOn(a, b) : vertexOn(b, a));
        if (ni_ === 1) emit(e(ins[0], out[0]), e(ins[0], out[1]), e(ins[0], out[2]), dx, dy, dz);
        else if (ni_ === 3) emit(e(out[0], ins[0]), e(out[0], ins[1]), e(out[0], ins[2]), dx, dy, dz);
        else {
          const a = e(ins[0], out[0]), b = e(ins[0], out[1]), c = e(ins[1], out[1]), d = e(ins[1], out[0]);
          emit(a, b, c, dx, dy, dz); emit(a, c, d, dx, dy, dz);
        }
      }
    }
  }
  return { positions: P.slice(0, nv * 3), indices: I.slice(0, ni) };
}

// Remove stray specks (tiny separate pieces) and report how many real pieces remain.
function dropSpecks(wasm, positions, indices) {
  let mesh = null, solid = null, parts = [];
  try {
    mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
    solid = new wasm.Manifold(mesh);
    if (!manifoldStatusOk(solid)) return null;
    parts = solid.decompose();
    if (parts.length <= 1) return { positions, indices, pieces: parts.length, dropped: 0 };
    const vols = parts.map(p => p.volume());
    const biggest = Math.max(...vols);
    const keep = parts.filter((p, i) => vols[i] >= biggest * 0.005);
    const meshes = keep.map(meshFromSolid);
    let nv = 0, ni = 0; for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
    const P = new Float32Array(nv), I = new Uint32Array(ni); let vo = 0, io = 0;
    for (const m of meshes) { P.set(m.positions, vo * 3); for (let q = 0; q < m.indices.length; q++) I[io + q] = m.indices[q] + vo; vo += m.positions.length / 3; io += m.indices.length; }
    return { positions: P, indices: I, pieces: keep.length, dropped: parts.length - keep.length };
  } catch { return null; }
  finally { for (const p of parts) try { p.delete?.(); } catch {} try { mesh?.delete?.(); } catch {} try { solid?.delete?.(); } catch {} }
}

/* ----------------------------- the rebuild ----------------------------- */
export async function rebuildSolidCore({ positions, indices, detailUnits = 0, maxCells = 30e6, maxRadius = 0, maxGap = 0, smooth = 1, maxTris = 300000, simplifyError = 0.35, wasm, simplifier, onProgress = () => {} }) {
  const clock = { t0: Date.now(), marks: {} };
  const mark = name => { clock.marks[name] = Date.now() - clock.t0; };
  if (!wasm?.Manifold?.levelSet) throw err('REMESH_ENGINE', 'The solid builder could not load in this browser.');
  const triCount = Math.floor(indices.length / 3);
  if (!triCount) throw err('REMESH_EMPTY', 'There is no surface to rebuild.');

  // --- grid ---
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  const longest = Math.max(size[0], size[1], size[2]);
  if (!(longest > 0)) throw err('REMESH_EMPTY', 'The model has no size.');
  const pad = 13;                       // room for the biggest sealing radius (10) plus a margin
  let h = Math.max((detailUnits || 0) / 3, longest / 700);   // as fine as the cell budget allows (never coarser than needed)
  const dimsFor = hh => size.map(s => Math.ceil(s / hh) + 2 * pad);
  let dims = dimsFor(h);
  while (dims[0] * dims[1] * dims[2] > maxCells) { h *= 1.05; dims = dimsFor(h); }
  // how big a gap may we close? Measured in model units, so it does not shrink when the voxels get finer
  const gapUnits = maxGap > 0 ? maxGap : longest * 0.035;
  if (!(maxRadius > 0)) maxRadius = Math.min(9, Math.max(2, Math.ceil(gapUnits / (2 * h))));
  const [nx, ny, nz] = dims, N = nx * ny * nz;
  const ox = minX - pad * h, oy = minY - pad * h, oz = minZ - pad * h;

  onProgress(4, 'Setting up the grid…');
  const S = new Uint8Array(N), T1 = new Uint8Array(N), T2 = new Uint8Array(N), O = new Uint8Array(N);

  // --- 1. trace the surface ---
  onProgress(8, 'Tracing the surface…');
  const stack = [];
  const inv = 1 / h;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    rasterTriangle(S, nx, ny, nz, stack,
      (positions[a] - ox) * inv, (positions[a + 1] - oy) * inv, (positions[a + 2] - oz) * inv,
      (positions[b] - ox) * inv, (positions[b + 1] - oy) * inv, (positions[b + 2] - oz) * inv,
      (positions[c] - ox) * inv, (positions[c + 1] - oy) * inv, (positions[c + 2] - oz) * inv);
    if ((t & 4095) === 0) onProgress(8 + 14 * (t / triCount), 'Tracing the surface…');
  }
  mark('trace');
  const surfaceCells = sumGrid(S);
  if (!surfaceCells) throw err('REMESH_EMPTY', 'The surface did not land in the grid.');

  // --- 2 + 3. seal gaps and fill, growing the seal until the result stops changing ---
  let volumes = [], radiusUsed = -1, solidCells = 0;
  const radii = [...new Set([0, 1, 2, 3, 4, 6, 8, 10, maxRadius + 1].filter(r => r <= maxRadius + 1))].sort((x, y) => x - y);
  const lastRadius = radii[radii.length - 1];
  const MIN_RATIO = 1.5;                // a closed solid has far more filled voxels than skin voxels
  let finalGrowth = 1;
  for (let step = 0; step < radii.length; step++) {
    const r = radii[step];
    onProgress(24 + 40 * (step / radii.length), r === 0 ? 'Filling the inside…' : `Sealing gaps (up to ${r} voxels)…`);
    let D = S;
    if (r > 0) {            // D = S grown by r voxels, in T1 (x: S->T1, y: T1->T2, z: T2->T1)
      boxPass(S, T1, nx, ny, nz, 0, r, 'dilate'); boxPass(T1, T2, nx, ny, nz, 1, r, 'dilate'); boxPass(T2, T1, nx, ny, nz, 2, r, 'dilate'); D = T1;
    }
    floodOutside(D, O, nx, ny, nz);
    for (let i = 0; i < N; i++) T2[i] = O[i] ? 0 : 1;                 // solid = not outside
    if (r > 0) {            // shrink the skin back: erode by r (T2 -> T1 -> O -> T1)
      boxPass(T2, T1, nx, ny, nz, 0, r, 'erode'); boxPass(T1, O, nx, ny, nz, 1, r, 'erode'); boxPass(O, T1, nx, ny, nz, 2, r, 'erode');
    } else T1.set(T2);
    const v = sumGrid(T1);
    volumes.push(v);
    const growth = step > 0 ? (v - volumes[step - 1]) / Math.max(1, v) : 1;
    const closed = v / surfaceCells >= MIN_RATIO;
    // accept once the filled volume stops growing AND there is a real inside (a plateau of "just a skin" means still leaking)
    if (step > 0 && growth <= 0.01 && closed) { radiusUsed = r; solidCells = v; finalGrowth = growth; break; }
    if (r === lastRadius) {
      if (!closed) throw err('REMESH_LEAKY', 'The inside of this model could not be told apart from the outside, so it has too many gaps to rebuild. Nothing was changed.', { ratio: v / surfaceCells });
      if (growth > 0.05) throw err('REMESH_LEAKY', 'This model has gaps that are too big to close. Nothing was changed.', { growth, radius: r });
      radiusUsed = r; solidCells = v; finalGrowth = growth;
    }
  }
  mark('fill');
  // --- 4. smooth and extract ---
  onProgress(68, 'Smoothing…');
  let src = T2, dst = O;                // T1 keeps the binary solid; T2/O ping-pong the blur
  blurPass(T1, src, nx, ny, nz, 0, 255);
  const axes = [1, 2];
  for (let it = 1; it < Math.max(1, smooth); it++) axes.push(0, 1, 2);
  for (const axis of axes) { blurPass(src, dst, nx, ny, nz, axis, 1); const tmp = src; src = dst; dst = tmp; }
  const field = src;                    // 0..255, > 127 means inside

  let bx0 = nx, by0 = ny, bz0 = nz, bx1 = 0, by1 = 0, bz1 = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    let idx = nx * (j + ny * k);
    for (let i = 0; i < nx; i++, idx++) if (T1[idx]) { if (i < bx0) bx0 = i; if (i > bx1) bx1 = i; if (j < by0) by0 = j; if (j > by1) by1 = j; if (k < bz0) bz0 = k; if (k > bz1) bz1 = k; }
  }
  const stats = { voxel: h, dims: [nx, ny, nz], cells: N, radius: radiusUsed, surfaceCells, solidCells, droppedSpecks: 0, pieces: 1, simplified: false, extractor: 'tetrahedra' };
  mark('smooth');

  // fast path: our own marching tetrahedra; if Manifold does not accept the result we fall back to its level-set builder
  onProgress(74, 'Building the new surface…');
  const box = [Math.max(0, bx0 - 2), Math.max(0, by0 - 2), Math.max(0, bz0 - 2), Math.min(nx - 2, bx1 + 1), Math.min(ny - 2, by1 + 1), Math.min(nz - 2, bz1 + 1)];
  let mesh = extractSurface(field, nx, ny, nz, box, ox, oy, oz, h);
  mark('extract');
  stats.trisRaw = mesh.indices.length / 3;
  if (!stats.trisRaw) throw err('REMESH_EMPTY', 'The rebuild produced no solid.');

  // --- 5. simplify within a small error, then cap the size; every candidate must still be watertight ---
  let out = null;
  const candidates = [];
  if (simplifier && stats.trisRaw > 2000) {
    onProgress(86, 'Simplifying…');
    try {
      await simplifier.ready;
      for (const f of [simplifyError, simplifyError * 0.5]) {
        let [idx] = simplifier.simplify(mesh.indices, mesh.positions, 3, 3000, h * f, ['ErrorAbsolute']);
        if (idx.length / 3 > maxTris) [idx] = simplifier.simplify(mesh.indices, mesh.positions, 3, Math.floor(maxTris) * 3, h * 2, ['ErrorAbsolute']);
        candidates.push({ simplified: true, ...compactMesh(mesh.positions, idx) });
      }
    } catch (e) { stats.simplifyNote = String(e?.message || e); }
  }
  candidates.push({ simplified: false, ...mesh });
  for (const c of candidates) {
    const cleaned = dropSpecks(wasm, c.positions, c.indices);
    if (!cleaned) continue;
    out = { positions: cleaned.positions, indices: cleaned.indices };
    stats.simplified = c.simplified; stats.pieces = cleaned.pieces; stats.droppedSpecks = cleaned.dropped;
    break;
  }
  if (!out) {
    // our surface was rejected: let Manifold build it instead (slower, but guaranteed)
    onProgress(88, 'Building the surface another way…');
    const sdf = p => {
      const gx = (p[0] - ox) / h - 0.5, gy = (p[1] - oy) / h - 0.5, gz = (p[2] - oz) / h - 0.5;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), fx = gx - x0, fy = gy - y0, fz = gz - z0;
      const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : field[x + nx * (y + ny * z)];
      const c00 = at(x0, y0, z0) * (1 - fx) + at(x0 + 1, y0, z0) * fx, c10 = at(x0, y0 + 1, z0) * (1 - fx) + at(x0 + 1, y0 + 1, z0) * fx;
      const c01 = at(x0, y0, z0 + 1) * (1 - fx) + at(x0 + 1, y0, z0 + 1) * fx, c11 = at(x0, y0 + 1, z0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1) * fx;
      return (((c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz) - 127.5) / 255;
    };
    const bounds = { min: [ox + (bx0 - 2) * h, oy + (by0 - 2) * h, oz + (bz0 - 2) * h], max: [ox + (bx1 + 3) * h, oy + (by1 + 3) * h, oz + (bz1 + 3) * h] };
    const solid = wasm.Manifold.levelSet(sdf, bounds, h, 0, -1);
    try { if (!manifoldStatusOk(solid)) throw err('REMESH_EMPTY', 'The rebuild produced no solid.'); out = meshFromSolid(solid); stats.extractor = 'manifold'; }
    finally { try { solid.delete?.(); } catch {} }
  }
  stats.trisOut = out.indices.length / 3;
  mark('done');
  stats.ms = clock.marks;
  onProgress(100, 'Done');
  return { positions: out.positions, indices: out.indices, stats };
}
