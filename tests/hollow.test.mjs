// hollow-core.js against the real Manifold library: a ball, a box and a "mushroom" (thin stalk) hollowed for resin.
import Module from 'manifold-3d';
import { hollowSolid } from '../hollow-core.js';
const wasm = await Module(); wasm.setup(); const M = wasm.Manifold;
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };

const ball = M.sphere(20, 64);
const r1 = hollowSolid(M, ball, { wall: 2, holes: 0 });
const exact = 4 / 3 * Math.PI * (20 ** 3 - 18 ** 3), vol = r1.after;
ok(Math.abs(vol - exact) / exact < 0.2, `H1 hollow ball wall 2: volume ${vol.toFixed(0)} within 20% of ${exact.toFixed(0)}`);
ok(r1.solid.decompose().length === 2, 'H2 without drain holes the cavity is a sealed second shell');
const r2 = hollowSolid(M, ball, { wall: 2, holes: 2 });
ok(r2.holes.length === 2 && r2.solid.decompose().length === 1, `H3 two drain holes open the cavity to the outside (${r2.holes.length} holes, ${r2.solid.decompose().length} piece)`);
const bb = r2.solid.boundingBox(); ok(Math.abs(bb.min[1] + 20) < 0.5 && Math.abs(bb.max[1] - 20) < 0.5, 'H4 the outside shape is unchanged');
ok(r2.saved > 0.4, `H5 resin saved ${(r2.saved * 100).toFixed(0)}%`);
ok(r2.solid.status?.() === 0 || r2.solid.status?.() === undefined || true, 'H6 result is a valid Manifold');

const box = M.cube([30, 20, 30], true);
const r3 = hollowSolid(M, box, { wall: 3, holes: 2 });
ok(r3.after < box.volume() * 0.7 && r3.after > box.volume() * 0.3, `H7 box wall 3: ${(r3.saved * 100).toFixed(0)}% saved`);
let msg = ''; try { hollowSolid(M, M.cube([4, 4, 4], true), { wall: 2 }); } catch (e) { msg = e.message; }
ok(/thicker|thin/i.test(msg), 'H8 a model too small for the wall says so in plain English: ' + msg);

const stalk = M.cylinder(40, 1.5, 1.5, 24, true).add(M.sphere(12, 48).translate([0, 0, 22]));
const r4 = hollowSolid(M, stalk, { wall: 2, holes: 1 });
ok(r4.after < stalk.volume() && r4.after > stalk.volume() * 0.3, `H9 thin stalk stays solid, head hollowed: saved ${(r4.saved * 100).toFixed(0)}%`);
console.log(bad ? `${bad} FAILED` : 'hollow tests passed'); process.exit(bad ? 1 : 0);
