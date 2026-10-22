// SHRINK 3D v2.130 — Remove / Weld back (Game mode). No imports and no DOM, so it runs in the page and in the tests.
//
// The edit is a MASK over a baseline copy of the model: every triangle of the baseline is "alive" (in the car) or "cut". prepare() copies the baseline's triangles
// into world space once; select() brushes a sphere of that space; applySelection() flips the brushed triangles (cut them, or weld them back); rewrite() then writes the
// result into a current document by rebuilding each touched primitive from the baseline's vertex data. Because the baseline is never changed, a cut part can always
// be brought back, and nothing here depends on three.js triangle indices (the BVH reorders those).
//
// Primitives are matched baseline <-> current by a path key (ordinal of the mesh-carrying node in the scene, index of the primitive in its mesh). A primitive that loses
// every triangle is kept as a single collapsed triangle flagged extras.shrinkEmpty so the path stays valid; stripEmpty() removes those from a copy that is exported.

function walk(doc, fn) {
  const scene = doc.getRoot().listScenes()[0]; if (!scene) return;
  let ni = 0;
  scene.traverse(node => { const mesh = node.getMesh(); if (!mesh) return; const k = ni++; mesh.listPrimitives().forEach((prim, pi) => fn(node, mesh, prim, k + ':' + pi)); });
}

