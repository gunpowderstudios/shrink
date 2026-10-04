import Module from 'manifold-3d';
import { repairMesh, meshHealth } from '../repair-core.js';
import { ok, failures } from './helpers.mjs';

const wasm = await Module();
wasm.setup();

function rawSphere(r = 20, seg = 40, rings = 28, cx = 0, cy = 0, cz = 0) {
  const pos = [], idx = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings * Math.PI;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg * Math.PI * 2;
      pos.push(
        cx + r * Math.sin(v) * Math.cos(u),
        cy + r * Math.cos(v),
        cz + r * Math.sin(v) * Math.sin(u)
      );
    }
  }
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
    const a = y * (seg + 1) + x, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos, idx };
}

function repair(m) {
  return repairMesh({ positions: new Float32Array(m.pos), indices: new Uint32Array(m.idx) });
}

function cleanSphere(...args) {
  const r = repair(rawSphere(...args));
  return { pos: Array.from(r.positions), idx: Array.from(r.indices) };
}

function soup(m) {
  const pos = [], idx = [];
  for (const v of m.idx) {
    pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
    idx.push(idx.length);
  }
  return { pos, idx };
}

function dropFaces(m, drop) {
  const idx = [];
  for (let t = 0; t < m.idx.length / 3; t++) {
    if (!drop(t)) idx.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]);
  }
  return { pos: m.pos.slice(), idx };
}

function manifoldInfo(positions, indices) {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
  const solid = new wasm.Manifold(mesh);
  const status = String(solid.status()).toLowerCase();
  const valid = !solid.isEmpty() && status === 'noerror';
  const volume = valid ? solid.volume() : 0;
  const components = valid ? solid.decompose().length : 0;
  solid.delete();
  return { valid, volume, components, status };
}

const base = cleanSphere(20);
const expectedVolume = 4 / 3 * Math.PI * 20 ** 3;

{
  const h = meshHealth(new Float32Array(base.pos), new Uint32Array(base.idx));
  const m = manifoldInfo(new Float32Array(base.pos), new Uint32Array(base.idx));
  ok(h.clean, 'closed welded sphere is clean');
  ok(m.valid && Math.abs(m.volume - expectedVolume) / expectedVolume < 0.04, 'closed sphere is a valid solid with sensible volume');
}

{
  const input = soup(rawSphere(20));
  const before = meshHealth(new Float32Array(input.pos), new Uint32Array(input.idx));
  const r = repair(input);
  ok(before.clean, 'unwelded triangle soup gets the same clean verdict after shared welding');
  ok(r.stats.after.clean && r.stats.weldedPoints > 0, 'repair welds triangle soup without damaging topology');
}

{
  const input = dropFaces(base, t => (t % 97 < 3) || (t > 400 && t < 412));
  const r = repair(input);
  ok(r.stats.before.open > 0 && r.stats.holeLoops > 0, 'holes are detected and filled');
  ok(r.stats.after.clean && manifoldInfo(r.positions, r.indices).valid, 'hole repair finishes as a valid clean solid');
}

{
  const input = { pos: base.pos.slice(), idx: base.idx.slice() };
  for (let t = 0; t < input.idx.length / 3; t += 19) {
    const i = t * 3, q = input.idx[i + 1]; input.idx[i + 1] = input.idx[i + 2]; input.idx[i + 2] = q;
  }
  const before = meshHealth(new Float32Array(input.pos), new Uint32Array(input.idx));
  const r = repair(input);
  ok(!before.clean && before.flipped > 0, 'flipped triangles are detected by the shared health check');
  ok(r.stats.flipped > 0 && r.stats.after.clean, 'repair turns inconsistent triangles back around');
}

{
  const input = { pos: base.pos.slice(), idx: base.idx.slice() };
  for (let i = 0; i < input.idx.length; i += 3) {
    const q = input.idx[i + 1]; input.idx[i + 1] = input.idx[i + 2]; input.idx[i + 2] = q;
  }
  const r = repair(input);
  ok(r.stats.shellsTurned === 1 && r.stats.after.clean, 'an inside-out closed shell is turned outward');
  ok(manifoldInfo(r.positions, r.indices).volume > 0, 'inside-out repair produces positive solid volume');
}

{
  const input = { pos: base.pos.slice(), idx: base.idx.slice() };
  const a = input.idx[0], b = input.idx[1], n = input.pos.length / 3;
  input.pos.push(input.pos[a * 3] * 1.5, input.pos[a * 3 + 1] * 1.5, input.pos[a * 3 + 2] * 1.5);
  input.idx.push(a, b, n);
  const before = meshHealth(new Float32Array(input.pos), new Uint32Array(input.idx));
  const r = repair(input);
  ok(before.tangled > 0, 'a third triangle sharing one edge is detected as tangled');
  ok(r.stats.tangledRemoved > 0 && r.stats.after.clean, 'repair removes the tangled fin');
}

{
  const input = { pos: base.pos.slice(), idx: base.idx.slice() };
  for (let i = 0; i < 300; i += 3) input.idx.push(input.idx[i], input.idx[i + 1], input.idx[i + 2]);
  const r = repair(input);
  ok(r.stats.duplicateRemoved === 100, 'duplicate triangles are removed');
  ok(r.stats.after.clean, 'duplicate removal leaves a clean mesh');
}

{
  const a = base;
  const b = cleanSphere(14, 40, 28, 16, 0, 0);
  const off = a.pos.length / 3;
  const input = { pos: a.pos.concat(b.pos), idx: a.idx.concat(b.idx.map(i => i + off)) };
  const before = meshHealth(new Float32Array(input.pos), new Uint32Array(input.idx));
  const r = repair(input);
  ok(before.clean && r.stats.after.clean, 'separate/overlapping closed parts are allowed by the health check');
}

{
  const input = dropFaces(base, t => {
    const ia = base.idx[t * 3], ib = base.idx[t * 3 + 1], ic = base.idx[t * 3 + 2];
    return base.pos[ia * 3 + 1] > 0 && base.pos[ib * 3 + 1] > 0 && base.pos[ic * 3 + 1] > 0;
  });
  const r = repair(input);
  ok(r.stats.before.open > 0, 'a very large missing region is detected as a hole');
  ok(r.stats.after.clean, 'large-hole repair still returns a clean mesh');
}

{
  const p = new Float32Array(base.pos);
  const i = new Uint32Array(base.idx);
  const empty = new Uint32Array(i.length + 3); empty.set(i); empty.set([0, 0, 0], i.length);
  const h = meshHealth(p, empty);
  ok(h.clean && h.degenerate === 1, 'empty triangles are reported but never make a mesh dirty');
}

{
  const welded = meshHealth(new Float32Array(base.pos), new Uint32Array(base.idx));
  const loose = soup(base);
  const unwelded = meshHealth(new Float32Array(loose.pos), new Uint32Array(loose.idx));
  ok(welded.clean === unwelded.clean && welded.open === unwelded.open && welded.tangled === unwelded.tangled && welded.flipped === unwelded.flipped,
    'health result is the same whether points arrive pre-welded or as triangle soup');
}

console.log(failures() ? `\n${failures()} FAILED` : '\nall repair regressions passed');
