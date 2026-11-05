// SHRINK 3D v2.202 — "Racer" export preset, the geometry side (vertex budget). No DOM and no imports of its own except reduce-core:
// the page (racer.js) and the tests (racer-geometry.test.mjs) hand in the glTF-Transform helpers and the meshopt simplifier through `ops`.
//
// What it does, in this order, on a document whose wheels are already separate nodes (wheel-split):
//   1. every wheel (Wheel_FL ...) is reduced to about `wheelVerts` vertices, with its own pivot untouched;
//   2. the rest of the car is split into triangles a player can see and triangles nobody sees (the underside and the inside of the shell).
//      "Seen" = in front in a software depth render from a ring of directions at or above the horizon, so an underside never counts and an
//      interior seen through a window does. The unseen triangles are crushed (`hiddenKeep`), the seen ones get what is left of `totalVerts`;
//   3. the vertex count is measured again and the seen part is redone with a slightly larger error if the car is still over budget.
// Meshopt's error limit is tried small first (0.01) so lights, window frames and the silhouette keep their shape when the budget allows it.
import { reduceIndices } from './reduce-core.js?v=2.18';

export const GEO_DEFAULTS = { totalVerts: 80000, wheelVerts: 7000, hiddenKeep: 0.12, resolution: 1024, maxVerts: 90000 };
export const WHEEL_NAME = /^Wheel_(FL|FR|RL|RR|F|L|R)$/;
const VALID_SETS = [['FL', 'FR', 'RL', 'RR'], ['F', 'RL', 'RR'], ['L', 'R']];
const ERRORS = [0.01, 0.025, 0.05, 0.1];

/* ---------- reading the document ---------- */
function floatPositions(acc) {
  const a = acc.getArray();
  if (a instanceof Float32Array) return a;
  const out = new Float32Array(acc.getCount() * 3), e = [0, 0, 0];
  for (let i = 0; i < acc.getCount(); i++) { acc.getElement(i, e); out.set(e, i * 3); }
  return out;
}
function sequentialIndices(doc, prim) {
  const n = prim.getAttribute('POSITION').getCount(), arr = new Uint32Array(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  const buffer = prim.getAttribute('POSITION').getBuffer() || doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const acc = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer);
  prim.setIndices(acc); return acc;
}
function distinct(idx, n) { const seen = new Uint8Array(n); let c = 0; for (let i = 0; i < idx.length; i++) if (!seen[idx[i]]) { seen[idx[i]] = 1; c++; } return c; }

// every drawable triangle primitive, once per node that shows it
export function collectParts(doc) {
  const parts = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || prim.listTargets().length || !prim.getAttribute('POSITION')) continue;
      const idxAcc = prim.getIndices() || sequentialIndices(doc, prim);
      const pos = floatPositions(prim.getAttribute('POSITION')), idx = Uint32Array.from(idxAcc.getArray());
      parts.push({ node, mesh, prim, pos, idx, wheel: WHEEL_NAME.test(node.getName() || ''), verts: distinct(idx, pos.length / 3) });
    }
  }
  return parts;
}

export function vertexReport(doc) {
  const parts = collectParts(doc), wheels = [], names = [];
  let body = 0, total = 0;
  for (const p of parts) {
    total += p.verts;
    if (p.wheel) { const n = p.node.getName(); let w = wheels.find(x => x.name === n); if (!w) wheels.push(w = { name: n, verts: 0 }); w.verts += p.verts; if (!names.includes(n)) names.push(n); }
    else body += p.verts;
  }
  return { total, body, wheels, wheelNames: names };
}

// the game finds the wheels by name; a set that is not one of the three layouts is a mistake worth saying out loud
export function wheelSetProblem(names) {
  if (!names.length) return 'No parts named Wheel_FL / Wheel_FR / Wheel_RL / Wheel_RR were found. The game needs them: turn on "Separate the wheels".';
  const have = names.map(n => n.replace('Wheel_', '')).sort().join(',');
  if (!VALID_SETS.some(s => [...s].sort().join(',') === have)) return `The wheel parts are ${names.join(', ')}. The game expects Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR (or Wheel_F, Wheel_RL, Wheel_RR for a three-wheeler, or Wheel_L, Wheel_R for a caravan).`;
  return null;
}

