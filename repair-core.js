// SHRINK 3D v2.17 — detail-preserving mesh repair (pure JS, no imports: runs on the main thread, in a worker and in Node tests).
//
// The voxel rebuild fixes anything but softens detail. Most "needs repair" models only have small, local problems, so this
// repair leaves the surface exactly as it is and only touches the trouble spots:
//   1. weld points that sit in the same place (STL files store every triangle on its own)
//   2. drop degenerate and duplicate triangles
//   3. where three or more triangles meet on one edge, keep the two that continue the surface smoothly
//   4. turn flipped triangles around so every neighbour agrees which way is out
//   5. close each hole with a small patch (cheapest triangulation for small holes, a fan for big ones)
//   6. make sure each closed shell faces outward (not inside-out)
// Overlapping parts are left alone: slicers merge those, and they do not stop a mesh being a valid solid.

const edgeKey = (a, b, V) => (a < b ? a * V + b : b * V + a);

/* ----------------------------- topology report ----------------------------- */
// Counts how many edges are open (1 triangle), tangled (3+), or inconsistently oriented (2 triangles running the same way).
export function topologyReport(positions, indices) {
  const V = positions.length / 3 + 1, nf = Math.floor(indices.length / 3);
  const count = new Map(), dir = new Map();
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = indices[f * 3 + k], b = indices[f * 3 + (k + 1) % 3];
      const key = edgeKey(a, b, V);
      count.set(key, (count.get(key) || 0) + 1);
      const d = a < b ? 1 : -1;
      dir.set(key, (dir.get(key) || 0) + d);
    }
  }
  let open = 0, tangled = 0, inconsistent = 0;
  for (const [key, c] of count) {
    if (c === 1) open++;
    else if (c > 2) tangled++;
    else if (dir.get(key) !== 0) inconsistent++;
  }
  return { open, tangled, inconsistent, edges: count.size, triangles: nf, clean: open === 0 && tangled === 0 && inconsistent === 0 };
}

/* ----------------------------- helpers ----------------------------- */
function faceNormal(P, a, b, c) {
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len, len / 2];
}

function triArea(P, a, b, c) { return faceNormal(P, a, b, c)[3]; }

