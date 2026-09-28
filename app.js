import * as THREE from 'https://esm.sh/three@0.180.0';
import { OrbitControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';

const $ = (id) => document.getElementById(id);
const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'), workspace: $('workspace'), fileName: $('fileName'),
  originalSize: $('originalSize'), triangleCount: $('triangleCount'), vertexCount: $('vertexCount'), textureCount: $('textureCount'),
  preset: $('preset'), geometry: $('geometry'), geometryValue: $('geometryValue'), textureSize: $('textureSize'),
  textureQuality: $('textureQuality'), textureQualityValue: $('textureQualityValue'), webpToggle: $('webpToggle'),
  quantizeToggle: $('quantizeToggle'), optimizeBtn: $('optimizeBtn'), status: $('status'), resultCard: $('resultCard'),
  optimizedSize: $('optimizedSize'), savingBadge: $('savingBadge'), downloadBtn: $('downloadBtn'), newFileBtn: $('newFileBtn'),
  viewer: $('viewer'), showOriginalBtn: $('showOriginalBtn'), showOptimizedBtn: $('showOptimizedBtn'), resetViewBtn: $('resetViewBtn'),
  progressWrap: $('progressWrap'), progressBar: $('progressBar'), progressLabel: $('progressLabel')
};

const PRESETS = {
  safe:       { geometry: 90, textureSize: 2048, textureQuality: 88, webp: true, quantize: true },
  game:       { geometry: 70, textureSize: 1024, textureQuality: 82, webp: true, quantize: true },
  small:      { geometry: 50, textureSize: 1024, textureQuality: 76, webp: true, quantize: true },
  aggressive: { geometry: 35, textureSize: 512,  textureQuality: 70, webp: true, quantize: true }
};

let sourceFile = null;
let sourceBytes = null;
let optimizedBytes = null;
let originalURL = null;
let optimizedURL = null;
let originalModel = null;
let optimizedModel = null;
let currentModel = null;

// ---------- Viewer ----------
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

async function loadSceneFromURL(url) {
  return await new Promise((resolve, reject) => loader.load(url, g => resolve(g.scene), undefined, reject));
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

function showModel(model, which) {
  if (currentModel) scene.remove(currentModel);
  currentModel = model;
  if (currentModel) scene.add(currentModel);
  els.showOriginalBtn.classList.toggle('active', which === 'original');
  els.showOptimizedBtn.classList.toggle('active', which === 'optimized');
  frameModel(model);
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

// ---------- UI ----------
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
  els.geometry.value = p.geometry; els.textureSize.value = p.textureSize; els.textureQuality.value = p.textureQuality;
  els.webpToggle.checked = p.webp; els.quantizeToggle.checked = p.quantize; updateLabels();
}
function updateLabels(){ els.geometryValue.textContent = `${els.geometry.value}%`; els.textureQualityValue.textContent = `${els.textureQuality.value}%`; }

els.preset.addEventListener('change', () => applyPreset(els.preset.value));
els.geometry.addEventListener('input', () => { updateLabels(); markCustom(); });
els.textureQuality.addEventListener('input', () => { updateLabels(); markCustom(); });
els.textureSize.addEventListener('change', markCustom);
els.webpToggle.addEventListener('change', markCustom);
els.quantizeToggle.addEventListener('change', markCustom);

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
els.optimizeBtn.addEventListener('click', optimizeModel);
els.downloadBtn.addEventListener('click', downloadOptimized);

async function openFile(file) {
  if (!file.name.toLowerCase().endsWith('.glb')) { setStatus('Please choose a .glb file.', true); return; }
  try {
    setStatus('Opening model…');
    hideProgress();
    sourceFile = file;
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    optimizedBytes = null;
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
    els.dropZone.classList.add('hidden'); els.workspace.classList.remove('hidden');
    els.resultCard.classList.add('hidden'); els.showOptimizedBtn.disabled = true;
    showModel(originalModel, 'original'); resizeViewer();
    setStatus('Ready to optimize.');
  } catch (err) {
    console.error(err); setStatus(`Could not open this GLB: ${err.message}`, true);
  }
}

// ---------- Optimizer ----------
const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

async function optimizeModel() {
  if (!sourceBytes) return;
  els.optimizeBtn.disabled = true; els.downloadBtn.disabled = true; els.resultCard.classList.add('hidden');
  els.optimizeBtn.textContent = 'Optimizing…';
  try {
    setProgress(5, 'Reading GLB…');
    setStatus('Optimization is running locally in your browser.');
    await MeshoptSimplifier.ready;
    await MeshoptDecoder.ready;
    const document = await io.readBinary(sourceBytes);
    const keepRatio = Number(els.geometry.value) / 100;

    setProgress(18, 'Cleaning geometry…');
    await document.transform(dedup(), weld());

    if (keepRatio < 0.999) {
      setProgress(35, `Reducing polygons to about ${Math.round(keepRatio*100)}%…`);
      await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: keepRatio, error: 0.001 }));
    } else {
      setProgress(48, 'Keeping original polygon count…');
    }

    if (els.quantizeToggle.checked) {
      setProgress(58, 'Quantizing mesh data…');
      await document.transform(quantize());
    }

    if (els.webpToggle.checked) {
      setProgress(68, 'Resizing and compressing textures…');
      await convertTexturesToWebP(document, Number(els.textureSize.value), Number(els.textureQuality.value) / 100, 68, 88);
    }

    setProgress(90, 'Removing unused data…');
    await document.transform(prune());
    setProgress(94, 'Writing optimized GLB…');
    optimizedBytes = await io.writeBinary(document);

    setProgress(97, 'Loading optimized preview…');
    if (optimizedURL) URL.revokeObjectURL(optimizedURL);
    optimizedURL = URL.createObjectURL(new Blob([optimizedBytes], { type: 'model/gltf-binary' }));
    disposeModel(optimizedModel);
    optimizedModel = await loadSceneFromURL(optimizedURL);

    const saving = 100 * (1 - optimizedBytes.byteLength / sourceBytes.byteLength);
    els.optimizedSize.textContent = formatBytes(optimizedBytes.byteLength);
    els.savingBadge.textContent = saving >= 0 ? `${saving.toFixed(0)}% smaller` : `${Math.abs(saving).toFixed(0)}% larger`;
    els.resultCard.classList.remove('hidden'); els.showOptimizedBtn.disabled = false; els.downloadBtn.disabled = false;
    showModel(optimizedModel, 'optimized');
    setProgress(100, 'Finished');
    setStatus('Done — compare Original and Optimized in the viewer.');
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

async function convertTexturesToWebP(document, maxSize, quality, progressStart = 68, progressEnd = 88) {
  const textures = document.getRoot().listTextures();
  if (!textures.length) return;
  document.createExtension(EXTTextureWebP).setRequired(true);

  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i];
    const image = texture.getImage();
    if (!image?.byteLength) continue;
    const mime = texture.getMimeType() || 'image/png';
    const bitmap = await createImageBitmap(new Blob([image], { type: mime }));
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

function downloadOptimized() {
  if (!optimizedBytes || !sourceFile) return;
  const base = sourceFile.name.replace(/\.glb$/i, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([optimizedBytes], { type: 'model/gltf-binary' }));
  a.download = `${base}-shrink.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

applyPreset('game');
