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

/* ---------- Smaller file: drop the metallic/roughness and occlusion maps ---------- */
const tex = (w, h = w) => { const t = new THREE.Texture(); t.image = { width: w, height: h }; return t; };
const base = tex(2048), normal = tex(2048), orm = tex(2048), ao = tex(2048);
const mk2 = (opts = {}) => { const m = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 1, map: base, normalMap: normal, ...opts }); return m; };
const car2 = new THREE.Group(); car2.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk2({ roughnessMap: orm, metalnessMap: orm, aoMap: ao })));
const live2 = car2.clone(true); live2.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
w.__shrinkApp.originalModel = car2; w.__shrinkApp.optimizedModel = live2;
w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 30));
const sv = L.savings();
ok(sv.mr.has && sv.ao.has && sv.mr.count === 1 && sv.ao.count === 1, 'savings: the metallic/roughness image and the AO image are each freed on their own');
ok(Math.abs(sv.mr.file - 512 * 512 * 0.4) < 1 && sv.mr.gpu > 1e6, 'savings are sized at the data-map size (512px, WebP): ' + Math.round(sv.mr.file) + ' bytes file');
ok(!$('dropMapsBlock').hidden && /saves/.test($('dropMRRowSave').textContent), 'the Smaller file block shows what each box would save: ' + $('dropMRRowSave').textContent);
$('dropMR').checked = true; fire($('dropMR'), 'change');
ok(car2.children[0].material.roughnessMap === null && car2.children[0].material.metalnessMap === null && live2.children[0].material.roughnessMap === null, 'ticking "metallic/roughness" removes the map from the original view and the reduced preview');
ok(car2.children[0].material.roughness === 0.5 && car2.children[0].material.aoMap === ao, 'it uses a flat roughness (50%) and leaves the AO map alone');
ok(Math.abs(L.metalScale - 0.2) < 1e-9 && car2.children[0].material.metalness === 0.2, 'metal drops to car-paint 20% so the car does not turn to chrome without its map');
$('roughVal').value = '30'; fire($('roughVal'), 'input'); ok(car2.children[0].material.roughness === 0.3 && live2.children[0].material.roughness === 0.3, 'the roughness slider drives both views');
$('dropAO').checked = true; fire($('dropAO'), 'change'); ok(car2.children[0].material.aoMap === null, 'ticking AO removes the occlusion map too');
$('dropMR').checked = false; fire($('dropMR'), 'change'); $('dropAO').checked = false; fire($('dropAO'), 'change');
ok(car2.children[0].material.roughnessMap === orm && car2.children[0].material.metalnessMap === orm && car2.children[0].material.aoMap === ao && live2.children[0].material.roughnessMap === orm && car2.children[0].material.roughness === 1, 'un-ticking puts the real maps (and roughness) back, in both views');
// export
const fakeDoc2 = () => { const m = { f: 1, rough: 1, mr: {}, occ: {}, getMetallicFactor() { return this.f; }, setMetallicFactor(v) { this.f = v; return this; }, getMetallicRoughnessTexture() { return this.mr; }, setMetallicRoughnessTexture(t) { this.mr = t; return this; }, setRoughnessFactor(v) { this.rough = v; return this; }, getOcclusionTexture() { return this.occ; }, setOcclusionTexture(t) { this.occ = t; return this; } }; return { m, getRoot: () => ({ listMaterials: () => [m] }) }; };
L.setMaps({ mr: true, ao: true, r: 0.4 }); L.setScale(20); const fd = fakeDoc2(); L.applyToDocument(fd);
ok(fd.m.mr === null && fd.m.occ === null && fd.m.rough === 0.4 && Math.abs(fd.m.f - 0.2) < 1e-9, 'the saved GLB loses both maps and gets the flat roughness and metal values');
ok(L.changed === true, '"changed" is true so Save edited GLB rewrites the file');
L.setMaps({ mr: false, ao: false }); L.setScale(100); ok(L.changed === false, 'and false again once everything is back to the file');
// shared ORM image (AO + roughness + metal packed into one texture): dropping one slot alone frees nothing
const packed = new THREE.Group(); packed.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk2({ roughnessMap: orm, metalnessMap: orm, aoMap: orm })));
w.__shrinkApp.originalModel = packed; w.__shrinkApp.optimizedModel = null; w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 30));
const sv2 = L.savings();
ok(sv2.mr.count === 0 && sv2.ao.count === 0 && sv2.both.count === 1 && /shares its image/.test($('dropMRRowSave').textContent), 'a packed ORM image is only freed when both maps are dropped, and the panel says so: ' + $('dropMRRowSave').textContent);
// a texture that is also the base colour is never counted as freed
const colour = new THREE.Group(); colour.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk2({ aoMap: base })));
w.__shrinkApp.originalModel = colour; w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 30));
ok(L.savings().ao.count === 0, 'an image that is also the base colour is never offered as a saving');
// nothing to drop -> the block stays hidden
const plain = new THREE.Group(); plain.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk2({}))); w.__shrinkApp.originalModel = plain; w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 30));
ok($('dropMapsBlock').hidden === true, 'a model with no such maps hides the Smaller file block');

