// Material look: the Metallic slider changes the preview and is written into the saved GLB; the original is never touched.
import { JSDOM } from 'jsdom'; import * as THREE from 'three'; import fs from 'fs'; import path from 'path';
import { root, prepare, ok } from './helpers.mjs';
prepare();
const dom = new JSDOM('<!doctype html><body class="app-mode-game"><section id="stepExtra"><details id="retouchDetails"></details></section></body>', { runScripts: 'outside-only' });
const w = dom.window;
const mk = (metal, withMap = false) => { const m = new THREE.MeshStandardMaterial({ metalness: metal, roughness: .3 }); if (withMap) m.metalnessMap = new THREE.Texture(); return m; };
const car = new THREE.Group(); const chrome = mk(1), trim = mk(0.5, true), cloth = mk(0);
for (const m of [chrome, trim, cloth]) car.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
const live = car.clone(true); live.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });        // like the live reducer's preview
w.__shrinkApp = { originalModel: car, optimizedModel: live };
w.eval(fs.readFileSync(path.join(root, 'material-look.js'), 'utf8'));
await new Promise(r => setTimeout(r, 50));
const L = w.__shrinkMaterial, $ = id => w.document.getElementById(id);
const metals = model => { const o = []; model.traverse(x => { if (x.isMesh) o.push(+x.material.metalness.toFixed(3)); }); return o; };
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

ok(!!$('materialDetails') && $('materialDetails').nextElementSibling === $('retouchDetails'), 'the Material look panel is in the Touch up step, before Retouch textures');
ok(/up to 100% metallic/.test($('metalScaleNote').textContent) && $('metalScaleValue').textContent === 'As in the file', 'it reports how metallic the model is and starts "As in the file"');
$('metalScale').value = '20'; fire($('metalScale'), 'input');
ok(JSON.stringify(metals(car)) === JSON.stringify([0.2, 0.1, 0]) && JSON.stringify(metals(live)) === JSON.stringify([0.2, 0.1, 0]), 'dragging to 20% scales every material, in the original view and the reduced preview: ' + metals(car));
ok($('metalScaleValue').textContent === '20%', 'the label shows 20%');
// repeated moves scale from the file's own value, not from the last result
$('metalScale').value = '50'; fire($('metalScale'), 'input'); $('metalScale').value = '100'; fire($('metalScale'), 'input');
ok(JSON.stringify(metals(car)) === JSON.stringify([1, 0.5, 0]), 'back at 100% every material is exactly as in the file again: ' + metals(car));
// a freshly cloned live preview (the reducer rebuilds it) inherits the setting
L.setScale(30);
const rebuilt = car.clone(true); rebuilt.traverse(o => { if (o.isMesh) o.material = o.material.clone(); }); w.__shrinkApp.optimizedModel = rebuilt;
w.dispatchEvent(new w.CustomEvent('shrink:live-updated')); 
ok(JSON.stringify(metals(rebuilt)) === JSON.stringify([0.3, 0.15, 0]), 'a rebuilt live preview follows the setting: ' + metals(rebuilt));
// buttons
$('metalPaint').click(); ok(Math.abs(L.metalScale - 0.2) < 1e-9 && metals(car)[0] === 0.2, 'the "Car paint" button sets 20%');
$('metalMatt').click(); ok(metals(car).every(v => v === 0), 'the "No metal" button sets 0%');
$('metalReset').click(); ok(L.metalScale === 1 && metals(car)[0] === 1, 'the reset button restores the file');

// export: a glTF-Transform document
const fakeDoc = factors => { const mats = factors.map(f => ({ f, getMetallicFactor() { return this.f; }, setMetallicFactor(v) { this.f = v; return this; } })); return { mats, getRoot: () => ({ listMaterials: () => mats }) }; };
let d = fakeDoc([1, 0.5, 0]); L.setScale(20);
const n = L.applyToDocument(d); ok(JSON.stringify(d.mats.map(m => +m.f.toFixed(3))) === JSON.stringify([0.2, 0.1, 0]) && n === 2, 'the saved GLB gets the same factors (' + d.mats.map(m => m.f) + ')');
L.setScale(100); d = fakeDoc([1, 0.5]); ok(L.applyToDocument(d) === 0 && d.mats[0].f === 1, 'at 100% the saved GLB is left exactly as it is');
// a new model resets the setting
L.setScale(10); w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 20));
ok(L.metalScale === 1, 'opening a new model starts "As in the file" again');
const flat = new THREE.Group(); flat.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk(0))); w.__shrinkApp.originalModel = flat; w.__shrinkApp.optimizedModel = null;
w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 20));
ok(/non-metallic/.test($('metalScaleNote').textContent), 'a model with no metal says there is nothing to turn down');
console.log('all passed'); process.exit(0);
