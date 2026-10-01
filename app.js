import * as THREE from 'https://esm.sh/three@0.180.0';
import { OrbitControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { WebIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { simplifyWithProtection, smoothNormals } from './mesh-tools.js?v=1.75';

const $ = (id) => document.getElementById(id);
const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'), workspace: $('workspace'), fileName: $('fileName'),
  originalSize: $('originalSize'), triangleCount: $('triangleCount'), vertexCount: $('vertexCount'), textureCount: $('textureCount'),
  preset: $('preset'), geometry: $('geometry'), geometryValue: $('geometryValue'), textureSize: $('textureSize'),
  textureQuality: $('textureQuality'), textureQualityValue: $('textureQualityValue'), webpToggle: $('webpToggle'),
  quantizeToggle: $('quantizeToggle'), meshoptToggle: $('meshoptToggle'), optimizeBtn: $('optimizeBtn'), status: $('status'), resultCard: $('resultCard'),
  optimizedSize: $('optimizedSize'), optimizedTriangleCount: $('optimizedTriangleCount'), optimizedVertexCount: $('optimizedVertexCount'),
  savingBadge: $('savingBadge'), downloadBtn: $('downloadBtn'), newFileBtn: $('newFileBtn'),
  viewer: $('viewer'), showOriginalBtn: $('showOriginalBtn'), showOptimizedBtn: $('showOptimizedBtn'), resetViewBtn: $('resetViewBtn'), wireframeBtn: $('wireframeBtn'),
  progressWrap: $('progressWrap'), progressBar: $('progressBar'), progressLabel: $('progressLabel'),
  textureEditor: $('textureEditor'), textureSelect: $('textureSelect'), textureDimensions: $('textureDimensions'),
  textureCanvas: $('textureCanvas'), textureEmpty: $('textureEmpty'), brushToolBtn: $('brushToolBtn'), eyedropperToolBtn: $('eyedropperToolBtn'),
  paintColor: $('paintColor'), blackSwatchBtn: $('blackSwatchBtn'), whiteSwatchBtn: $('whiteSwatchBtn'),
  brushSize: $('brushSize'), brushSizeValue: $('brushSizeValue'), brushOpacity: $('brushOpacity'), brushOpacityValue: $('brushOpacityValue'),
  undoPaintBtn: $('undoPaintBtn'), resetTextureBtn: $('resetTextureBtn'), applyTextureBtn: $('applyTextureBtn'), saveEditedBtn: $('saveEditedBtn')
};

const PRESETS = {
  safe:       { geometry: 90, textureSize: 2048, textureQuality: 88, webp: true, quantize: true, meshopt: true },
  game:       { geometry: 70, textureSize: 1024, textureQuality: 82, webp: true, quantize: true, meshopt: true },
  small:      { geometry: 50, textureSize: 1024, textureQuality: 76, webp: true, quantize: true, meshopt: true },
  aggressive: { geometry: 35, textureSize: 512,  textureQuality: 70, webp: true, quantize: true, meshopt: true }
};

let sourceFile = null;
let sourceBytes = null;
let optimizedBytes = null;
let originalURL = null;
let optimizedURL = null;
let originalModel = null;
let optimizedModel = null;
let currentModel = null;
let wireframeEnabled = false;
let currentWhich = 'original';
let compareOn = false;
let compareSplit = 0.5;
let sourceKind = 'glb';          // glb | stl | obj | ply (what the user opened)
let lastReduce = null;
let optimizedIsPreview = false;   // true while optimizedModel is the live preview (shares materials with the original)
let reducedVersion = 0;

let textureOriginals = [];
let selectedTextureIndex = 0;
let selectedTextureMime = 'image/png';
let selectedTextureName = '';
let paintTool = 'brush';
let painting = false;
let lastPoint = null;
let undoImageData = null;
let textureDirty = false;

const io = new WebIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder
  });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100000);
camera.position.set(4, 3, 6);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
els.viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
window.__shrinkViewer = { renderer, scene, camera, controls };

scene.add(new THREE.HemisphereLight(0xffffff, 0x303540, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.0); key.position.set(4, 8, 6); scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd2ff, 1.2); fill.position.set(-6, 3, -4); scene.add(fill);

const grid = new THREE.GridHelper(20, 20, 0x525964, 0x2b3038);
grid.material.opacity = 0.32; grid.material.transparent = true; scene.add(grid);

function resizeViewer() {
  const r = els.viewer.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resizeViewer).observe(els.viewer);

