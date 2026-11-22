// text-core.js: a bitmap becomes letter outlines with holes
import { bitmapToShapes } from '../text-core.js';
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
const mk = (w, h, f) => { const b = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[y * w + x] = f(x, y) ? 1 : 0; return b; };
const A = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(s) / 2; };
const ring = mk(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 40 && d > 20; });
const s1 = bitmapToShapes(ring, 100, 100);
ok(s1.length === 1 && s1[0].holes.length === 1, `T1 an O is one outline with one hole (${s1.length} outline, ${s1[0]?.holes.length} holes)`);
const want = Math.PI * (1600 - 400), got = A(s1[0].outer) - A(s1[0].holes[0]);
ok(Math.abs(got - want) / want < 0.03, `T2 the O has the right area (${got.toFixed(0)} vs ${want.toFixed(0)})`);
ok(s1[0].outer.length < 200, `T3 the outline is simplified (${s1[0].outer.length} points)`);
const two = mk(20, 20, (x, y) => (x < 9 && y < 9) || (x >= 9 && y >= 9 && x < 18 && y < 18));      // two squares touching only at a corner
const s2 = bitmapToShapes(two, 20, 20);
ok(s2.length === 2, `T4 two blobs that touch only at a corner stay two outlines (${s2.length})`);
const b8 = mk(120, 100, (x, y) => { const d1 = Math.hypot(x - 35, y - 30), d2 = Math.hypot(x - 35, y - 70), e = Math.hypot(x - 85, y - 50); return (d1 < 22 && d1 > 10) || (d2 < 24 && d2 > 11) || (e < 12); });
const s3 = bitmapToShapes(b8, 120, 100);
ok(s3.length === 2 && s3.map(s => s.holes.length).sort().join() === '0,2', `T5 an 8 and a dot: ${s3.length} outlines, ${s3.map(s => s.holes.length).join('/')} holes`);
ok(bitmapToShapes(new Uint8Array(100), 10, 10).length === 0, 'T6 an empty picture gives nothing');
console.log(bad ? bad + ' FAILED' : 'text tests passed'); process.exit(bad ? 1 : 0);