// a wheel spins about its node origin, so its geometry has to be centred on it
export function pivotProblems(doc) {
  const out = [];
  for (const p of collectParts(doc)) {
    if (!p.wheel) continue;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.idx.length; i++) { const v = p.idx[i]; for (let k = 0; k < 3; k++) { const x = p.pos[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; } }
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    const off = Math.hypot((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    if (off > 0.03 * size) {
      // a tyre that is only partly modelled (the top is inside the arch on many scans) looks off-centre by its box alone: its box is not round in the wheel's plane. A whole tyre's box is.
      const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], ax = ext.indexOf(Math.min(...ext)), a = ext[(ax + 1) % 3], b = ext[(ax + 2) % 3];
      if (Math.min(a, b) < 0.9 * Math.max(a, b)) continue;
      out.push({ name: p.node.getName(), offset: off, size });
    }
  }
  return out;
}

/* ---------- which triangles can a player see? (depth render from a ring of directions) ---------- */
export function viewDirections() {
  const dirs = [], ring = (elev, n, phase = 0) => { const c = Math.cos(elev), s = Math.sin(elev); for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2; dirs.push([Math.cos(a) * c, s, Math.sin(a) * c]); } };
  ring(0, 12); ring(0.4, 12, 0.26); ring(0.85, 8); ring(1.25, 5); dirs.push([0, 1, 0]);
  return dirs;
}

// parts: [{ wp: Float32Array world positions, idx: Uint32Array }]  ->  one Uint8Array of 1 = seen per part (per triangle)
export async function visibleTriangles(parts, { resolution = GEO_DEFAULTS.resolution } = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.wp.length; i += 3) for (let k = 0; k < 3; k++) { const x = p.wp[i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2, R = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
  const N = resolution, scale = N / (2.02 * R), tol = 2.5 / scale, flags = parts.map(p => new Uint8Array(p.idx.length / 3));
  const z = new Float32Array(N * N);
  for (const d of viewDirections()) {
    // screen axes perpendicular to the view direction
    let ux = 0, uy = 1, uz = 0; if (Math.abs(d[1]) > 0.95) { ux = 1; uy = 0; }
    let ax = uy * d[2] - uz * d[1], ay = uz * d[0] - ux * d[2], az = ux * d[1] - uy * d[0]; const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
    const bx = d[1] * az - d[2] * ay, by = d[2] * ax - d[0] * az, bz = d[0] * ay - d[1] * ax;
    z.fill(-Infinity);
    const proj = parts.map(p => {
      const n = p.wp.length / 3, X = new Float32Array(n), Y = new Float32Array(n), D = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = p.wp[i * 3] - cx, y = p.wp[i * 3 + 1] - cy, w = p.wp[i * 3 + 2] - cz; X[i] = (x * ax + y * ay + w * az) * scale + N / 2; Y[i] = (x * bx + y * by + w * bz) * scale + N / 2; D[i] = x * d[0] + y * d[1] + w * d[2]; }
      return { X, Y, D };
    });
    // pass 1: nearest surface per pixel
    parts.forEach((p, pi) => {
      const { X, Y, D } = proj[pi], idx = p.idx;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const x0 = X[a], y0 = Y[a], x1 = X[b], y1 = Y[b], x2 = X[c], y2 = Y[c];
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (area > -1e-9 && area < 1e-9) continue;
        const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(N - 1, Math.ceil(Math.max(x0, x1, x2)));
        const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(N - 1, Math.ceil(Math.max(y0, y1, y2)));
        const inv = 1 / area, d0 = D[a], d1 = D[b], d2 = D[c];
        for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
          const sx = px + 0.5, sy = py + 0.5;
          const w0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) * inv, w1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) * inv, w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const dd = w0 * d0 + w1 * d1 + w2 * d2, o = py * N + px; if (dd > z[o]) z[o] = dd;
        }
      }
    });
    // pass 2: a triangle is seen if its centre or a corner is not behind what is in the buffer
    parts.forEach((p, pi) => {
      const { X, Y, D } = proj[pi], idx = p.idx, f = flags[pi];
      const front = (px, py, dd) => { px = Math.floor(px); py = Math.floor(py); if (px < 0 || py < 0 || px >= N || py >= N) return false; return dd >= z[py * N + px] - tol; };
      for (let t = 0; t < idx.length; t += 3) {
        const ti = t / 3; if (f[ti]) continue;
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        if (front((X[a] + X[b] + X[c]) / 3, (Y[a] + Y[b] + Y[c]) / 3, (D[a] + D[b] + D[c]) / 3) || front(X[a], Y[a], D[a]) || front(X[b], Y[b], D[b]) || front(X[c], Y[c], D[c])) f[ti] = 1;
      }
    });
    await Promise.resolve();
  }
  return flags;
}

