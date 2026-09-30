import './paint-mode-v08.js';
import './gltf-texture-index.js';
import * as THREE from 'https://esm.sh/three@0.180.0';

const state = {
  mode: 'navigate',
  painting: false,
  lastPoint: null,
  activeMaterial: null,
  liveTexture: null,
  undoImage: null,
  activeTextureIndex: null,
  cloneSource: null,
  cloneStartDest: null,
  cloneSnapshot: null
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

function getViewerState() {
  return window.__shrinkViewer || null;
}

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
const cloneModelBtn = makeButton('cloneModelBtn', 'Clone');
const sampleModelBtn = makeButton('sampleModelBtn', 'Pick colour');
const navigateModelBtn = makeButton('navigateModelBtn', 'Navigate');
const undo3DBtn = makeButton('undo3DBtn', 'Undo');
undo3DBtn.disabled = true;
controls.append(paintModelBtn, cloneModelBtn, sampleModelBtn, navigateModelBtn, undo3DBtn);

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
  state.cloneStartDest = null;
  state.cloneSnapshot = null;
  paintModelBtn.classList.toggle('active', mode === 'paint');
  cloneModelBtn.classList.toggle('active', mode === 'clone');
  sampleModelBtn.classList.toggle('active', mode === 'sample');
  navigateModelBtn.classList.toggle('active', mode === 'navigate');
  viewer?.classList.toggle('direct-paint', mode === 'paint' || mode === 'clone');
  viewer?.classList.toggle('direct-sample', mode === 'sample');

  if (mode !== 'navigate' && originalBtn && !originalBtn.classList.contains('active')) originalBtn.click();

  if (help) {
    help.textContent = mode === 'paint'
      ? 'PAINT · drag on model · hold Cmd / Ctrl to rotate · scroll to zoom'
      : mode === 'clone'
        ? 'CLONE · Option/Alt-click a clean source · drag to clone · Cmd/Ctrl to rotate'
        : mode === 'sample'
          ? 'PICK COLOUR · click the model to sample its texture colour'
          : 'Drag to rotate · Scroll to zoom · Right-drag to pan';
  }

  if (mode === 'paint') say('Paint mode: drag directly on the model. Hold Cmd / Ctrl while dragging to rotate.');
  if (mode === 'clone') say(state.cloneSource
    ? 'Clone mode: drag to clone from the saved source. Option/Alt-click anywhere to choose a new source.'
    : 'Clone mode: Option-click (Mac) or Alt-click (Windows) a clean area of the car to set the source.');
  if (mode === 'sample') say('Pick colour: click the model to sample a colour, then Paint resumes automatically.');
}

