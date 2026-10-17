import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { mergeDocuments } from '@gltf-transform/functions';
import { mergePart } from '../add-part-core.js';
import { prepare } from '../remove-part-core.js';

function box(name, x) {
  const doc = new Document(), buf = doc.createBuffer();
  const P = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], I = [0, 1, 2, 2, 1, 3];
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf)).setMaterial(doc.createMaterial(name + 'mat'));
  const node = doc.createNode(name).setTranslation([x, 0, 0]).setMesh(doc.createMesh(name).addPrimitive(prim));
  doc.createScene().addChild(node); return doc;
}
const car = box('car', 0), wheel = box('wheel', 0.5);
const before = prepare(car).prims.length;
const w = mergePart(car, wheel, { translation: [10, 2, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2] }, 'Part_wheel_1', mergeDocuments);
assert.equal(car.getRoot().listScenes().length, 1, 'the part scene is folded into the main one');
const kids = car.getRoot().listScenes()[0].listChildren(); assert.equal(kids.length, 2); assert.equal(kids[1], w, 'new node is last, so existing mesh-node ordinals do not move');
assert.equal(car.getRoot().listMeshes().length, 2); assert.equal(car.getRoot().listMaterials().length, 2, 'the part keeps its own material');
assert.equal(wheel.getRoot().listScenes()[0].listChildren().length, 1, 'the part document is not changed');
const M = w.listChildren()[0].getWorldMatrix(); assert.ok(Math.abs(M[12] - (10 + 2 * 0.5)) < 1e-6 && Math.abs(M[13] - 2) < 1e-6 && Math.abs(M[0] - 2) < 1e-6, 'wrapper transform applies to the part: ' + M.slice(12, 15));
// the same part can be added again (a second wheel) and the first car part keeps its path key
const w2 = mergePart(car, wheel, { translation: [-10, 2, 0], scale: [-2, 2, 2] }, 'Part_wheel_2', mergeDocuments); assert.equal(car.getRoot().listMeshes().length, 3);
const keys = prepare(car).prims.map(p => p.pk); assert.equal(keys[0], '0:0', 'car primitive keeps its key'); assert.equal(keys.length, before + 2);
assert.equal(car.getRoot().listBuffers().length, 1, 'one buffer, so the GLB can be written');
assert.ok(car.getRoot().listAccessors().every(a => a.getBuffer() === car.getRoot().listBuffers()[0]));
console.log('add-part tests passed');
