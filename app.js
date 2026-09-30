import * as THREE from 'https://esm.sh/three@0.180.0';
import { OrbitControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'https://esm.sh/three-mesh-bvh@0.9.2?deps=three@0.180.0';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

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
  aggressive: { geometry: 35, textureSize: 512, textureQuality: 70, webp: true, quantize: true, meshopt: true }
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

(function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function prepareBVH(model) {
  if (!model) return;
  const seen = new Set();
  model.traverse(o => {
    if (!o.isMesh || !o.geometry || seen.has(o.geometry.uuid)) return;
    seen.add(o.geometry.uuid);
    if (!o.geometry.boundsTree) {
      try { o.geometry.computeBoundsTree({ maxLeafTris: 20 }); }
      catch (err) { console.warn('BVH unavailable for mesh:', err); }
    }
  });
}

async function loadSceneFromURL(url) {
  const model = await new Promise((resolve, reject) => loader.load(url, g => resolve(g.scene), undefined, reject));
  prepareBVH(model);
  return model;
}

function disposeModel(model) {
  if (!model) return;
  const disposedGeometry = new Set();
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry && !disposedGeometry.has(o.geometry.uuid)) {
      disposedGeometry.add(o.geometry.uuid);
      o.geometry.disposeBoundsTree?.();
      o.geometry.dispose?.();
    }
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
  if (currentModel) scene.remove(currentModel);
  currentModel = model;
  if (currentModel) {
    applyWireframe(currentModel, wireframeEnabled);
    scene.add(currentModel);
  }
  els.showOriginalBtn.classList.toggle('active', which === 'original');
  els.showOptimizedBtn.classList.toggle('active', which === 'optimized');
  if (reframe) frameModel(model);
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
els.resetViewBtn.addEventListener('click', () => currentModel && frameModel(currentModel));
els.wireframeBtn.addEventListener('click', () => {
  wireframeEnabled = !wireframeEnabled;
  applyWireframe(currentModel, wireframeEnabled);
  els.wireframeBtn.classList.toggle('active', wireframeEnabled);
  els.wireframeBtn.textContent = wireframeEnabled ? 'Shaded' : 'Wireframe';
});
els.optimizeBtn.addEventListener('click', optimizeModel);
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
    sourceBytes = await io.writeBinary(doc);
    optimizedBytes = null;
    disposeModel(optimizedModel); optimizedModel = null;
    if (optimizedURL) { URL.revokeObjectURL(optimizedURL); optimizedURL = null; }
    els.showOptimizedBtn.disabled = true;
    els.resultCard.classList.add('hidden');
    els.originalSize.textContent = formatBytes(sourceBytes.byteLength);
    await reloadOriginalPreview(false);
    textureDirty = false;
    setStatus(`Applied ${selectedTextureName}. The 3D preview and future optimized GLB now use your edit.`);
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
  const base = sourceFile.name.replace(/\.glb$/i, '');
  downloadBytes(sourceBytes, `${base}-edited.glb`);
}

async function openFile(file) {
  if (!file.name.toLowerCase().endsWith('.glb')) { setStatus('Please choose a .glb file.', true); return; }
  try {
    setStatus('Opening model…');
    hideProgress();
    sourceFile = file;
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    optimizedBytes = null;
    textureDirty = false;
    if (originalURL) URL.revokeObjectURL(originalURL);
    if (optimizedURL) URL.revokeObjectURL(optimizedURL);
    originalURL = URL.createObjectURL(file);
    optimizedURL = null;
    disposeModel(originalModel); disposeModel(optimizedModel);
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
    await prepareTextureEditor();
    if (!stats.textures) setStatus('Ready to optimize. This GLB has no image textures to retouch.');
  } catch (err) {
    console.error(err); setStatus(`Could not open this GLB: ${err.message}`, true);
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

    setProgress(15, 'Cleaning geometry…');
    await document.transform(dedup(), weld());

    if (keepRatio < 0.999) {
      setProgress(30, `Reducing polygons to about ${Math.round(keepRatio*100)}%…`);
      await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: keepRatio, error: 0.001 }));
    } else {
      setProgress(42, 'Keeping original polygon count…');
    }

    if (els.webpToggle.checked) {
      setProgress(52, 'Resizing and compressing textures…');
      await convertTexturesToWebP(document, Number(els.textureSize.value), Number(els.textureQuality.value) / 100, 52, 72);
    }

    setProgress(76, 'Removing unused data…');
    await document.transform(prune());

    if (els.meshoptToggle.checked) {
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
    disposeModel(optimizedModel);
    optimizedModel = await loadSceneFromURL(optimizedURL);

    const optimizedStats = getModelStats(optimizedModel);
    const saving = 100 * (1 - optimizedBytes.byteLength / sourceBytes.byteLength);
    els.optimizedSize.textContent = formatBytes(optimizedBytes.byteLength);
    els.optimizedTriangleCount.textContent = num(optimizedStats.triangles);
    els.optimizedVertexCount.textContent = num(optimizedStats.vertices);
    els.savingBadge.textContent = saving >= 0 ? `${saving.toFixed(0)}% smaller` : `${Math.abs(saving).toFixed(0)}% larger`;
    els.resultCard.classList.remove('hidden'); els.showOptimizedBtn.disabled = false; els.downloadBtn.disabled = false;
    showModel(optimizedModel, 'optimized');
    setProgress(100, 'Finished');
    setStatus('Done — compare Original / Edited and Optimized, or use Wireframe to inspect the mesh.');
    setTimeout(hideProgress, 1200);
  } catch (err) {
    console.error(err);
    setProgress(100, 'Stopped');
    setStatus(`Optimization failed: ${err.message}`, true);
  } finally {
    els.optimizeBtn.disabled = false;
    els.optimizeBtn.textContent = 'Optimize model';
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

function downloadBytes(bytes, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadOptimized() {
  if (!optimizedBytes || !sourceFile) return;
  const base = sourceFile.name.replace(/\.glb$/i, '');
  downloadBytes(optimizedBytes, `${base}-shrink.glb`);
}

applyPreset('game');
updateLabels();
setPaintTool('brush');