paintModelBtn.addEventListener('click', () => setMode('paint'));
cloneModelBtn.addEventListener('click', () => setMode('clone'));
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
  const v = getViewerState();
  if (!v?.renderer || !v?.scene || !v?.camera) {
    say('3D painter is not connected to the viewer yet. Reload the page and try again.', true);
    return null;
  }
  const canvas = v.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndc = new THREE.Vector2(
    ((evt.clientX - rect.left) / rect.width) * 2 - 1,
    -((evt.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, v.camera);
  const hits = raycaster.intersectObjects(v.scene.children, true);
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

function dab(point) {
  if (!paintCtx || !point) return;
  paintCtx.save();
  paintCtx.globalAlpha = Number(brushOpacity?.value || 100) / 100;
  paintCtx.fillStyle = paintColor?.value || '#000000';
  paintCtx.beginPath();
  paintCtx.arc(point.x, point.y, Number(brushSize?.value || 32) / 2, 0, Math.PI * 2);
  paintCtx.fill();
  paintCtx.restore();
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
}

function drawSegment(from, to) {
  if (!paintCtx || !from || !to) return;
  paintCtx.save();
  paintCtx.globalAlpha = Number(brushOpacity?.value || 100) / 100;
  paintCtx.strokeStyle = paintColor?.value || '#000000';
  paintCtx.lineWidth = Number(brushSize?.value || 32);
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.beginPath();
  paintCtx.moveTo(from.x, from.y);
  paintCtx.lineTo(to.x, to.y);
  paintCtx.stroke();
  paintCtx.restore();
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
}

function seamThreshold() {
  const brush = Number(brushSize?.value || 32);
  return Math.max(brush * 4, Math.min(textureCanvas.width, textureCanvas.height) * 0.06);
}

function paintBetween(from, to) {
  if (!from || !to) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const brush = Number(brushSize?.value || 32);

  if (distance > seamThreshold()) {
    dab(to);
    return;
  }

  const step = Math.max(1, brush * 0.35);
  const steps = Math.max(1, Math.ceil(distance / step));
  let prev = from;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const next = { x: from.x + dx * t, y: from.y + dy * t };
    drawSegment(prev, next);
    prev = next;
  }
}

function cloneDab(destPoint) {
  const source = state.cloneSource;
  const startDest = state.cloneStartDest;
  const snapshot = state.cloneSnapshot;
  if (!paintCtx || !source || !startDest || !snapshot || !destPoint) return;

  const radius = Math.max(1, Number(brushSize?.value || 32) / 2);
  const opacity = Number(brushOpacity?.value || 100) / 100;
  const offsetX = destPoint.x - startDest.x;
  const offsetY = destPoint.y - startDest.y;
  const sourceCenterX = source.x + offsetX;
  const sourceCenterY = source.y + offsetY;

  const minX = Math.max(0, Math.floor(destPoint.x - radius));
  const minY = Math.max(0, Math.floor(destPoint.y - radius));
  const maxX = Math.min(textureCanvas.width - 1, Math.ceil(destPoint.x + radius));
  const maxY = Math.min(textureCanvas.height - 1, Math.ceil(destPoint.y + radius));
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const patch = paintCtx.getImageData(minX, minY, width, height);
  const out = patch.data;
  const src = snapshot.data;
  const sw = snapshot.width;
  const sh = snapshot.height;

  for (let py = 0; py < height; py++) {
    const y = minY + py;
    for (let px = 0; px < width; px++) {
      const x = minX + px;
      const localX = x - destPoint.x;
      const localY = y - destPoint.y;
      const distance = Math.hypot(localX, localY);
      if (distance > radius) continue;

      const sx = Math.round(sourceCenterX + localX);
      const sy = Math.round(sourceCenterY + localY);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;

      const feather = Math.min(1, Math.max(0, (radius - distance) / Math.max(1, radius * 0.28)));
      const alpha = opacity * feather;
      if (alpha <= 0) continue;

      const si = (sy * sw + sx) * 4;
      const di = (py * width + px) * 4;
      out[di] = Math.round(out[di] * (1 - alpha) + src[si] * alpha);
      out[di + 1] = Math.round(out[di + 1] * (1 - alpha) + src[si + 1] * alpha);
      out[di + 2] = Math.round(out[di + 2] * (1 - alpha) + src[si + 2] * alpha);
      out[di + 3] = Math.round(out[di + 3] * (1 - alpha) + src[si + 3] * alpha);
    }
  }

  paintCtx.putImageData(patch, minX, minY);
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
}

function cloneBetween(from, to) {
  if (!from || !to) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const brush = Number(brushSize?.value || 32);

  if (distance > seamThreshold()) {
    cloneDab(to);
    return;
  }

  const step = Math.max(1, brush * 0.28);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    cloneDab({ x: from.x + dx * t, y: from.y + dy * t });
  }
}

function fallbackTextureIndex(material) {
  const options = [...(textureSelect?.options || [])];
  if (!options.length) return null;
  const name = material?.map?.name?.trim() || '';
  if (name) {
    const exact = options.find(o => o.textContent.trim() === name);
    if (exact) return Number(exact.value);
    const loose = options.find(o => o.textContent.trim().includes(name) || name.includes(o.textContent.trim()));
    if (loose) return Number(loose.value);
  }
  if (options.length === 1) return Number(options[0].value);
  return null;
}

function textureIndexForMaterial(material) {
  const exact = material?.map?.userData?.gltfTextureIndex;
  if (Number.isInteger(exact) && exact >= 0 && exact < (textureSelect?.options?.length || 0)) return exact;
  return fallbackTextureIndex(material);
}

