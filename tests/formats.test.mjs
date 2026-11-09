// 3MF and USDZ export: real zip files that open, with the right units and axes.
import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { build3mf, buildUsdz } from '../export-formats.js';
import { ok } from './helpers.mjs';

const geo = new THREE.BoxGeometry(2, 4, 6);   // x 2, y 4 (up), z 6
const model = new THREE.Group(); model.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
model.position.set(10, 0, 0);

const m = build3mf({ THREE, model, mmPerUnit: 10 });
ok(m.triangles === 12, '3MF: a box has 12 triangles');
const z3 = unzipSync(new Uint8Array(await m.blob.arrayBuffer()));
ok(z3['[Content_Types].xml'] && z3['_rels/.rels'] && z3['3D/3dmodel.model'], '3MF: has the three required parts');
const xml = strFromU8(z3['3D/3dmodel.model']);
ok(xml.includes('unit="millimeter"'), '3MF: units are millimetres');
ok((xml.match(/<vertex /g) || []).length === 24 && (xml.match(/<triangle /g) || []).length === 12, '3MF: 24 vertices and 12 triangles');
const zs = [...xml.matchAll(/<vertex x="([-\d.]+)" y="([-\d.]+)" z="([-\d.]+)"/g)].map(r => +r[3]);
ok(Math.abs(Math.max(...zs) - Math.min(...zs) - 40) < 1e-6, '3MF: Z is up (the 4-unit height x 10 mm = 40 mm)');
const xs = [...xml.matchAll(/<vertex x="([-\d.]+)"/g)].map(r => +r[1]);
ok(Math.abs(Math.min(...xs) - 90) < 1e-6, '3MF: the parent move (10 units x 10 mm) is baked in');

const u = buildUsdz({ THREE, model, mmPerUnit: 10 });
const bytes = new Uint8Array(await u.blob.arrayBuffer());
ok(u.triangles === 12, 'USDZ: 12 triangles');
const zu = unzipSync(bytes);
ok(zu['model.usda'], 'USDZ: holds model.usda');
const usda = strFromU8(zu['model.usda']);
ok(usda.startsWith('#usda 1.0') && usda.includes('upAxis = "Y"') && usda.includes('metersPerUnit = 1'), 'USDZ: metres, Y-up');
const ys = [...usda.matchAll(/\(([-\d.e]+),([-\d.e]+),([-\d.e]+)\)/g)].slice(0, 24).map(r => +r[2]);
ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.04) < 1e-6, 'USDZ: 40 mm tall = 0.04 m');
const nameLen = new DataView(bytes.buffer).getUint16(26, true), extraLen = new DataView(bytes.buffer).getUint16(28, true);
ok((30 + nameLen + extraLen) % 64 === 0, 'USDZ: file data starts on a 64-byte boundary');
