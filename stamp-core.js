// SHRINK 3D v2.79 — Stamp maths (no browser or three.js needed, so it can be tested on its own).
// A "patch" is a picture copied from the model as it looked on screen: { pw, ph, s, data } where data is RGBA (straight alpha,
// alpha 0 = nothing was there) and every patch pixel covers s x s screen pixels. Pasting maps each destination screen pixel
// back into the patch: undo the rotation, undo the flip, divide by the scale.

export function patchCoords(dx, dy, { scale = 1, rotDeg = 0, flip = false, pw, ph, s = 1 }) {
  const a = rotDeg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
  let x = (dx * c + dy * n) / scale, y = (-dx * n + dy * c) / scale;   // screen y points down, like CSS rotate()
  if (flip) x = -x;
  return { u: x / s + pw / 2, v: y / s + ph / 2 };
}

// Bilinear sample of the patch at continuous position (u, v) in patch pixels. Returns alpha 0..1 and writes the colour to out.
export function samplePatch(patch, u, v, out = [0, 0, 0]) {
  const { pw, ph, data } = patch;
  const fx = u - 0.5, fy = v - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const x = x0 + i, y = y0 + j, w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
    if (x < 0 || y < 0 || x >= pw || y >= ph || w <= 0) continue;
    const o = (y * pw + x) * 4, al = data[o + 3] / 255 * w;
    r += data[o] * al; g += data[o + 1] * al; b += data[o + 2] * al; a += al;
  }
  if (a <= 1e-6) { out[0] = out[1] = out[2] = 0; return 0; }
  out[0] = r / a; out[1] = g / a; out[2] = b / a; return Math.min(1, a);
}

// 1 in the middle, fading to 0 over the outer ~6% of the patch so a pasted box does not leave a hard edge.
export function edgeFalloff(u, v, pw, ph, frac = 0.06) {
  const edge = Math.max(1, Math.min(pw, ph) * frac), d = Math.min(u, pw - u, v, ph - v);
  return d <= 0 ? 0 : Math.min(1, d / edge);
}

// Radius (screen px) of a circle that holds the pasted rectangle.
export const pasteRadius = (pw, ph, s, scale) => Math.hypot(pw * s * scale, ph * s * scale) / 2;

// Longest side of a patch is kept at or below this many patch pixels.
export const MAX_PATCH = 160;
export const patchStep = (w, h) => Math.max(1, Math.ceil(Math.max(w, h) / MAX_PATCH));

/* ---------- bumps (normal map) helpers, shared with paint3d.js ---------- */
// Blend the pixels of a w x h RGBA normal map that colour texel (px, py) of a cw x ch colour picture covers towards rgb.
// Returns the rectangle it touched ({x0,y0,x1,y1}) or null.
export function blendNormalBlock(d, w, h, cw, ch, px, py, wt, rgb) {
  if (wt <= 0) return null;
  const sx = w / cw, sy = h / ch;
  const x0 = Math.floor(px * sx), x1 = Math.max(x0, Math.ceil((px + 1) * sx) - 1), y0 = Math.floor(py * sy), y1 = Math.max(y0, Math.ceil((py + 1) * sy) - 1);
  if (x0 >= w || y0 >= h || x0 < 0 || y0 < 0) return null;
  const ex = Math.min(x1, w - 1), ey = Math.min(y1, h - 1);
  for (let y = y0; y <= ey; y++) for (let x = x0; x <= ex; x++) {
    const o = (y * w + x) * 4;
    d[o] = d[o] * (1 - wt) + rgb[0] * wt; d[o + 1] = d[o + 1] * (1 - wt) + rgb[1] * wt; d[o + 2] = d[o + 2] * (1 - wt) + rgb[2] * wt;
  }
  return { x0, y0, x1: ex, y1: ey };
}
// Copy a rectangle out of an RGBA buffer (for Undo).
export function sliceRegion(buf, w, b) {
  const rw = b.x1 - b.x0 + 1, rh = b.y1 - b.y0 + 1, out = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) out.set(buf.subarray(((b.y0 + y) * w + b.x0) * 4, ((b.y0 + y) * w + b.x0 + rw) * 4), y * rw * 4);
  return out;
}
