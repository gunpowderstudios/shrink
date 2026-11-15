import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import ManifoldModule from 'manifold-3d';
import { prepareHollow } from '../hollow-core.js';
import { ok } from './helpers.mjs';

const wasm = await ManifoldModule(); wasm.setup();
const data = g => ({ positions: new Float32Array(g.attributes.position.array), indices: new Uint32Array(g.index.array) });
const prepare = (g, wall) => prepareHollow({ THREE, MeshBVH, wasm, ...data(g), wall });
const box = new THREE.BoxGeometry(20, 20, 20);
const project = prepare(box, 2);
ok(project.chambers === 1 && Math.abs(project.savedMl - 4.096) < 0.1, '20 mm cube has one 16 mm cavity, within 0.1 ml');
const h1 = { point: [-4, -10, 0], normal: [0,-1,0] }, h2 = { point: [4,-10,0], normal: [0,-1,0] };
ok(!project.drill([h1], 3).positions, 'one hole does not permit export');
ok(!project.drill([h1,h1], 3).positions, 'overlapping holes do not count twice');
const cut = project.drill([h1,h2], 3);
ok(cut.count[0] === 2 && cut.positions?.length > 0 && cut.savedMl > project.savedMl, 'two connected drain holes produce a valid shell');
if (cut.positions) {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: cut.positions, triVerts: cut.indices });
  mesh.merge();
  const solid = new wasm.Manifold(mesh);
  ok(solid.status() === 'NoError' && Math.abs(solid.boundingBox().max[1] - 10) < 1e-5, 'output is manifold at the exact exterior size');
  ok(solid.rayCast([-4,-12,0],[-4,-5,0]).length === 0 && solid.rayCast([0,-12,0],[0,-5,0]).length === 2, 'drain channel reaches the cavity but the adjacent wall is intact');
  solid.delete();
}
project.dispose();
try { prepare(new THREE.BoxGeometry(30,3,30), 2); ok(false, 'thin part refused'); } catch { ok(true, 'thin part refused'); }
try { prepare(new THREE.PlaneGeometry(30,30), 2); ok(false, 'open mesh refused'); } catch { ok(true, 'open mesh refused'); }

const a = wasm.Manifold.cube([14, 14, 14], true);
const b = a.translate([24, 0, 0]);
const stick = wasm.Manifold.cube([13, 2, 2], true);
const bridge = stick.translate([12,0,0]);
const barbell = wasm.Manifold.union([a, b, bridge]);
const mesh = barbell.getMesh();
const two = prepareHollow({ THREE, MeshBVH, wasm, positions: mesh.vertProperties, indices: mesh.triVerts, wall: 2 });
const hole = (x, z) => ({ point: [x,-7,z], normal: [0,-1,0] });
ok(two.chambers === 2, 'thin bridge stays solid and leaves two separate chambers');
ok(!two.drill([hole(-3,0), hole(3,0)], 2).positions, 'holes opening only one of two chambers cannot export');
ok(two.drill([hole(-3,0), hole(3,0), hole(21,0), hole(27,0)], 2).count.every(n => n === 2), 'both chambers can be checked independently');
ok(two.drill([hole(-3,0), hole(3,0), hole(21,0), hole(27,0)], 2).positions?.length > 0, 'both drained chambers export as one shell');
two.dispose();
for (const item of [mesh, barbell, bridge, stick, b, a]) item.delete?.();