const _size = new THREE.Vector2();
function renderFrame() {
  if (compareOn && originalModel && optimizedModel) {
    // Split-screen: original on the left of the divider, reduced on the right.
    renderer.getSize(_size);
    const sx = Math.round(_size.x * compareSplit);
    renderer.setScissorTest(true);
    originalModel.visible = true; optimizedModel.visible = false;
    renderer.setScissor(0, 0, sx, _size.y);
    renderer.render(scene, camera);
    originalModel.visible = false; optimizedModel.visible = true;
    renderer.setScissor(sx, 0, _size.x - sx, _size.y);
    renderer.render(scene, camera);
    originalModel.visible = true;
    renderer.setScissorTest(false);
  } else {
    renderer.render(scene, camera);
  }
}
(function animate(){ requestAnimationFrame(animate); controls.update(); renderFrame(); })();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

async function loadSceneFromURL(url) {
  return await new Promise((resolve, reject) => loader.load(url, g => resolve(g.scene), undefined, reject));
}

function disposeReduced() {
  const m = optimizedModel;
  if (!m) return;
  if (scene.children.includes(m)) scene.remove(m);
  if (optimizedIsPreview) m.traverse(o => { if (o.isMesh) o.geometry?.dispose?.(); });   // materials are shared with the original
  else disposeModel(m);
  optimizedModel = null; optimizedIsPreview = false;
}

// Swap in a new reduced model (live preview or a finished build) while keeping whatever the viewer is showing consistent.
function setReduced(model, isPreview) {
  const prev = optimizedModel;
  if (prev === model) { optimizedIsPreview = isPreview; return; }
  const wasShown = prev && currentModel === prev;
  disposeReduced();
  optimizedModel = model; optimizedIsPreview = isPreview; reducedVersion++;
  els.showOptimizedBtn.disabled = false;
  if (compareOn) { scene.add(model); applyWireframe(model, wireframeEnabled); }
  else if (wasShown) { currentModel = model; scene.add(model); applyWireframe(model, wireframeEnabled); }
}

function disposeModel(model) {
  if (!model) return;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m) return;
      Object.values(m).forEach(v => v?.isTexture && v.dispose());
      m.dispose?.();
    });
  });
}

function applyWireframe(model, enabled) {
  if (!model) return;
  model.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m || !('wireframe' in m)) return;
      m.wireframe = enabled;
      m.needsUpdate = true;
    });
  });
}

function showModel(model, which, reframe = true) {
  if (compareOn) leaveCompare();
  if (currentModel) scene.remove(currentModel);
  currentModel = model;
  currentWhich = which;
  if (currentModel) {
    applyWireframe(currentModel, wireframeEnabled);
    scene.add(currentModel);
  }
  els.showOriginalBtn.classList.toggle('active', which === 'original');
  els.showOptimizedBtn.classList.toggle('active', which === 'optimized');
  if (reframe) frameModel(model);
}

function enterCompare() {
  if (!originalModel || !optimizedModel) return false;
  if (currentModel) scene.remove(currentModel);
  scene.add(originalModel); scene.add(optimizedModel);
  applyWireframe(originalModel, wireframeEnabled); applyWireframe(optimizedModel, wireframeEnabled);
  compareOn = true;
  els.showOriginalBtn.classList.remove('active'); els.showOptimizedBtn.classList.remove('active');
  window.dispatchEvent(new CustomEvent('shrink:compare', { detail: { on: true } }));
  return true;
}

function leaveCompare() {
  if (!compareOn) return;
  compareOn = false;
  if (originalModel) { scene.remove(originalModel); originalModel.visible = true; }
  if (optimizedModel) { scene.remove(optimizedModel); optimizedModel.visible = true; }
  currentModel = null;
  window.dispatchEvent(new CustomEvent('shrink:compare', { detail: { on: false } }));
}

function setCompare(on) {
  if (on) return enterCompare();
  if (!compareOn) return true;
  const which = currentWhich === 'optimized' && optimizedModel ? 'optimized' : 'original';
  const model = which === 'optimized' ? optimizedModel : originalModel;
  leaveCompare();
  showModel(model, which, false);
  return true;
}

function frameModel(model) {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  controls.target.copy(sphere.center);
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = radius * 1000;
  camera.position.copy(sphere.center).add(new THREE.Vector3(1.4, .9, 1.7).normalize().multiplyScalar(radius * 3.2));
  camera.updateProjectionMatrix();
  controls.update();
  grid.position.y = box.min.y;
  grid.scale.setScalar(Math.max(radius / 5, .1));
}

