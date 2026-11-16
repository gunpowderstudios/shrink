// SHRINK 3D v2.281 — hollow-core.js: hollow a closed solid for resin printing. No DOM, no three.js; Manifold is passed in.
// The outer surface is NEVER rebuilt: the cavity is a separate inner shape (an inward offset worked out on a coarse voxel grid) that is
// subtracted from the original solid with Manifold, so every outside detail SHRINK kept stays exactly as it was. Drain holes are cylinders
// from the lowest point of the base up into the cavity (resin printers need them or uncured resin is trapped and the cup can suck).
// Units are whatever the solid is in (world units); callers convert mm.

// Squared Euclidean distance transform of one line (Felzenszwalb & Huttenlocher). f: input, out: result, v/z: scratch.
function edt1d(f, n, out, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const d = q - v[k]; out[q] = d * d + f[v[k]]; }
}

/** Voxelise the inside of a closed mesh by casting vertical (Y) rays through a regular XZ grid and pairing the crossings. */
export function voxelInside(pos, idx, min, cell, nx, ny, nz) {
  const inside = new Uint8Array(nx * ny * nz);
  const cols = new Array(nx * nz);                     // triangle lists per (x,z) cell
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    const x0 = Math.min(pos[a], pos[b], pos[c]), x1 = Math.max(pos[a], pos[b], pos[c]);
    const z0 = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), z1 = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
    const i0 = Math.max(0, Math.ceil((x0 - min[0]) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((x1 - min[0]) / cell - 0.5));
    const k0 = Math.max(0, Math.ceil((z0 - min[2]) / cell - 0.5)), k1 = Math.min(nz - 1, Math.floor((z1 - min[2]) / cell - 0.5));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) (cols[i + k * nx] ||= []).push(t);
  }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const list = cols[i + k * nx]; if (!list) continue;
    const px = min[0] + (i + 0.5) * cell + cell * 1.234e-5, pz = min[2] + (k + 0.5) * cell + cell * 2.718e-5, ys = [];     // nudged off the lattice so a ray never runs exactly along a triangle edge (that would count a crossing twice)
    for (const t of list) {
      const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
      const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[c], cz = pos[c + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-14) continue;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      const e = -1e-9; if (l1 < e || l2 < e || l3 < e) continue;
      ys.push(l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1]);
    }
    if (ys.length < 2) continue;
    ys.sort((p, q) => p - q);
    for (let m = 0; m + 1 < ys.length; m += 2) {
      const j0 = Math.max(0, Math.ceil((ys[m] - min[1]) / cell - 0.5)), j1 = Math.min(ny - 1, Math.floor((ys[m + 1] - min[1]) / cell - 0.5));
      for (let j = j0; j <= j1; j++) inside[i + nx * (j + ny * k)] = 1;
    }
  }
  return inside;
}

/** Distance (in world units) from every voxel to the nearest outside voxel; 0 outside. */
export function insideDistance(inside, nx, ny, nz, cell) {
  const N = nx * ny * nz, g = new Float64Array(N), big = 1e12;
  for (let i = 0; i < N; i++) g[i] = inside[i] ? big : 0;
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), o = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const base = nx * (j + ny * k); for (let i = 0; i < nx; i++) f[i] = g[base + i]; edt1d(f, nx, o, v, z); for (let i = 0; i < nx; i++) g[base + i] = o[i]; }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) f[j] = g[i + nx * (j + ny * k)]; edt1d(f, ny, o, v, z); for (let j = 0; j < ny; j++) g[i + nx * (j + ny * k)] = o[j]; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { for (let k = 0; k < nz; k++) f[k] = g[i + nx * (j + ny * k)]; edt1d(f, nz, o, v, z); for (let k = 0; k < nz; k++) g[i + nx * (j + ny * k)] = o[k]; }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = inside[i] ? Math.max(0, Math.sqrt(g[i]) - 0.5) * cell : 0;     // centre-to-centre distance, less half a cell to the real surface
  return out;
}

/**
 * hollowSolid(M, solid, opts): returns { solid, before, after, saved, holes, cavity } or throws a plain-English Error.
 *  opts.wall   wall thickness in solid units (required)
 *  opts.holes  number of drain holes (default 2, 0 = none)  opts.holeRadius  radius in solid units
 *  opts.maxCells  largest grid side (default 160)
 */
