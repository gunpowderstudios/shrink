// Racer vertex budget (racer-geometry-core.js): wheels to ~7k each, hidden surfaces crushed, total inside the budget, names and pivots intact.
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { compactPrimitive, getPrimitiveVertexCount } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { applyGeometry, collectParts, vertexReport, wheelSetProblem, pivotProblems, visibleTriangles, WHEEL_NAME } from '../racer-geometry-core.js';
await MeshoptSimplifier.ready;
const ops = { simplifier: MeshoptSimplifier, compactPrimitive, getPrimitiveVertexCount };

// a subdivided box shell (outside faces); scale s about the origin, n x n quads per face
function box(sx, sy, sz, n) {
  const pos = [], idx = [];
  const face = (o, u, v) => { const b = pos.length / 3; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(o[0] + u[0] * i / n + v[0] * j / n, o[1] + u[1] * i / n + v[1] * j / n, o[2] + u[2] * i / n + v[2] * j / n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = b + j * (n + 1) + i; idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); } };
  const x = sx / 2, y = sy / 2, z = sz / 2;
  face([-x, -y, z], [2 * x, 0, 0], [0, 2 * y, 0]); face([x, -y, -z], [-2 * x, 0, 0], [0, 2 * y, 0]);
  face([-x, -y, -z], [0, 0, 2 * z], [0, 2 * y, 0]); face([x, -y, z], [0, 0, -2 * z], [0, 2 * y, 0]);
  face([-x, y, z], [2 * x, 0, 0], [0, 0, -2 * z]); face([-x, -y, -z], [2 * x, 0, 0], [0, 0, 2 * z]);
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
// a tyre: a cylinder about Z, `seg` segments round, `rows` rings along the width
function tyre(r, w, seg, rows) {
  const pos = [], idx = [];
  for (let k = 0; k <= rows; k++) for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; pos.push(Math.cos(a) * r, Math.sin(a) * r, -w / 2 + w * k / rows); }
  for (let k = 0; k < rows; k++) for (let i = 0; i < seg; i++) { const a = k * seg + i, b = k * seg + (i + 1) % seg; idx.push(a, b, a + seg, b, b + seg, a + seg); }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