function getModelStats(model) {
  let triangles = 0, vertices = 0, textures = new Set();
  model.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    vertices += g.attributes.position?.count || 0;
    triangles += g.index ? Math.floor(g.index.count / 3) : Math.floor((g.attributes.position?.count || 0) / 3);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => m && Object.values(m).forEach(v => v?.isTexture && textures.add(v.uuid)));
  });
  return { triangles, vertices, textures: textures.size };
}

async function reloadOriginalPreview(reframe = false) {
  if (!sourceBytes) return;
  if (originalURL) URL.revokeObjectURL(originalURL);
  originalURL = URL.createObjectURL(new Blob([sourceBytes], { type: 'model/gltf-binary' }));
  const oldModel = originalModel;
  originalModel = await loadSceneFromURL(originalURL);
  if (currentModel === oldModel || !currentModel) showModel(originalModel, 'original', reframe);
  disposeModel(oldModel);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(2)} MB`;
}
function num(n) { return new Intl.NumberFormat().format(n); }
function setStatus(msg, error = false) { els.status.textContent = msg; els.status.classList.toggle('error', error); }
function setProgress(percent, label) {
  const p = Math.max(0, Math.min(100, percent));
  els.progressWrap.classList.remove('hidden');
  els.progressBar.style.width = `${p}%`;
  els.progressLabel.textContent = label;
}
function hideProgress() { els.progressWrap.classList.add('hidden'); }
function markCustom(){ els.preset.value = 'custom'; }

function applyPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  els.geometry.value = p.geometry;
  els.textureSize.value = p.textureSize;
  els.textureQuality.value = p.textureQuality;
  els.webpToggle.checked = p.webp;
  els.quantizeToggle.checked = p.quantize;
  els.meshoptToggle.checked = p.meshopt;
  updateLabels();
}
function updateLabels(){
  els.geometryValue.textContent = `${els.geometry.value}%`;
  els.textureQualityValue.textContent = `${els.textureQuality.value}%`;
  els.brushSizeValue.textContent = `${els.brushSize.value} px`;
  els.brushOpacityValue.textContent = `${els.brushOpacity.value}%`;
}

els.preset.addEventListener('change', () => applyPreset(els.preset.value));
els.geometry.addEventListener('input', () => { updateLabels(); markCustom(); });
els.textureQuality.addEventListener('input', () => { updateLabels(); markCustom(); });
els.textureSize.addEventListener('change', markCustom);
els.webpToggle.addEventListener('change', markCustom);
els.quantizeToggle.addEventListener('change', markCustom);
els.meshoptToggle.addEventListener('change', markCustom);

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
els.fileInput.addEventListener('change', () => els.fileInput.files[0] && openFile(els.fileInput.files[0]));
['dragenter','dragover'].forEach(t => els.dropZone.addEventListener(t, e => { e.preventDefault(); els.dropZone.classList.add('dragover'); }));
['dragleave','drop'].forEach(t => els.dropZone.addEventListener(t, e => { e.preventDefault(); els.dropZone.classList.remove('dragover'); }));
els.dropZone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });
els.newFileBtn.addEventListener('click', () => els.fileInput.click());
els.showOriginalBtn.addEventListener('click', () => originalModel && showModel(originalModel, 'original'));
els.showOptimizedBtn.addEventListener('click', () => optimizedModel && showModel(optimizedModel, 'optimized'));
els.resetViewBtn.addEventListener('click', () => { const m = currentModel || originalModel; if (m) frameModel(m); });
els.wireframeBtn.addEventListener('click', () => {
  wireframeEnabled = !wireframeEnabled;
  if (compareOn) { applyWireframe(originalModel, wireframeEnabled); applyWireframe(optimizedModel, wireframeEnabled); } else applyWireframe(currentModel, wireframeEnabled);
  els.wireframeBtn.classList.toggle('active', wireframeEnabled);
  els.wireframeBtn.textContent = wireframeEnabled ? 'Shaded' : 'Wireframe';
});
async function buildAndSave() {
  // Anything painted on the 3D model must be written into the GLB first, or it would silently be left out of the saved file.
  if (window.__shrinkPaint?.hasEdits?.() || textureDirty) {
    setStatus('Applying your texture edits first…');
    await applyTextureToModel();
  }
  const ok = await optimizeModel();
  if (ok && optimizedBytes) downloadOptimized();
}
els.optimizeBtn.addEventListener('click', buildAndSave);
els.downloadBtn.addEventListener('click', downloadOptimized);

const paintCtx = els.textureCanvas.getContext('2d', { willReadFrequently: true });

function setPaintTool(tool) {
  paintTool = tool;
  els.brushToolBtn.classList.toggle('active', tool === 'brush');
  els.eyedropperToolBtn.classList.toggle('active', tool === 'eyedropper');
  els.textureCanvas.style.cursor = tool === 'eyedropper' ? 'copy' : 'crosshair';
}

els.brushToolBtn.addEventListener('click', () => setPaintTool('brush'));
els.eyedropperToolBtn.addEventListener('click', () => setPaintTool('eyedropper'));
els.blackSwatchBtn.addEventListener('click', () => { els.paintColor.value = '#000000'; setPaintTool('brush'); });
els.whiteSwatchBtn.addEventListener('click', () => { els.paintColor.value = '#ffffff'; setPaintTool('brush'); });
els.brushSize.addEventListener('input', updateLabels);
els.brushOpacity.addEventListener('input', updateLabels);
els.textureSelect.addEventListener('change', async () => {
  selectedTextureIndex = Number(els.textureSelect.value);
  await loadTextureIntoEditor(selectedTextureIndex);
});
els.undoPaintBtn.addEventListener('click', undoLastStroke);
els.resetTextureBtn.addEventListener('click', resetSelectedTexture);
els.applyTextureBtn.addEventListener('click', applyTextureToModel);
els.saveEditedBtn.addEventListener('click', downloadEdited);

function canvasPoint(evt) {
  const rect = els.textureCanvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * (els.textureCanvas.width / rect.width),
    y: (evt.clientY - rect.top) * (els.textureCanvas.height / rect.height)
  };
}

function sampleColour(point) {
  const x = Math.max(0, Math.min(els.textureCanvas.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(els.textureCanvas.height - 1, Math.round(point.y)));
  const p = paintCtx.getImageData(x, y, 1, 1).data;
  els.paintColor.value = `#${[p[0], p[1], p[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  setPaintTool('brush');
  setStatus(`Sampled ${els.paintColor.value}. Paint over the unwanted detail.`);
}

