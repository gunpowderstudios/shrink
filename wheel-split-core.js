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
function fitAxle(Q, n, sx, L, ymin, W, rfix) {
  const cand = [];
  for (let i = 0; i < n; i++) { const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2]; if (x * sx > 0 && y < ymin + 0.25 * L && Math.abs(z) > 0.6 * W) cand.push(i); }
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

  const fits = { '-1': fitAxle(Q, n, -1, L, ymin, W), '1': fitAxle(Q, n, 1, L, ymin, W) };
  if (!fits['-1'] || !fits['1']) return { found: false, reason: 'No wheels found (is the car sitting on its wheels?).' };
  const good = fits['-1'].score >= fits['1'].score ? -1 : 1;
  fits[-good] = fitAxle(Q, n, -good, L, ymin, W, fits[good].r) || fits[-good];
  if (fits['-1'].score < 40 || fits['1'].score < 40) return { found: false, reason: 'No clear wheel circles found in the side view.' };

  // tyre width: measured at the bottom of the tyre, where it touches the ground, so panels outside the tyre are not counted
  const zr = [];
  for (const sx of [-1, 1]) {
    const f = fits[sx], arr = [];
    for (let i = 0; i < n; i++) if (Q[i * 3 + 1] < ymin + 0.3 * f.r && Math.abs(Q[i * 3] - f.x) < f.r * 0.7) arr.push(Math.abs(Q[i * 3 + 2]));
    if (arr.length < 20) { for (let i = 0; i < n; i++) if (Math.hypot(Q[i * 3] - f.x, Q[i * 3 + 1] - f.y) < f.r * 1.05 && Math.abs(Q[i * 3 + 2]) > 0.5 * W) arr.push(Math.abs(Q[i * 3 + 2])); }
    zr.push([percentile(arr, 0.03), percentile(arr, 0.97)]);
  }
  const z0 = (zr[0][0] + zr[1][0]) / 2, z1 = (zr[0][1] + zr[1][1]) / 2;
  if (!(z1 - z0 > 0.02 * L)) return { found: false, reason: 'Could not measure the tyres.' };

  // front: the cabin (roof and glass) sits nearer the rear, so the front is on the other side of the middle of the car. The cabin's span is
  // measured on the upper part of the body (5th..95th percentile of x), which does not depend on how densely the roof is triangulated.
  const ytop = ymin + 0.7 * (maxy - ymin), xs = []; for (let i = 0; i < n; i++) if (Q[i * 3 + 1] > ytop) xs.push(Q[i * 3]);
  const cabinMid = xs.length >= 3 ? (percentile(xs, 0.05) + percentile(xs, 0.95)) / 2 : 0;
  const frontSign = cabinMid > 0 ? -1 : 1;

  // manual nudges, in tyre radii: adj.front / adj.rear move that axle forward (+) or back (-); adj.dyFront / adj.dyRear raise (+) or lower (-) that axle;
  // adj.dyW = { Wheel_FL: n, ... } raises or lowers one wheel on top of that; adj.dy (older) moves all four; adj.size scales the wheel (1 = as found)
  const axles = [-1, 1].map(sx => {
    const f = fits[sx], role = sx * frontSign > 0 ? 'front' : 'rear', size = adj.size > 0 ? adj.size : 1;
    return { sx, role, r0: f.r, x: f.x + frontSign * (adj[role] || 0) * f.r, y: f.y + ((adj.dy || 0) + ((role === 'front' ? adj.dyFront : adj.dyRear) || 0)) * f.r, r: f.r * size };
  });
  const wheels = []; let k = 0;
  for (const a of axles) for (const sz of [-1, 1]) {
    const name = `Wheel_${a.role === 'front' ? 'F' : 'R'}${sz === frontSign ? 'R' : 'L'}`, wf = (a.role === 'front' ? adj.widthFront : adj.widthRear) > 0 ? (a.role === 'front' ? adj.widthFront : adj.widthRear) : 1, cy = a.y + ((adj.dyW && adj.dyW[name]) || 0) * a.r0;
    wheels.push({ index: k++, axle: a, role: a.role, sz, name, cx: a.x, cy, centre: fromDet(a.x, cy, sz * (z0 + z1) / 2), radius: a.r, width: (z1 - z0) * wf, wf });
  }
  // a wheel takes the triangles inside its circle (side view) and inside its tyre width; wf scales the width about the tyre's middle
  const zc = (z0 + z1) / 2;
  const classify = (x, y, z) => {
    const [X, Y, Z] = toDet(x, y, z), az = Math.abs(Z);
    for (const w of wheels) {
      if (Math.sign(Z) !== w.sz || w.axle.sx * X <= 0) continue;
      if (az < zc - (zc - z0 * 0.94) * w.wf || az > zc + (z1 * 1.04 - zc) * w.wf) continue;
      if (Math.hypot(X - w.cx, Y - w.cy) < w.radius * 1.06) return w.index;
    }
    return -1;
  };
  return { found: true, axle: alongZ ? 'x' : 'z', lengthAxis: alongZ ? 'z' : 'x', wheels, classify, frontSign, length: L, info: { radius: wheels[0].radius, width: z1 - z0, alongZ } };
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
    for (let t = 0; t < nTri; t++) {
      const a = ia ? ia[t * 3] : t * 3, b = ia ? ia[t * 3 + 1] : t * 3 + 1, c = ia ? ia[t * 3 + 2] : t * 3 + 2;
      const cx = (wp[a * 3] + wp[b * 3] + wp[c * 3]) / 3, cy = (wp[a * 3 + 1] + wp[b * 3 + 1] + wp[c * 3 + 1]) / 3, cz = (wp[a * 3 + 2] + wp[b * 3 + 2] + wp[c * 3 + 2]) / 3;
      groups[1 + det.classify(cx, cy, cz)].push(a, b, c);   // classify gives -1 for body -> groups[0]
    }
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
    scene.addChild(nd); made.push({ name: w.name, role: w.role, triangles: counts[k], centre: w.centre, width: w.width });
  });
  if (made.length < 4) return { found: true, partial: true, wheels: made, bodyTriangles, axle: det.axle, lengthAxis: det.lengthAxis, radius: det.info.radius, width: det.info.width, frontSign: det.frontSign, adj: { ...adj } };
  return { found: true, wheels: made, bodyTriangles, axle: det.axle, lengthAxis: det.lengthAxis, radius: det.info.radius, width: det.info.width, frontSign: det.frontSign, adj: { ...adj } };
}
