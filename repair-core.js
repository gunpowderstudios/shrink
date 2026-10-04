// SHRINK 3D v2.18 core — mesh health check + detail-preserving repair (pure JS, no imports, no DOM).
// Runs on the main thread, in a Web Worker (repair-worker.js) and in Node tests.
//
// ONE definition of "clean" lives here and is used everywhere (preflight, post-reduction guard, repair result):
//   - points are welded at the same tolerance (bounding-box diagonal x 1e-6),
//   - open edge      = used by exactly 1 triangle,
//   - tangled edge   = used by 3 or more triangles,
//   - flipped edge   = used by 2 triangles that both run the same way (inconsistent orientation).
// clean = no open, no tangled, no flipped edges. Empty/degenerate triangles are counted but are NOT a failure:
// they are harmless to slicers and are dropped by the repair.
//
// Everything below uses typed arrays and open-addressing hash tables (no string keys, no Map per vertex/edge), so a
// 1,000,000-triangle unwelded STL needs a few seconds and a few hundred MB instead of tens of seconds and >1.5 GB.

/* ----------------------------- hashing helpers ----------------------------- */
const nextPow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

export function defaultWeldTolerance(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  return { tol: diag * 1e-6, bbox: [minX, minY, minZ, maxX, maxY, maxZ] };
}

// Join points that sit in the same place. Returns canon[i] = new point id, unique = number of new points,
// first[u] = index of the first original point with id u.
export function weldIds(positions, tol) {
  const n = positions.length / 3, inv = 1 / tol;
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  const size = nextPow2(Math.max(16, n * 2)), mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const canon = new Int32Array(n), firstList = [];
  let unique = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(positions[i * 3] * inv), y = Math.round(positions[i * 3 + 1] * inv), z = Math.round(positions[i * 3 + 2] * inv);
    qx[i] = x; qy[i] = y; qz[i] = z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const t = table[h];
      if (t < 0) { table[h] = i; canon[i] = unique++; firstList.push(i); break; }
      if (qx[t] === x && qy[t] === y && qz[t] === z) { canon[i] = canon[t]; break; }
      h = (h + 1) & mask;
    }
  }
  return { canon, unique, first: Int32Array.from(firstList) };
}

// Directed-edge table. Entry e = face*3+k is the edge from F[face*3+k] to F[face*3+(k+1)%3].
// Every undirected edge gets a slot; its entries are chained through `next`. count[slot] = how many entries.
function buildEdges(F, nf) {
  const ne = nf * 3, size = nextPow2(Math.max(16, ne * 2)), mask = size - 1;
  const slotLo = new Int32Array(size).fill(-1), slotHi = new Int32Array(size), head = new Int32Array(size), count = new Int32Array(size);
  const next = new Int32Array(ne), slotOf = new Int32Array(ne);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
    const a = F[f * 3 + k], b = F[f * 3 + (k + 1) % 3], lo = a < b ? a : b, hi = a < b ? b : a, e = f * 3 + k;
    let h = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & mask;
    for (;;) {
      if (slotLo[h] < 0) { slotLo[h] = lo; slotHi[h] = hi; head[h] = e; next[e] = -1; count[h] = 1; slotOf[e] = h; break; }
      if (slotLo[h] === lo && slotHi[h] === hi) { next[e] = head[h]; head[h] = e; count[h]++; slotOf[e] = h; break; }
      h = (h + 1) & mask;
    }
  }
  return { size, slotLo, slotHi, head, count, next, slotOf, mask, ne };
}

function findSlot(E, lo, hi) {
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  let h = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & E.mask;
  for (;;) {
    if (E.slotLo[h] < 0) return -1;
    if (E.slotLo[h] === lo && E.slotHi[h] === hi) return h;
    h = (h + 1) & E.mask;
  }
}

