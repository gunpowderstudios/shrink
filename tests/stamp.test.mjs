// Stamp maths: where a pasted screen pixel lands in the copied patch, and how the patch is sampled.
import { patchCoords, samplePatch, edgeFalloff, pasteRadius, patchStep, MAX_PATCH } from '../stamp-core.js';
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
console.log('all passed'); process.exit(0);
