// SHRINK 3D v2.90 — Wheel splitter (Game mode). No imports and no DOM, so it runs in the page and in the tests.
//
// A car model (a Meshy download, say) is one lump of triangles. This finds the four wheels and cuts them out as their own parts
// (nodes named Wheel_FL / FR / RL / RR), each with its origin at the wheel's centre, so a game can spin and steer them. Everything else
// about the model is untouched: the same material, textures, metal and roughness maps, normals and UVs go with every triangle.
//
// Wheel finder: the wheels are circles in the side view. Per axle, the circle that most of the low, outer vertices lie on is the wheel;
// both axles share one tyre size. The tyre's width is measured where the tyre touches the ground, so a body panel or spat that
// sits outside the tyre stays with the body. The car is expected to sit on its wheels, Y up, its length along X or Z.

const percentile = (arr, q) => { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

// Best circle in the side view for one end of the car (ring density minus what lies just outside it). rfix shares a radius with the other axle.
// ground: only circles that stand on the ground (the lowest point of the tyre near the bottom of the model) are tried. A tyre has far fewer vertices than the
// body above it, so without this a big circle along the wheel arch and door can out-score the real, small tyre (a motorhome did exactly that).
// opts { x0, x1, rmin, rmax }: search signed axle positions x0..x1 over the whole length (a one-axle trailer), instead of one end of the car.
function fitAxle(Q, n, sx, L, ymin, W, rfix, centre, ground, opts) {
  const cand = [];   // centre: a single wheel on the middle line (three-wheelers); otherwise the outer pair
  for (let i = 0; i < n; i++) { const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2]; if ((opts || x * sx > 0) && y < ymin + 0.25 * L && (centre ? Math.abs(z) < 0.35 * W : Math.abs(z) > 0.6 * W)) cand.push(i); }
  const step = Math.max(1, Math.ceil(cand.length / 3000)), xs = [], ys = [];
  for (let t = 0; t < cand.length; t += step) { xs.push(Q[cand[t] * 3]); ys.push(Q[cand[t] * 3 + 1]); }
  let best = null; const m = xs.length;
  for (let cx = opts ? opts.x0 : 0.10 * L; cx <= (opts ? opts.x1 : 0.45 * L); cx += 0.005 * L) {
    const X = opts ? cx : cx * sx;
    for (let cy = ymin + 0.05 * L; cy <= ymin + 0.22 * L; cy += 0.005 * L) {
      let rs = rfix ? [rfix] : []; if (!rfix) for (let r = opts ? opts.rmin : 0.05 * L; r <= (opts ? opts.rmax : 0.13 * L); r += 0.0025 * L) rs.push(r);
      if (ground) rs = rs.filter(r => cy - r >= ymin - 0.02 * L && cy - r <= ymin + 0.035 * L);
      if (!rs.length) continue;
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

// Tyre width where the tyre touches the ground; arr is |z| for a pair, signed z for a single wheel.
function groundZ(Q, n, f, ymin, W, centre) {
  const arr = [];
  const ok = z => centre ? Math.abs(z) < 0.35 * W : true;
  for (let i = 0; i < n; i++) if (Q[i * 3 + 1] < ymin + 0.3 * f.r && Math.abs(Q[i * 3] - f.x) < f.r * 0.7 && ok(Q[i * 3 + 2])) arr.push(centre ? Q[i * 3 + 2] : Math.abs(Q[i * 3 + 2]));
  if (arr.length < 20) { arr.length = 0; for (let i = 0; i < n; i++) if (Math.hypot(Q[i * 3] - f.x, Q[i * 3 + 1] - f.y) < f.r * 1.05 && (centre ? Math.abs(Q[i * 3 + 2]) < 0.35 * W : Math.abs(Q[i * 3 + 2]) > 0.5 * W)) arr.push(centre ? Q[i * 3 + 2] : Math.abs(Q[i * 3 + 2])); }
  return [percentile(arr, 0.03), percentile(arr, 0.97)];
}

// Two axles, a wheel at each side of each (an ordinary car).
function twoAxles(Q, n, L, W, ymin, ground) {
  const fits = { '-1': fitAxle(Q, n, -1, L, ymin, W, undefined, false, ground), '1': fitAxle(Q, n, 1, L, ymin, W, undefined, false, ground) };
  if (!fits['-1'] || !fits['1']) return null;
  const good = fits['-1'].score >= fits['1'].score ? -1 : 1;
  fits[-good] = fitAxle(Q, n, -good, L, ymin, W, fits[good].r, false, ground) || fits[-good];
  return fits;
}
function layout4(Q, n, L, W, ymin, maxy) {
  let fits = twoAxles(Q, n, L, W, ymin, true);
  if (!fits || fits['-1'].score < 40 || fits['1'].score < 40) fits = twoAxles(Q, n, L, W, ymin, false);     // not standing on its wheels: search every height
  if (!fits) return { found: false, reason: 'No wheels found (is the car sitting on its wheels?).' };
  if (fits['-1'].score < 40 || fits['1'].score < 40) return { found: false, reason: 'No clear wheel circles found in the side view.' };
  const zr = [-1, 1].map(sx => groundZ(Q, n, fits[sx], ymin, W, false));
  const z0 = (zr[0][0] + zr[1][0]) / 2, z1 = (zr[0][1] + zr[1][1]) / 2;
  if (!(z1 - z0 > 0.02 * L)) return { found: false, reason: 'Could not measure the tyres.' };
  // front: the cabin (roof and glass) sits nearer the rear, so the front is on the other side of the middle of the car. The cabin's span is
  // measured on the upper part of the body (5th..95th percentile of x), which does not depend on how densely the roof is triangulated.
  const ytop = ymin + 0.7 * (maxy - ymin), xs = []; for (let i = 0; i < n; i++) if (Q[i * 3 + 1] > ytop) xs.push(Q[i * 3]);
  const cabinMid = xs.length >= 3 ? (percentile(xs, 0.05) + percentile(xs, 0.95)) / 2 : 0;
  const zc = (z0 + z1) / 2, tyreW = z1 - z0;
  const tyres = [-1, 1].map(sx => ({ sx, f: fits[sx], single: false, zc, lo: zc - z0 * 0.94, hi: z1 * 1.04 - zc, tyreW }));
  return { found: true, layout: '4', frontSign: cabinMid > 0 ? -1 : 1, tyres };
}

// Two wheels: a single axle (a caravan or trailer). The axle may sit anywhere along the length; there is no front or back, so the wheels are Wheel_L / Wheel_R.
function layout2(Q, n, L, W, ymin) {
  const opts = { x0: -0.35 * L, x1: 0.35 * L, rmin: 0.03 * L, rmax: 0.13 * L };
  let f = fitAxle(Q, n, 1, L, ymin, W, undefined, false, true, opts);
  if (!f || f.score < 40) f = fitAxle(Q, n, 1, L, ymin, W, undefined, false, false, opts);
  if (!f || f.score < 40) return { found: false, reason: 'No clear wheel circles found for a one-axle layout (a caravan or trailer).' };
  const [z0, z1] = groundZ(Q, n, f, ymin, W, false);
  if (!(z1 - z0 > 0.01 * L)) return { found: false, reason: 'Could not measure the tyres.' };
  const zc = (z0 + z1) / 2;
  return { found: true, layout: '2', frontSign: 1, tyres: [{ sx: 1, anyX: true, f, single: false, zc, lo: zc - z0 * 0.94, hi: z1 * 1.04 - zc, tyreW: z1 - z0 }] };
}

// Three wheels: one on the middle line at the front, a pair at the back (a Reliant-style three-wheeler).
function layout3(Q, n, L, W, ymin) {
  let best = null;
  for (const s of [-1, 1]) {
    const single = fitAxle(Q, n, s, L, ymin, W, undefined, true), pair = fitAxle(Q, n, -s, L, ymin, W);
    if (!single || !pair) continue;
    // a wheel stands on the ground: its lowest point must be near the bottom of the car, or it is a lump on the underside
    if (single.y - single.r - ymin > 0.35 * single.r || pair.y - pair.r - ymin > 0.35 * pair.r) continue;
    const score = single.score + pair.score; if (!best || score > best.score) best = { s, single, pair, score };
  }
  if (!best || best.single.score < 40 || best.pair.score < 40) return { found: false, reason: 'No clear wheels found for a three-wheel layout (one at the front, two at the back).' };
  const [pz0, pz1] = groundZ(Q, n, best.pair, ymin, W, false), [sz0, sz1] = groundZ(Q, n, best.single, ymin, W, true);
  if (!(pz1 - pz0 > 0.02 * L) || !(sz1 - sz0 > 0.02 * L)) return { found: false, reason: 'Could not measure the tyres.' };
  const pzc = (pz0 + pz1) / 2, szm = (sz0 + sz1) / 2, sHalf = (sz1 - sz0) / 2;
  return { found: true, layout: '3', frontSign: best.s, tyres: [
    { sx: best.s, f: best.single, single: true, zmid: szm, lo: sHalf * 1.1, hi: sHalf * 1.1, tyreW: sz1 - sz0 },
    { sx: -best.s, f: best.pair, single: false, zc: pzc, lo: pzc - pz0 * 0.94, hi: pz1 * 1.04 - pzc, tyreW: pz1 - pz0 } ] };
}

// P: Float32Array of world-space x,y,z. Returns { found, reason?, ... }. When found: wheels[] (name, centre[3] in world space, radius, width, index),
// axle ('z' when the car's length is along X, 'x' when along Z) and classify(x, y, z) -> wheel index or -1 for a WORLD-space point.
export function detectWheels(P, adj = {}) {
  const n = P.length / 3;
  if (n < 100) return { found: false, reason: 'The model is too small to hold a car.' };
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const alongZ = (maxz - minz) > (maxx - minx) * 1.2, ox = (minx + maxx) / 2, oz = (minz + maxz) / 2;
  // detection frame: length along X, Y up, width along Z, centred. A car that is long in Z is turned a quarter turn: (x,y,z) -> (z, y, -x).
  const toDet = (x, y, z) => alongZ ? [z - oz, y, -(x - ox)] : [x - ox, y, z - oz];
  const fromDet = (X, Y, Z) => alongZ ? [-Z + ox, Y, X + oz] : [X + ox, Y, Z + oz];
  const Q = new Float32Array(P.length);
  for (let i = 0; i < n; i++) { const d = toDet(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); Q[i * 3] = d[0]; Q[i * 3 + 1] = d[1]; Q[i * 3 + 2] = d[2]; }
  const L = alongZ ? maxz - minz : maxx - minx, W = (alongZ ? maxx - minx : maxz - minz) / 2, ymin = miny;
  if (!(L > 0) || !(W > 0)) return { found: false, reason: 'The model is flat.' };

  const three = adj.layout === '3' || adj.layout === 3;
  let spec = three ? layout3(Q, n, L, W, ymin) : (adj.layout === '2' || adj.layout === 2) ? layout2(Q, n, L, W, ymin) : layout4(Q, n, L, W, ymin, maxy);
  if (!spec.found && (adj.layout === 'auto')) { const t = layout3(Q, n, L, W, ymin); if (t.found) spec = t; else { const t2 = layout2(Q, n, L, W, ymin); if (t2.found) spec = t2; } }
  if (!spec.found) return spec;
  const { frontSign, tyres } = spec;   // tyres: [{ sx, f:{x,y,r}, single, zmid?, lo, hi, zc? }]

  // manual nudges, in tyre radii: adj.front / adj.rear move that axle forward (+) or back (-); adj.dyFront / adj.dyRear raise (+) or lower (-) that axle;
  // adj.dyW = { Wheel_FL: n, ... } raises or lowers one wheel on top of that; adj.dy (older) moves all; adj.sizeFront / adj.sizeRear scale that axle's wheels (adj.size, older, scales all; 1 = as found)
  const sizeOf = role => (adj.size > 0 ? adj.size : 1) * ((role === 'front' ? adj.sizeFront : adj.sizeRear) > 0 ? (role === 'front' ? adj.sizeFront : adj.sizeRear) : 1);
  const axles = tyres.map(t => {
    const role = t.sx * frontSign > 0 ? 'front' : 'rear';
    return { sx: t.sx, role, single: !!t.single, t, r0: t.f.r, x: t.f.x + frontSign * (adj[role] || 0) * t.f.r, y: t.f.y + ((adj.dy || 0) + ((role === 'front' ? adj.dyFront : adj.dyRear) || 0)) * t.f.r, r: t.f.r * sizeOf(role) };
  });
  const wheels = []; let k = 0;
  for (const a of axles) for (const sz of (a.single ? [0] : [-1, 1])) {
    const name = spec.layout === '2' ? `Wheel_${sz === frontSign ? 'R' : 'L'}` : a.single ? 'Wheel_F' : `Wheel_${a.role === 'front' ? 'F' : 'R'}${sz === frontSign ? 'R' : 'L'}`;
    const wk = a.role === 'front' ? adj.widthFront : adj.widthRear, wf = wk > 0 ? wk : 1, cy = a.y + ((adj.dyW && adj.dyW[name]) || 0) * a.r0;
    // sideways: adj.shiftFront / adj.shiftRear move the axle's wheels to the car's right (+) or left (-); adj.trackFront / adj.trackRear move that axle's pair outward (+) or inward (-) (the axle's width); adj.track (older) moves both; tyre radii
    const shift = frontSign * ((a.role === 'front' ? adj.shiftFront : adj.shiftRear) || 0) * a.r0 + sz * (((a.role === 'front' ? adj.trackFront : adj.trackRear) || 0) + (adj.track || 0)) * a.r0;
    const zmid = (a.single ? a.t.zmid : sz * a.t.zc) + shift;
    wheels.push({ index: k++, axle: a, role: a.role, sz: a.single ? 1 : sz, single: a.single, name, cx: a.x, cy, zmid, centre: fromDet(a.x, cy, zmid), radius: a.r, width: a.t.tyreW * wf, wf, lo: a.t.lo, hi: a.t.hi });
  }
  // a wheel takes the triangles inside its circle (side view) and inside its tyre width; wf scales the width about the tyre's middle
  const classify = (x, y, z) => {
    const [X, Y, Z] = toDet(x, y, z);
    for (const w of wheels) {
      if (!w.axle.t.anyX && w.axle.sx * X <= 0) continue;
      const t = w.sz * (Z - w.zmid);   // distance from the tyre's middle, positive towards the outside of the car
      if (t < -w.lo * w.wf || t > w.hi * w.wf) continue;
      if (Math.hypot(X - w.cx, Y - w.cy) < w.radius * 1.06) return w.index;
    }
    return -1;
  };
  return { found: true, axle: alongZ ? 'x' : 'z', lengthAxis: alongZ ? 'z' : 'x', wheels, classify, frontSign, length: L, layout: spec.layout, info: { radius: wheels[0].radius, width: wheels[0].width / (wheels[0].wf || 1), alongZ } };
}

/* ---------- glTF-Transform document surgery ---------- */
function transformPoint(W, x, y, z) { return [W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]]; }
function normalMatrix(W) {   // inverse transpose of the upper 3x3, row-major [a b c; d e f; g h i] as 9 numbers
  const a = W[0], b = W[4], c = W[8], d = W[1], e = W[5], f = W[9], g = W[2], h = W[6], i = W[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1;
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}

// World-space positions of every triangle-mesh vertex in the document, plus how to find them again.
export function collectWorldPositions(doc) {
  const parts = []; let total = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); if (!pos) continue;
      parts.push({ node, prim, pos, W }); total += pos.getCount();
    }
  }
  const P = new Float32Array(total * 3); let o = 0; const v = [0, 0, 0];
  for (const p of parts) for (let i = 0; i < p.pos.getCount(); i++) { p.pos.getElement(i, v); const w = transformPoint(p.W, v[0], v[1], v[2]); P[o++] = w[0]; P[o++] = w[1]; P[o++] = w[2]; }
  return { P, parts };
}