function drawBrush(from, to) {
  paintCtx.save();
  paintCtx.globalAlpha = Number(els.brushOpacity.value) / 100;
  paintCtx.strokeStyle = els.paintColor.value;
  paintCtx.fillStyle = els.paintColor.value;
  paintCtx.lineWidth = Number(els.brushSize.value);
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.beginPath();
  paintCtx.moveTo(from.x, from.y);
  paintCtx.lineTo(to.x, to.y);
  paintCtx.stroke();
  if (from.x === to.x && from.y === to.y) {
    paintCtx.beginPath();
    paintCtx.arc(to.x, to.y, Number(els.brushSize.value) / 2, 0, Math.PI * 2);
    paintCtx.fill();
  }
  paintCtx.restore();
  textureDirty = true;
}

els.textureCanvas.addEventListener('pointerdown', evt => {
  if (!els.textureCanvas.width || !els.textureCanvas.height) return;
  evt.preventDefault();
  const point = canvasPoint(evt);
  if (paintTool === 'eyedropper') {
    sampleColour(point);
    return;
  }
  try {
    undoImageData = paintCtx.getImageData(0, 0, els.textureCanvas.width, els.textureCanvas.height);
    els.undoPaintBtn.disabled = false;
  } catch (err) {
    console.warn('Could not capture undo image:', err);
    undoImageData = null;
  }
  painting = true;
  lastPoint = point;
  els.textureCanvas.setPointerCapture?.(evt.pointerId);
  drawBrush(point, point);
});

els.textureCanvas.addEventListener('pointermove', evt => {
  if (!painting || paintTool !== 'brush') return;
  evt.preventDefault();
  const point = canvasPoint(evt);
  drawBrush(lastPoint, point);
  lastPoint = point;
});

function stopPainting(evt) {
  if (!painting) return;
  painting = false;
  lastPoint = null;
  if (evt?.pointerId !== undefined) els.textureCanvas.releasePointerCapture?.(evt.pointerId);
}
els.textureCanvas.addEventListener('pointerup', stopPainting);
els.textureCanvas.addEventListener('pointercancel', stopPainting);
els.textureCanvas.addEventListener('pointerleave', evt => { if (evt.buttons === 0) stopPainting(evt); });

function undoLastStroke() {
  if (!undoImageData) return;
  paintCtx.putImageData(undoImageData, 0, 0);
  undoImageData = null;
  els.undoPaintBtn.disabled = true;
  textureDirty = true;
  setStatus('Last brush stroke undone.');
}