// One entry per editable triangle primitive (triangles, with positions, no morph targets; a mesh shared by two nodes is only editable through its first node).
export function prepare(doc) {
  const prims = []; let total = 0; const seen = new Set();
  walk(doc, (node, mesh, prim, pk) => {
    if (prim.getMode() !== 4 || seen.has(prim) || prim.listTargets().length) return;
    const pa = prim.getAttribute('POSITION'); if (!pa) return;
    seen.add(prim);
    const M = node.getWorldMatrix(), nv = pa.getCount(), ia = prim.getIndices(), src = ia ? ia.getArray() : null;
    const nTri = Math.floor((ia ? ia.getCount() : nv) / 3); if (!nTri) return;
    const wp = new Float32Array(nv * 3), e = [0, 0, 0];
    for (let i = 0; i < nv; i++) {
      pa.getElement(i, e);
      wp[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
      wp[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
      wp[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
    }
    const corner = (t, k) => src ? src[t * 3 + k] : t * 3 + k;
    const cen = new Float32Array(nTri * 3);
    for (let t = 0; t < nTri; t++) {
      const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
      cen[t * 3] = (wp[a * 3] + wp[b * 3] + wp[c * 3]) / 3; cen[t * 3 + 1] = (wp[a * 3 + 1] + wp[b * 3 + 1] + wp[c * 3 + 1]) / 3; cen[t * 3 + 2] = (wp[a * 3 + 2] + wp[b * 3 + 2] + wp[c * 3 + 2]) / 3;
    }
    prims.push({ pk, node, bprim: prim, nv, wp, src, nTri, cen, sel: new Uint8Array(nTri), alive: new Uint8Array(nTri).fill(1), dirty: false, corner });
    total += nTri;
  });
  return { prims, total, selected: 0, dead: 0 };
}

// Brush a sphere of radius r around c. mode 'remove' picks alive triangles, 'weld' picks cut ones; erase unpicks. eye = [x,y,z] limits remove to faces turned towards it.
export function select(data, c, r, opts = {}) {
  const r2 = r * r, erase = !!opts.erase, eye = opts.eye || null, weld = opts.mode === 'weld';
  let changed = 0;
  for (const p of data.prims) {
    const { cen, sel, wp, nTri, alive } = p;
    for (let t = 0; t < nTri; t++) {
      if (erase ? sel[t] !== 1 : (sel[t] === 1 || alive[t] === (weld ? 1 : 0))) continue;
      const dx = cen[t * 3] - c[0]; if (dx > r || dx < -r) continue;
      const dy = cen[t * 3 + 1] - c[1]; if (dy > r || dy < -r) continue;
      const dz = cen[t * 3 + 2] - c[2]; if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (eye && !erase && !weld) {
        const a = p.corner(t, 0), b = p.corner(t, 1), d = p.corner(t, 2);
        const ux = wp[b * 3] - wp[a * 3], uy = wp[b * 3 + 1] - wp[a * 3 + 1], uz = wp[b * 3 + 2] - wp[a * 3 + 2];
        const vx = wp[d * 3] - wp[a * 3], vy = wp[d * 3 + 1] - wp[a * 3 + 1], vz = wp[d * 3 + 2] - wp[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * (eye[0] - cen[t * 3]) + ny * (eye[1] - cen[t * 3 + 1]) + nz * (eye[2] - cen[t * 3 + 2]) <= 0) continue;
      }
      sel[t] = erase ? 0 : 1; changed++;
    }
  }
  data.selected += erase ? -changed : changed;
  return changed;
}
// Pick every triangle that is currently in the car (mode 'remove') or every cut one (mode 'weld').
export function selectAll(data, mode) {
  let n = 0; const want = mode === 'weld' ? 0 : 1;
  for (const p of data.prims) for (let t = 0; t < p.nTri; t++) if (p.alive[t] === want && !p.sel[t]) { p.sel[t] = 1; n++; }
  data.selected += n; return n;
}
export function clearSelection(data) { for (const p of data.prims) p.sel.fill(0); data.selected = 0; }

// Flip the picked triangles: cut them (mode 'remove') or weld them back ('weld'). Clears the picks. Returns how many changed.
export function applySelection(data, mode) {
  let n = 0; const to = mode === 'weld' ? 1 : 0;
  for (const p of data.prims) {
    let hit = false;
    for (let t = 0; t < p.nTri; t++) if (p.sel[t]) { if (p.alive[t] !== to) { p.alive[t] = to; n++; hit = true; } p.sel[t] = 0; }
    if (hit) p.dirty = true;
  }
  data.selected = 0; data.dead = countDead(data); return n;
}
export function countDead(data) { let d = 0; for (const p of data.prims) for (let t = 0; t < p.nTri; t++) if (!p.alive[t]) d++; return d; }
export function aliveTotal(data) { return data.total - countDead(data); }

// World-space corners (9 numbers per triangle) of the picked triangles, or of every cut triangle (the blue ghost shown while welding).
export function selectedCorners(data) { return corners(data, p => p.sel, 1); }
export function deadCorners(data) { return corners(data, p => p.alive, 0); }
function corners(data, field, want) {
  let n = 0; for (const p of data.prims) { const f = field(p); for (let t = 0; t < p.nTri; t++) if (f[t] === want) n++; }
  const out = new Float32Array(n * 9); let o = 0;
  for (const p of data.prims) { const f = field(p); for (let t = 0; t < p.nTri; t++) {
    if (f[t] !== want) continue;
    for (let k = 0; k < 3; k++) { const v = p.corner(t, k); out[o++] = p.wp[v * 3]; out[o++] = p.wp[v * 3 + 1]; out[o++] = p.wp[v * 3 + 2]; }
  } }
  return out;
}

// Undo support: copy the alive masks, and put a copy back (the bytes for that state are kept by the caller).
export function snapshotMasks(data) { return data.prims.map(p => p.alive.slice()); }
export function restoreMasks(data, snap) { data.prims.forEach((p, i) => { if (snap[i]) p.alive = snap[i].slice(); p.dirty = false; p.sel.fill(0); }); data.selected = 0; data.dead = countDead(data); }

// Write the baseline's alive triangles into the matching primitives of `doc` (a current document). Touches only primitives changed since the last rewrite.
// The caller prunes the orphaned accessors afterwards. Returns how many primitives were rebuilt.
export function rewrite(doc, data) {
  const cur = new Map(); walk(doc, (node, mesh, prim, pk) => cur.set(pk, prim));
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  let done = 0;
  for (const p of data.prims) {
    if (!p.dirty) continue; p.dirty = false;
    const prim = cur.get(p.pk); if (!prim) continue;
    const bp = p.bprim, remap = new Int32Array(p.nv).fill(-1), order = [], idx = [];
    for (let t = 0; t < p.nTri; t++) {
      if (!p.alive[t]) continue;
      for (let k = 0; k < 3; k++) { const v = p.corner(t, k); let q = remap[v]; if (q < 0) { q = order.length; remap[v] = q; order.push(v); } idx.push(q); }
    }
    const empty = !idx.length;
    if (empty) { order.push(0); idx.push(0, 0, 0); }                  // a single collapsed triangle keeps the primitive (and its path) alive
    for (const sem of bp.listSemantics()) {
      const src = bp.getAttribute(sem), es = src.getElementSize(), arr = src.getArray(), out = new arr.constructor(order.length * es);
      for (let j = 0; j < order.length; j++) for (let q = 0; q < es; q++) out[j * es + q] = arr[order[j] * es + q];
      prim.setAttribute(sem, doc.createAccessor().setType(src.getType()).setNormalized(src.getNormalized()).setBuffer(buffer).setArray(out));
    }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(order.length < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx)));
    const ex = { ...(prim.getExtras() || {}) }; if (empty) ex.shrinkEmpty = true; else delete ex.shrinkEmpty; prim.setExtras(ex);
    done++;
  }
  return done;
}

// Drop the collapsed placeholder primitives (and any mesh left empty). Run on a document that is about to be exported, never on the working copy.
export function stripEmpty(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) if (prim.getExtras()?.shrinkEmpty) { prim.dispose(); n++; }
    if (!mesh.listPrimitives().length) mesh.dispose();
  }
  return n;
}
