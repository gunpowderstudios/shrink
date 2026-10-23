// SHRINK 3D v2.138 — "Centre on origin, sit on the ground" for a GLB (no DOM; tested by ground.test.mjs).
// Moves the whole model (every scene root node, wheels included) so its bounding box is centred left/right and front/back on the origin and its
// lowest point is exactly on y = 0. Only the translation of the scene's top-level nodes changes: meshes, rotations, scales and materials are untouched.
// getBounds comes from @gltf-transform/core or /functions (passed in so this file has no imports).
export function centreOnGround(doc, getBounds) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (!scene) return { moved: false, reason: 'no scene' };
  const { min, max } = getBounds(scene);
  if (![...min, ...max].every(Number.isFinite) || max[1] < min[1]) return { moved: false, reason: 'empty' };
  const d = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  if (d.every(v => Math.abs(v) < 1e-7)) return { moved: false, reason: 'already', size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
  for (const n of scene.listChildren()) { const t = n.getTranslation(); n.setTranslation([t[0] + d[0], t[1] + d[1], t[2] + d[2]]); }
  return { moved: true, offset: d, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
