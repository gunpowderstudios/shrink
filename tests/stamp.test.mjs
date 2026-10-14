// Stamp maths: where a pasted screen pixel lands in the copied patch, and how the patch is sampled.
import { patchCoords, samplePatch, edgeFalloff, pasteRadius, patchStep, MAX_PATCH, blendNormalBlock, sliceRegion } from '../stamp-core.js';
import { ok } from './helpers.mjs';
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// a 4x2 patch: left half red, right half blue, all opaque; 1 patch pixel = 1 screen pixel
const mk = (pw, ph, f) => { const data = new Uint8ClampedArray(pw * ph * 4); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) data.set(f(x, y), (y * pw + x) * 4); return { pw, ph, s: 1, data }; };
const P = mk(4, 2, x => x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
const base = { scale: 1, rotDeg: 0, flip: false, pw: 4, ph: 2, s: 1 };

let c = patchCoords(0, 0, base); ok(near(c.u, 2) && near(c.v, 1), 'the middle of the paste is the middle of the patch');
c = patchCoords(-2, 0, base); ok(near(c.u, 0) && near(c.v, 1), 'the left edge of the paste is the left edge of the patch');
c = patchCoords(2, 0, { ...base, scale: 2 }); ok(near(c.u, 3), 'at 200% a screen pixel covers half a patch pixel');
c = patchCoords(2, 0, { ...base, flip: true }); ok(near(c.u, 0), 'flipped: the right side of the paste reads the left side of the patch');
// rotate 90 degrees clockwise on screen: the patch\'s right edge ends up at the bottom, so a pixel straight below the centre reads the right edge
c = patchCoords(0, 2, { ...base, rotDeg: 90 }); ok(near(c.u, 4) && near(c.v, 1), 'rotated 90° clockwise: the point below the centre shows the patch\'s right side');
c = patchCoords(0, 2, { ...base, rotDeg: -90 }); ok(near(c.u, 0), 'rotated -90°: the point below the centre shows the left side');
c = patchCoords(3, 0, { ...base, rotDeg: 180 }); ok(near(c.u, 2 - 3) && near(c.v, 1), 'rotated 180° is a point reflection');
c = patchCoords(10, 0, { ...base, s: 5, pw: 4 }); ok(near(c.u, 4), 'a patch made of 5px steps: 10 screen px right of centre is 2 patch px');

const out = [0, 0, 0];
let a = samplePatch(P, 0.5, 0.5, out); ok(a === 1 && out[0] === 255 && out[2] === 0, 'sampling a red pixel gives red, fully opaque');
a = samplePatch(P, 3.5, 1.5, out); ok(a === 1 && out[2] === 255 && out[0] === 0, 'sampling a blue pixel gives blue');
a = samplePatch(P, 2, 1, out); ok(near(a, 1) && Math.abs(out[0] - 127.5) < 1 && Math.abs(out[2] - 127.5) < 1, 'between red and blue it blends evenly');
ok(samplePatch(P, -3, 1, out) === 0 && samplePatch(P, 1, 9, out) === 0, 'outside the patch there is nothing (alpha 0)');
// transparent pixels do not bleed their colour: a half-transparent edge keeps the opaque neighbour\'s colour
const T = mk(2, 1, x => x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 0]);
a = samplePatch(T, 1, 0.5, out); ok(near(a, 0.5) && out[0] > 254 && out[1] < 1, 'a see-through neighbour only lowers the alpha, it does not tint the colour');

ok(edgeFalloff(50, 50, 100, 100) === 1 && edgeFalloff(0, 50, 100, 100) === 0 && edgeFalloff(3, 50, 100, 100) < 1 && edgeFalloff(3, 50, 100, 100) > 0, 'the edge fades out over the outer few percent');
ok(near(pasteRadius(30, 40, 1, 1), 25) && near(pasteRadius(30, 40, 2, 0.5), 25), 'the paste radius holds the whole rectangle');
ok(patchStep(100, 50) === 1 && patchStep(MAX_PATCH * 3, 10) === 3 && patchStep(MAX_PATCH + 1, 1) === 2, 'big boxes are sampled more coarsely so a copy stays fast');

