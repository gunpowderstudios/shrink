// Tron (beta) page code: gathers a model from the viewer, makes the flat car (through a stand-in Worker), shows it in place of the model,
// puts the model back, and saves a GLB. three is the real library; the page's esm.sh imports are swapped for local ones.
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { flattenCar } from '../tron-core.js';
import { makeCar } from './tron-fixture.mjs';
import { ok, root, build } from './helpers.mjs';
await MeshoptSimplifier.ready;

const dom = new JSDOM(`<body><section id="stepExtra"><details id="retouchDetails"></details></section>
  <button id="showOriginalBtn"></button><button id="showOptimizedBtn"></button><button id="compareBtn"></button></body>`, { url: 'http://localhost/' });
const win = dom.window;
Object.assign(globalThis, { window: win, document: win.document, Blob: win.Blob, FileReader: win.FileReader });
let saved = null;
win.URL.createObjectURL = b => { saved = b; return 'blob:test'; }; win.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = win.URL.createObjectURL;
win.HTMLAnchorElement.prototype.click = function () {};

// a stand-in Worker: same messages as tron-worker.js, run in this process
class FakeWorker {
  constructor() { this.l = { message: new Set(), error: new Set() }; this.data = null; }
  addEventListener(t, f) { this.l[t]?.add(f); } removeEventListener(t, f) { this.l[t]?.delete(f); }
  postMessage(m) {
    if (m.type === 'load') { this.data = m.data; return; }
    setTimeout(() => {
      try {
        const r = flattenCar(this.data, { faces: m.faces, simplifier: MeshoptSimplifier, onProgress: text => this.emit({ type: 'progress', id: m.id, text }) });
        this.emit({ type: 'done', id: m.id, result: r });
      } catch (e) { this.emit({ type: 'error', id: m.id, message: e.message }); }
    }, 0);
  }
  emit(data) { for (const f of [...this.l.message]) f({ data }); }
}
globalThis.Worker = FakeWorker; win.Worker = FakeWorker;

// the car as a three.js model, the way the viewer holds it (one mesh with a material colour; no texture)
const car = makeCar(), g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(car.src.positions, 3)); g.setAttribute('normal', new THREE.BufferAttribute(car.src.normals, 3)); g.setIndex(new THREE.BufferAttribute(car.src.indices, 1));
const model = new THREE.Group(); model.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc81e1e })));
const scene = new THREE.Scene(); scene.add(model);
win.__shrinkApp = { THREE, originalModel: model, currentModel: model, baseName: () => 'mini' };
win.__shrinkViewer = { scene };

// load the page script with its web imports made local
fs.mkdirSync(build, { recursive: true });
const code = fs.readFileSync(path.join(root, 'tron-ui.js'), 'utf8')
  .replace("import(`./tron-core.js?v=${VERSION}`)", "import('../tron-core.js')")
  .replace("import('https://esm.sh/three@0.180.0/examples/jsm/exporters/GLTFExporter.js')", "import('three/examples/jsm/exporters/GLTFExporter.js')");
const file = path.join(root, 'tests', 'tron-ui.build.mjs'); fs.writeFileSync(file, code);
await import(file + '?t=' + Date.now());
const $ = id => document.getElementById(id);

ok($('tronDetails') && $('tronDetails').classList.contains('game-only'), 'the Tron panel is added, for Game mode');
ok($('stepExtra').firstElementChild === $('tronDetails') || $('tronDetails').nextElementSibling === $('retouchDetails'), 'it sits in the left panel just before Retouch textures');
ok(/beta/i.test($('tronDetails').querySelector('summary').textContent), 'it is labelled beta');
const T = win.__shrinkTron;
ok(T.facesForPos(0) === 300 && T.facesForPos(100) === 20000, 'the slider runs 300 to 20,000 triangles');
ok(T.facesForPos($('tronFaces').value) === 800, 'it starts at 800');
ok(T.facesForPos(T.posForFaces(5000)) >= 4900 && T.facesForPos(T.posForFaces(5000)) <= 5100, 'positions and triangle counts convert back and forth');
ok($('tronDownload').hidden && $('tronBack').hidden, 'download and back are hidden until there is a result');
$('tronFaces').value = String(T.posForFaces(900)); $('tronFaces').dispatchEvent(new win.Event('input'));
ok(/^9[0-9]{2}$/.test($('tronFacesValue').textContent) || $('tronFacesValue').textContent === '900', 'the slider shows its triangle count: ' + $('tronFacesValue').textContent);

