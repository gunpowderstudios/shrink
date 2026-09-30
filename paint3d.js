import './paint-mode-v08.js';
import * as THREE from 'https://esm.sh/three@0.180.0';

const state = {
  renderer: null,
  scene: null,
  camera: null,
  mode: 'navigate',
  painting: false,
  lastPoint: null,
  activeMaterial: null,
  liveTexture: null,
  undoImage: null,
  activeTextureIndex: null
};

const originalRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function(scene, camera) {
  state.renderer = this;
  state.scene = scene;
  state.camera = camera;
  return originalRender.call(this, scene, camera);
};

const viewer = document.getElementById('viewer');
const toolbar = document.querySelector('.viewer-toolbar');
const help = document.querySelector('.viewer-help');
const textureCanvas = document.getElementById('textureCanvas');
const paintColor = document.getElementById('paintColor');
const brushSize = document.getElementById('brushSize');
const brushOpacity = document.getElementById('brushOpacity');
const textureSelect = document.getElementById('textureSelect');
const status = document.getElementById('status');
const originalBtn = document.getElementById('showOriginalBtn');
const applyBtn = document.getElementById('applyTextureBtn');
const paintCtx = textureCanvas?.getContext('2d', { willReadFrequently: true });
const raycaster = new THREE.Raycaster();

function say(message, error = false) {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', error);
}

function makeButton(id, label) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'button ghost small model-paint-button';
  button.textContent = label;
  return button;
}

const controls = document.createElement('div');
controls.className = 'model-paint-controls';
const paintModelBtn = makeButton('paintModelBtn', 'Paint');
const sampleModelBtn = makeButton('sampleModelBtn', 'Pick colour');
const navigateModelBtn = makeButton('navigateModelBtn', 'Navigate');
const undo3DBtn = makeButton('undo3DBtn', 'Undo');
undo3DBtn.disabled = true;
controls.append(paintModelBtn, sampleModelBtn, navigateModelBtn, undo3DBtn);

if (toolbar) {
  const actions = toolbar.querySelector('.viewer-actions');
  if (actions) toolbar.insertBefore(controls, actions);
  else toolbar.appendChild(controls);
}

const style = document.createElement('style');
style.textContent = `
  .model-paint-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto;margin-right:8px}
  .model-paint-button.active{border-color:#ff6b6b!important;background:#5a2a2f!important;color:#fff!important}
  #navigateModelBtn{display:none!important}
  .viewer.direct-paint canvas{cursor:none!important;touch-action:none}
  .viewer.direct-sample canvas{cursor:copy!important;touch-action:none}
  .viewer.direct-paint.modifier-rotate canvas{cursor:grab!important}
  .viewer.direct-paint.modifier-rotate canvas:active{cursor:grabbing!important}
  @media(max-width:1100px){.viewer-toolbar{flex-wrap:wrap}.model-paint-controls{order:3;width:100%;margin:4px 0 0}}
`;
document.head.appendChild(style);

function setMode(mode) {
  state.mode = mode;
  state.painting = false;
  state.lastPoint = null;
  paintModelBtn.classList.toggle('active', mode === 'paint');
  sampleModelBtn.classList.toggle('active', mode === 'sample');
  navigateModelBtn.classList.toggle('active', mode === 'navigate');
  viewer?.classList.toggle('direct-paint', mode === 'paint');
  viewer?.classList.toggle('direct-sample', mode === 'sample');

  if (mode !== 'navigate' && originalBtn && !originalBtn.classList.contains('active')) originalBtn.click();

  if (help) {
    help.textContent = mode === 'paint'
      ? 'PAINT · drag on model · hold Cmd / Ctrl to rotate · scroll to zoom'
      : mode === 'sample'
        ? 'PICK COLOUR · click the model to sample its texture colour'
        : 'Drag to rotate · Scroll to zoom · Right-drag to pan';
  }

  if (mode === 'paint') say('Paint mode: drag directly on the model. Hold Cmd / Ctrl while dragging to rotate.');
  if (mode === 'sample') say('Pick colour: click the model to sample a colour, then Paint resumes automatically.');
}

paintModelBtn.addEventListener('click', () => setMode('paint'));
sampleModelBtn.addEventListener('click', () => setMode('sample'));
navigateModelBtn.addEventListener('click', () => setMode('navigate'));

