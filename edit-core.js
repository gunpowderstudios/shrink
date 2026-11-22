// edit-core.js — shape join/cut and plane slicing on a Manifold solid (v2.307). No DOM, no three.js.
// All coordinates are world units. A "matrix" is a 16-number column-major array (three.js Matrix4.elements).

/** A unit primitive centred on the origin: cube 1x1x1, ball diameter 1, cylinder/cone diameter 1 and height 1 along Y (cone point up). */
export function primitive(M, kind) {
  switch (kind) {
    case 'cube': return M.cube([1, 1, 1], true);
    case 'ball': return M.sphere(0.5, 48);
    case 'cylinder': return M.cylinder(1, 0.5, 0.5, 48, true).rotate([-90, 0, 0]);
    case 'cone': return M.cylinder(1, 0.5, 0, 48, true).rotate([-90, 0, 0]);
    default: throw new Error('Unknown shape: ' + kind);
  }
}

/** shapes: [{ kind, mode: 'join' | 'cut', matrix }]. Returns a NEW solid; the input solid is left alone (caller deletes it). */
export function applyShapes(M, solid, shapes) {
  let cur = solid, owned = false;
  for (const s of shapes) {
    const prim = primitive(M, s.kind).transform(s.matrix);
    const next = s.mode === 'cut' ? cur.subtract(prim) : cur.add(prim);
    try { prim.delete?.(); } catch {}
    if (owned) { try { cur.delete?.(); } catch {} }
    cur = next; owned = true;
  }
  if (!owned) throw new Error('Nothing to apply.');
  if (cur.isEmpty()) { try { cur.delete?.(); } catch {} throw new Error('That would remove the whole model.'); }
  return cur;
}

/** Keep the part of the solid where n·x >= offset (the cut face is closed automatically). n need not be unit length. */
export function sliceSolid(M, solid, n, offset) {
  const len = Math.hypot(n[0], n[1], n[2]) || 1, nn = [n[0] / len, n[1] / len, n[2] / len];
  const kept = solid.trimByPlane(nn, offset / len);
  if (kept.isEmpty()) { try { kept.delete?.(); } catch {} throw new Error('That cut would remove the whole model.'); }
  return kept;
}

/** Join (add) or cut (subtract) a whole second solid, e.g. a new head. Returns a NEW solid. */
export function applySolid(M, solid, other, mode) {
  const r = mode === 'cut' ? solid.subtract(other) : solid.add(other);
  if (r.isEmpty()) { try { r.delete?.(); } catch {} throw new Error('That would remove the whole model.'); }
  return r;
}

/**
 * v2.313 lasso: a prism (a sideways pyramid for a perspective camera) from a screen outline.
 * pts = [[ndcX, ndcY], ...] (-1..1, +y up). cam = { world: 16-number camera matrixWorld, persp, tanY, aspect } or
 * { world, persp:false, halfW, halfH }. near/far = distances from the camera along its view direction.
 */
export function lassoPrism(M, CS, pts, cam, near, far) {
  if (!pts || pts.length < 3) throw new Error('Draw a loop with the lasso first.');
  if (!(far > near)) throw new Error('The lasso has no depth to cut.');
  const d0 = cam.persp ? Math.max(1e-6, near) : 1;
  const sx = cam.persp ? d0 * cam.tanY * cam.aspect : cam.halfW, sy = cam.persp ? d0 * cam.tanY : cam.halfH;
  let poly = pts.map(([x, y]) => [-x * sx, y * sy]);     // x is mirrored because the prism is turned 180° about Y below
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.reverse();
  const cs = new CS([poly], 'NonZero');
  if (cs.isEmpty()) { try { cs.delete?.(); } catch {} throw new Error('That loop is too small. Draw a bigger one.'); }
  const top = cam.persp ? far / d0 : 1;
  let prism = M.extrude(cs, far - near, 0, 0, [top, top]);
  try { cs.delete?.(); } catch {}
  const step = (m) => { const n = m(prism); try { prism.delete?.(); } catch {} prism = n; };
  step(p => p.translate([0, 0, cam.persp ? near : near]));
  step(p => p.rotate([0, 180, 0]));
  step(p => p.transform(cam.world));
  return prism;
}