/* ---------- Colour correction + reflection ---------- */
// jsdom has no canvas: a tiny fake that keeps the pixels so the real maths runs end to end
w.HTMLCanvasElement.prototype.getContext = function () {
  const cv = this; return {
    drawImage(im) { cv._px = new Uint8ClampedArray(im.px); cv._w = cv.width; cv._h = cv.height; },
    getImageData() { return { data: cv._px, width: cv._w, height: cv._h }; }, putImageData() {} };
};
const yellow = [230, 190, 20, 255];
const mkImg = () => ({ width: 2, height: 2, px: [...yellow, ...yellow, ...yellow, ...yellow] });
const hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const d = mx - mn; const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60; return { h, s: mx === 0 ? 0 : d / mx, v: mx }; };
// pure maths
const id = L.colourMatrix(0, 1, 1); ok(id.every((v, i) => Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-9), 'the neutral colour matrix is the identity');
const grey = L.adjustRGBA(new Float32Array(yellow), L.colourMatrix(0, 0, 1)); ok(Math.abs(grey[0] - grey[1]) < 1.5 && Math.abs(grey[1] - grey[2]) < 1.5, 'saturation 0 makes yellow grey: ' + [...grey].slice(0, 3).map(Math.round));
const blue = L.adjustRGBA(new Float32Array(yellow), L.colourMatrix(180, 1, 1)); ok(hsl([...blue]).h > 180 && hsl([...blue]).h < 270, 'hue +180 turns yellow bluish: ' + [...blue].slice(0, 3).map(Math.round));
const dim = L.adjustRGBA(new Float32Array(yellow), L.colourMatrix(0, 1, 0.5)); ok(Math.abs(dim[0] - 115) < 1 && dim[3] === 255, 'brightness 50% halves the values and leaves alpha alone');
const pal = L.adjustRGBA(new Float32Array(yellow), L.colourMatrix(0, 1.6, 1)); ok(pal[0] >= 230 && pal[2] < 20 + 1, 'saturation 160% pushes yellow further out and clips at 0..255: ' + [...pal].slice(0, 3).map(Math.round));

// preview: textured material gets a corrected COPY; the original picture is never touched
const orig = new THREE.Texture(mkImg()); orig.colorSpace = THREE.SRGBColorSpace;
const paint = new THREE.MeshStandardMaterial({ map: orig, roughness: 0.6, metalness: 0 });
const plainM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.8, 0.5, 0.05), roughness: 0.5 });
const carC = new THREE.Group(); carC.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint), new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plainM));
const liveC = carC.clone(true); liveC.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
w.__shrinkApp.originalModel = carC; w.__shrinkApp.optimizedModel = liveC;
w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 30));
ok(!!$('hueShift') && !!$('satScale') && !!$('brightScale') && !!$('glossScale'), 'the panel has Hue, Saturation, Brightness and Reflection sliders');
const origPx = [...orig.image.px];
L.setColour({ s: 0 });
const pm = carC.children[0].material.map, lm = liveC.children[0].material.map;
ok(pm && pm !== orig && pm.source !== orig.source && lm === pm, 'saturation 0: the preview uses a corrected copy with its own image source, in both views');
ok(JSON.stringify([...orig.image.px]) === JSON.stringify(origPx), 'the original picture is not modified');
ok(Math.abs(pm.image._px[0] - pm.image._px[1]) < 2, 'the corrected picture really is grey now');
ok(pm.userData.origW === 2, 'the copy remembers the original size so size estimates stay right');
const c1 = carC.children[1].material.color; ok(Math.abs(c1.r - c1.g) < 0.02, 'a plain colour value is corrected too: ' + [c1.r, c1.g, c1.b].map(v => v.toFixed(2)));
ok(L.changed === true && $('satScaleValue').textContent === '0%', 'it counts as a change and the label says 0%');
$('colourReset').click();
ok(carC.children[0].material.map === orig && Math.abs(carC.children[1].material.color.g - 0.5) < 1e-6 && L.changed === false, 'Reset colour puts the file\'s own picture and colour back exactly');
$('hueShift').value = '90'; fire($('hueShift'), 'input'); ok(L.colour.hue === 90 && $('hueShiftValue').textContent === '+90°', 'the Hue slider drives the setting');
$('colourReset').click(); fire($('hueShift'), 'input');   // slider value still 90 in the DOM? reset must also move it
$('hueShift').value = '0'; L.setColour({ h: 0 });