function materialForHit(hit) {
  const object = hit?.object;
  if (!object?.material) return null;
  if (!Array.isArray(object.material)) return object.material;
  const index = hit.face?.materialIndex ?? 0;
  return object.material[index] || object.material[0] || null;
}

function rayHit(evt) {
  if (!state.renderer || !state.scene || !state.camera) return null;
  const canvas = state.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndc = new THREE.Vector2(
    ((evt.clientX - rect.left) / rect.width) * 2 - 1,
    -((evt.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, state.camera);
  const hits = raycaster.intersectObjects(state.scene.children, true);
  return hits.find(hit => hit.object?.isMesh && hit.uv) || null;
}

function texturePoint(hit, material) {
  if (!hit?.uv || !textureCanvas.width || !textureCanvas.height) return null;
  const uv = hit.uv.clone();
  const map = material?.map;
  if (map?.updateMatrix) map.updateMatrix();
  if (map?.transformUv) map.transformUv(uv);
  const x = Math.max(0, Math.min(textureCanvas.width - 1, uv.x * textureCanvas.width));
  const y = Math.max(0, Math.min(textureCanvas.height - 1, uv.y * textureCanvas.height));
  return { x, y };
}

function saveUndo() {
  if (!paintCtx || !textureCanvas.width || !textureCanvas.height) return;
  try {
    state.undoImage = paintCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height);
    undo3DBtn.disabled = false;
  } catch (err) {
    console.warn('3D paint undo unavailable:', err);
  }
}

function draw(from, to) {
  if (!paintCtx || !from || !to) return;
  paintCtx.save();
  paintCtx.globalAlpha = Number(brushOpacity?.value || 100) / 100;
  paintCtx.strokeStyle = paintColor?.value || '#000000';
  paintCtx.fillStyle = paintColor?.value || '#000000';
  paintCtx.lineWidth = Number(brushSize?.value || 32);
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.beginPath();
  paintCtx.moveTo(from.x, from.y);
  paintCtx.lineTo(to.x, to.y);
  paintCtx.stroke();
  if (Math.abs(from.x - to.x) < 0.01 && Math.abs(from.y - to.y) < 0.01) {
    paintCtx.beginPath();
    paintCtx.arc(to.x, to.y, Number(brushSize?.value || 32) / 2, 0, Math.PI * 2);
    paintCtx.fill();
  }
  paintCtx.restore();
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
}

function materialTextureName(material) {
  return material?.map?.name?.trim() || '';
}

function findTextureOptionForMaterial(material) {
  const options = [...(textureSelect?.options || [])];
  if (!options.length) return null;

  const name = materialTextureName(material);
  if (name) {
    const exact = options.find(o => o.textContent.trim() === name);
    if (exact) return exact;
    const loose = options.find(o => o.textContent.trim().includes(name) || name.includes(o.textContent.trim()));
    if (loose) return loose;
  }

  const image = material?.map?.image;
  const w = image?.width || image?.videoWidth || image?.naturalWidth;
  const h = image?.height || image?.videoHeight || image?.naturalHeight;
  if (w && h) {
    for (const option of options) {
      const index = Number(option.value);
      if (index === Number(textureSelect.value) && textureCanvas.width === w && textureCanvas.height === h) return option;
    }
  }

  if (options.length === 1) return options[0];
  return null;
}

async function ensureTextureForMaterial(material) {
  const option = findTextureOptionForMaterial(material);
  if (!option) {
    say('I could not identify which embedded texture this surface uses. Try another part of the model or choose the matching texture on the left once.', true);
    return false;
  }

  const index = Number(option.value);
  if (Number(textureSelect.value) !== index || state.activeTextureIndex !== index) {
    textureSelect.value = String(index);
    textureSelect.dispatchEvent(new Event('change', { bubbles: true }));
    state.activeTextureIndex = index;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return true;
}

function attachLiveCanvas(material) {
  if (!material?.map || !textureCanvas.width || !textureCanvas.height) return;
  if (state.activeMaterial === material && state.liveTexture) return;

  state.liveTexture?.dispose?.();
  const oldMap = material.map;
  const live = new THREE.CanvasTexture(textureCanvas);
  live.name = oldMap.name;
  live.flipY = oldMap.flipY;
  live.colorSpace = oldMap.colorSpace || THREE.SRGBColorSpace;
  live.wrapS = oldMap.wrapS;
  live.wrapT = oldMap.wrapT;
  live.magFilter = oldMap.magFilter;
  live.minFilter = oldMap.minFilter;
  live.anisotropy = oldMap.anisotropy;
  live.offset.copy(oldMap.offset);
  live.repeat.copy(oldMap.repeat);
  live.center.copy(oldMap.center);
  live.rotation = oldMap.rotation;
  live.matrixAutoUpdate = oldMap.matrixAutoUpdate;
  if (!oldMap.matrixAutoUpdate) live.matrix.copy(oldMap.matrix);
  live.needsUpdate = true;
  material.map = live;
  material.needsUpdate = true;
  state.activeMaterial = material;
  state.liveTexture = live;
}

function sampleAt(point) {
  const x = Math.max(0, Math.min(textureCanvas.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(textureCanvas.height - 1, Math.round(point.y)));
  const px = paintCtx.getImageData(x, y, 1, 1).data;
  const hex = `#${[px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  if (paintColor) paintColor.value = hex;
  say(`Picked ${hex} from the model. Paint mode is active again.`);
  setMode('paint');
}

function modifierOrbit(evt) {
  return evt.metaKey || evt.ctrlKey || viewer?.classList.contains('modifier-rotate');
}

async function handlePointerDown(evt) {
  if (state.mode === 'navigate' || evt.button !== 0 || modifierOrbit(evt)) return;
  if (!state.renderer || evt.target !== state.renderer.domElement) return;
  evt.preventDefault();
  evt.stopImmediatePropagation();

  const hit = rayHit(evt);
  if (!hit) {
    say('No paintable surface under the pointer.', true);
    return;
  }
  const material = materialForHit(hit);
  if (!material?.map) {
    say('That part of the model does not use an image colour texture.', true);
    return;
  }

  const ready = await ensureTextureForMaterial(material);
  if (!ready) return;

  const point = texturePoint(hit, material);
  if (!point) return;

  if (state.mode === 'sample') {
    sampleAt(point);
    return;
  }

  saveUndo();
  attachLiveCanvas(material);
  state.painting = true;
  state.lastPoint = point;
  draw(point, point);
  try { state.renderer.domElement.setPointerCapture(evt.pointerId); } catch {}
  say(`Live painting ${textureSelect?.selectedOptions?.[0]?.textContent || 'the surface texture'} — changes should appear immediately on the model.`);
}

function handlePointerMove(evt) {
  if (state.mode !== 'paint' || !state.painting || modifierOrbit(evt)) return;
  evt.preventDefault();
  evt.stopImmediatePropagation();
  const hit = rayHit(evt);
  if (!hit) return;
  const material = materialForHit(hit);
  if (material !== state.activeMaterial) return;
  const point = texturePoint(hit, material);
  if (!point) return;
  draw(state.lastPoint, point);
  state.lastPoint = point;
}

function stopPaint(evt) {
  if (!state.painting) return;
  if (state.mode !== 'navigate' && !modifierOrbit(evt)) {
    evt?.preventDefault?.();
    evt?.stopImmediatePropagation?.();
  }
  state.painting = false;
  state.lastPoint = null;
  try { state.renderer?.domElement?.releasePointerCapture(evt.pointerId); } catch {}
}

viewer?.addEventListener('pointerdown', handlePointerDown, true);
viewer?.addEventListener('pointermove', handlePointerMove, true);
viewer?.addEventListener('pointerup', stopPaint, true);
viewer?.addEventListener('pointercancel', stopPaint, true);

undo3DBtn.addEventListener('click', () => {
  if (!state.undoImage || !paintCtx) return;
  paintCtx.putImageData(state.undoImage, 0, 0);
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
  state.undoImage = null;
  undo3DBtn.disabled = true;
  say('Last 3D paint stroke undone.');
});

applyBtn?.addEventListener('click', () => {
  state.painting = false;
  state.lastPoint = null;
  state.activeMaterial = null;
  state.liveTexture = null;
  state.activeTextureIndex = Number(textureSelect?.value ?? -1);
  setMode('paint');
});

setMode('navigate');