/* ----------------------------- the health check ----------------------------- */
// positions: Float32Array xyz, indices: Uint32Array (or Int32Array) triples, in ONE shared coordinate space (world space).
export function meshHealth(positions, indices, opts = {}) {
  const nvIn = positions.length / 3, nfIn = Math.floor(indices.length / 3);
  const { tol } = defaultWeldTolerance(positions);
  const { canon, unique } = weldIds(positions, opts.tolerance > 0 ? opts.tolerance : tol);
  const F = new Int32Array(nfIn * 3); let nf = 0, degenerate = 0;
  for (let f = 0; f < nfIn; f++) {
    const a = canon[indices[f * 3]], b = canon[indices[f * 3 + 1]], c = canon[indices[f * 3 + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    F[nf * 3] = a; F[nf * 3 + 1] = b; F[nf * 3 + 2] = c; nf++;
  }
  const E = buildEdges(F, nf);
  let open = 0, tangled = 0, flipped = 0;
  for (let h = 0; h < E.size; h++) {
    if (E.slotLo[h] < 0) continue;
    const c = E.count[h];
    if (c === 1) open++;
    else if (c > 2) tangled++;
    else {
      const e1 = E.head[h], e2 = E.next[e1];
      if (F[e1] === F[e2]) flipped++;          // both directed entries start at the same point: they run the same way
    }
  }
  return { triangles: nf, degenerate, open, tangled, flipped, points: unique, inputPoints: nvIn, inputTriangles: nfIn, clean: open === 0 && tangled === 0 && flipped === 0 };
}

// The old name used by earlier tests / callers.
export function topologyReport(positions, indices) {
  const h = meshHealth(positions, indices);
  return { open: h.open, tangled: h.tangled, inconsistent: h.flipped, triangles: h.triangles, clean: h.clean };
}

// Convenience for a THREE model (THREE is passed in, so this file stays import-free): gathers world-space triangles.
export function gatherWorld(THREE, model) {
  model.updateMatrixWorld(true);
  let nv = 0, ni = 0; const meshes = [];
  model.traverse(o => { const g = o.geometry; if (!o.isMesh || !g?.attributes?.position) return; meshes.push(o); nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
  const positions = new Float32Array(nv * 3), indices = new Uint32Array(ni - (ni % 3));
  const v = new THREE.Vector3(); let vo = 0, io = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position, flip = mesh.matrixWorld.determinant() < 0;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); positions[(vo + i) * 3] = v.x; positions[(vo + i) * 3 + 1] = v.y; positions[(vo + i) * 3 + 2] = v.z; }
    const count = g.index ? g.index.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = g.index ? g.index.getX(t) : t, b = g.index ? g.index.getX(t + 1) : t + 1, c = g.index ? g.index.getX(t + 2) : t + 2;
      indices[io++] = a + vo; indices[io++] = (flip ? c : b) + vo; indices[io++] = (flip ? b : c) + vo;
    }
    vo += pos.count;
  }
  return { positions, indices: indices.subarray(0, io) };
}

// Same field names the old preflight expected, so existing UI code keeps working.
export function healthOfModel(THREE, model) {
  const { positions, indices } = gatherWorld(THREE, model);
  const h = meshHealth(positions, indices);
  return { ...h, openEdges: h.open, pinchedEdges: h.tangled, flippedEdges: h.flipped, degenerateTriangles: h.degenerate };
}

/* ----------------------------- the repair ----------------------------- */
function normalOf(P, a, b, c, out) {
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / len; out[1] = ny / len; out[2] = nz / len; out[3] = len / 2;
  return out;
}