export function hollowSolid(M, solid, opts = {}) {
  const wall = Number(opts.wall); if (!(wall > 0)) throw new Error('Wall thickness must be above zero.');
  const mesh = solid.getMesh(), np = mesh.numProp, vp = mesh.vertProperties, nv = vp.length / np;
  const pos = new Float64Array(nv * 3); for (let i = 0; i < nv; i++) { pos[3 * i] = vp[i * np]; pos[3 * i + 1] = vp[i * np + 1]; pos[3 * i + 2] = vp[i * np + 2]; }
  const idx = mesh.triVerts;
  const bb = solid.boundingBox(), min = [bb.min[0], bb.min[1], bb.min[2]], max = [bb.max[0], bb.max[1], bb.max[2]];
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const before = solid.volume();
  if (!(before > 0)) throw new Error('This model is not a closed solid, so it cannot be hollowed. Run FIX IT (and FUSE IT) first.');
  if (wall * 2.2 >= Math.min(max[0] - min[0], max[1] - min[1], max[2] - min[2])) throw new Error('The wall is thicker than the model can hold. Use a thinner wall.');
  const cell = Math.max(wall / (opts.cellsPerWall || 2.5), ext / (opts.maxCells || 160)), pad = 2;
  const nx = Math.ceil((max[0] - min[0]) / cell) + 2 * pad, ny = Math.ceil((max[1] - min[1]) / cell) + 2 * pad, nz = Math.ceil((max[2] - min[2]) / cell) + 2 * pad;
  const gmin = [min[0] - pad * cell, min[1] - pad * cell, min[2] - pad * cell];
  const inside = voxelInside(pos, idx, gmin, cell, nx, ny, nz);
  const dist = insideDistance(inside, nx, ny, nz, cell);
  // signed field for the cavity: positive where the surface is further than `wall` from the outside
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? 0 : dist[i + nx * (j + ny * k)];
  const sdf = p => {
    const fx = (p[0] - gmin[0]) / cell - 0.5, fy = (p[1] - gmin[1]) / cell - 0.5, fz = (p[2] - gmin[2]) / cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
    const l = (a, b, t) => a + (b - a) * t;
    const d = l(l(l(at(i, j, k), at(i + 1, j, k), tx), l(at(i, j + 1, k), at(i + 1, j + 1, k), tx), ty), l(l(at(i, j, k + 1), at(i + 1, j, k + 1), tx), l(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), tx), ty), tz);
    return d - wall;
  };
  const cavity = M.levelSet(sdf, { min: [gmin[0] + cell, gmin[1] + cell, gmin[2] + cell], max: [gmin[0] + (nx - 1) * cell, gmin[1] + (ny - 1) * cell, gmin[2] + (nz - 1) * cell] }, cell);
  if (!(cavity.volume() > before * 0.002)) { cavity.delete?.(); throw new Error('This model is too thin to hollow at that wall thickness (it would stay solid). Try a thinner wall.'); }
  let out = solid.subtract(cavity);
  const holes = [];
  const wantHoles = opts.holes == null ? 2 : opts.holes;
  if (wantHoles > 0) {
    const r = opts.holeRadius || Math.max(cell * 0.9, wall * 0.75);
    // candidate columns: the cavity's lowest point per (x,z) column; take the lowest, then the one furthest from it
    const cand = [];
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      let y1 = -1, y0 = -1;
      for (let j = 0; j < ny; j++) { const d = dist[i + nx * (j + ny * k)]; if (y0 < 0 && d > 0) y0 = j; if (d > wall + r * 1.1) { y1 = j; break; } }
      if (y1 >= 0 && y0 >= 0) cand.push({ x: gmin[0] + (i + 0.5) * cell, z: gmin[2] + (k + 0.5) * cell, y0: gmin[1] + y0 * cell, y1: gmin[1] + (y1 + 0.5) * cell });
    }
    cand.sort((a, b) => a.y0 - b.y0);
    const base = cand.filter(c => c.y0 <= (cand[0]?.y0 ?? 0) + wall * 1.5);
    const picks = [];
    if (base.length) {
      picks.push(base[Math.floor(base.length / 2)]);
      while (picks.length < wantHoles) {
        let best = null, bd = -1;
        for (const c of base) { const d = Math.min(...picks.map(p => Math.hypot(p.x - c.x, p.z - c.z))); if (d > bd) { bd = d; best = c; } }
        if (!best || bd < r * 4) break; picks.push(best);
      }
    }
    for (const p of picks) {
      const h = (p.y1 - p.y0) + 3 * cell;
      const cyl = M.cylinder(h, r, r, 24, false).rotate([-90, 0, 0]).translate([p.x, p.y0 - 2 * cell, p.z]);
      const next = out.subtract(cyl); out.delete?.(); cyl.delete?.(); out = next; holes.push({ x: p.x, z: p.z, r });
    }
  }
  cavity.delete?.();
  const after = out.volume();
  if (!(after > 0) || !(after < before)) throw new Error('Hollowing did not produce a smaller solid.');
  return { solid: out, before, after, saved: 1 - after / before, holes, cell };
}
