// fill-core.js: an orange cut in half, a box with a missing face, two holes, a concave hole, and a closed ball (nothing to do).
import { openLoops, fillOpenEdges, openEdgeSegments } from '../fill-core.js';
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };

function ball(r, nu, nv, cutY) {                       // UV sphere; cutY keeps only y >= cutY (rows below are dropped), leaving an open rim
  const P = [], I = [], rows = [];
  for (let j = 0; j <= nv; j++) { const th = Math.PI * j / nv, y = r * Math.cos(th); if (cutY !== undefined && y < cutY - 1e-9) break; rows.push(j); }
  for (const j of rows) { const th = Math.PI * j / nv; for (let i = 0; i < nu; i++) { const ph = 2 * Math.PI * i / nu; P.push(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)); } }
  const R = rows.length;
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < nu; i++) { const a = j * nu + i, b = j * nu + (i + 1) % nu, c = (j + 1) * nu + i, d = (j + 1) * nu + (i + 1) % nu; if (j > 0) I.push(a, c, b); if (j < nv - 1) I.push(b, c, d); }
  return { positions: new Float32Array(P), indices: new Uint32Array(I) };
}
function volume(P, I) { let v = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return v / 6; }
function consistent(P, I) {                              // closed AND every neighbour agrees which way is out: each directed edge once, and its reverse once
  const { canon } = openLoops(P, I), U = Math.max(...canon) + 1, m = new Map(); let okAll = true;
  for (let t = 0; t < I.length; t += 3) { const v = [0, 1, 2].map(k => canon[I[t + k]]); if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; for (let k = 0; k < 3; k++) { const key = v[k] * U + v[(k + 1) % 3]; m.set(key, (m.get(key) || 0) + 1); } }
  for (const [key, c] of m) { const a = Math.floor(key / U), b = key % U; if (c !== 1 || m.get(b * U + a) !== 1) { okAll = false; break; } } return okAll;
}
function openCount(P, I) { return openLoops(P, I).loops.length; }

const full = ball(20, 48, 24); ok(openCount(full.positions, full.indices) === 0, 'F1 a closed ball has no holes');
{ const r = fillOpenEdges(full.positions, full.indices); ok(r.stats.filled === 0 && r.indices === full.indices, 'F2 nothing to fill on a closed ball'); }
const half = ball(20, 48, 24, 0); const nh = openLoops(half.positions, half.indices).loops;
ok(nh.length === 1 && nh[0].length === 48, 'F3 an orange cut in half has one open rim of 48 points: ' + nh.length + ' loop(s), ' + (nh[0] && nh[0].length));
{ const r = fillOpenEdges(half.positions, half.indices); ok(r.stats.filled === 1 && openCount(r.positions, r.indices) === 0, 'F4 the rim is capped and the model is closed (' + r.stats.triangles + ' triangles added)');
  const vol = Math.abs(volume(r.positions, r.indices)), exact = 2 / 3 * Math.PI * 20 ** 3; ok(consistent(r.positions, r.indices) && Math.abs(vol - exact) / exact < 0.05, 'F5 the capped half ball is a closed solid, every neighbour agreeing which way is out, with the right volume: ' + vol.toFixed(0) + ' vs ' + exact.toFixed(0)); }
{ const r = fillOpenEdges(half.positions, half.indices); let flat = true; for (let t = half.indices.length; t < r.indices.length; t++) if (Math.abs(r.positions[r.indices[t] * 3 + 1]) > 1e-3) flat = false; ok(flat, 'F6 the cap is flat (all its points sit on the cut plane)'); }
// two holes: a ball with a top and a bottom cap removed
{ const b = ball(20, 40, 20); const I = []; for (let t = 0; t < b.indices.length; t += 3) { const ys = [0, 1, 2].map(k => b.positions[b.indices[t + k] * 3 + 1]); if (Math.max(...ys) > 18 || Math.min(...ys) < -18) continue; I.push(b.indices[t], b.indices[t + 1], b.indices[t + 2]); }
  const P = b.positions, II = new Uint32Array(I), L = openLoops(P, II).loops; ok(L.length === 2, 'F7 a ball with both ends missing has two holes (' + L.length + ')');
  const one = fillOpenEdges(P, II, { point: [0, 25, 0] }); ok(one.stats.filled === 1 && openCount(one.positions, one.indices) === 1, 'F8 with a point only the nearest hole closes');
  const top = one.positions, tips = []; for (let t = II.length; t < one.indices.length; t++) tips.push(top[one.indices[t] * 3 + 1]); ok(tips.every(y => y > 10), 'F9 it was the top one');
  const all = fillOpenEdges(P, II); ok(all.stats.filled === 2 && openCount(all.positions, all.indices) === 0, 'F10 fill all closes both'); }
// concave hole: an L-shaped box with its top missing
{ const poly = [[0,0],[6,0],[6,3],[3,3],[3,6],[0,6]], H = 5, P = [], I = []; poly.forEach(p => P.push(p[0], 0, p[1])); poly.forEach(p => P.push(p[0], H, p[1]));
  [[0,1,2],[0,2,3],[0,3,4],[0,4,5]].forEach(t => I.push(...t));
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; I.push(i, 6 + j, j, i, 6 + i, 6 + j); }
  const PP = new Float32Array(P), II = new Uint32Array(I); ok(openCount(PP, II) === 1 && !consistent(PP, II), 'F11a an L-shaped box with no top has one concave hole');
  const r = fillOpenEdges(PP, II); ok(r.stats.filled === 1 && r.stats.triangles === 4 && consistent(r.positions, r.indices), 'F11 the concave six-point hole is closed with 4 triangles and the box is a closed, consistent solid (' + r.stats.triangles + ')');
  ok(Math.abs(Math.abs(volume(r.positions, r.indices)) - 27 * H) < 1e-3, 'F11b the L box volume is right: ' + Math.abs(volume(r.positions, r.indices)).toFixed(1)); }
{ const segs = openEdgeSegments(half.positions, half.indices); ok(segs.loops === 1 && segs.segments.length === 48 * 6, 'F12 openEdgeSegments gives the rim for drawing it red: ' + segs.segments.length / 6 + ' edges'); }
{ const b = ball(20, 4000, 40, 0); const t0 = Date.now(); const r = fillOpenEdges(b.positions, b.indices); ok(r.stats.filled === 1 && openCount(r.positions, r.indices) === 0, 'F13 a very long rim (4000 points) closes with a fan in ' + (Date.now() - t0) + ' ms'); }
console.log(bad ? bad + ' FAILED' : 'fill tests passed'); process.exit(bad ? 1 : 0);