/** op: 'delete' (remove what is inside the prism), 'copy' (keep the model, return the piece), 'cut' (take the piece out and return it, or drop it when keep is false). Returns { piece, rest } (either may be null). The hole is always capped flat. */
export function lassoRegion(M, solid, prism, op) {
  const piece = (op === 'copy' || op === 'cut') ? solid.intersect(prism) : null;
  if (piece && piece.isEmpty()) { try { piece.delete?.(); } catch {} throw new Error('The loop did not catch any of the model. Draw it around the part you want.'); }
  let rest = null;
  if (op !== 'copy') {
    rest = solid.subtract(prism);
    if (rest.isEmpty()) { try { rest.delete?.(); piece?.delete?.(); } catch {} throw new Error('That would remove the whole model.'); }
    if (rest.volume() > solid.volume() * 0.999999) { try { rest.delete?.(); piece?.delete?.(); } catch {} throw new Error('The loop did not catch any of the model. Draw it around the part you want.'); }
  }
  return { piece, rest };
}

/**
 * v2.378 FILL INSIDE: solidify the cup / bowl / egg-cup pocket that the point [x,y,z] (a hit on its inner wall or floor) sits in.
 * Works in a copy turned so world +Y is Manifold's +Z: it slices upward from the point, follows the void ring that contains the point
 * (a void ring has the material outline around it) for as long as it stays enclosed, extrudes that ring slab by slab and unions the
 * slabs with the model. Returns { solid, top, slabs } (a NEW solid) or throws a plain-English error.
 */
export function fillPocket(M, CS, solid, point, steps = 160) {
  const P = [point[0], -point[2]], y0 = point[1];
  const rs = solid.rotate([90, 0, 0]);                                  // (x, y, z) -> (x, -z, y)
  const bb = rs.boundingBox(), zTop = bb.max[2];
  const inRing = (r, p) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const area = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * r[i][1] - r[i][0] * r[j][1]); return s / 2; };
  const ringDist = (r, p) => { let m = 1e30; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[j], b = r[i], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1e-12; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)); m = Math.min(m, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); } return m; };
  const tol = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) * 0.02;
  const rings = [], hs = [];
  const step = Math.max((zTop - y0) / steps, 1e-6);
  const holeAt = zz => {
    const cs = rs.slice(zz); let polys; try { polys = cs.toPolygons(); } finally { try { cs.delete?.(); } catch {} }
    // a void is a hole outline (negative area). The picked point sits ON the wall or floor, so take hole outlines that contain it or pass within tol of it; the smallest one is the pocket
    const near = polys.filter(r => r.length > 2 && area(r) < 0 && (inRing(r, P) || ringDist(r, P) <= tol));
    return near.length ? near.reduce((a, b) => (Math.abs(area(a)) <= Math.abs(area(b)) ? a : b)) : null;
  };
  const up = [], down = [];
  for (let z = y0 + step * 0.25; z < zTop; z += step) { const h = holeAt(z); if (h) up.push([z, h]); else if (up.length || z > y0 + step * 3) break; }
  if (up.length) for (let z = y0 - step * 0.75; z > bb.min[2]; z -= step) { const h = holeAt(z); if (h) down.push([z, h]); else break; }
  else for (let z = y0 - step * 0.75; z > bb.min[2] && z > y0 - step * 3; z -= step) { const h = holeAt(z); if (h) { down.push([z, h]); } else break; }
  const all = down.reverse().concat(up);
  for (const [zz, h] of all) { hs.push(zz); rings.push(h); }
  if (!rings.length) { try { rs.delete?.(); } catch {} throw new Error('That does not look like a cup or a pocket with material all round it. Click inside it, on its inner wall or floor.'); }
  let out = rs, slabs = 0; const made = [];
  try {
    for (let i = 0; i < rings.length; i++) {
      const lo = hs[i] - step * (i ? 1 : 0.5), hi = (i + 1 < rings.length ? hs[i + 1] : hs[i] + step * 0.5);
      const cs = CS.ofPolygons([rings[i].slice().reverse()], 'Positive'); const cs2 = i + 1 < rings.length ? CS.ofPolygons([rings[i + 1].slice().reverse()], 'Positive') : null;
      const sec = cs2 ? CS.union ? CS.union(cs, cs2) : cs.add(cs2) : cs;
      const slab = M.extrude(sec, hi - lo).translate([0, 0, lo]); made.push(slab); slabs++;
      try { cs.delete?.(); cs2?.delete?.(); if (sec !== cs) sec.delete?.(); } catch {}
    }
    // the floor: from the lowest solid below the first ring up to it is already material; start the fill a hair below the first slice
    let acc = rs; for (const s of made) { const n = acc.add(s); if (acc !== rs) try { acc.delete?.(); } catch {} acc = n; }
    // slab seams can leave zero-volume sliver shells: keep only real pieces
    let clean = acc; try { const parts = acc.decompose(), vols = parts.map(q => q.volume()), big = Math.max(...vols); const keep = parts.filter((q, i) => vols[i] > big * 1e-6); if (keep.length !== parts.length) clean = M.compose(keep); parts.forEach(q => { if (!keep.includes(q)) try { q.delete?.(); } catch {} }); } catch {}
    out = clean.rotate([-90, 0, 0]); if (acc !== rs) try { acc.delete?.(); } catch {} if (clean !== acc) try { clean.delete?.(); } catch {}
    return { solid: out, top: hs[hs.length - 1], slabs };
  } finally { made.forEach(s => { try { s.delete?.(); } catch {} }); try { rs.delete?.(); } catch {} }
}