/* ----------------------------- the repair ----------------------------- */
export function repairMesh({ positions, indices, weldTolerance = 0, maxDpLoop = 32 }) {
  const stats = { weldedPoints: 0, degenerateRemoved: 0, duplicateRemoved: 0, tangledRemoved: 0, flipped: 0, holeLoops: 0, holeTriangles: 0, shellsTurned: 0, before: null, after: null };
  stats.before = topologyReport(positions, indices);

  /* 1. weld */
  const nv0 = positions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const tol = weldTolerance > 0 ? weldTolerance : diag * 1e-6, inv = 1 / tol;
  const weld = new Map(), remap = new Int32Array(nv0), pts = [];
  for (let i = 0; i < nv0; i++) {
    const key = `${Math.round(positions[i * 3] * inv)},${Math.round(positions[i * 3 + 1] * inv)},${Math.round(positions[i * 3 + 2] * inv)}`;
    let id = weld.get(key);
    if (id === undefined) { id = pts.length / 3; weld.set(key, id); pts.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    remap[i] = id;
  }
  stats.weldedPoints = nv0 - pts.length / 3;
  const P = pts;                       // grows when holes get a centre point

  /* 2. degenerate + duplicate triangles */
  let faces = [];                      // flat [a,b,c, a,b,c, ...]
  const seen = new Set();
  const V0 = pts.length / 3 + 1;
  const nfIn = Math.floor(indices.length / 3);
  for (let f = 0; f < nfIn; f++) {
    const a = remap[indices[f * 3]], b = remap[indices[f * 3 + 1]], c = remap[indices[f * 3 + 2]];
    if (a === b || b === c || a === c) { stats.degenerateRemoved++; continue; }
    const s = [a, b, c].sort((x, y) => x - y);
    const key = (s[0] * V0 + s[1]) * V0 + s[2];
    if (seen.has(key)) { stats.duplicateRemoved++; continue; }
    seen.add(key);
    faces.push(a, b, c);
  }

  /* 3. tangled edges: keep the two triangles that continue the surface */
  {
    const V = pts.length / 3 + 1, nf = faces.length / 3;
    const edges = new Map();
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
      const key = edgeKey(faces[f * 3 + k], faces[f * 3 + (k + 1) % 3], V);
      const list = edges.get(key); if (list) list.push(f); else edges.set(key, [f]);
    }
    const removed = new Uint8Array(nf);
    for (const [key, list0] of edges) {
      if (list0.length <= 2) continue;
      const list = list0.filter(f => !removed[f]);
      if (list.length <= 2) continue;
      const lo = Math.floor(key / V), hi = key - lo * V;
      const info = list.map(f => {
        let d = 0;
        for (let k = 0; k < 3; k++) { const a = faces[f * 3 + k], b = faces[f * 3 + (k + 1) % 3]; if (a === lo && b === hi) d = 1; else if (a === hi && b === lo) d = -1; }
        return { f, d, n: faceNormal(P, faces[f * 3], faces[f * 3 + 1], faces[f * 3 + 2]) };
      });
      let best = -Infinity, pair = [0, 1];
      for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
        const dot = info[i].n[0] * info[j].n[0] + info[i].n[1] * info[j].n[1] + info[i].n[2] * info[j].n[2];
        const score = (info[i].d !== info[j].d ? dot : -dot) + (info[i].d !== info[j].d ? 0.5 : 0);
        if (score > best) { best = score; pair = [i, j]; }
      }
      info.forEach((x, i) => { if (i !== pair[0] && i !== pair[1]) { removed[x.f] = 1; stats.tangledRemoved++; } });
    }
    if (stats.tangledRemoved) { const kept = []; for (let f = 0; f < nf; f++) if (!removed[f]) kept.push(faces[f * 3], faces[f * 3 + 1], faces[f * 3 + 2]); faces = kept; }
  }

  /* 4. make every neighbour agree which way is out (flood across shared edges) */
  const orient = () => {
    const V = P.length / 3 + 1, nf = faces.length / 3;
    const edges = new Map();
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
      const key = edgeKey(faces[f * 3 + k], faces[f * 3 + (k + 1) % 3], V);
      const list = edges.get(key); if (list) list.push(f); else edges.set(key, [f]);
    }
    const dirOf = (f, a, b) => { for (let k = 0; k < 3; k++) { const x = faces[f * 3 + k], y = faces[f * 3 + (k + 1) % 3]; if (x === a && y === b) return 1; if (x === b && y === a) return -1; } return 0; };
    const flip = new Int8Array(nf).fill(-1), comp = new Int32Array(nf).fill(-1);
    let nc = 0, flips = 0;
    const queue = [];
    for (let s = 0; s < nf; s++) {
      if (comp[s] >= 0) continue;
      comp[s] = nc; flip[s] = 0; queue.length = 0; queue.push(s);
      for (let qi = 0; qi < queue.length; qi++) {
        const f = queue[qi];
        for (let k = 0; k < 3; k++) {
          const a = faces[f * 3 + k], b = faces[f * 3 + (k + 1) % 3];
          const list = edges.get(edgeKey(a, b, V)); if (!list || list.length !== 2) continue;
          const g = list[0] === f ? list[1] : list[0];
          const effF = flip[f] ? -1 : 1;                 // direction of a->b once f's flip is applied
          const stored = dirOf(g, a, b);                 // direction of a->b as g is stored
          const need = stored === effF ? 1 : 0;          // g must run the opposite way to f
          if (flip[g] < 0) { flip[g] = need; comp[g] = nc; queue.push(g); }
        }
      }
      nc++;
    }
    for (let f = 0; f < nf; f++) if (flip[f] === 1) { const t = faces[f * 3 + 1]; faces[f * 3 + 1] = faces[f * 3 + 2]; faces[f * 3 + 2] = t; flips++; }
    return flips;
  };
  stats.flipped = orient();

  /* 5. fill holes */
  {
    const V = P.length / 3 + 1, nf = faces.length / 3;
    const count = new Map(), edgeSet = new Set();
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
      const key = edgeKey(faces[f * 3 + k], faces[f * 3 + (k + 1) % 3], V);
      count.set(key, (count.get(key) || 0) + 1); edgeSet.add(key);
    }
    // directed boundary edges, as the existing triangle runs them
    const out = new Map(); let boundary = 0;
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
      const a = faces[f * 3 + k], b = faces[f * 3 + (k + 1) % 3];
      if (count.get(edgeKey(a, b, V)) === 1) { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); boundary++; }
    }
    const loops = [];
    while (out.size) {
      const start = out.keys().next().value;
      const path = [start], pos = new Map([[start, 0]]);
      let cur = start;
      for (;;) {
        const list = out.get(cur);
        if (!list || !list.length) break;                          // a chain that never closes: leave it alone
        const nxt = list.pop(); if (!list.length) out.delete(cur);
        if (pos.has(nxt)) {
          const at = pos.get(nxt);
          loops.push(path.slice(at));                              // a closed loop: path[at] ... path[last] and back
          for (let i = at + 1; i < path.length; i++) pos.delete(path[i]);
          path.length = at + 1; cur = nxt;
          if (!out.get(cur)?.length) break;
        } else { pos.set(nxt, path.length); path.push(nxt); cur = nxt; }
      }
    }
    const VK = V + 5e6;                                            // edge keys that cannot collide with later centre points
    for (const key of [...edgeSet]) { const lo = Math.floor(key / V), hi = key - lo * V; edgeSet.delete(key); edgeSet.add(edgeKey(lo, hi, VK)); }
    const newFaces = [];
    const addTri = (a, b, c) => { newFaces.push(a, b, c); edgeSet.add(edgeKey(a, b, VK)); edgeSet.add(edgeKey(b, c, VK)); edgeSet.add(edgeKey(c, a, VK)); };
    for (const loopIn of loops) {
      const n = loopIn.length; if (n < 3) continue;
      const R = loopIn.slice().reverse();                          // new triangles run the opposite way to the boundary
      stats.holeLoops++;
      if (n === 3) { addTri(R[0], R[1], R[2]); stats.holeTriangles++; continue; }
      let done = false;
      if (n <= maxDpLoop) {
        // cheapest triangulation by total area; a diagonal that already exists as an edge would tangle the mesh, so it is forbidden
        const INF = 1e300, cost = Array.from({ length: n }, () => new Float64Array(n)), pick = Array.from({ length: n }, () => new Int32Array(n).fill(-1));
        const okDiag = (i, j) => (j === i + 1) || (i === 0 && j === n - 1) || !edgeSet.has(edgeKey(R[i], R[j], VK));
        for (let len = 2; len < n; len++) for (let i = 0; i + len < n; i++) {
          const j = i + len; let bestC = INF, bestK = -1;
          if (!okDiag(i, j)) { cost[i][j] = INF; continue; }
          for (let k = i + 1; k < j; k++) {
            if (cost[i][k] >= INF || cost[k][j] >= INF) continue;
            const c = cost[i][k] + cost[k][j] + triArea(P, R[i], R[k], R[j]);
            if (c < bestC) { bestC = c; bestK = k; }
          }
          cost[i][j] = bestC; pick[i][j] = bestK;
        }
        if (cost[0][n - 1] < INF) {
          const stack = [[0, n - 1]];
          while (stack.length) { const [i, j] = stack.pop(); if (j - i < 2) continue; const k = pick[i][j]; addTri(R[i], R[k], R[j]); stats.holeTriangles++; stack.push([i, k], [k, j]); }
          done = true;
        }
      }
      if (!done) {
        let cx = 0, cy = 0, cz = 0; for (const v of R) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
        const c = P.length / 3; P.push(cx / n, cy / n, cz / n);
        for (let i = 0; i < n; i++) { addTri(R[i], R[(i + 1) % n], c); stats.holeTriangles++; }
      }
    }
    for (const x of newFaces) faces.push(x);
  }

  /* 6. every closed shell must face outward */
  {
    const V = P.length / 3 + 1, nf = faces.length / 3;
    const edges = new Map();
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
      const key = edgeKey(faces[f * 3 + k], faces[f * 3 + (k + 1) % 3], V);
      const l = edges.get(key); if (l) l.push(f); else edges.set(key, [f]);
    }
    const comp = new Int32Array(nf).fill(-1); const members = [];
    for (let s = 0; s < nf; s++) {
      if (comp[s] >= 0) continue;
      const id = members.length, list = [s]; comp[s] = id;
      for (let qi = 0; qi < list.length; qi++) {
        const f = list[qi];
        for (let k = 0; k < 3; k++) {
          const l = edges.get(edgeKey(faces[f * 3 + k], faces[f * 3 + (k + 1) % 3], V));
          if (l) for (const g of l) if (comp[g] < 0) { comp[g] = id; list.push(g); }
        }
      }
      members.push(list);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    for (const list of members) {
      let vol = 0;
      for (const f of list) {
        const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
        const ax = P[a * 3] - cx, ay = P[a * 3 + 1] - cy, az = P[a * 3 + 2] - cz;
        const bx = P[b * 3] - cx, by = P[b * 3 + 1] - cy, bz = P[b * 3 + 2] - cz;
        const qx = P[c * 3] - cx, qy = P[c * 3 + 1] - cy, qz = P[c * 3 + 2] - cz;
        vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
      }
      if (vol < 0) { for (const f of list) { const t = faces[f * 3 + 1]; faces[f * 3 + 1] = faces[f * 3 + 2]; faces[f * 3 + 2] = t; } stats.shellsTurned++; }
    }
  }

  /* output: only the points that are still used */
  const used = new Int32Array(P.length / 3).fill(-1); let nu = 0;
  for (const v of faces) if (used[v] < 0) used[v] = nu++;
  const outPos = new Float32Array(nu * 3), outIdx = new Uint32Array(faces.length);
  for (let v = 0; v < used.length; v++) if (used[v] >= 0) { outPos[used[v] * 3] = P[v * 3]; outPos[used[v] * 3 + 1] = P[v * 3 + 1]; outPos[used[v] * 3 + 2] = P[v * 3 + 2]; }
  for (let i = 0; i < faces.length; i++) outIdx[i] = used[faces[i]];
  stats.after = topologyReport(outPos, outIdx);
  return { positions: outPos, indices: outIdx, stats };
}