await win.__shrinkTron.make();
const tc = scene.getObjectByName('TronCar');
ok(!!tc, 'a Tron car is added to the viewer');
ok(model.visible === false, 'the normal model is hidden while Tron shows');
ok(tc && !!tc.getObjectByName('Body') && ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].every(n => tc.getObjectByName(n)), 'it has a Body and four named wheels');
const wfl = tc.getObjectByName('Wheel_FL');
ok(wfl.children.length === 2 && wfl.position.x < 0 && Math.abs(wfl.position.y + 0.1) < 0.2, 'each wheel is its own node, sitting at the wheel position');
const body = tc.getObjectByName('Body');
ok(body.geometry.attributes.color && body.material.vertexColors, 'the body is painted with per-face colours');
const nTri = body.geometry.attributes.position.count / 3;
ok(nTri > 100 && nTri <= 1000 * 1.25, `the body has about the triangles asked for (${nTri} for ~900)`);
ok(/triangles in the body/.test($('tronStatus').textContent) && !$('tronStatus').classList.contains('bad'), 'the status says what was made: ' + $('tronStatus').textContent);
ok(!$('tronDownload').hidden && !$('tronBack').hidden, 'download and back appear');

// the slider re-makes it
$('tronFaces').value = String(T.posForFaces(400)); $('tronFaces').dispatchEvent(new win.Event('change'));
await new Promise(r => setTimeout(r, 900));
const tc2 = scene.getObjectByName('TronCar');
ok(tc2 && tc2 !== tc && tc2.getObjectByName('Body').geometry.attributes.position.count / 3 < nTri, 'moving the slider makes a new, flatter car');
ok(scene.children.filter(c => c.name === 'TronCar').length === 1, 'only one Tron car is ever in the scene');

// save
$('tronDownload').click(); await new Promise(r => setTimeout(r, 400));
ok(saved && saved.size > 1000, `a GLB is saved (${saved?.size} bytes)`);
{
  const buf = await new Promise(r => { const fr = new win.FileReader(); fr.onload = () => r(fr.result); fr.readAsArrayBuffer(saved); });
  const dv = new DataView(buf); ok(dv.getUint32(0, true) === 0x46546C67, 'the file is a binary glTF');
  const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  ok(['Body', 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].every(n => json.nodes.some(x => x.name === n)), 'the saved GLB has the Body and four wheel nodes');
  ok(json.meshes.some(m => m.primitives.some(p => p.attributes.COLOR_0 !== undefined)), 'the face colours are saved as vertex colours');
  ok(!(json.images || []).length, 'no textures in the saved file');
}

// back to the normal model
$('tronBack').click();
ok(!scene.getObjectByName('TronCar') && model.visible === true, 'Back puts the normal model back');
await win.__shrinkTron.make();
$('showOriginalBtn').click();
ok(!scene.getObjectByName('TronCar') && model.visible === true, 'choosing Original/Reduced in the viewer also leaves Tron');
await win.__shrinkTron.make();
win.dispatchEvent(new win.CustomEvent('shrink:model-opened', { detail: {} }));
ok(!scene.getObjectByName('TronCar') && model.visible === true && $('tronDownload').hidden, 'opening another model drops the Tron car');

// a car that is long in Z is turned so its length runs along X
{
  const g2 = g.clone(); g2.rotateY(Math.PI / 2);
  const m2 = new THREE.Group(); m2.add(new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ color: 0xc81e1e }))); scene.add(m2);
  win.__shrinkApp.originalModel = m2; win.__shrinkApp.currentModel = m2;
  await win.__shrinkTron.make();
  const tc3 = scene.getObjectByName('TronCar'); const bb = new THREE.Box3().setFromObject(tc3.getObjectByName('Body')), sz = bb.getSize(new THREE.Vector3());
  ok(sz.x > sz.z * 1.5 && !!tc3.getObjectByName('Wheel_FL'), 'a car that was long in Z comes out long in X, with its wheels');
  ok(/turned/.test($('tronStatus').textContent), 'and the status says it was turned');
}
fs.unlinkSync(file);