// end to end on a fake flat "screen": paste a patch rotated by 90° and read it back
{
  const R = 10, got = new Map();
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const { u, v } = patchCoords(dx, dy, { ...base, rotDeg: 90 });
    if (u < 0 || v < 0 || u > 4 || v > 2) continue;
    if (samplePatch(P, u, v, out) > 0.5) got.set(`${dx},${dy}`, out[0] > out[2] ? 'R' : 'B');
  }
  ok(got.get('0,-1') === 'R' && got.get('0,1') === 'B' && !got.has('3,0'), 'a 4x2 patch pasted at 90° becomes 2 wide and 4 tall, red on top and blue below');
}
/* ---------- bumps: flatten / copy the normal map ---------- */
{
  const mkN = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set([200, 90, 240, 255], i * 4); return d; };
  const FLAT = [128, 128, 255];
  let d = mkN(4, 4), b = blendNormalBlock(d, 4, 4, 4, 4, 1, 2, 1, FLAT);
  ok(b.x0 === 1 && b.x1 === 1 && b.y0 === 2 && b.y1 === 2 && d[(2 * 4 + 1) * 4] === 128 && d[(2 * 4 + 1) * 4 + 2] === 255 && d[0] === 200, 'same size: one colour texel flattens exactly one normal texel and nothing else');
  d = mkN(8, 8); b = blendNormalBlock(d, 8, 8, 4, 4, 1, 1, 1, FLAT);
  ok(b.x0 === 2 && b.x1 === 3 && b.y0 === 2 && b.y1 === 3 && d[(2 * 8 + 2) * 4] === 128 && d[(3 * 8 + 3) * 4] === 128 && d[(4 * 8 + 4) * 4] === 200, 'a normal map twice as big: one colour texel covers a 2x2 block');
  d = mkN(2, 2); b = blendNormalBlock(d, 2, 2, 4, 4, 3, 3, 1, FLAT);
  ok(b.x0 === 1 && b.y0 === 1 && d[(1 * 2 + 1) * 4] === 128 && d[0] === 200, 'a normal map half the size: four colour texels share one');
  d = mkN(4, 4); blendNormalBlock(d, 4, 4, 4, 4, 0, 0, 0.5, FLAT);
  ok(d[0] === 164 && d[1] === 109 && Math.abs(d[2] - 247.5) < 1 && d[3] === 255, 'half strength moves halfway to flat and leaves alpha alone');
  ok(blendNormalBlock(mkN(4, 4), 4, 4, 4, 4, 9, 9, 1, FLAT) === null && blendNormalBlock(mkN(4, 4), 4, 4, 4, 4, 1, 1, 0, FLAT) === null, 'outside the picture, or at zero strength, nothing happens');
  // clone: copying the source's normal colour
  d = mkN(4, 4); d.set([10, 20, 30, 255], 0); const src = [d[0], d[1], d[2]]; blendNormalBlock(d, 4, 4, 4, 4, 3, 3, 1, src);
  ok(d[(3 * 4 + 3) * 4] === 10 && d[(3 * 4 + 3) * 4 + 1] === 20, 'clone copies the source normal colour to the destination');
  // undo: slice the rectangle that was changed
  const before = mkN(4, 4); before.set([1, 2, 3, 255], (1 * 4 + 2) * 4);
  const part = sliceRegion(before, 4, { x0: 1, y0: 1, x1: 2, y1: 2 });
  ok(part.length === 2 * 2 * 4 && part[4] === 1 && part[5] === 2 && part[0] === 200, 'the undo slice is exactly the changed rectangle: ' + part.slice(0, 8));
  const back = mkN(4, 4); blendNormalBlock(back, 4, 4, 4, 4, 2, 1, 1, FLAT);
  for (let y = 0; y < 2; y++) back.set(part.subarray(y * 8, y * 8 + 8), ((1 + y) * 4 + 1) * 4);
  ok(back[(1 * 4 + 2) * 4] === 1, 'putting the slice back restores the pixels');
}

console.log('all passed'); process.exit(0);