/* ---------- reducing to a vertex budget ---------- */
function concat(...lists) { let n = 0; for (const l of lists) n += l.length; const out = new Uint32Array(n); let o = 0; for (const l of lists) { out.set(l, o); o += l.length; } return out; }
function pick(idx, flags, want) { const out = []; for (let t = 0; t < flags.length; t++) if (!!flags[t] === want) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]); return Uint32Array.from(out); }
const asU32 = a => (a instanceof Uint32Array ? a : Uint32Array.from(a));
const shrinkIdx = (simplifier, pos, idx, ratio, error, lockBorder) => (idx.length < 9 || ratio >= 0.999 ? idx : asU32(reduceIndices({ simplifier, positions: pos, indices: idx, ratio: Math.max(0.001, ratio), error, lockBorder }).indices));

// items: [{ pos, idx, flags|null }]  ->  { outputs: Uint32Array[] (one per item), verts }
function fit(items, targetVerts, { simplifier, hiddenKeep, lockBorder }) {
  const n = items.length;
  // unseen triangles first: they are crushed whatever the budget (up to the error limit of 0.1)
  const hidden = items.map(it => (it.flags ? shrinkIdx(simplifier, it.pos, pick(it.idx, it.flags, false), hiddenKeep, 0.1, true) : new Uint32Array(0)));
  const seenIdx = items.map(it => (it.flags ? pick(it.idx, it.flags, true) : it.idx));
  const count = outs => { let v = 0; outs.forEach((o, i) => { v += distinct(concat(o, hidden[i]), items[i].pos.length / 3); }); return v; };
  const total = items.reduce((a, it) => a + distinct(it.idx, it.pos.length / 3), 0);
  if (total <= targetVerts * 1.03) return { outputs: items.map(it => it.idx), verts: total, changed: false };
  // a first guess from the current vertices-per-triangle, then corrected from what comes out
  let ratio = Math.min(1, targetVerts / total), best = null, over = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const err = ERRORS[Math.min(ERRORS.length - 1, over)];
    const outs = seenIdx.map((s, i) => shrinkIdx(simplifier, items[i].pos, s, ratio, err, items[i].flags ? true : lockBorder));
    const verts = count(outs), cand = { outputs: outs.map((o, i) => concat(o, hidden[i])), seenLen: outs.map(o => o.length), verts, changed: true };
    if (verts <= targetVerts * 1.03 && (!best || best.verts > targetVerts * 1.03 || verts > best.verts)) best = cand;
    else if (!best) best = cand;
    if (verts <= targetVerts * 1.03 && verts >= targetVerts * 0.93) break;           // close enough under the budget
    if (verts > targetVerts * 1.03) over++;                                            // over: allow a larger error next time
    else if (ratio >= 0.999) break;                                                    // under budget at full detail: nothing more to give
    ratio = Math.min(1, Math.max(0.002, ratio * Math.min(1.6, Math.max(0.5, (targetVerts * 0.97) / verts))));
  }
  // scanned meshes carry thousands of tiny loose pieces that the simplifier cannot merge, so it stops at a floor above the budget: drop the smallest loose pieces
  if (best.verts > targetVerts * 1.03) best = trimToBudget(items, best, targetVerts);
  return best;
}