// reflection = roughness multiplier, from the file's own value
L.setColour({ g: 0.5 }); ok(Math.abs(carC.children[0].material.roughness - 0.3) < 1e-9 && Math.abs(liveC.children[0].material.roughness - 0.3) < 1e-9, 'Reflection 50% halves the roughness in both views');
L.setColour({ g: 0.8 }); L.setColour({ g: 1 }); ok(Math.abs(carC.children[0].material.roughness - 0.6) < 1e-9, 'and goes back to exactly the file\'s value');

// export: glTF-Transform fake with factors and a texture
const mkDocMat = () => ({ bc: [0.8, 0.5, 0.05, 1], rf: 0.6, mf: 1, tex: null, getMetallicFactor() { return this.mf; }, setMetallicFactor(v) { this.mf = v; return this; }, getRoughnessFactor() { return this.rf; }, setRoughnessFactor(v) { this.rf = v; return this; },
  getMetallicRoughnessTexture: () => null, getOcclusionTexture: () => null, getEmissiveTexture: () => null, getNormalTexture: () => null,
  getBaseColorTexture() { return this.tex; }, setBaseColorTexture(t) { this.tex = t; return this; }, getBaseColorFactor() { return this.bc; }, setBaseColorFactor(v) { this.bc = v; return this; } });
const dm = mkDocMat(), docC = { getRoot: () => ({ listMaterials: () => [dm] }) };
L.setColour({ g: 0.5 }); L.applyToDocument(docC); ok(Math.abs(dm.rf - 0.3) < 1e-9, 'the saved GLB gets the same reflection setting');
L.setColour({ g: 1, s: 0 }); const nC = await L.applyColourToDocument(docC);
ok(nC === 1 && Math.abs(dm.bc[0] - dm.bc[1]) < 0.03 && dm.bc[3] === 1, 'the saved GLB gets the corrected plain colour, alpha kept: ' + dm.bc.map(v => v.toFixed(2)));
L.setColour({ s: 1 }); const dm2 = mkDocMat(); ok(await L.applyColourToDocument({ getRoot: () => ({ listMaterials: () => [dm2] }) }) === 0 && dm2.bc[1] === 0.5, 'with the colour sliders neutral the saved GLB colours are left alone');

/* ---------- data maps saved at half size ---------- */
const dtex = { n: 'orm' }, ctex = { n: 'colour' }, ntex = { n: 'normal' };
const dmat = { getMetallicRoughnessTexture: () => dtex, getOcclusionTexture: () => dtex, getBaseColorTexture: () => ctex, getNormalTexture: () => ntex, getEmissiveTexture: () => null };
const ddoc = { getRoot: () => ({ listMaterials: () => [dmat] }) };
ok($('smallData').checked && L.smallData === true, 'the "half size" option starts on');
ok(L.textureCap(ddoc, dtex, 1024) === 512 && L.textureCap(ddoc, dtex, 256) === 256, 'a metallic/roughness/AO picture is capped at 512px but never enlarged');
ok(L.textureCap(ddoc, ctex, 1024) === 1024 && L.textureCap(ddoc, ntex, 1024) === 1024, 'colour and normal pictures keep the chosen size');
const shared = { ...dmat, getBaseColorTexture: () => dtex };
ok(L.textureCap({ getRoot: () => ({ listMaterials: () => [shared] }) }, dtex, 1024) === 1024, 'an image that is also the base colour keeps the full size');
w.__shrinkApp.originalModel = car2; w.__shrinkApp.optimizedModel = null; w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 30));
$('smallData').checked = false; fire($('smallData'), 'change');
ok(L.smallData === false && L.textureCap(ddoc, dtex, 1024) === 1024 && Math.abs(L.savings().mr.file - 1024 * 1024 * 0.4) < 1, 'switched off, everything keeps the chosen size and the savings follow');
w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await new Promise(r => setTimeout(r, 20));
ok(L.smallData === true && $('smallData').checked, 'a new model starts with it on again');

console.log('all passed'); process.exit(0);
