// SHRINK 3D v2.10 — solid rebuild core (no imports, so it runs in a Web Worker, on the main thread and in Node tests).
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

/* ----------------------------- the rebuild ----------------------------- */
export async function rebuildSolidCore({ positions, indices, detailUnits = 0, maxCells = 12e6, maxRadius = 4, targetTris = 0, wasm, simplifier, onProgress = () => {} }) {
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
  const pad = maxRadius + 3;
  let h = Math.max(detailUnits || 0, longest / 400);
  const dimsFor = hh => size.map(s => Math.ceil(s / hh) + 2 * pad);
  let dims = dimsFor(h);
  while (dims[0] * dims[1] * dims[2] > maxCells) { h *= 1.05; dims = dimsFor(h); }
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
  const surfaceCells = sumGrid(S);
  if (!surfaceCells) throw err('REMESH_EMPTY', 'The surface did not land in the grid.');

  // --- 2 + 3. seal gaps and fill, growing the seal until the result stops changing ---
  let volumes = [], radiusUsed = -1, solidCells = 0;
  for (let r = 0; r <= maxRadius; r++) {
    onProgress(24 + 40 * (r / (maxRadius + 1)), r === 0 ? 'Filling the inside…' : `Sealing gaps (${r} of ${maxRadius})…`);
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
    const growth = r > 0 ? (v - volumes[r - 1]) / Math.max(1, v) : 1;
    if (r >= 1 && growth <= 0.01) { radiusUsed = r; solidCells = v; break; }
    if (r === maxRadius) {
      if (growth > 0.05) throw err('REMESH_LEAKY', 'This model has gaps that are too big to close. Nothing was changed.', { growth, radius: r });
      radiusUsed = r; solidCells = v;
    }
  }
  if (solidCells / surfaceCells < 1.5) throw err('REMESH_LEAKY', 'The inside of this model could not be told apart from the outside, so it has too many gaps to rebuild. Nothing was changed.', { ratio: solidCells / surfaceCells });

  // --- 4. smooth and extract ---
  onProgress(68, 'Smoothing…');
  let src = T2, dst = O;                // T1 keeps the binary solid; T2/O ping-pong the blur
  blurPass(T1, src, nx, ny, nz, 0, 255);
  for (const axis of [1, 2, 0, 1, 2]) { blurPass(src, dst, nx, ny, nz, axis, 1); const tmp = src; src = dst; dst = tmp; }
  const field = src;                    // 0..255, > 127 means inside

  let bx0 = nx, by0 = ny, bz0 = nz, bx1 = 0, by1 = 0, bz1 = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    let idx = nx * (j + ny * k);
    for (let i = 0; i < nx; i++, idx++) if (T1[idx]) { if (i < bx0) bx0 = i; if (i > bx1) bx1 = i; if (j < by0) by0 = j; if (j > by1) by1 = j; if (k < bz0) bz0 = k; if (k > bz1) bz1 = k; }
  }
  const sample = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : field[x + nx * (y + ny * z)];
  const sdf = p => {
    const gx = (p[0] - ox) * inv - 0.5, gy = (p[1] - oy) * inv - 0.5, gz = (p[2] - oz) * inv - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;
    const c00 = sample(x0, y0, z0) * (1 - fx) + sample(x0 + 1, y0, z0) * fx;
    const c10 = sample(x0, y0 + 1, z0) * (1 - fx) + sample(x0 + 1, y0 + 1, z0) * fx;
    const c01 = sample(x0, y0, z0 + 1) * (1 - fx) + sample(x0 + 1, y0, z0 + 1) * fx;
    const c11 = sample(x0, y0 + 1, z0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1, z0 + 1) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy, c1 = c01 * (1 - fy) + c11 * fy;
    return ((c0 * (1 - fz) + c1 * fz) - 127.5) / 255;
  };
  const bounds = { min: [ox + (bx0 - 2) * h, oy + (by0 - 2) * h, oz + (bz0 - 2) * h], max: [ox + (bx1 + 3) * h, oy + (by1 + 3) * h, oz + (bz1 + 3) * h] };

  onProgress(74, 'Building the new surface…');
  let solid = wasm.Manifold.levelSet(sdf, bounds, h, 0, -1);
  let mesh;
  const stats = { voxel: h, dims: [nx, ny, nz], cells: N, radius: radiusUsed, surfaceCells, solidCells, droppedSpecks: 0, pieces: 1, simplified: false };
  try {
    if (!manifoldStatusOk(solid)) throw err('REMESH_EMPTY', 'The rebuild produced no solid.');
    // keep real pieces, drop tiny specks
    const parts = solid.decompose();
    stats.pieces = parts.length;
    if (parts.length > 1) {
      const vols = parts.map(p => p.volume());
      const biggest = Math.max(...vols);
      const keep = parts.filter((p, i) => vols[i] >= biggest * 0.005);
      stats.droppedSpecks = parts.length - keep.length;
      stats.pieces = keep.length;
      const meshes = keep.map(meshFromSolid);
      let nv = 0, ni = 0; for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
      const P = new Float32Array(nv), I = new Uint32Array(ni); let vo = 0, io = 0;
      for (const m of meshes) { P.set(m.positions, vo * 3); for (let q = 0; q < m.indices.length; q++) I[io + q] = m.indices[q] + vo; vo += m.positions.length / 3; io += m.indices.length; }
      mesh = { positions: P, indices: I };
    } else mesh = meshFromSolid(solid);
    for (const p of parts) try { p.delete?.(); } catch {}
  } finally { try { solid?.delete?.(); } catch {} }
  stats.trisRaw = mesh.indices.length / 3;

  // --- 5. simplify, keeping it watertight ---
  let out = mesh;
  if (simplifier && targetTris > 0 && stats.trisRaw > targetTris * 1.1) {
    onProgress(90, 'Simplifying…');
    try {
      await simplifier.ready;
      const tries = [targetTris, targetTris * 2];
      for (const target of tries) {
        const [idx] = simplifier.simplify(mesh.indices, mesh.positions, 3, Math.max(3, Math.floor(target) * 3), h * 0.6, ['ErrorAbsolute']);
        const compact = compactMesh(mesh.positions, idx);
        if (isWatertight(wasm, compact.positions, compact.indices)) { out = compact; stats.simplified = true; break; }
      }
    } catch (e) { stats.simplifyNote = String(e?.message || e); }
  }
  stats.trisOut = out.indices.length / 3;
  onProgress(100, 'Done');
  return { positions: out.positions, indices: out.indices, stats };
}
