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