// Remove whole connected pieces, hidden-only pieces first and then the smallest, until the vertex count fits. Pieces are found by shared vertex numbers (the mesh is welded).
function trimToBudget(items, cand, targetVerts) {
  const pieces = []; let total = 0; const per = [];
  items.forEach((it, i) => {
    const idx = cand.outputs[i], nTri = idx.length / 3, seenTris = cand.seenLen ? cand.seenLen[i] / 3 : nTri, par = new Map();
    const find = x => { let r = x; while (par.get(r) !== r) r = par.get(r); while (par.get(x) !== r) { const n = par.get(x); par.set(x, r); x = n; } return r; };
    for (let k = 0; k < idx.length; k++) if (!par.has(idx[k])) par.set(idx[k], idx[k]);
    for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]); if (b !== a) par.set(b, a); const c2 = find(c), a2 = find(a); if (c2 !== a2) par.set(c2, a2); }
    const comp = new Map(), verts = new Map();
    for (let t = 0; t < nTri; t++) { const r = find(idx[t * 3]); let p = comp.get(r); if (!p) { p = { item: i, tris: 0, seen: 0, verts: 0 }; comp.set(r, p); pieces.push(p); } p.tris++; if (t < seenTris) p.seen++; }
    for (const v of par.keys()) { const p = comp.get(find(v)); if (p) p.verts++; }
    const keep = new Uint8Array(nTri).fill(1); per.push({ idx, comp, find, keep, seenTris });
    total += par.size;
  });
  pieces.sort((a, b) => ((a.seen ? 1 : 0) - (b.seen ? 1 : 0)) || a.tris - b.tris);
  const drop = new Set(); const goal = targetVerts * 0.98;
  for (const p of pieces) { if (total <= goal) break; drop.add(p); total -= p.verts; }
  if (!drop.size) return cand;
  const outputs = per.map(({ idx, comp, find }) => { const out = []; for (let t = 0; t < idx.length; t += 3) { if (!drop.has(comp.get(find(idx[t])))) out.push(idx[t], idx[t + 1], idx[t + 2]); } return Uint32Array.from(out); });
  return { outputs, verts: total, changed: true, trimmed: drop.size };
}

function install(doc, items) {
  for (const it of items) {
    const old = it.prim.getIndices();
    const acc = doc.createAccessor().setType('SCALAR').setArray(it.out).setBuffer(old.getBuffer());
    it.prim.setIndices(acc);
    if (old.listParents().filter(p => p.propertyType !== 'Root').length === 0) old.dispose();
  }
}