async function prepareTextureEditor() {
  textureOriginals = [];
  els.textureSelect.innerHTML = '';
  els.textureEditor.classList.add('hidden');
  if (!sourceBytes) return;

  const doc = await io.readBinary(sourceBytes);
  const textures = doc.getRoot().listTextures();
  if (!textures.length) return;

  textures.forEach((texture, index) => {
    const image = texture.getImage();
    const mime = texture.getMimeType() || 'image/png';
    textureOriginals.push({
      bytes: image ? new Uint8Array(image) : null,
      mime,
      name: texture.getName() || `Texture ${index + 1}`
    });
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = texture.getName() || `Texture ${index + 1}`;
    els.textureSelect.appendChild(option);
  });

  els.textureEditor.classList.remove('hidden');
  selectedTextureIndex = 0;
  els.textureSelect.value = '0';
  await loadTextureIntoEditor(0);
}

async function loadTextureIntoEditor(index) {
  if (!sourceBytes) return;
  textureDirty = false;
  undoImageData = null;
  els.undoPaintBtn.disabled = true;
  els.applyTextureBtn.disabled = true;
  els.resetTextureBtn.disabled = true;
  els.textureEmpty.classList.add('hidden');

  try {
    const doc = await io.readBinary(sourceBytes);
    const textures = doc.getRoot().listTextures();
    const texture = textures[index];
    const image = texture?.getImage();
    if (!texture || !image?.byteLength) throw new Error('This texture has no editable embedded image.');

    selectedTextureIndex = index;
    selectedTextureMime = texture.getMimeType() || 'image/png';
    selectedTextureName = texture.getName() || `Texture ${index + 1}`;
    await drawImageBytesToCanvas(new Uint8Array(image), selectedTextureMime);
    els.textureDimensions.textContent = `${els.textureCanvas.width} × ${els.textureCanvas.height}`;
    els.applyTextureBtn.disabled = false;
    els.resetTextureBtn.disabled = !textureOriginals[index]?.bytes;
    setStatus(`Texture ready — use Eyedropper then Brush to retouch it.`);
  } catch (err) {
    console.warn(err);
    els.textureCanvas.width = 1;
    els.textureCanvas.height = 1;
    paintCtx.clearRect(0, 0, 1, 1);
    els.textureDimensions.textContent = 'Unavailable';
    els.textureEmpty.textContent = err.message || 'No editable image texture found.';
    els.textureEmpty.classList.remove('hidden');
    setStatus('This texture cannot be painted in the browser.', true);
  }
}

async function drawImageBytesToCanvas(bytes, mime) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  els.textureCanvas.width = bitmap.width;
  els.textureCanvas.height = bitmap.height;
  paintCtx.clearRect(0, 0, bitmap.width, bitmap.height);
  paintCtx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
}

async function resetSelectedTexture() {
  const original = textureOriginals[selectedTextureIndex];
  if (!original?.bytes) return;
  try {
    await drawImageBytesToCanvas(original.bytes, original.mime);
    selectedTextureMime = original.mime;
    textureDirty = true;
    undoImageData = null;
    els.undoPaintBtn.disabled = true;
    setStatus('Texture reset to the version in the GLB you originally opened. Press Apply texture to model to commit it.');
  } catch (err) {
    setStatus(`Could not reset texture: ${err.message}`, true);
  }
}