export function repairMesh({ positions, indices, weldTolerance = 0, maxDpLoop = 32, onProgress = () => {} }) {
  const stats = { weldedPoints: 0, degenerateRemoved: 0, duplicateRemoved: 0, tangledRemoved: 0, flipped: 0, holeLoops: 0, holeTriangles: 0, shellsTurned: 0, before: null, after: null };
  onProgress(2, 'Checking the mesh…');
  stats.before = meshHealth(positions, indices);

  /* 1. weld */
  onProgress(12, 'Joining loose points…');
  const { tol, bbox } = defaultWeldTolerance(positions);
  const { canon, unique, first } = weldIds(positions, weldTolerance > 0 ? weldTolerance : tol);
  stats.weldedPoints = positions.length / 3 - unique;
  let P = new Float32Array((unique + 1024) * 3), nP = unique;
  for (let u = 0; u < unique; u++) { const s = first[u] * 3; P[u * 3] = positions[s]; P[u * 3 + 1] = positions[s + 1]; P[u * 3 + 2] = positions[s + 2]; }
  const addPoint = (x, y, z) => { if (nP * 3 + 3 > P.length) { const q = new Float32Array(P.length * 2); q.set(P); P = q; } P[nP * 3] = x; P[nP * 3 + 1] = y; P[nP * 3 + 2] = z; return nP++; };

  /* 2. degenerate + duplicate triangles */
  onProgress(24, 'Removing empty and duplicate triangles…');
  const nfIn = Math.floor(indices.length / 3);
  let F = new Int32Array(nfIn * 3), nf = 0;
  {
    const size = nextPow2(Math.max(16, nfIn * 2)), mask = size - 1, table = new Int32Array(size).fill(-1);
    for (let f = 0; f < nfIn; f++) {
      const a = canon[indices[f * 3]], b = canon[indices[f * 3 + 1]], c = canon[indices[f * 3 + 2]];
      if (a === b || b === c || a === c) { stats.degenerateRemoved++; continue; }
      let s0 = a, s1 = b, s2 = c, t;
      if (s0 > s1) { t = s0; s0 = s1; s1 = t; } if (s1 > s2) { t = s1; s1 = s2; s2 = t; } if (s0 > s1) { t = s0; s0 = s1; s1 = t; }
      let h = (Math.imul(s0, 73856093) ^ Math.imul(s1, 19349663) ^ Math.imul(s2, 83492791)) & mask, dup = false;
      for (;;) {
        const q = table[h];
        if (q < 0) { table[h] = nf; break; }
        let r0 = F[q * 3], r1 = F[q * 3 + 1], r2 = F[q * 3 + 2];
        if (r0 > r1) { t = r0; r0 = r1; r1 = t; } if (r1 > r2) { t = r1; r1 = r2; r2 = t; } if (r0 > r1) { t = r0; r0 = r1; r1 = t; }
        if (r0 === s0 && r1 === s1 && r2 === s2) { dup = true; break; }
        h = (h + 1) & mask;
      }
      if (dup) { stats.duplicateRemoved++; continue; }
      F[nf * 3] = a; F[nf * 3 + 1] = b; F[nf * 3 + 2] = c; nf++;
    }
  }

  /* 3. tangled edges: keep the two triangles that continue the surface */
  onProgress(36, 'Untangling edges…');
  {
    const E = buildEdges(F, nf), removed = new Uint8Array(nf);
    let any = false;
    for (let h = 0; h < E.size; h++) {
      if (E.slotLo[h] < 0 || E.count[h] <= 2) continue;
      const lo = E.slotLo[h], hi = E.slotHi[h], list = [];
      for (let e = E.head[h]; e >= 0; e = E.next[e]) { const f = (e / 3) | 0; if (!removed[f]) list.push(e); }
      if (list.length <= 2) continue;
      const info = list.map(e => { const f = (e / 3) | 0, k = e % 3, d = (F[f * 3 + k] === lo && F[f * 3 + (k + 1) % 3] === hi) ? 1 : -1; return { f, d, n: normalOf(P, F[f * 3], F[f * 3 + 1], F[f * 3 + 2], [0, 0, 0, 0]) }; });
      let best = -Infinity, pi = 0, pj = 1;
      for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
        const dot = info[i].n[0] * info[j].n[0] + info[i].n[1] * info[j].n[1] + info[i].n[2] * info[j].n[2];
        const opposite = info[i].d !== info[j].d, score = (opposite ? dot : -dot) + (opposite ? 0.5 : 0);
        if (score > best) { best = score; pi = i; pj = j; }
      }
      info.forEach((x, i) => { if (i !== pi && i !== pj) { removed[x.f] = 1; stats.tangledRemoved++; any = true; } });
    }
    if (any) { let w = 0; for (let f = 0; f < nf; f++) if (!removed[f]) { F[w * 3] = F[f * 3]; F[w * 3 + 1] = F[f * 3 + 1]; F[w * 3 + 2] = F[f * 3 + 2]; w++; } nf = w; }
  }

  /* shared by step 4 and step 6: face components, optionally with consistent orientation */
  const flood = (E, applyOrientation) => {
    const opp = new Int32Array(nf * 3).fill(-1);
    for (let h = 0; h < E.size; h++) if (E.slotLo[h] >= 0 && E.count[h] === 2) { const e1 = E.head[h], e2 = E.next[e1]; opp[e1] = e2; opp[e2] = e1; }
    const flip = new Int8Array(nf), comp = new Int32Array(nf).fill(-1), queue = new Int32Array(nf);
    let nc = 0, flips = 0;
    for (let s = 0; s < nf; s++) {
      if (comp[s] >= 0) continue;
      comp[s] = nc; let qh = 0, qt = 0; queue[qt++] = s;
      while (qh < qt) {
        const f = queue[qh++];
        for (let k = 0; k < 3; k++) {
          const o = opp[f * 3 + k]; if (o < 0) continue;
          const g = (o / 3) | 0; if (comp[g] >= 0) continue;
          const a = F[f * 3 + k], c = F[g * 3 + (o % 3)];
          flip[g] = applyOrientation ? (flip[f] ^ (a === c ? 1 : 0)) : 0;
          comp[g] = nc; queue[qt++] = g;
        }
      }
      nc++;
    }
    if (applyOrientation) for (let f = 0; f < nf; f++) if (flip[f] === 1) { const t = F[f * 3 + 1]; F[f * 3 + 1] = F[f * 3 + 2]; F[f * 3 + 2] = t; flips++; }
    return { comp, nc, flips };
  };

  /* 4. make every neighbour agree which way is out */
  onProgress(48, 'Turning flipped triangles round…');
  stats.flipped = flood(buildEdges(F, nf), true).flips;

  /* 5. fill holes */
  onProgress(60, 'Closing holes…');
  {
    const E = buildEdges(F, nf), out = new Map();
    for (let e = 0; e < nf * 3; e++) {
      if (E.count[E.slotOf[e]] !== 1) continue;
      const f = (e / 3) | 0, k = e % 3, a = F[f * 3 + k], b = F[f * 3 + (k + 1) % 3];
      const l = out.get(a); if (l) l.push(b); else out.set(a, [b]);
    }
    const loops = [];
    while (out.size) {
      const start = out.keys().next().value, path = [start], pos = new Map([[start, 0]]);
      let cur = start;
      for (;;) {
        const list = out.get(cur);
        if (!list || !list.length) break;
        const nxt = list.pop(); if (!list.length) out.delete(cur);
        if (pos.has(nxt)) {
          const at = pos.get(nxt); loops.push(path.slice(at));
          for (let i = at + 1; i < path.length; i++) pos.delete(path[i]);
          path.length = at + 1; cur = nxt;
          if (!out.get(cur)?.length) break;
        } else { pos.set(nxt, path.length); path.push(nxt); cur = nxt; }
      }
    }
    const added = new Set(), addKey = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    const hasEdge = (a, b) => findSlot(E, a, b) >= 0 || added.has(addKey(a, b));
    const newFaces = [];
    const addTri = (a, b, c) => { newFaces.push(a, b, c); added.add(addKey(a, b)); added.add(addKey(b, c)); added.add(addKey(c, a)); };
    const tmp = [0, 0, 0, 0];
    const area = (a, b, c) => normalOf(P, a, b, c, tmp)[3];
    for (const loopIn of loops) {
      const n = loopIn.length; if (n < 3) continue;
      const R = loopIn.slice().reverse();
      stats.holeLoops++;
      if (n === 3) { addTri(R[0], R[1], R[2]); stats.holeTriangles++; continue; }
      let done = false;
      if (n <= maxDpLoop) {
        const INF = 1e300, cost = Array.from({ length: n }, () => new Float64Array(n)), pick = Array.from({ length: n }, () => new Int32Array(n).fill(-1));
        const okDiag = (i, j) => (j === i + 1) || (i === 0 && j === n - 1) || !hasEdge(R[i], R[j]);
        for (let len = 2; len < n; len++) for (let i = 0; i + len < n; i++) {
          const j = i + len; let bestC = INF, bestK = -1;
          if (!okDiag(i, j)) { cost[i][j] = INF; continue; }
          for (let k = i + 1; k < j; k++) {
            if (cost[i][k] >= INF || cost[k][j] >= INF) continue;
            const c = cost[i][k] + cost[k][j] + area(R[i], R[k], R[j]);
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
        const c = addPoint(cx / n, cy / n, cz / n);
        for (let i = 0; i < n; i++) { addTri(R[i], R[(i + 1) % n], c); stats.holeTriangles++; }
      }
    }
    if (newFaces.length) {
      const G = new Int32Array((nf + newFaces.length / 3) * 3); G.set(F.subarray(0, nf * 3)); G.set(newFaces, nf * 3);
      F = G; nf += newFaces.length / 3;
    }
  }

  /* 6. every closed shell must face outward */
  onProgress(80, 'Checking the shells face outward…');
  {
    const { comp, nc } = flood(buildEdges(F, nf), false);
    const vol = new Float64Array(nc), cx = (bbox[0] + bbox[3]) / 2, cy = (bbox[1] + bbox[4]) / 2, cz = (bbox[2] + bbox[5]) / 2;
    for (let f = 0; f < nf; f++) {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      const ax = P[a * 3] - cx, ay = P[a * 3 + 1] - cy, az = P[a * 3 + 2] - cz;
      const bx = P[b * 3] - cx, by = P[b * 3 + 1] - cy, bz = P[b * 3 + 2] - cz;
      const qx = P[c * 3] - cx, qy = P[c * 3 + 1] - cy, qz = P[c * 3 + 2] - cz;
      vol[comp[f]] += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    }
    const turn = new Uint8Array(nc); for (let i = 0; i < nc; i++) if (vol[i] < 0) { turn[i] = 1; stats.shellsTurned++; }
    if (stats.shellsTurned) for (let f = 0; f < nf; f++) if (turn[comp[f]]) { const t = F[f * 3 + 1]; F[f * 3 + 1] = F[f * 3 + 2]; F[f * 3 + 2] = t; }
  }

  /* output: only the points that are still used */
  onProgress(92, 'Packing the result…');
  const used = new Int32Array(nP).fill(-1); let nu = 0;
  for (let i = 0; i < nf * 3; i++) if (used[F[i]] < 0) used[F[i]] = nu++;
  const outPos = new Float32Array(nu * 3), outIdx = new Uint32Array(nf * 3);
  for (let v = 0; v < nP; v++) if (used[v] >= 0) { outPos[used[v] * 3] = P[v * 3]; outPos[used[v] * 3 + 1] = P[v * 3 + 1]; outPos[used[v] * 3 + 2] = P[v * 3 + 2]; }
  for (let i = 0; i < nf * 3; i++) outIdx[i] = used[F[i]];
  stats.after = meshHealth(outPos, outIdx);
  onProgress(100, 'Done');
  return { positions: outPos, indices: outIdx, stats };
}