/**
 * v2.405 SOLID CUT (Tim): cutting a block out of a hollow model (a base with a hollow inside) used to leave the hollow open at the cut face.
 * Before the cutter is subtracted, every cavity (void outline in the horizontal slices) that comes within `margin` of the cutter is filled with
 * material, as a plug `margin` deep around the cutter, so the new face is solid. The cavity further away stays, closed again.
 * Works in a copy turned so world +Y is Manifold's +Z, like fillPocket. Returns { solid, slabs } (a NEW solid) or null when nothing needed plugging.
 */
export function plugCavities(M, CS, solid, cutter, margin, steps = 48) {
  const area = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * r[i][1] - r[i][0] * r[j][1]); return s / 2; };
  const rs = solid.rotate([90, 0, 0]), cr = cutter.rotate([90, 0, 0]), made = [];
  try {
    const cb = cr.boundingBox(), mb = rs.boundingBox(), z0 = Math.max(cb.min[2], mb.min[2]), z1 = Math.min(cb.max[2], mb.max[2]);
    if (!(z1 > z0)) return null;
    const n = Math.max(8, steps), step = (z1 - z0) / n, grow = Math.max(step * 0.6, margin * 0.02);
    const fills = [];
    for (let i = 0; i < n; i++) {
      const z = z0 + step * (i + 0.5); fills.push(null);
      const cs = rs.slice(z); let polys; try { polys = cs.toPolygons(); } finally { try { cs.delete?.(); } catch {} }
      const holes = polys.filter(r => r.length > 2 && area(r) < 0);                      // a void has a material outline around it
      if (!holes.length) continue;
      const bs = cr.slice(z); if (bs.isEmpty()) { try { bs.delete?.(); } catch {} continue; }
      const zone = bs.offset(margin, 'Round'); try { bs.delete?.(); } catch {}
      const hs0 = CS.ofPolygons(holes.map(r => r.slice().reverse()), 'Positive'), hs = hs0.offset(grow, 'Round'); try { hs0.delete?.(); } catch {}
      const fill = hs.intersect(zone); try { hs.delete?.(); zone.delete?.(); } catch {}
      if (fill.isEmpty()) { try { fill.delete?.(); } catch {} continue; }
      fills[i] = fill;
    }
    for (let i = 0; i < n; i++) {                                                         // the hollow's floor and ceiling fall between two slices: reach one step past the last slice with a hollow, or a thin crack stays open
      if (!fills[i]) continue; const z = z0 + step * (i + 0.5), lo = z - step * (fills[i - 1] ? 0.54 : 1.5), hi = z + step * (fills[i + 1] ? 0.54 : 1.5);
      made.push(M.extrude(fills[i], hi - lo).translate([0, 0, lo]));
    }
    fills.forEach(f => { try { f?.delete?.(); } catch {} });
    if (!made.length) return null;
    const plug = made.length === 1 ? made[0] : M.union(made), joined = rs.add(plug);
    if (plug !== made[0]) try { plug.delete?.(); } catch {}
    let clean = joined;                                                                    // seams can leave zero-volume slivers: keep real pieces. An enclosed void has NEGATIVE volume and must stay
    try { const parts = joined.decompose(), vols = parts.map(q => Math.abs(q.volume())), big = Math.max(...vols), keep = parts.filter((q, k) => vols[k] > big * 1e-6); if (keep.length !== parts.length) clean = M.compose(keep); parts.forEach(q => { if (!keep.includes(q)) try { q.delete?.(); } catch {} }); } catch {}
    const out = clean.rotate([-90, 0, 0]); if (clean !== joined) try { clean.delete?.(); } catch {} try { joined.delete?.(); } catch {}
    return { solid: out, slabs: made.length };
  } finally { made.forEach(q => { try { q.delete?.(); } catch {} }); try { rs.delete?.(); cr.delete?.(); } catch {} }
}