function outputMimeForTexture(mime) {
  if (mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/png') return mime;
  return 'image/png';
}

async function applyTextureToModel() {
  if (!sourceBytes || !els.textureCanvas.width) return;
  els.applyTextureBtn.disabled = true;
  const oldText = els.applyTextureBtn.textContent;
  els.applyTextureBtn.textContent = 'Applying…';
  try {
    const doc = await io.readBinary(sourceBytes);
    const textures = doc.getRoot().listTextures();
    const texture = textures[selectedTextureIndex];
    if (!texture) throw new Error('Texture is no longer available.');

    const mime = outputMimeForTexture(selectedTextureMime);
    const quality = mime === 'image/jpeg' || mime === 'image/webp' ? 0.95 : undefined;
    const blob = await canvasToBlob(els.textureCanvas, mime, quality);
    texture.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType(mime);
    // Other textures painted directly on the 3D model but not currently open in the flat editor.
    for (const extra of (window.__shrinkPaint?.collectDirtyLayers?.() || [])) {
      const other = textures[extra.index];
      if (!other) continue;
      const otherMime = outputMimeForTexture(other.getMimeType() || 'image/png');
      const otherBlob = await canvasToBlob(extra.canvas, otherMime, otherMime === 'image/png' ? undefined : 0.95);
      other.setImage(new Uint8Array(await otherBlob.arrayBuffer())).setMimeType(otherMime);
    }
    sourceBytes = await io.writeBinary(doc);
    optimizedBytes = null;
    if (compareOn) leaveCompare();
    disposeReduced();
    if (optimizedURL) { URL.revokeObjectURL(optimizedURL); optimizedURL = null; }
    els.showOptimizedBtn.disabled = true;
    els.resultCard.classList.add('hidden');
    els.originalSize.textContent = formatBytes(sourceBytes.byteLength);
    await reloadOriginalPreview(false);
    textureDirty = false;
    setStatus(`Applied ${selectedTextureName}. The 3D preview and future optimized GLB now use your edit.`);
    window.dispatchEvent(new Event('shrink:texture-applied'));
  } catch (err) {
    console.error(err);
    setStatus(`Could not apply texture: ${err.message}`, true);
  } finally {
    els.applyTextureBtn.disabled = false;
    els.applyTextureBtn.textContent = oldText;
  }
}

function downloadEdited() {
  if (!sourceBytes || !sourceFile) return;
  downloadBytes(sourceBytes, `${baseName()}-edited.glb`);
}

async function convertMeshToGlb(file, ext) {
  // STL / OBJ / PLY -> GLB so the same viewer, reducer and painter can be used on sculpts from ShapeLab, C4D, Blender, ZBrush.
  const buf = await file.arrayBuffer();
  const base = 'https://esm.sh/three@0.180.0/examples/jsm/loaders/';
  const parts = [];
  let zUp = ext === 'stl' || ext === 'ply';             // STL/PLY are normally Z-up; glTF is Y-up
  if (ext === 'obj') zUp = /^# Shrink OBJ[^\n]*Z-up/.test(new TextDecoder().decode(buf.slice(0, 200)));   // our own exports say which axis they use
  const take = (geometry, matrix) => {
    const pos = geometry.attributes.position;
    const positions = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (matrix) v.applyMatrix4(matrix);
      if (zUp) positions.set([v.x, v.z, -v.y], i * 3); else positions.set([v.x, v.y, v.z], i * 3);
    }
    let colors = null;
    const col = geometry.attributes.color;
    if (col) { colors = new Float32Array(col.count * 3); for (let i = 0; i < col.count; i++) colors.set([col.getX(i), col.getY(i), col.getZ(i)], i * 3); }
    parts.push({ positions, colors, indices: geometry.index ? new Uint32Array(geometry.index.array) : null });
  };
  if (ext === 'stl') { const { STLLoader } = await import(base + 'STLLoader.js'); take(new STLLoader().parse(buf)); }
  else if (ext === 'ply') { const { PLYLoader } = await import(base + 'PLYLoader.js'); take(new PLYLoader().parse(buf)); }
  else {
    const { OBJLoader } = await import(base + 'OBJLoader.js');
    const group = new OBJLoader().parse(new TextDecoder().decode(buf));
    group.updateMatrixWorld(true);
    group.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) take(o.geometry, o.matrixWorld); });
  }
  if (!parts.length) throw new Error('No mesh data found in this file.');

  const doc = new Document();
  const buffer = doc.createBuffer();
  const material = doc.createMaterial('Shrink').setBaseColorFactor([0.78, 0.78, 0.8, 1]).setMetallicFactor(0).setRoughnessFactor(0.75);
  const sceneDef = doc.createScene('Scene');
  parts.forEach((part, i) => {
    const prim = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(part.positions).setBuffer(buffer));
    if (part.colors) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(part.colors).setBuffer(buffer));
    if (part.indices) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(part.indices).setBuffer(buffer));
    sceneDef.addChild(doc.createNode(`part${i}`).setMesh(doc.createMesh(`part${i}`).addPrimitive(prim)));
  });
  await doc.transform(weld());                            // STL/OBJ triangles are unshared: merge identical vertices
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (!indices) continue;
      const positions = prim.getAttribute('POSITION').getArray();
      const normals = smoothNormals(positions, indices.getArray());
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer));
    }
  }
  return await io.writeBinary(doc);
}

