// edit-core.js against the real Manifold library: shapes join/cut and plane slicing (shorten a "sword").
import Module from 'manifold-3d';
import { applyShapes, sliceSolid, applySolid, lassoPrism, lassoRegion, fillPocket } from '../edit-core.js';
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

/* v2.313 lasso: a screen outline becomes a prism through the model */
{ const body = M.cube([20, 40, 20], true), CS = wasm.CrossSection;
  const world = T(0, 0, 100);                                                  // camera at z=100 looking down -z
  const ortho = { world, persp: false, halfW: 50, halfH: 50 }, loop = [[-1, 0.2], [1, 0.2], [1, 0.4], [-1, 0.4]];   // y 10..20 on screen
  const pr = lassoPrism(M, CS, loop, ortho, 10, 190);
  const c1 = lassoRegion(M, body, pr, 'copy'); const pb = c1.piece.boundingBox();
  ok(c1.rest === null && Math.abs(c1.piece.volume() - 20 * 10 * 20) < 1 && Math.abs(pb.min[1] - 10) < 1e-6, `E12 COPY takes the lassoed piece (volume ${c1.piece.volume().toFixed(0)}) and leaves the model alone`);
  const c2 = lassoRegion(M, body, pr, 'delete');
  ok(c2.piece === null && Math.abs(c2.rest.volume() - (body.volume() - 4000)) < 1 && c2.rest.decompose().length === 1, 'E13 DELETE removes it and the hole is capped flat (one closed piece)');
  const c3 = lassoRegion(M, body, pr, 'cut');
  ok(c3.piece && c3.rest && Math.abs(c3.piece.volume() + c3.rest.volume() - body.volume()) < 1 && c3.rest.boundingBox().max[1] < 10.001, 'E14 CUT OFF gives the piece and the capped rest');
  const rot = { world: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -100, 1], persp: false, halfW: 50, halfH: 50 };   // camera behind, looking +z
  const c4 = lassoRegion(M, body, lassoPrism(M, CS, loop, rot, 10, 190), 'copy');
  ok(Math.abs(c4.piece.volume() - 4000) < 1, 'E15 a rotated camera selects the same place (screen up is still up)');
  const side = [[0.1, -1], [0.5, -1], [0.5, 1], [0.1, 1]];                     // x 5..25 on screen, so x 5..10 of the body
  const c5 = lassoRegion(M, body, lassoPrism(M, CS, side, ortho, 10, 190), 'copy');
  ok(Math.abs(c5.piece.boundingBox().min[0] - 5) < 1e-6 && Math.abs(c5.piece.volume() - 5 * 40 * 20) < 1, 'E16 screen right is world right');
  const persp = { world, persp: true, tanY: 0.4, aspect: 1 }, pc = lassoRegion(M, body, lassoPrism(M, CS, [[-1, 0.1], [1, 0.1], [1, 0.6], [-1, 0.6]], persp, 60, 140), 'copy');
  ok(pc.piece.volume() > 3000 && pc.piece.volume() < 9000, `E17 a perspective lasso catches a piece too (${pc.piece.volume().toFixed(0)})`);
  let msg = ''; try { lassoRegion(M, body, lassoPrism(M, CS, [[0.8, 0.8], [0.9, 0.8], [0.9, 0.9]], ortho, 10, 190), 'delete'); } catch (e) { msg = e.message; }
  ok(/did not catch/.test(msg), 'E18 a loop that misses the model is refused: ' + msg);
  let m2 = ''; try { lassoPrism(M, CS, [[0, 0], [1, 1]], ortho, 10, 190); } catch (e) { m2 = e.message; }
  ok(/loop/.test(m2), 'E19 a two-point scribble is refused');
}
/* v2.378 FILL INSIDE */
{ const outer = M.cylinder(20, 10, 10, 48).rotate([-90, 0, 0]), inner = M.cylinder(18, 7, 7, 48).rotate([-90, 0, 0]).translate([0, 4, 0]), cup = outer.subtract(inner);
  const r = fillPocket(M, wasm.CrossSection, cup, [7, 10, 0]);
  ok(Math.abs(r.solid.volume() - outer.volume()) / outer.volume() < 0.01 && r.solid.decompose().length === 1, `EP1 FILL INSIDE makes the cup solid (volume ${r.solid.volume().toFixed(0)} vs ${outer.volume().toFixed(0)})`);
  const bb = r.solid.boundingBox(); ok(Math.abs(bb.max[0] - 10) < 1e-6 && Math.abs(bb.max[1] - 20) < 1e-6, 'EP2 the fill does not poke outside the cup');
  const tap = M.cylinder(20, 6, 12, 48).rotate([-90, 0, 0]).subtract(M.cylinder(18, 3, 9, 48).rotate([-90, 0, 0]).translate([0, 3, 0]));
  const t2 = fillPocket(M, wasm.CrossSection, tap, [4.5, 12, 0]); const full = M.cylinder(20, 6, 12, 48).rotate([-90, 0, 0]);
  ok(t2.solid.volume() > tap.volume() && t2.solid.volume() <= full.volume() * 1.001 && t2.solid.boundingBox().max[0] < 12.001, 'EP3 a tapered cup is filled without growing past its outside');
  let m2 = ''; try { fillPocket(M, wasm.CrossSection, outer, [0, 10, 0]); } catch (e) { m2 = e.message; } ok(/cup or a pocket/.test(m2), 'EP4 a solid block says there is no pocket'); }
console.log(bad ? `${bad} FAILED` : 'edit tests passed'); process.exit(bad ? 1 : 0);

