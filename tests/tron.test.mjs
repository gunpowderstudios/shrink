// Tron (beta): the flat-car maker. A made-up car (box body, box cabin set towards the rear, four cylinder wheels) must come out as a solid
// low-poly body plus four wheels in the right places, with face colours taken from the original.
import { MeshoptSimplifier } from 'meshoptimizer';
import { flattenCar, surfaceNets, signedVolume, fillInside, resFor, TRON_MIN_FACES, TRON_MAX_FACES } from '../tron-core.js';
import { ok } from './helpers.mjs';
await MeshoptSimplifier.ready;

// ---- pieces ----
const P = [], N = [], C = [], I = [];
function quad(a, b, c, d, n, col) { const o = P.length / 3; for (const v of [a, b, c, d]) { P.push(...v); N.push(...n); C.push(...col); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); }
function box(x0, x1, y0, y1, z0, z1, side, top) {
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side);
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], side);
}
function wheel(cx, cy, cz, r, w, col) {
  const seg = 28;
  for (let s = 0; s < seg; s++) {
    const a0 = 2 * Math.PI * s / seg, a1 = 2 * Math.PI * (s + 1) / seg, nm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
    const p = (a, z) => [cx + r * Math.cos(a), cy + r * Math.sin(a), cz + z];
    quad(p(a0, -w / 2), p(a1, -w / 2), p(a1, w / 2), p(a0, w / 2), nm, col);
    const o = P.length / 3; for (const [v, n] of [[[cx, cy, cz + w / 2], [0, 0, 1]], [p(a0, w / 2), [0, 0, 1]], [p(a1, w / 2), [0, 0, 1]]]) { P.push(...v); N.push(...n); C.push(...col); } I.push(o, o + 1, o + 2);
  }
}
const RED = [200, 30, 30], GOLD = [230, 190, 40], BLUE = [40, 80, 200], DARK = [30, 30, 30];
box(-2, 2, -0.1, 0.5, -0.9, 0.9, RED, RED);          // body: red
box(-0.6, 1.0, 0.5, 1.1, -0.75, 0.75, BLUE, GOLD);    // cabin: blue sides, gold roof, sits towards the rear (+x), so the front is -x
const WY = -0.1;                                      // wheel centres: 0.4 up from the ground (y = -0.5)
for (const x of [-1.3, 1.3]) for (const z of [-0.85, 0.85]) wheel(x, WY, z, 0.4, 0.3, DARK);
const src = { positions: Float32Array.from(P), normals: Float32Array.from(N), colors: Uint8Array.from(C), indices: Uint32Array.from(I) };

// ---- surface nets on a sphere ----
{
  const n = 28, f = new Float32Array(n * n * n), c = (n - 1) / 2, r = 9;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[(k * n + j) * n + i] = Math.max(0, Math.min(1, 0.5 + (r - Math.hypot(i - c, j - c, k - c))));
  const m = surfaceNets(f, n, n, n, 0.5, [0, 0, 0], 1);
  const v = signedVolume(m.positions, m.indices), want = 4 / 3 * Math.PI * r ** 3;
  ok(v > 0, 'surface nets: triangles face outward (positive volume)');
  ok(Math.abs(v - want) / want < 0.06, `surface nets: a sphere keeps its volume (${v.toFixed(0)} vs ${want.toFixed(0)})`);
}
// ---- a hollow box with a hole in one wall still fills (a real car has open windows) ----
{
  const n = 22, g = new Uint8Array(n * n * n);
  for (let k = 5; k < 15; k++) for (let j = 5; j < 15; j++) for (let i = 5; i < 15; i++) if (i === 5 || i === 14 || j === 5 || j === 14 || k === 5 || k === 14) g[(k * n + j) * n + i] = 1;
  for (let k = 8; k < 11; k++) for (let j = 8; j < 11; j++) g[(k * n + j) * n + 14] = 0;
  const s = fillInside(g, n, n, n); let cnt = 0; for (const v of s) cnt += v;
  ok(cnt > 900, `a hollow box with a hole in its wall is filled solid (${cnt} cells)`);
}
ok(resFor(2500) < resFor(800) && resFor(5000) < resFor(2500) && resFor(300) <= 0.03 && resFor(20000) >= 0.004, 'more triangles -> a finer grid, within limits');

