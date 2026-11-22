// v2.406 TEXT tool core (no DOM, no three.js): a black-and-white picture of some text becomes closed outlines (letters + holes).
// Marching squares with the points on edge midpoints, so two outlines never touch each other (no pinched corners for the solid tools),
// then Douglas-Peucker to drop the staircase. bits = Uint8Array w*h (1 = ink).

function simplify(pts, tol) {                                   // closed loop; keep the corners, drop points that lie within tol of the line
  const n = pts.length; if (n < 8) return pts;
  let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const part = (a, b) => {                                       // open run pts[a..b] inclusive (indexes may wrap)
    const out = [], stack = [[a, b]], keep = new Set([a % n, b % n]);
    while (stack.length) {
      const [s, e] = stack.pop(); const A = pts[s % n], B = pts[e % n], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9; let md = -1, mi = -1;
      for (let i = s + 1; i < e; i++) { const P = pts[i % n], d = Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep.add(mi % n); stack.push([s, mi], [mi, e]); }
    }
    return keep;
  };
  const k1 = part(0, far), k2 = part(far, n); const keep = new Set([...k1, ...k2]);
  const out = []; for (let i = 0; i < n; i++) if (keep.has(i)) out.push(pts[i]);
  return out.length >= 3 ? out : pts;
}
const area2 = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * r[i][1] - r[i][0] * r[j][1]); return s; };
const inPoly = (r, p) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

/** Returns [{ outer: [[x,y],...], holes: [[[x,y],...], ...] }] in pixel units (y down). */
export function bitmapToShapes(bits, w, h, tol = 0.7) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : bits[y * w + x];
  const segs = new Map(); const key = (t, i, j) => t + i + ',' + j;                // h(i,j): between pixel (i,j) and (i+1,j); v(i,j): between (i,j) and (i,j+1)
  const pos = k => { const t = k[0], [i, j] = k.slice(1).split(',').map(Number); return t === 'h' ? [i + 0.5, j] : [i, j + 0.5]; };
  const add = (a, b, ref) => {                                                      // orient so that the reference inside corner is on the negative side
    const A = pos(a), B = pos(b), dx = B[0] - A[0], dy = B[1] - A[1], cr = dx * (ref[1] - A[1]) - dy * (ref[0] - A[0]);
    if (cr > 0) segs.set(b, a); else segs.set(a, b);
  };
  const multi = [];                                                                 // starts with two outgoing segments cannot happen: every midpoint has exactly two segments (one per cell)
  void multi;
  for (let j = -1; j < h; j++) for (let i = -1; i < w; i++) {
    const tl = at(i, j), tr = at(i + 1, j), br = at(i + 1, j + 1), bl = at(i, j + 1); if (tl + tr + br + bl === 0 || tl + tr + br + bl === 4) continue;
    const T = key('h', i, j), B = key('h', i, j + 1), L = key('v', i, j), R = key('v', i + 1, j);
    const corners = [[tl, [i, j], T, L], [tr, [i + 1, j], T, R], [br, [i + 1, j + 1], B, R], [bl, [i, j + 1], B, L]];
    const cross = [(tl !== tr) && T, (tr !== br) && R, (bl !== br) && B, (tl !== bl) && L].filter(Boolean);
    if (cross.length === 2) { const c = corners.find(q => q[0]); add(cross[0], cross[1], c[1]); }
    else if (cross.length === 4) { for (const c of corners) if (c[0]) add(c[2], c[3], c[1]); }   // a diagonal pair: cut each inside corner off on its own, so the outlines stay apart
  }
  // an edge midpoint can be the start of a segment from each of its two cells only when both orient the same way, so every key has one outgoing segment
  const seen = new Set(), loops = [];
  for (const start of segs.keys()) {
    if (seen.has(start)) continue; const loop = []; let k = start, guard = 0;
    while (k && !seen.has(k) && guard++ < 5e6) { seen.add(k); loop.push(pos(k)); k = segs.get(k); }
    if (loop.length >= 3 && k === start) loops.push(loop);
  }
  const rings = loops.map(l => simplify(l, tol)).filter(r => r.length >= 3 && Math.abs(area2(r)) / 2 > 2);
  if (!rings.length) return [];
  const sign = Math.sign(area2(rings.reduce((a, b) => (Math.abs(area2(a)) >= Math.abs(area2(b)) ? a : b))));   // the biggest ring is an outline: same turning direction = outline, opposite = hole
  const outers = rings.filter(r => Math.sign(area2(r)) === sign).map(r => ({ outer: r, holes: [], a: Math.abs(area2(r)) })), holes = rings.filter(r => Math.sign(area2(r)) !== sign);
  for (const hr of holes) { const home = outers.filter(o => inPoly(o.outer, hr[0])).sort((p, q) => p.a - q.a)[0]; if (home) home.holes.push(hr); }
  return outers.map(o => ({ outer: o.outer, holes: o.holes }));
}
