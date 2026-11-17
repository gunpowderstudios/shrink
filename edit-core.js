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