function addMesh(doc, buf, mat, g, name) {
  const p = doc.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buf), i = doc.createAccessor().setType('SCALAR').setArray(g.idx).setBuffer(buf);
  return doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION', p).setIndices(i).setMaterial(mat));
}
function car({ wheelNames = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'], shift = 0 } = {}) {
  const doc = new Document(), buf = doc.createBuffer(), mat = doc.createMaterial('car'), scene = doc.createScene();
  const outer = box(4, 1.2, 1.8, 100), inner = box(2.4, 0.7, 1.2, 100);                   // 'inner' sits inside 'outer': nobody can see it
  const body = doc.createNode('Body').setMesh(addMesh(doc, buf, mat, { pos: Float32Array.from([...outer.pos, ...inner.pos]), idx: Uint32Array.from([...outer.idx, ...[...inner.idx].map(v => v + outer.pos.length / 3)]) }, 'body'));
  scene.addChild(body);
  const at = [[1.3, -0.6 + shift, 0.95], [1.3, -0.6, -0.95], [-1.3, -0.6, 0.95], [-1.3, -0.6, -0.95]];
  wheelNames.forEach((n, k) => scene.addChild(doc.createNode(n).setTranslation(at[k]).setMesh(addMesh(doc, buf, mat, tyre(0.4, 0.25, 200, 100), n))));
  return { doc, outerVerts: outer.pos.length / 3, innerVerts: inner.pos.length / 3, outerTris: outer.idx.length / 3 };
}

assert.ok(WHEEL_NAME.test('Wheel_FL') && WHEEL_NAME.test('Wheel_F') && WHEEL_NAME.test('Wheel_R') && !WHEEL_NAME.test('Wheel_FLx') && !WHEEL_NAME.test('wheel_FL'));
assert.equal(wheelSetProblem(['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']), null);
assert.equal(wheelSetProblem(['Wheel_F', 'Wheel_RL', 'Wheel_RR']), null, 'three-wheeler');
assert.equal(wheelSetProblem(['Wheel_L', 'Wheel_R']), null, 'caravan');
assert.ok(/Separate the wheels/.test(wheelSetProblem([])), 'no wheels: says what to do');
assert.ok(/expects/.test(wheelSetProblem(['Wheel_FL', 'Wheel_FR'])), 'a half set is a mistake');

// 1. visibility: the inner shell is not seen, the outer one is
{
  const { doc, outerTris } = car(); const parts = collectParts(doc), b = parts.find(p => !p.wheel);
  const wp = b.pos, flags = (await visibleTriangles([{ wp, idx: b.idx }], { resolution: 512 }))[0];
  let outerSeen = 0, innerSeen = 0; for (let t = 0; t < flags.length; t++) if (flags[t]) { if (t < outerTris) outerSeen++; else innerSeen++; }
  console.log('outer seen', outerSeen, 'of', outerTris, '· inner seen', innerSeen, 'of', flags.length - outerTris);
  assert.ok(innerSeen < 0.02 * (flags.length - outerTris), 'the enclosed shell is not seen');
  const bottom = outerTris / 6 * 5; // the bottom face is face index 5 (the last sixth of the outer shell)
  let bottomSeen = 0; for (let t = Math.floor(bottom); t < outerTris; t++) if (flags[t]) bottomSeen++;
  assert.ok(bottomSeen < 0.15 * (outerTris / 6), 'the underside is not seen from the ring of directions: ' + bottomSeen);
  assert.ok(outerSeen > 0.55 * outerTris, 'most of the outside is seen: ' + outerSeen);
}

// 2. the budget
{
  const { doc, outerVerts, innerVerts } = car(); const before = vertexReport(doc);
  console.log('before', before.total, 'wheels', before.wheels.map(w => w.verts).join('/'), 'body', before.body);
  assert.ok(before.total > 150000, 'the test car is heavy');
  const rep = await applyGeometry(doc, { totalVerts: 80000, wheelVerts: 7000, resolution: 512 }, ops);
  const a = rep.after; console.log('after', a.total, 'wheels', a.wheels.map(w => w.verts).join('/'), 'body', a.body, 'seen', rep.seen, 'hidden', rep.hidden, rep.warnings);
  assert.ok(a.total <= 80000 * 1.05, 'inside the total budget: ' + a.total);
  for (const w of a.wheels) assert.ok(w.verts <= 7000 * 1.1 && w.verts >= 3000, w.name + ' near 7k: ' + w.verts);
  assert.deepEqual(a.wheelNames.sort(), ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'], 'wheel names kept');
  assert.equal(rep.warnings.length, 0, 'no warnings: ' + rep.warnings.join(' | '));
  // names, translations and the single material are untouched
  const root = doc.getRoot(); assert.equal(root.listMaterials().length, 1); assert.equal(root.listMaterials()[0].getName(), 'car');
  assert.deepEqual(root.listNodes().find(n => n.getName() === 'Wheel_FL').getTranslation(), [1.3, -0.6, 0.95], 'wheel node position untouched');
  assert.deepEqual(root.listNodes().find(n => n.getName() === 'Body').getTranslation(), [0, 0, 0]);
  // the hidden inner shell lost much more than the visible outer one
  const bp = collectParts(doc).find(p => !p.wheel), used = new Set(bp.idx);
  const pos = bp.pos; let innerLeft = 0, outerLeft = 0; for (const v of used) { const x = Math.abs(pos[v * 3]), y = Math.abs(pos[v * 3 + 1]); if (x <= 1.21 && y <= 0.36 && Math.abs(pos[v * 3 + 2]) <= 0.61) innerLeft++; else outerLeft++; }
  console.log('inner left', innerLeft, 'of', innerVerts, '· outer left', outerLeft, 'of', outerVerts);
  assert.ok(innerLeft < 0.2 * innerVerts, 'the inside is crushed'); assert.ok(outerLeft > 0.3 * outerVerts, 'the outside keeps its detail');
  assert.equal(pivotProblems(doc).length, 0, 'pivots still at the wheel centres');
}

// 3. a car already inside its budget is left alone
{
  const { doc } = car(); const small = await applyGeometry(doc, { totalVerts: 80000, wheelVerts: 7000, resolution: 256 }, ops);
  const again = await applyGeometry(doc, { totalVerts: 80000, wheelVerts: 7000, resolution: 256 }, ops);
  assert.equal(again.after.total, small.after.total, 'second run changes nothing'); assert.ok(again.notes.some(n => /already within/.test(n)));
}

// 4. mistakes are reported, not hidden
{
  const { doc } = car({ wheelNames: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Body2'] });
  const rep = await applyGeometry(doc, { resolution: 128 }, ops); assert.ok(rep.warnings.some(w => /expects/.test(w)), 'missing wheel name reported');
  const off = car(); const wheel = off.doc.getRoot().listNodes().find(n => n.getName() === 'Wheel_FL'), pos = wheel.getMesh().listPrimitives()[0].getAttribute('POSITION'), arr = pos.getArray();
  for (let i = 0; i < arr.length; i += 3) arr[i] += 0.3; pos.setArray(arr);
  assert.ok(pivotProblems(off.doc).some(p => p.name === 'Wheel_FL'), 'an off-centre pivot is found');
}
// 5. through the real compression: names, pivots, one material, vertex budget and file size survive meshopt + quantisation and a read-back
{
  const { NodeIO } = await import('@gltf-transform/core'); const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { meshopt, prune } = await import('@gltf-transform/functions'); const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const { doc } = car(); await applyGeometry(doc, { resolution: 256 }, ops);
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const bytes = await io.writeBinary(doc), back = await io.readBinary(bytes), r = back.getRoot();
  const rep = vertexReport(back); console.log('file', (bytes.length / 1048576).toFixed(2), 'MB, vertices', rep.total);
  assert.ok(rep.total <= 80000 * 1.05 && bytes.length < 2.5 * 1048576, 'budget and size hold after compression');
  assert.deepEqual(rep.wheelNames.sort(), ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']); assert.equal(r.listMaterials().length, 1); assert.equal(r.listMaterials()[0].getName(), 'car');
  const fl = r.listNodes().find(n => n.getName() === 'Wheel_FL'); assert.deepEqual(fl.getTranslation().map(v => +v.toFixed(5)), [1.3, -0.6, 0.95], 'the wheel pivot is still where the wheel is');
  const wm = fl.getWorldMatrix(); assert.ok(Math.abs(wm[12] - 1.3) < 1e-5 && Math.abs(wm[13] + 0.6) < 1e-5 && Math.abs(wm[14] - 0.95) < 1e-5, 'world position of the wheel centre unchanged');
}
// 6. the ground step after the budget puts the tyres exactly on y = 0 and keeps every wheel pivot at its wheel
{
  const { getBounds } = await import('@gltf-transform/functions'); const { centreOnGround } = await import('../ground-core.js');
  const { doc } = car(); await applyGeometry(doc, { resolution: 256 }, ops);
  const before = getBounds(doc.getRoot().listScenes()[0]); assert.ok(before.min[1] < -0.5, 'the test car starts below the ground');
  const g = centreOnGround(doc, getBounds); assert.ok(g.moved);
  const after = getBounds(doc.getRoot().listScenes()[0]); assert.ok(Math.abs(after.min[1]) < 1e-5, 'tyres on y = 0: ' + after.min[1]);
  assert.ok(Math.abs((after.min[0] + after.max[0]) / 2) < 1e-5 && Math.abs((after.min[2] + after.max[2]) / 2) < 1e-5, 'centred on the origin');
  assert.equal(pivotProblems(doc).length, 0, 'pivots untouched by the move');
}
console.log('racer-geometry tests passed');
