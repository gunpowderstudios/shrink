import assert from 'node:assert/strict';
import { Document, getBounds } from '@gltf-transform/core';
import { centreOnGround } from '../ground-core.js';

function boxMesh(doc, buf, x0, x1, y0, y1, z0, z1) {
  const P = [], I = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) P.push(x, y, z);
  for (const f of [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]) I.push(f[0], f[1], f[2], f[0], f[2], f[3]);
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf), ix = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf);
  return doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ix));
}
// two root nodes, one rotated, model floating off to one side
{
  const doc = new Document(), buf = doc.createBuffer(), sc = doc.createScene();
  sc.addChild(doc.createNode('Body').setMesh(boxMesh(doc, buf, 3, 7, 2, 4, -1, 5)));
  sc.addChild(doc.createNode('Wheel_FL').setTranslation([4, 2.5, 6]).setRotation([0, 0.3826834, 0, 0.9238795]).setMesh(boxMesh(doc, buf, -0.5, 0.5, -0.5, 0.5, -0.2, 0.2)));
  const r = centreOnGround(doc, getBounds); assert.ok(r.moved);
  const b = getBounds(sc);
  assert.ok(Math.abs(b.min[1]) < 1e-5, 'lowest point on y=0: ' + b.min[1]);
  assert.ok(Math.abs((b.min[0] + b.max[0]) / 2) < 1e-5 && Math.abs((b.min[2] + b.max[2]) / 2) < 1e-5, 'centred on x and z');
  const w = sc.listChildren()[1]; assert.deepEqual(w.getRotation().map(v => +v.toFixed(5)), [0, 0.38268, 0, 0.92388], 'rotation untouched');
  assert.equal(centreOnGround(doc, getBounds).moved, false, 'a second run changes nothing');
}
// a node sitting under a parent that is scaled and rotated still ends up centred (only the top-level translation moves)
{
  const doc = new Document(), buf = doc.createBuffer(), sc = doc.createScene();
  const root = doc.createNode('Root').setScale([2, 2, 2]).setRotation([0, 0.7071068, 0, 0.7071068]).setTranslation([10, -5, 3]);
  root.addChild(doc.createNode('Car').setMesh(boxMesh(doc, buf, 0, 2, 1, 2, 0, 6)));
  sc.addChild(root);
  centreOnGround(doc, getBounds); const b = getBounds(sc);
  assert.ok(Math.abs(b.min[1]) < 1e-5 && Math.abs(b.min[0] + b.max[0]) < 1e-4 && Math.abs(b.min[2] + b.max[2]) < 1e-4, JSON.stringify(b));
}
assert.equal(centreOnGround(new Document(), getBounds).moved, false);
console.log('ground tests passed');
