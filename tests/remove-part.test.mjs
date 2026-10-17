import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { prepare, select, selectAll, clearSelection, selectedCorners, deadCorners, applySelection, aliveTotal, snapshotMasks, restoreMasks, rewrite, stripEmpty } from '../remove-part-core.js';

// a body (indexed box-ish strip) and a "mirror" (non-indexed triangles) sitting out at x=5, on a node moved by +10 in x
function model() {
  const doc = new Document(), buf = doc.createBuffer();
  const P = [], I = [];
  for (let i = 0; i < 20; i++) { P.push(i * 0.1, 0, 0, i * 0.1, 1, 0, i * 0.1, 0, 1); }              // 20 vertices-triples (60 verts)
  for (let i = 0; i < 20; i++) I.push(i * 3, i * 3 + 1, i * 3 + 2);                                   // 20 body triangles
  const mk = (arr, type, cls) => doc.createAccessor().setType(type).setArray(new cls(arr)).setBuffer(buf);
  const body = doc.createPrimitive().setAttribute('POSITION', mk(P, 'VEC3', Float32Array)).setIndices(mk(I, 'SCALAR', Uint16Array));
  const M = [];                                                                                         // non-indexed: 5 triangles at x = 5..
  for (let i = 0; i < 5; i++) M.push(5 + i * 0.01, 0.5, 0, 5 + i * 0.01, 1.5, 0, 5 + i * 0.01, 0.5, 1);
  const uvM = []; for (let i = 0; i < 15; i++) uvM.push(i / 15, 0.5);
  const mirror = doc.createPrimitive().setAttribute('POSITION', mk(M, 'VEC3', Float32Array)).setAttribute('TEXCOORD_0', mk(uvM, 'VEC2', Float32Array));
  const n1 = doc.createNode('body').setMesh(doc.createMesh('b').addPrimitive(body));
  const n2 = doc.createNode('mirror').setTranslation([10, 0, 0]).setMesh(doc.createMesh('m').addPrimitive(mirror));
  doc.createScene().addChild(n1).addChild(n2);
  return { doc, body, mirror };
}

{ const { doc } = model(); const d = prepare(doc);
  assert.equal(d.total, 25, 'all triangles found'); assert.equal(d.prims.length, 2);
  // the mirror node is moved by 10, so its world x is about 15
  const mp = d.prims.find(p => p.node.getName() === 'mirror'); assert.ok(Math.abs(mp.cen[0] - 15) < 0.1, 'world centroid ' + mp.cen[0]);
  assert.equal(select(d, [15, 0.8, 0.3], 0.5), 5, 'brush picks the mirror'); assert.equal(d.selected, 5);
  assert.equal(select(d, [15, 0.8, 0.3], 0.5), 0, 'again changes nothing');
  assert.equal(selectedCorners(d).length, 5 * 9, 'highlight corners');
  assert.equal(select(d, [15, 0.8, 0.3], 0.5, { erase: true }), 5, 'erase unselects'); assert.equal(d.selected, 0);
  console.log('ok select'); }

{ const { doc, body, mirror } = model(); const d = prepare(doc);
  select(d, [15, 0.8, 0.3], 0.5);                           // the mirror
  select(d, [0.2, 0.3, 0.3], 0.15);                         // a few body triangles
  const before = d.selected; assert.ok(before > 5);
  assert.equal(applySelection(d, 'remove'), before); assert.equal(aliveTotal(d), 25 - before); assert.equal(d.selected, 0);
  assert.equal(rewrite(doc, d), 2, 'both touched primitives rebuilt');
  const mp = mirror.getExtras(); assert.equal(mp.shrinkEmpty, true, 'emptied primitive kept as a flagged placeholder');
  const idx = body.getIndices().getArray(), nv = body.getAttribute('POSITION').getCount();
  assert.equal(idx.length / 3, 20 - (before - 5), 'body triangles left');
  assert.equal(nv, idx.length, 'unused vertices dropped (each triangle owned 3)');
  assert.ok(Math.max(...idx) < nv, 'indices valid');
  assert.equal(stripEmpty(doc), 1, 'placeholder stripped for export'); assert.equal(doc.getRoot().listMeshes().length, 1, 'empty mesh dropped');
  console.log('ok remove'); }

// weld back: the cut part can be brought back, from a baseline that never changes
{ const { doc, body, mirror } = model(); const d = prepare(doc);
  select(d, [15, 0.8, 0.3], 0.5); const snap0 = snapshotMasks(d); applySelection(d, 'remove'); rewrite(doc, d);
  assert.equal(d.dead, 5); assert.equal(deadCorners(d).length, 5 * 9, 'ghost shows the cut triangles');
  assert.equal(select(d, [15, 0.8, 0.3], 0.5, { mode: 'remove' }), 0, 'remove mode cannot pick what is already cut');
  assert.equal(select(d, [0, 0, 0], 100, { mode: 'weld' }), 5, 'weld mode picks only cut triangles');
  assert.equal(applySelection(d, 'weld'), 5); assert.equal(d.dead, 0); rewrite(doc, d);
  assert.equal(mirror.getExtras().shrinkEmpty, undefined, 'placeholder flag cleared');
  assert.equal(mirror.getIndices().getCount(), 15, 'mirror back with its 5 triangles'); assert.equal(mirror.getAttribute('TEXCOORD_0').getCount(), 15, 'uv data came back too');
  assert.equal(stripEmpty(doc), 0, 'nothing to strip once welded back');
  // partial weld + selectAll + undo of masks
  select(d, [15, 0.8, 0.3], 0.5); applySelection(d, 'remove'); const snap = snapshotMasks(d); rewrite(doc, d);
  assert.equal(selectAll(d, 'weld'), 5); clearSelection(d); restoreMasks(d, snap0); assert.equal(d.dead, 0, 'masks restored from a snapshot');
  restoreMasks(d, snap); assert.equal(d.dead, 5);
  console.log('ok weld back'); }

{ const { doc, mirror } = model(); const d = prepare(doc);
  const p = d.prims.find(x => x.node.getName() === 'mirror'); p.sel[0] = 1; p.sel[3] = 1; d.selected = 2;
  applySelection(d, 'remove'); rewrite(doc, d);
  assert.equal(mirror.getIndices().getCount(), 9, 'non-indexed primitive becomes indexed with 3 triangles');
  assert.equal(mirror.getAttribute('POSITION').getCount(), 9); assert.equal(mirror.getAttribute('TEXCOORD_0').getCount(), 9, 'other attributes follow');
  console.log('ok non-indexed'); }

{ const { doc } = model(); const d = prepare(doc);
  assert.equal(select(d, [0, 0, 0], 100, { eye: [-50, 0.3, 0.3] }), 0, 'faces pointing away from the eye are not picked');
  assert.equal(select(d, [0, 0, 0], 100, { eye: [50, 0.3, 0.3] }), 25, 'faces towards the eye are picked');
  console.log('ok facing'); }
console.log('remove-part tests passed');
