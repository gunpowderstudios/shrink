// fill-core.js (v2.360): close open holes ("boundary loops") in a triangle mesh with flat caps. No DOM, no three.js.
// positions = Float32Array xyz, indices = Uint32Array (3 per triangle). Points that sit in the same place are treated as one (weldIds).
import { defaultWeldTolerance, weldIds } from './repair-core.js?v=2.196';

const EAR_MAX = 4000;                                 // above this a loop is capped with a fan to its middle (ear clipping is O(n^2))

export function openLoops(positions, indices) {
  const { tol } = defaultWeldTolerance(positions), w = weldIds(positions, tol), canon = w.canon, U = w.unique, nt = Math.floor(indices.length / 3);
  const key = (a, b) => a * U + b, count = new Map(), dir = [];
  for (let t = 0; t < nt; t++) {
    const a = canon[indices[t * 3]], b = canon[indices[t * 3 + 1]], c = canon[indices[t * 3 + 2]]; if (a === b || b === c || a === c) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? key(p, q) : key(q, p); count.set(k, (count.get(k) || 0) + 1); dir.push(p, q); }
  }
  const out = new Map();
  for (let i = 0; i < dir.length; i += 2) { const p = dir[i], q = dir[i + 1], k = p < q ? key(p, q) : key(q, p); if (count.get(k) === 1) { const l = out.get(p); if (l) l.push(q); else out.set(p, [q]); } }
  const edges = []; out.forEach((l, p) => l.forEach(q => edges.push(p, q)));
  const loops = [];
  while (out.size) {
    const start = out.keys().next().value, path = [start], pos = new Map([[start, 0]]); let cur = start;
    for (;;) {
      const list = out.get(cur); if (!list || !list.length) break;
      const nxt = list.pop(); if (!list.length) out.delete(cur);
      if (pos.has(nxt)) {
        const at = pos.get(nxt); const loop = path.slice(at); if (loop.length >= 3) loops.push(loop);
        for (let i = at + 1; i < path.length; i++) pos.delete(path[i]);
        path.length = at + 1; cur = nxt; if (!out.get(cur)?.length) break;
      } else { pos.set(nxt, path.length); path.push(nxt); cur = nxt; }
    }
    if (out.size && !out.get(start)?.length) out.delete(start);
  }
  return { loops, first: w.first, canon, edges };
}

// every open edge as a pair of points (for drawing the holes in red)
export function openEdgeSegments(positions, indices) {
  const { loops, first } = openLoops(positions, indices), seg = [];
  for (const L of loops) for (let i = 0; i < L.length; i++) { const a = first[L[i]], b = first[L[(i + 1) % L.length]]; seg.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2], positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]); }
  return { segments: new Float32Array(seg), loops: loops.length };
}

function earClip(P, R) {                              // R = loop vertices (original indices) in the order the cap must run; returns triangles as index triples or null
  const n = R.length; if (n < 3) return null;
  let nx = 0, ny = 0, nz = 0;                         // Newell normal of the loop
  for (let i = 0; i < n; i++) { const a = R[i] * 3, b = R[(i + 1) % n] * 3; nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]); ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]); nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]); }
  const nl = Math.hypot(nx, ny, nz); if (nl < 1e-18) return null; nx /= nl; ny /= nl; nz /= nl;
  let ux, uy, uz; if (Math.abs(nx) < 0.9) { ux = 0; uy = -nz; uz = ny; } else { ux = nz; uy = 0; uz = -nx; } const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const X = new Float64Array(n), Y = new Float64Array(n); for (let i = 0; i < n; i++) { const a = R[i] * 3; X[i] = P[a] * ux + P[a + 1] * uy + P[a + 2] * uz; Y[i] = P[a] * vx + P[a + 1] * vy + P[a + 2] * vz; }
  const prev = new Int32Array(n), next = new Int32Array(n); for (let i = 0; i < n; i++) { prev[i] = (i + n - 1) % n; next[i] = (i + 1) % n; }
  const cross = (a, b, c) => (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
  const inside = (a, b, c, p) => { const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p); return d1 >= 0 && d2 >= 0 && d3 >= 0; };
  const tris = []; let left = n, i = 0, fails = 0;
  const clip = v => { const a = prev[v], c = next[v]; tris.push(R[a], R[v], R[c]); next[a] = c; prev[c] = a; left--; fails = 0; return c; };
  while (left > 3) {
    const a = prev[i], c = next[i]; let ear = cross(a, i, c) > 1e-18;
    if (ear) { for (let j = next[c]; j !== a; j = next[j]) { if (cross(prev[j], j, next[j]) <= 0 && inside(a, i, c, j)) { ear = false; break; } } }
    if (ear) i = clip(i); else { i = next[i]; if (++fails > left) i = clip(i); }   // no ear anywhere (numerical trouble): clip anyway so it always finishes
  }
  if (left === 3) { const a = i, b = next[i], c = next[b]; tris.push(R[a], R[b], R[c]); }
  return tris;
}

// opts.point = [x,y,z]: close only the hole nearest this point; otherwise every hole. opts.maxLoops limits how many.
export function fillOpenEdges(positions, indices, opts = {}) {
  const { loops, first } = openLoops(positions, indices), stats = { holes: loops.length, filled: 0, triangles: 0, skipped: 0 };
  if (!loops.length) return { positions, indices, stats };
  let todo = loops;
  if (opts.point) {
    const [px, py, pz] = opts.point; let best = Infinity, bl = null;
    for (const L of loops) { let d = Infinity; for (const c of L) { const a = first[c] * 3, dx = positions[a] - px, dy = positions[a + 1] - py, dz = positions[a + 2] - pz, dd = dx * dx + dy * dy + dz * dz; if (dd < d) d = dd; } if (d < best) { best = d; bl = L; } }
    todo = bl ? [bl] : [];
  }
  if (opts.maxLoops) todo = todo.slice(0, opts.maxLoops);
  const P = positions, newPts = [], newTris = []; let nv = positions.length / 3;
  for (const L of todo) {
    const R = L.slice().reverse().map(c => first[c]); let tris = R.length <= EAR_MAX ? earClip(P, R) : null;
    if (!tris || !tris.length) {                      // fan to the middle of the loop
      let cx = 0, cy = 0, cz = 0; for (const v of R) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
      const c = nv++; newPts.push(cx / R.length, cy / R.length, cz / R.length); tris = []; for (let i = 0; i < R.length; i++) tris.push(R[i], R[(i + 1) % R.length], c);
    }
    for (const t of tris) newTris.push(t); stats.filled++; stats.triangles += tris.length / 3;
  }
  if (!newTris.length) return { positions, indices, stats };
  const outP = new Float32Array(positions.length + newPts.length); outP.set(positions); outP.set(newPts, positions.length);
  const outI = new Uint32Array(indices.length + newTris.length); outI.set(indices); outI.set(newTris, indices.length);
  return { positions: outP, indices: outI, stats };
}
