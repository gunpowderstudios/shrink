// SHRINK 3D v2.109 — Remove part (Game mode): pick triangles with a brush, then cut them out of the glTF document. No imports and no DOM, so it runs in the page and in the tests.
//
// The selection is kept against the *document* (glTF-Transform), not the three.js preview: the preview's triangle order is changed by the BVH,
// so indices there would not match the file. prepare() copies each primitive's triangles into world space once; select() paints a sphere of that
// space; removeSelected() deletes the chosen triangles from the document and drops the vertices nothing uses any more.

// One entry per (node, triangle primitive). A mesh used by two nodes gives two entries that share the primitive; removal unions their picks.
export function prepare(doc) {
  const prims = []; let total = 0;
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return { prims, total: 0, selected: 0 };
  scene.traverse(node => {
    const mesh = node.getMesh(); if (!mesh) return;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;                      // triangles only
      const pa = prim.getAttribute('POSITION'); if (!pa) continue;
      const nv = pa.getCount(), ia = prim.getIndices(), src = ia ? ia.getArray() : null;
      const nTri = Math.floor((ia ? ia.getCount() : nv) / 3); if (!nTri) continue;
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
      prims.push({ prim, node, wp, src, nTri, cen, sel: new Uint8Array(nTri), corner });
      total += nTri;
    }
  });
  return { prims, total, selected: 0 };
}

// Select (or, with erase, unselect) every triangle whose middle lies within r of centre c. With eye = [x,y,z], only triangles that face that point.
// Returns how many triangles changed.
export function select(data, c, r, opts = {}) {
  const r2 = r * r, erase = !!opts.erase, eye = opts.eye || null, want = erase ? 0 : 1;
  let changed = 0;
  for (const p of data.prims) {
    const { cen, sel, wp, nTri } = p;
    for (let t = 0; t < nTri; t++) {
      if (sel[t] === want) continue;
      const dx = cen[t * 3] - c[0]; if (dx > r || dx < -r) continue;
      const dy = cen[t * 3 + 1] - c[1]; if (dy > r || dy < -r) continue;
      const dz = cen[t * 3 + 2] - c[2]; if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (eye && !erase) {
        const a = p.corner(t, 0), b = p.corner(t, 1), d = p.corner(t, 2);
        const ux = wp[b * 3] - wp[a * 3], uy = wp[b * 3 + 1] - wp[a * 3 + 1], uz = wp[b * 3 + 2] - wp[a * 3 + 2];
        const vx = wp[d * 3] - wp[a * 3], vy = wp[d * 3 + 1] - wp[a * 3 + 1], vz = wp[d * 3 + 2] - wp[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * (eye[0] - cen[t * 3]) + ny * (eye[1] - cen[t * 3 + 1]) + nz * (eye[2] - cen[t * 3 + 2]) <= 0) continue;
      }
      sel[t] = want; changed++;
    }
  }
  data.selected += erase ? -changed : changed;
  return changed;
}

export function clearSelection(data) { for (const p of data.prims) p.sel.fill(0); data.selected = 0; }

// World-space corners of every selected triangle (for the red highlight): Float32Array of 9 numbers per triangle.
export function selectedCorners(data) {
  const out = new Float32Array(data.selected * 9); let o = 0;
  for (const p of data.prims) for (let t = 0; t < p.nTri; t++) {
    if (!p.sel[t]) continue; if (o + 9 > out.length) return out.subarray(0, o);
    for (let k = 0; k < 3; k++) { const v = p.corner(t, k); out[o++] = p.wp[v * 3]; out[o++] = p.wp[v * 3 + 1]; out[o++] = p.wp[v * 3 + 2]; }
  }
  return out.subarray(0, o);
}

// Delete the selected triangles from the document and drop vertices nothing uses. Returns { removed, remaining }. The caller prunes the orphaned accessors.
export function removeSelected(doc, data) {
  const byPrim = new Map();     // primitive -> Uint8Array of triangles to drop (union over its nodes)
  for (const p of data.prims) {
    let m = byPrim.get(p.prim); if (!m) { m = { nTri: p.nTri, drop: new Uint8Array(p.nTri), src: p.src }; byPrim.set(p.prim, m); }
    for (let t = 0; t < p.nTri; t++) if (p.sel[t]) m.drop[t] = 1;
  }
  let removed = 0, remaining = 0;
  for (const [prim, m] of byPrim) {
    let n = 0; for (let t = 0; t < m.nTri; t++) if (m.drop[t]) n++;
    if (!n) { remaining += m.nTri; continue; }
    removed += n;
    const keep = m.nTri - n; remaining += keep;
    const mesh = prim.listParents().find(x => x.propertyType === 'Mesh');
    if (!keep) { prim.dispose(); if (mesh && !mesh.listPrimitives().length) mesh.dispose(); continue; }
    const pa = prim.getAttribute('POSITION'), nv = pa.getCount();
    const corner = (t, k) => m.src ? m.src[t * 3 + k] : t * 3 + k;
    const remap = new Int32Array(nv).fill(-1), order = [], idx = new Uint32Array(keep * 3);
    let o = 0;
    for (let t = 0; t < m.nTri; t++) {
      if (m.drop[t]) continue;
      for (let k = 0; k < 3; k++) { const v = corner(t, k); let q = remap[v]; if (q < 0) { q = order.length; remap[v] = q; order.push(v); } idx[o++] = q; }
    }
    const buffer = pa.getBuffer();
    const moreThanOne = acc => acc.listParents().filter(x => x.propertyType === 'Primitive').length > 1;
    const targets = prim.listTargets().length > 0;
    const shared = prim.listAttributes().some(moreThanOne);
    if (targets || shared) {
      // morph targets or vertex data shared with another primitive: keep every vertex, only change which triangles use them
      const raw = new Uint32Array(keep * 3); let r = 0;
      for (let t = 0; t < m.nTri; t++) { if (m.drop[t]) continue; for (let k = 0; k < 3; k++) raw[r++] = corner(t, k); }
      const ia = doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(nv < 65536 ? Uint16Array.from(raw) : raw);
      prim.setIndices(ia); continue;
    }
    for (const sem of prim.listSemantics()) {
      const acc = prim.getAttribute(sem), es = acc.getElementSize(), arr = acc.getArray(), out = new arr.constructor(order.length * es);
      for (let j = 0; j < order.length; j++) for (let q = 0; q < es; q++) out[j * es + q] = arr[order[j] * es + q];
      prim.setAttribute(sem, acc.clone().setArray(out));
    }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(order.length < 65536 ? Uint16Array.from(idx) : idx));
  }
  return { removed, remaining };
}