async function openFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['glb', 'stl', 'obj', 'ply'].includes(ext)) { setStatus('Please choose a .glb, .stl, .obj or .ply file.', true); return; }
  try {
    setStatus(ext === 'glb' ? 'Opening model…' : `Converting ${ext.toUpperCase()} for editing…`);
    hideProgress();
    sourceFile = file;
    sourceKind = ext;
    sourceBytes = ext === 'glb' ? new Uint8Array(await file.arrayBuffer()) : await convertMeshToGlb(file, ext);
    optimizedBytes = null;
    lastReduce = null;
    textureDirty = false;
    if (compareOn) leaveCompare();
    if (originalURL) URL.revokeObjectURL(originalURL);
    if (optimizedURL) URL.revokeObjectURL(optimizedURL);
    originalURL = URL.createObjectURL(new Blob([sourceBytes], { type: 'model/gltf-binary' }));
    optimizedURL = null;
    disposeModel(originalModel); disposeReduced();
    originalModel = await loadSceneFromURL(originalURL);
    optimizedModel = null;
    const stats = getModelStats(originalModel);
    els.fileName.textContent = file.name;
    els.originalSize.textContent = formatBytes(file.size);
    els.triangleCount.textContent = num(stats.triangles);
    els.vertexCount.textContent = num(stats.vertices);
    els.textureCount.textContent = num(stats.textures);
    els.optimizedTriangleCount.textContent = '—';
    els.optimizedVertexCount.textContent = '—';
    els.dropZone.classList.add('hidden'); els.workspace.classList.remove('hidden');
    els.resultCard.classList.add('hidden'); els.showOptimizedBtn.disabled = true;
    showModel(originalModel, 'original'); resizeViewer();
    window.dispatchEvent(new CustomEvent('shrink:model-opened', { detail: { kind: ext, triangles: stats.triangles, vertices: stats.vertices } }));
    await prepareTextureEditor();
    if (!stats.textures) setStatus(ext === 'glb'
      ? 'Ready to optimize. This GLB has no image textures to retouch.'
      : `${ext.toUpperCase()} loaded. Use Print & Share to reduce it, check detail loss and export.`);
  } catch (err) {
    console.error(err); setStatus(`Could not open this file: ${err.message}`, true);
  }
}

async function optimizeModel() {
  if (!sourceBytes) return;
  if (textureDirty) setStatus('Tip: Apply your texture edit before optimizing if you want it included.');
  els.optimizeBtn.disabled = true; els.downloadBtn.disabled = true; els.resultCard.classList.add('hidden');
  els.optimizeBtn.textContent = 'Optimizing…';
  try {
    setProgress(5, 'Reading GLB…');
    setStatus('Optimization is running locally in your browser.');
    await MeshoptSimplifier.ready;
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    const document = await io.readBinary(sourceBytes);
    const keepRatio = Number(els.geometry.value) / 100;

    lastReduce = null;
    setProgress(15, 'Cleaning geometry…');
    await document.transform(dedup(), weld());

    if (keepRatio < 0.999) {
      setProgress(30, `Reducing polygons to about ${Math.round(keepRatio*100)}%…`);
      const printOpts = window.__shrinkPrint?.getReduceOptions?.() || {};
      lastReduce = await simplifyWithProtection(document, {
        ratio: keepRatio, error: 0.05, simplifier: MeshoptSimplifier,
        dabs: printOpts.dabs || [], protectKeep: printOpts.protectKeep ?? 1
      });
    } else {
      setProgress(42, 'Keeping original polygon count…');
    }

    const printMode = window.__shrinkUI?.getMode?.() === 'print';
    if (els.webpToggle.checked && !printMode) {
      setProgress(52, 'Resizing and compressing textures…');
      await convertTexturesToWebP(document, Number(els.textureSize.value), Number(els.textureQuality.value) / 100, 52, 72);
    }

    setProgress(76, 'Removing unused data…');
    await document.transform(prune());

    if (printMode) {
      setProgress(84, 'Keeping the mesh uncompressed for modelling tools…');
    } else if (els.meshoptToggle.checked) {
      setProgress(84, 'Applying Meshopt compression…');
      await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    } else if (els.quantizeToggle.checked) {
      setProgress(84, 'Quantizing mesh data…');
      await document.transform(quantize());
    }

    setProgress(94, 'Writing optimized GLB…');
    optimizedBytes = await io.writeBinary(document);

    setProgress(97, 'Loading optimized preview…');
    if (optimizedURL) URL.revokeObjectURL(optimizedURL);
    optimizedURL = URL.createObjectURL(new Blob([optimizedBytes], { type: 'model/gltf-binary' }));
    const builtModel = await loadSceneFromURL(optimizedURL);
    const keepLivePreview = !!(optimizedModel && optimizedIsPreview);    // the live preview already shows what will be saved
    if (!keepLivePreview) setReduced(builtModel, false);

    const optimizedStats = getModelStats(builtModel);
    if (keepLivePreview) disposeModel(builtModel);
    const saving = 100 * (1 - optimizedBytes.byteLength / sourceBytes.byteLength);
    els.optimizedSize.textContent = formatBytes(optimizedBytes.byteLength);
    els.optimizedTriangleCount.textContent = num(optimizedStats.triangles);
    els.optimizedVertexCount.textContent = num(optimizedStats.vertices);
    els.savingBadge.textContent = saving >= 0 ? `${saving.toFixed(0)}% smaller` : `${Math.abs(saving).toFixed(0)}% larger`;
    els.resultCard.classList.remove('hidden'); els.showOptimizedBtn.disabled = false; els.downloadBtn.disabled = false;
    if (!keepLivePreview) showModel(optimizedModel, 'optimized');
    setProgress(100, 'Finished');
    setStatus('Done — use Compare or Detail loss in the viewer to see exactly what changed.');
    window.dispatchEvent(new CustomEvent('shrink:optimized', { detail: { reduce: lastReduce, bytes: optimizedBytes.byteLength, triangles: optimizedStats.triangles } }));
    setTimeout(hideProgress, 1200);
    return true;
  } catch (err) {
    console.error(err);
    setProgress(100, 'Stopped');
    setStatus(`Optimization failed: ${err.message}`, true);
    return false;
  } finally {
    els.optimizeBtn.disabled = false;
    els.optimizeBtn.textContent = els.optimizeBtn.dataset.label || 'Optimize model';
  }
}