async function waitForTextureEditor(index, material) {
  const image = material?.map?.image;
  const expectedWidth = image?.width || image?.videoWidth || image?.naturalWidth || 0;
  const expectedHeight = image?.height || image?.videoHeight || image?.naturalHeight || 0;
  const started = performance.now();
  while (performance.now() - started < 1800) {
    const sameIndex = Number(textureSelect?.value) === index;
    const hasCanvas = textureCanvas.width > 1 && textureCanvas.height > 1;
    const rightSize = !expectedWidth || !expectedHeight || (textureCanvas.width === expectedWidth && textureCanvas.height === expectedHeight);
    if (sameIndex && hasCanvas && rightSize && !applyBtn?.disabled) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return Number(textureSelect?.value) === index && textureCanvas.width > 1 && textureCanvas.height > 1;
}

async function ensureTextureForMaterial(material) {
  const index = textureIndexForMaterial(material);
  if (!Number.isInteger(index)) {
    say('This surface has a texture, but Shrink could not link it to the embedded GLB image.', true);
    return false;
  }
  if (Number(textureSelect.value) !== index || state.activeTextureIndex !== index) {
    textureSelect.value = String(index);
    textureSelect.dispatchEvent(new Event('change', { bubbles: true }));
    state.activeTextureIndex = index;
    state.cloneSource = null;
  }
  const ready = await waitForTextureEditor(index, material);
  if (!ready) {
    say(`Texture ${index + 1} was identified, but its image did not finish loading into the paint canvas.`, true);
    return false;
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
  live.userData = { ...(oldMap.userData || {}) };
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
  const v = getViewerState();
  if (!v?.renderer) {
    say('3D painter could not access the viewer. Reload the page and try again.', true);
    return;
  }
  if (evt.target !== v.renderer.domElement) return;
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

  const pointerId = evt.pointerId;
  const ready = await ensureTextureForMaterial(material);
  if (!ready) return;

  const point = texturePoint(hit, material);
  if (!point) return;

  if (state.mode === 'sample') {
    sampleAt(point);
    return;
  }

  if (state.mode === 'clone' && evt.altKey) {
    state.cloneSource = { x: point.x, y: point.y, textureIndex: state.activeTextureIndex };
    state.cloneStartDest = null;
    state.cloneSnapshot = null;
    say(`Clone source set on Texture ${state.activeTextureIndex + 1}. Now drag over the area you want to replace.`);
    return;
  }

  if (state.mode === 'clone' && !state.cloneSource) {
    say('Set a clone source first: hold Option (Mac) or Alt (Windows) and click a clean area of the car.', true);
    return;
  }

  if (state.mode === 'clone' && state.cloneSource.textureIndex !== state.activeTextureIndex) {
    state.cloneSource = null;
    say('That surface uses a different texture. Option/Alt-click a new clone source on this surface.', true);
    return;
  }

  if (evt.buttons === 0) return;

  saveUndo();
  attachLiveCanvas(material);
  state.painting = true;
  state.lastPoint = point;

  if (state.mode === 'clone') {
    state.cloneStartDest = { x: point.x, y: point.y };
    state.cloneSnapshot = state.undoImage;
    cloneDab(point);
    say(`LIVE CLONE · Texture ${state.activeTextureIndex + 1} · Option/Alt-click to choose another source.`);
  } else {
    dab(point);
    say(`LIVE PAINT · Texture ${state.activeTextureIndex + 1} · ${paintColor?.value || '#000000'} · seam-safe stroke.`);
  }

  try { v.renderer.domElement.setPointerCapture(pointerId); } catch {}
}

function handlePointerMove(evt) {
  if (!['paint', 'clone'].includes(state.mode) || !state.painting || modifierOrbit(evt)) return;
  if ((evt.buttons & 1) === 0) {
    stopPaint(evt);
    return;
  }
  evt.preventDefault();
  evt.stopImmediatePropagation();
  const hit = rayHit(evt);
  if (!hit) return;
  const material = materialForHit(hit);
  if (material !== state.activeMaterial) {
    state.lastPoint = null;
    return;
  }
  const point = texturePoint(hit, material);
  if (!point) return;

  if (state.mode === 'clone') {
    if (state.lastPoint) cloneBetween(state.lastPoint, point);
    else cloneDab(point);
  } else {
    if (state.lastPoint) paintBetween(state.lastPoint, point);
    else dab(point);
  }
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
  state.cloneStartDest = null;
  state.cloneSnapshot = null;
  try { getViewerState()?.renderer?.domElement?.releasePointerCapture(evt.pointerId); } catch {}
}

viewer?.addEventListener('pointerdown', handlePointerDown, true);
viewer?.addEventListener('pointermove', handlePointerMove, true);
viewer?.addEventListener('pointerup', stopPaint, true);
viewer?.addEventListener('pointercancel', stopPaint, true);
viewer?.addEventListener('pointerleave', evt => { if ((evt.buttons & 1) === 0) stopPaint(evt); }, true);

undo3DBtn.addEventListener('click', () => {
  if (!state.undoImage || !paintCtx) return;
  paintCtx.putImageData(state.undoImage, 0, 0);
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
  state.undoImage = null;
  undo3DBtn.disabled = true;
  say('Last 3D paint stroke undone.');
});

textureSelect?.addEventListener('change', () => {
  state.cloneSource = null;
  state.cloneStartDest = null;
  state.cloneSnapshot = null;
});

applyBtn?.addEventListener('click', () => {
  state.painting = false;
  state.lastPoint = null;
  state.activeMaterial = null;
  state.liveTexture = null;
  state.activeTextureIndex = Number(textureSelect?.value ?? -1);
  state.cloneSource = null;
  state.cloneStartDest = null;
  state.cloneSnapshot = null;
  setMode('paint');
});

setMode('navigate');
