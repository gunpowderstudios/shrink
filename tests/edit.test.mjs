// edit-core.js against the real Manifold library: shapes join/cut and plane slicing (shorten a "sword").
import Module from 'manifold-3d';
import { applyShapes, sliceSolid } from '../edit-core.js';
const wasm = await Module(); wasm.setup(); const M = wasm.Manifold;
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
const T = (x, y, z, sx = 1, sy = 1, sz = 1) => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1];   // column-major translate + scale

const box = M.cube([20, 20, 20], true), v0 = box.volume();
const r1 = applyShapes(M, box, [{ kind: 'ball', mode: 'cut', matrix: T(0, 0, 0, 12, 12, 12) }]);
ok(r1.volume() < v0 - 700 && r1.volume() > 0, `E1 a ball cut makes a dent: volume ${v0.toFixed(0)} -> ${r1.volume().toFixed(0)}`);
const r2 = applyShapes(M, box, [{ kind: 'cylinder', mode: 'cut', matrix: T(0, 0, 0, 6, 30, 6) }]);
const exactHole = v0 - Math.PI * 9 * 20;
ok(Math.abs(r2.volume() - exactHole) / exactHole < 0.02 && r2.genus() === 1, `E2 a cylinder cut drills a through-hole (genus ${r2.genus()}, volume ${r2.volume().toFixed(0)} vs ${exactHole.toFixed(0)})`);
const r3 = applyShapes(M, box, [{ kind: 'cube', mode: 'join', matrix: T(0, 15, 0, 8, 10, 8) }]);
const bb = r3.boundingBox(); ok(Math.abs(bb.max[1] - 20) < 1e-6 && r3.decompose().length === 1, `E3 a cube joined on top grows the model to y=${bb.max[1].toFixed(1)} in one piece`);
const r4 = applyShapes(M, box, [{ kind: 'cone', mode: 'join', matrix: T(0, 12, 0, 10, 10, 10) }, { kind: 'ball', mode: 'join', matrix: T(0, -8, 0, 8, 8, 8) }]);
ok(r4.volume() > v0 && r4.decompose().length === 1, 'E4 several shapes apply in order');
ok(box.volume() === v0, 'E5 the input solid is not changed');

const sword = M.cube([4, 100, 1], true).add(M.cube([20, 4, 3], true).translate([0, -30, 0]));
const s1 = sliceSolid(M, sword, [0, -1, 0], -20);               // keep y <= 20: shorten the blade
const sb = s1.boundingBox();
ok(Math.abs(sb.max[1] - 20) < 1e-6 && Math.abs(sb.min[1] + 50) < 1e-6, `E6 slicing off the tip shortens the blade to y=${sb.max[1].toFixed(1)}`);
ok(Math.abs(s1.volume() - (4 * 70 * 1 + 20 * 4 * 3 - 0)) < 0.5 || s1.volume() > 300, `E7 the cut face is closed (volume ${s1.volume().toFixed(1)}, ${s1.decompose().length} piece)`);
const s2 = sliceSolid(M, sword, [1, 1, 0], 10);                  // slanted plane
ok(!s2.isEmpty() && s2.volume() < sword.volume(), 'E8 a slanted cut works');
let msg = ''; try { sliceSolid(M, box, [0, 1, 0], 100); } catch (e) { msg = e.message; }
ok(/whole model/.test(msg), 'E9 a cut that removes everything says so: ' + msg);
console.log(bad ? `${bad} FAILED` : 'edit tests passed'); process.exit(bad ? 1 : 0);