// Cut the wheels out of the document: new nodes Wheel_xx at the scene root, each wheel's triangles moved out of the body primitives.
// Returns { found, reason?, wheels: [{name, triangles, centre}], bodyTriangles }.
export function splitWheels(doc, adj = {}) {
  const { P, parts } = collectWorldPositions(doc);
  const det = detectWheels(P, adj);
  if (!det.found) return { found: false, reason: det.reason };
  const root = doc.getRoot(), buffer = root.listBuffers()[0] || doc.createBuffer(), scene = root.listScenes()[0];
  if (!scene) return { found: false, reason: 'The file has no scene.' };
  const perWheel = det.wheels.map(() => []), counts = det.wheels.map(() => 0);
  let bodyTriangles = 0; const v = [0, 0, 0];
  const seenMesh = new Map();
  for (const p of parts) {
    const { node, prim, pos, W } = p;
    if (prim.getMode() !== 4 || prim.listTargets().length) continue;                 // plain triangle lists only
    if (seenMesh.has(prim)) continue; seenMesh.set(prim, 1);
    const sharedBy = root.listNodes().filter(nd => nd.getMesh() === node.getMesh()).length; if (sharedBy > 1) continue;   // a mesh used twice cannot be split per use
    const idxAcc = prim.getIndices(), ia = idxAcc ? idxAcc.getArray() : null, nTri = ia ? ia.length / 3 : pos.getCount() / 3;
    const W3 = normalMatrix(W), wp = new Float32Array(pos.getCount() * 3);
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const w = transformPoint(W, v[0], v[1], v[2]); wp[i * 3] = w[0]; wp[i * 3 + 1] = w[1]; wp[i * 3 + 2] = w[2]; }
    const groups = [[]].concat(det.wheels.map(() => []));   // groups[0] = body, groups[1+k] = wheel k
    const cls = new Int32Array(nTri), corner = (t, q) => ia ? ia[t * 3 + q] : t * 3 + q;
    for (let t = 0; t < nTri; t++) {
      const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
      const cx = (wp[a * 3] + wp[b * 3] + wp[c * 3]) / 3, cy = (wp[a * 3 + 1] + wp[b * 3 + 1] + wp[c * 3 + 1]) / 3, cz = (wp[a * 3 + 2] + wp[b * 3 + 2] + wp[c * 3 + 2]) / 3;
      cls[t] = det.classify(cx, cy, cz);   // -1 = body
    }
    // Whole shells: a connected piece of the mesh (a tyre, a hub, the inner tyre of a twin pair) that lies mostly inside one wheel's zone belongs to that wheel
    // completely. Cutting it at the zone's edge left half a tyre stuck to the body, which showed as stray texture pieces next to the spinning wheel.
    // Pieces welded to the body (their own vertices are shared with it) are one big component that is never mostly inside a wheel, so they are still cut per triangle.
    if (nTri <= 800000 && pos.getCount() <= 800000) {
      const cell = Math.max(det.length * 2e-4, 1e-9), wid = new Map(), rep = new Int32Array(pos.getCount());
      for (let i = 0; i < pos.getCount(); i++) { const k = Math.round(wp[i * 3] / cell) + ',' + Math.round(wp[i * 3 + 1] / cell) + ',' + Math.round(wp[i * 3 + 2] / cell); let id = wid.get(k); if (id === undefined) { id = wid.size; wid.set(k, id); } rep[i] = id; }
      const par = new Int32Array(wid.size); for (let i = 0; i < par.length; i++) par[i] = i;
      const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let t = 0; t < nTri; t++) { const ra = find(rep[corner(t, 0)]), rb = find(rep[corner(t, 1)]), rc = find(rep[corner(t, 2)]); par[rb] = ra; par[find(rc)] = find(ra); }
      const nW = det.wheels.length, tally = new Map();
      for (let t = 0; t < nTri; t++) { const r = find(rep[corner(t, 0)]); let e = tally.get(r); if (!e) { e = new Int32Array(nW + 1); tally.set(r, e); } e[0]++; if (cls[t] >= 0) e[1 + cls[t]]++; }
      const owner = new Map();
      for (const [r, e] of tally) { if (e[0] < 12) continue; let best = -1, bn = 0; for (let k = 0; k < nW; k++) if (e[1 + k] > bn) { bn = e[1 + k]; best = k; } if (best >= 0 && bn >= 0.5 * e[0] && det.wheels[best].wf === 1) owner.set(r, best); }   // a hand-set tyre width (adj.widthFront / widthRear) keeps the plain cut
      if (owner.size) for (let t = 0; t < nTri; t++) { const o = owner.get(find(rep[corner(t, 0)])); if (o !== undefined) cls[t] = o; }
    }
    for (let t = 0; t < nTri; t++) groups[1 + cls[t]].push(corner(t, 0), corner(t, 1), corner(t, 2));
    const semantics = prim.listSemantics();
    // build a primitive's worth of accessors from a list of triangle corners, optionally moving the geometry
    const subset = (corners, wheel) => {
      const remap = new Map(), order = []; const idx = new Uint32Array(corners.length);
      for (let q = 0; q < corners.length; q++) { let k = remap.get(corners[q]); if (k === undefined) { k = order.length; remap.set(corners[q], k); order.push(corners[q]); } idx[q] = k; }
      const out = { idx: order.length < 65536 ? Uint16Array.from(idx) : idx, attrs: {} };
      for (const sem of semantics) {
        const src = prim.getAttribute(sem), es = src.getElementSize(), isGeo = wheel && (sem === 'POSITION' || sem === 'NORMAL' || sem === 'TANGENT');
        const arr = isGeo ? new Float32Array(order.length * es) : new (src.getArray().constructor)(order.length * es), e = new Array(es).fill(0);
        for (let j = 0; j < order.length; j++) {
          if (!isGeo) { const sa = src.getArray(); for (let q = 0; q < es; q++) arr[j * es + q] = sa[order[j] * es + q]; continue; }
          src.getElement(order[j], e);
          if (sem === 'POSITION') { const w = [wp[order[j] * 3] - wheel.centre[0], wp[order[j] * 3 + 1] - wheel.centre[1], wp[order[j] * 3 + 2] - wheel.centre[2]]; arr[j * 3] = w[0]; arr[j * 3 + 1] = w[1]; arr[j * 3 + 2] = w[2]; }
          else {   // NORMAL / TANGENT turn with the node (inverse transpose for normals), then are made unit length again
            const m = sem === 'NORMAL' ? W3 : [W[0], W[4], W[8], W[1], W[5], W[9], W[2], W[6], W[10]];
            let x = m[0] * e[0] + m[1] * e[1] + m[2] * e[2], y = m[3] * e[0] + m[4] * e[1] + m[5] * e[2], z = m[6] * e[0] + m[7] * e[1] + m[8] * e[2]; const l = Math.hypot(x, y, z) || 1;
            arr[j * es] = x / l; arr[j * es + 1] = y / l; arr[j * es + 2] = z / l; if (es === 4) arr[j * es + 3] = e[3];
          }
        }
        out.attrs[sem] = { arr, src, isGeo };
      }
      return out;
    };
    const mk = (s, name) => {
      const acc = (arr, type, src, norm) => { const a = doc.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer); if (norm) a.setNormalized(true); return a; };
      const out = { attrs: {}, idx: acc(s.idx, 'SCALAR') };
      for (const sem of semantics) { const q = s.attrs[sem]; out.attrs[sem] = acc(q.arr, q.src.getType(), q.src, q.isGeo ? false : q.src.getNormalized()); }
      return out;
    };
    for (let g = 0; g < groups.length; g++) {
      if (!groups[g].length) continue;
      if (g === 0) continue;   // body is rebuilt below
      const w = det.wheels[g - 1], built = mk(subset(groups[g], w), w.name), wp2 = doc.createPrimitive();
      for (const sem of semantics) wp2.setAttribute(sem, built.attrs[sem]);
      wp2.setIndices(built.idx).setMaterial(prim.getMaterial());
      perWheel[g - 1].push(wp2); counts[g - 1] += groups[g].length / 3;
    }
    if (groups.slice(1).some(g => g.length)) {   // some triangles left: swap the body primitive's data for the body-only subset
      const built = mk(subset(groups[0].length ? groups[0] : [0, 0, 0], null), 'body');
      for (const sem of semantics) prim.setAttribute(sem, built.attrs[sem]);
      prim.setIndices(built.idx); bodyTriangles += groups[0].length / 3;
    } else bodyTriangles += nTri;
  }
  const made = [];
  det.wheels.forEach((w, k) => {
    if (!perWheel[k].length) return;
    const mesh = doc.createMesh(w.name); for (const pr of perWheel[k]) mesh.addPrimitive(pr);
    const nd = doc.createNode(w.name).setTranslation(w.centre).setMesh(mesh).setExtras({ wheel: true, axle: det.axle, radius: w.radius, width: w.width });
    scene.addChild(nd); made.push({ name: w.name, role: w.role, sz: w.sz, single: w.single, triangles: counts[k], centre: w.centre, width: w.width, radius: w.radius });
  });
  if (made.length < det.wheels.length) return { found: true, partial: true, wheels: made, bodyTriangles, axle: det.axle, lengthAxis: det.lengthAxis, radius: det.info.radius, width: det.info.width, frontSign: det.frontSign, adj: { ...adj } };
  return { found: true, wheels: made, bodyTriangles, axle: det.axle, lengthAxis: det.lengthAxis, radius: det.info.radius, width: det.info.width, frontSign: det.frontSign, adj: { ...adj } };
}