// ---- the whole pipeline ----
const r800 = flattenCar(src, { faces: 800, simplifier: MeshoptSimplifier });
ok(r800.info.wheelsFound && r800.wheels.length === 4, 'four wheels are found');
const near = (w, x, z) => Math.abs(w.x - x) < 0.25 && Math.abs(w.y - WY) < 0.2 && Math.abs(w.z - z) < 0.15;
ok([[-1.3, -0.85], [-1.3, 0.85], [1.3, -0.85], [1.3, 0.85]].every(([x, z]) => r800.wheels.some(w => near(w, x, z))), 'each wheel is where the real one is');
ok(r800.wheels.every(w => Math.abs(w.radius - 0.4) < 0.1 && Math.abs(w.width - 0.3) < 0.12), 'wheel radius and width are about right');
ok(r800.info.frontSign === -1, 'the front is on the side away from the cabin');
const names = r800.wheels.map(w => w.name).sort().join(',');
ok(names === 'Wheel_FL,Wheel_FR,Wheel_RL,Wheel_RR', 'wheels are named front/rear and left/right: ' + names);
const wFL = r800.wheels.find(w => w.name === 'Wheel_FL'), wFR = r800.wheels.find(w => w.name === 'Wheel_FR');
ok(wFL.x < 0 && wFR.x < 0 && wFL.z * wFR.z < 0, 'front wheels are at the front, one each side');
ok(wFR.z < 0 && wFL.z > 0, 'facing -x with Y up, the right side is -z');
ok(r800.body.faces <= 800 * 1.25 && r800.body.faces >= 100, `the body has about the triangles asked for (${r800.body.faces} for 800)`);
// the body fits the original: its box matches the car body (x -2..2, y -0.1..1.1 give or take a voxel)
{
  const b = r800.body.positions; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < b.length; i += 3) { x0 = Math.min(x0, b[i]); x1 = Math.max(x1, b[i]); y0 = Math.min(y0, b[i + 1]); y1 = Math.max(y1, b[i + 1]); }
  ok(Math.abs(x0 + 2) < 0.25 && Math.abs(x1 - 2) < 0.25, `body length matches (${x0.toFixed(2)}..${x1.toFixed(2)})`);
  ok(y1 > 0.95 && y1 < 1.25 && y0 > -0.3 && y0 < 0.1, `body height matches (${y0.toFixed(2)}..${y1.toFixed(2)})`);
}
// colours: a face on top of the cabin is gold, a face on the side of the lower body is red
{
  const b = r800.body; let gold = 0, red = 0, blue = 0;
  for (let t = 0; t < b.faces; t++) {
    const cy = (b.positions[t * 9 + 1] + b.positions[t * 9 + 4] + b.positions[t * 9 + 7]) / 3, ny = b.normals[t * 9 + 1], cz = (b.positions[t * 9 + 2] + b.positions[t * 9 + 5] + b.positions[t * 9 + 8]) / 3;
    const [r, g, bl] = [b.colors[t * 9], b.colors[t * 9 + 1], b.colors[t * 9 + 2]];
    if (cy > 1 && ny > 0.8 && r > 180 && g > 150 && bl < 90) gold++;
    if (cy < 0.4 && Math.abs(cz) > 0.7 && r > 170 && g < 80) red++;
    if (cy > 0.6 && cy < 1 && Math.abs(cz) > 0.6 && bl > 150 && r < 100) blue++;
  }
  ok(gold > 0, `cabin roof faces are gold (${gold})`); ok(red > 0, `lower body side faces are red (${red})`); ok(blue > 0, `cabin side faces are blue (${blue})`);
}
// the slider: more triangles gives more faces, fewer gives fewer, and the same setting twice gives the same car
const r2500 = flattenCar(src, { faces: 2500, simplifier: MeshoptSimplifier }), r300 = flattenCar(src, { faces: 300, simplifier: MeshoptSimplifier }), again = flattenCar(src, { faces: 800, simplifier: MeshoptSimplifier });
ok(r300.body.faces <= r800.body.faces && r800.body.faces <= r2500.body.faces, `slider moves the count: ${r300.body.faces} <= ${r800.body.faces} <= ${r2500.body.faces}`);
ok(again.body.faces === r800.body.faces && again.body.positions.every((v, i) => v === r800.body.positions[i]), 'same settings give the same car');
ok(TRON_MIN_FACES === 300 && TRON_MAX_FACES === 20000, 'slider limits are 300 and 20,000');
// a model with no normals (or all-zero ones) still gets the right colours: the roof is gold, not the colour of whatever is inside
for (const bad of [null, new Float32Array(src.normals.length)]) {
  const r = flattenCar({ ...src, normals: bad }, { faces: 800, simplifier: MeshoptSimplifier }), b = r.body; let gold = 0;
  for (let t = 0; t < b.faces; t++) { const cy = (b.positions[t * 9 + 1] + b.positions[t * 9 + 4] + b.positions[t * 9 + 7]) / 3; if (cy > 1 && b.normals[t * 9 + 1] > 0.8 && b.colors[t * 9] > 180 && b.colors[t * 9 + 2] < 90) gold++; }
  ok(gold > 0, `with ${bad ? 'all-zero' : 'no'} normals the roof is still gold (${gold})`);
}
// a model with no wheels still gives a body (wheelsFound false, no wheel list)
{
  const q = { positions: [], normals: [], colors: [], indices: [] };
  P.length = 0; N.length = 0; C.length = 0; I.length = 0;
  box(-2, 2, -0.5, 0.5, -0.9, 0.9, RED, RED);
  const r = flattenCar({ positions: Float32Array.from(P), normals: Float32Array.from(N), colors: Uint8Array.from(C), indices: Uint32Array.from(I) }, { faces: 400, simplifier: MeshoptSimplifier });
  ok(r.body.faces > 0, 'a plain box still gives a body');
  void q;
}
try { flattenCar({ positions: new Float32Array(9), indices: new Uint32Array(3) }, { faces: 400, simplifier: MeshoptSimplifier }); ok(false, 'a tiny model should be refused'); } catch (e) { ok(/too few/.test(e.message), 'a tiny model is refused with a plain message'); }