async function convertTexturesToWebP(document, maxSize, quality, progressStart = 52, progressEnd = 72) {
  const textures = document.getRoot().listTextures();
  if (!textures.length) return;
  document.createExtension(EXTTextureWebP).setRequired(true);

  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i];
    const image = texture.getImage();
    if (!image?.byteLength) continue;
    const mime = texture.getMimeType() || 'image/png';
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([image], { type: mime }));
    } catch (err) {
      console.warn(`Skipping unsupported texture ${i + 1}:`, err);
      continue;
    }
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = documentCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await canvasToBlob(canvas, 'image/webp', quality);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    texture.setImage(bytes).setMimeType('image/webp');
    const step = progressStart + ((i + 1) / textures.length) * (progressEnd - progressStart);
    setProgress(step, `Compressing texture ${i + 1} of ${textures.length}…`);
    await new Promise(requestAnimationFrame);
  }
}

function documentCanvas(width, height) {
  if ('OffscreenCanvas' in window) return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}

async function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return await canvas.convertToBlob({ type, quality });
  return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Texture conversion failed.')), type, quality));
}

function baseName() { return (sourceFile?.name || 'model').replace(/\.[^.]+$/, ''); }

function downloadBytes(bytes, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadOptimized() {
  if (!optimizedBytes || !sourceFile) return;
  downloadBytes(optimizedBytes, `${baseName()}-shrink.glb`);
}

applyPreset('game');
updateLabels();
setPaintTool('brush');

window.__shrinkApp = {
  THREE,
  get originalModel() { return originalModel; },
  get optimizedModel() { return optimizedModel; },
  get currentModel() { return currentModel; },
  get sourceBytes() { return sourceBytes; },
  get optimizedBytes() { return optimizedBytes; },
  get sourceKind() { return sourceKind; },
  get sourceFile() { return sourceFile; },
  get lastReduce() { return lastReduce; },
  get wireframe() { return wireframeEnabled; },
  baseName,
  show(which) {
    if (which === 'optimized' && optimizedModel) showModel(optimizedModel, 'optimized', false);
    else if (originalModel) showModel(originalModel, 'original', false);
  },
  setCompare,
  setPreview(root) { setReduced(root, true); if (currentWhich === 'original' && !els.showOriginalBtn.dataset.pinned) { /* stay on the original until the UI asks */ } },
  clearPreview() { if (optimizedIsPreview) { if (compareOn) leaveCompare(); const was = currentModel === optimizedModel; disposeReduced(); els.showOptimizedBtn.disabled = true; if (was && originalModel) showModel(originalModel, 'original', false); } },
  notifyReduced(meta) { reducedVersion++; window.dispatchEvent(new CustomEvent('shrink:reduced', { detail: { ...meta, version: reducedVersion } })); },
  get reducedVersion() { return reducedVersion; },
  get optimizedIsPreview() { return optimizedIsPreview; },
  buildAndSave,
  optimize: optimizeModel,
  isCompare: () => compareOn,
  setCompareSplit(v) { compareSplit = Math.max(0.03, Math.min(0.97, v)); },
  getCompareSplit: () => compareSplit,
  formatBytes,
  setStatus
};