// ops: { simplifier (meshopt, already .ready), compactPrimitive, getPrimitiveVertexCount }
export async function applyGeometry(doc, options = {}, ops, progress = () => {}) {
  const o = { ...GEO_DEFAULTS, ...options }, report = { options: o, notes: [], warnings: [], hidden: 0, seen: 0 };
  const parts = collectParts(doc);
  report.before = vertexReport(doc);
  const wheels = parts.filter(p => p.wheel), body = parts.filter(p => !p.wheel);
  const problem = wheelSetProblem(report.before.wheelNames); if (problem) report.warnings.push(problem);

  // 1. wheels: each wheel gets its own budget; a wheel made of several primitives shares it by vertices
  progress('Reducing the wheels…');
  const byWheel = new Map(); for (const w of wheels) { const k = w.node; if (!byWheel.has(k)) byWheel.set(k, []); byWheel.get(k).push(w); }
  const done = [];
  for (const group of byWheel.values()) {
    const items = group.map(g => ({ pos: g.pos, idx: g.idx, flags: null }));
    const r = fit(items, o.wheelVerts, { simplifier: ops.simplifier, hiddenKeep: o.hiddenKeep, lockBorder: false });
    if (r.changed) group.forEach((g, i) => done.push({ prim: g.prim, out: r.outputs[i] }));
  }
  install(doc, done);

  // 2. the rest of the car: seen / unseen, then the budget that is left
  progress('Working out which parts of the car can be seen…');
  const wheelsAfter = [...byWheel.values()].reduce((a, group) => a + group.reduce((s, g) => s + (done.find(d => d.prim === g.prim) ? distinct(done.find(d => d.prim === g.prim).out, g.pos.length / 3) : g.verts), 0), 0);
  const bodyTarget = Math.max(2000, o.totalVerts - wheelsAfter);
  if (body.length) {
    const wps = body.map(b => { const m = b.node.getWorldMatrix(), wp = new Float32Array(b.pos.length); for (let i = 0; i < b.pos.length; i += 3) { const x = b.pos[i], y = b.pos[i + 1], z = b.pos[i + 2]; wp[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; wp[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; wp[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]; } return wp; });
    // the wheels also hide things (the inside of the arches), so they take part in the depth render
    const all = body.map((b, i) => ({ wp: wps[i], idx: b.idx })).concat(wheels.map(w => { const m = w.node.getWorldMatrix(), wp = new Float32Array(w.pos.length); for (let i = 0; i < w.pos.length; i += 3) { const x = w.pos[i], y = w.pos[i + 1], z = w.pos[i + 2]; wp[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; wp[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; wp[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]; } return { wp, idx: w.idx }; }));
    const flags = (await visibleTriangles(all, { resolution: o.resolution })).slice(0, body.length);
    for (const f of flags) for (const v of f) { if (v) report.seen++; else report.hidden++; }
    progress('Reducing the car to the vertex budget…');
    const items = body.map((b, i) => ({ pos: b.pos, idx: b.idx, flags: flags[i] }));
    const r = fit(items, bodyTarget, { simplifier: ops.simplifier, hiddenKeep: o.hiddenKeep, lockBorder: false });
    if (r.changed) install(doc, body.map((b, i) => ({ prim: b.prim, out: r.outputs[i] })));
    else report.notes.push('The car is already within its vertex budget; it was left as it is.');
  }

  // unused vertices out, 16-bit indices where they fit (same as the normal reduction path)
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4 || !prim.getIndices()) continue;
    ops.compactPrimitive(prim);
    if (ops.getPrimitiveVertexCount(prim, 'upload') <= 65534) prim.getIndices().setArray(new Uint16Array(prim.getIndices().getArray()));
  }
  report.after = vertexReport(doc);
  if (report.after.total > o.maxVerts) report.warnings.push(`The car still has ${report.after.total.toLocaleString('en-GB')} vertices, over the ${o.maxVerts.toLocaleString('en-GB')} the game wants. Lower the total in the Racer panel.`);
  for (const w of report.after.wheels) if (w.verts > o.wheelVerts * 1.25) report.warnings.push(`${w.name} has ${w.verts.toLocaleString('en-GB')} vertices (aim ${o.wheelVerts.toLocaleString('en-GB')}).`);
  for (const p of pivotProblems(doc)) report.warnings.push(`${p.name}'s pivot is ${(100 * p.offset / p.size).toFixed(0)}% of the wheel's size away from its centre, so it will wobble when it spins.`);
  return report;
}

export function describeGeometry(rep, bytes = 0) {
  if (!rep) return [];
  const f = n => n.toLocaleString('en-GB'), a = rep.after, b = rep.before;
  const lines = [`Vertices: ${f(a.total)} (was ${f(b.total)}) · wheels ${a.wheels.length ? a.wheels.map(w => f(w.verts)).join(' / ') : 'none found'} · body ${f(a.body)}`];
  if (rep.seen || rep.hidden) lines.push(`Seen from outside: ${f(rep.seen)} triangles kept at full detail, ${f(rep.hidden)} (underside and inside) simplified hard`);
  if (bytes) lines.push(`File: ${(bytes / 1048576).toFixed(2)} MB`);
  return lines;
}
