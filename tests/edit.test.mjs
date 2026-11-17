// edit-core.js against the real Manifold library: shapes join/cut and plane slicing (shorten a "sword").
import Module from 'manifold-3d';
import { applyShapes, sliceSolid, applySolid, copyRegion } from '../edit-core.js';
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

/* a second solid: replace the head */
{ const body = M.cube([20, 40, 20], true), head = M.sphere(10, 32).translate([0, 30, 0]), lowered = sliceSolid(M, body, [0, -1, 0], -10);   // body trimmed to y <= 10
  const joined = applySolid(M, lowered, M.cube([12, 12, 12], true).translate([0, 6, 0]), 'join'); const bb = joined.boundingBox();
  ok(Math.abs(bb.max[1] - 12) < 1e-6 && joined.decompose().length === 1, `E10 a part joined onto the trimmed body is one piece, top at y=${bb.max[1].toFixed(1)}`);
  const holed = applySolid(M, body, M.cylinder(50, 3, 3, 24, true).rotate([90, 0, 0]), 'cut');
  ok(holed.genus() === 1, 'E11 a part cut out drills a hole through the body (genus 1)');
  void head;
}

/* copy / cut a region */
{ const body = M.cube([20, 40, 20], true), cm = T(0, 15, 0, 30, 10, 30);          // box around the top 10 units (y 10..20)
  const c1 = copyRegion(M, body, cm, false); const pb = c1.piece.boundingBox();
  ok(c1.rest === null && Math.abs(c1.piece.volume() - 20 * 10 * 20) < 1 && Math.abs(pb.min[1] - 10) < 1e-6, `E12 COPY takes the piece in the box (volume ${c1.piece.volume().toFixed(0)}) and leaves the model alone`);
  const c2 = copyRegion(M, body, cm, true);
  ok(Math.abs(c2.rest.volume() - (body.volume() - 4000)) < 1 && c2.rest.decompose().length === 1, 'E12 CUT also removes it from the model');
  let msg = ''; try { copyRegion(M, body, T(0, 100, 0, 5, 5, 5), false); } catch (e) { msg = e.message; }
  ok(/Nothing is inside/.test(msg), 'E12 an empty box is refused: ' + msg);
}
console.log(bad ? `${bad} FAILED` : 'edit tests passed'); process.exit(bad ? 1 : 0);
