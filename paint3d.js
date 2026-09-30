import './paint-mode-v08.js?v=1.5';
import './gltf-texture-index.js?v=1.5';
import * as THREE from 'https://esm.sh/three@0.180.0';

const state = {
  mode: 'navigate',
  painting: false,
  activeMaterial: null,
  activeTextureIndex: null,
  activeSurface: null,
  lastScreen: null,
  undoImage: null,
  cloneSourceScreen: null,
  cloneOffsetScreen: null,
  cloneSnapshot: null,
  surfaces: new Map()
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
raycaster.firstHitOnly = true;

function getViewerState() { return window.__shrinkViewer || null; }

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
  .clone-source-marker{position:absolute;width:18px;height:18px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #111;pointer-events:none;transform:translate(-50%,-50%);display:none;z-index:6}
  .viewer.clone-ready .clone-source-marker{display:block}
  @media(max-width:1100px){.viewer-toolbar{flex-wrap:wrap}.model-paint-controls{order:3;width:100%;margin:4px 0 0}}
`;
document.head.appendChild(style);

const cloneMarker = document.createElement('div');
cloneMarker.className = 'clone-source-marker';
viewer?.appendChild(cloneMarker);

function setMode(mode) {
  state.mode = mode;
  state.painting = false;
  state.lastScreen = null;
  state.cloneOffsetScreen = null;
  state.cloneSnapshot = null;
  paintModelBtn.classList.toggle('active', mode === 'paint');
  cloneModelBtn.classList.toggle('active', mode === 'clone');
  sampleModelBtn.classList.toggle('active', mode === 'sample');
  navigateModelBtn.classList.toggle('active', mode === 'navigate');
  viewer?.classList.toggle('direct-paint', mode === 'paint' || mode === 'clone');
  viewer?.classList.toggle('direct-sample', mode === 'sample');
  viewer?.classList.toggle('clone-ready', mode === 'clone' && !!state.cloneSourceScreen);

  if (mode !== 'navigate' && originalBtn && !originalBtn.classList.contains('active')) originalBtn.click();

  if (help) {
    help.textContent = mode === 'paint'
      ? 'PAINT · screen-space brush · hold Cmd / Ctrl to rotate · scroll to zoom'
      : mode === 'clone'
        ? 'CLONE · Option/Alt-click source · drag to clone · Cmd/Ctrl to rotate'
        : mode === 'sample'
          ? 'PICK COLOUR · click the model to sample its texture colour'
          : 'Drag to rotate · Scroll to zoom · Right-drag to pan';
  }

  if (mode === 'paint') say('Paint mode: each brush step is raycast onto the car, so UV seams are not joined by lines.');
  if (mode === 'clone') say(state.cloneSourceScreen
    ? 'Clone source is set. Drag over the area to replace it, or Option/Alt-click a new source.'
    : 'Clone mode: Option-click (Mac) or Alt-click (Windows) a clean area to set the source.');
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

function screenPoint(evtOrPoint) {
  return { x: evtOrPoint.clientX ?? evtOrPoint.x, y: evtOrPoint.clientY ?? evtOrPoint.y };
}

function rayHitAt(point) {
  const v = getViewerState();
  if (!v?.renderer || !v?.scene || !v?.camera) return null;
  const canvas = v.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndc = new THREE.Vector2(
    ((point.x - rect.left) / rect.width) * 2 - 1,
    -((point.y - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, v.camera);
  const hits = raycaster.intersectObjects(v.scene.children, true);
  return hits.find(hit => hit.object?.isMesh && hit.uv) || null;
}

function texturePoint(hit, material, canvas) {
  if (!hit?.uv || !canvas?.width || !canvas?.height) return null;
  const uv = hit.uv.clone();
  const map = material?.map;
  if (map?.updateMatrix) map.updateMatrix();
  if (map?.transformUv) map.transformUv(uv);
  return {
    x: Math.max(0, Math.min(canvas.width - 1, uv.x * canvas.width)),
    y: Math.max(0, Math.min(canvas.height - 1, uv.y * canvas.height))
  };
}

function textureIndexForMaterial(material) {
  const exact = material?.map?.userData?.gltfTextureIndex;
  if (Number.isInteger(exact) && exact >= 0 && exact < (textureSelect?.options?.length || 0)) return exact;
  const options = [...(textureSelect?.options || [])];
  const name = material?.map?.name?.trim() || '';
  if (name) {
    const exactName = options.find(o => o.textContent.trim() === name);
    if (exactName) return Number(exactName.value);
    const loose = options.find(o => o.textContent.trim().includes(name) || name.includes(o.textContent.trim()));
    if (loose) return Number(loose.value);
  }
  return options.length === 1 ? Number(options[0].value) : null;
}

async function waitForTextureEditor(index) {
  const started = performance.now();
  while (performance.now() - started < 1800) {
    if (Number(textureSelect?.value) === index && textureCanvas.width > 1 && textureCanvas.height > 1 && !applyBtn?.disabled) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return Number(textureSelect?.value) === index && textureCanvas.width > 1 && textureCanvas.height > 1;
}

function makeSurface(index) {
  const canvas = document.createElement('canvas');
  canvas.width = textureCanvas.width;
  canvas.height = textureCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(textureCanvas, 0, 0);
  const surface = { index, canvas, ctx, liveTextures: new Set() };
  state.surfaces.set(index, surface);
  return surface;
}

function syncSurfaceToEditor(surface) {
  if (!surface || Number(textureSelect?.value) !== surface.index) return;
  if (textureCanvas.width !== surface.canvas.width || textureCanvas.height !== surface.canvas.height) {
    textureCanvas.width = surface.canvas.width;
    textureCanvas.height = surface.canvas.height;
  }
  paintCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  paintCtx.drawImage(surface.canvas, 0, 0);
}

function refreshSurface(surface) {
  if (!surface) return;
  surface.liveTextures.forEach(tex => { tex.needsUpdate = true; });
  syncSurfaceToEditor(surface);
}

async function ensureSurfaceForMaterial(material) {
  const index = textureIndexForMaterial(material);
  if (!Number.isInteger(index)) {
    say('This surface has a texture, but Shrink could not link it to the embedded GLB image.', true);
    return null;
  }

  if (Number(textureSelect.value) !== index) {
    textureSelect.value = String(index);
    textureSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (!await waitForTextureEditor(index)) {
    say(`Texture ${index + 1} did not finish loading into the editor.`, true);
    return null;
  }

  let surface = state.surfaces.get(index);
  if (!surface) surface = makeSurface(index);
  else syncSurfaceToEditor(surface);
  state.activeTextureIndex = index;
  state.activeSurface = surface;
  return surface;
}

function attachSurfaceToMaterial(material, surface) {
  if (!material?.map || !surface) return;
  if (material.map.image === surface.canvas) {
    state.activeMaterial = material;
    return;
  }
  const oldMap = material.map;
  const live = new THREE.CanvasTexture(surface.canvas);
  live.name = oldMap.name;
  live.flipY = oldMap.flipY;
  live.colorSpace = oldMap.colorSpace || THREE.SRGBColorSpace;
  live.wrapS = oldMap.wrapS; live.wrapT = oldMap.wrapT;
  live.magFilter = oldMap.magFilter; live.minFilter = oldMap.minFilter;
  live.anisotropy = oldMap.anisotropy;
  live.offset.copy(oldMap.offset); live.repeat.copy(oldMap.repeat); live.center.copy(oldMap.center);
  live.rotation = oldMap.rotation; live.matrixAutoUpdate = oldMap.matrixAutoUpdate;
  if (!oldMap.matrixAutoUpdate) live.matrix.copy(oldMap.matrix);
  live.userData = { ...(oldMap.userData || {}), gltfTextureIndex: surface.index };
  live.needsUpdate = true;
  material.map = live;
  material.needsUpdate = true;
  surface.liveTextures.add(live);
  state.activeMaterial = material;
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

function brushRadius(surface) {
  return Math.max(1, Number(brushSize?.value || 32) / 2);
}

function paintDab(surface, point) {
  if (!surface || !point) return;
  const ctx = surface.ctx;
  ctx.save();
  ctx.globalAlpha = Number(brushOpacity?.value || 100) / 100;
  ctx.fillStyle = paintColor?.value || '#000000';
  ctx.beginPath();
  ctx.arc(point.x, point.y, brushRadius(surface), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  refreshSurface(surface);
}

function cloneDab(surface, dest, source, snapshot) {
  if (!surface || !dest || !source || !snapshot) return;
  const radius = brushRadius(surface);
  const opacity = Number(brushOpacity?.value || 100) / 100;
  const minX = Math.max(0, Math.floor(dest.x - radius));
  const minY = Math.max(0, Math.floor(dest.y - radius));
  const maxX = Math.min(surface.canvas.width - 1, Math.ceil(dest.x + radius));
  const maxY = Math.min(surface.canvas.height - 1, Math.ceil(dest.y + radius));
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const patch = surface.ctx.getImageData(minX, minY, width, height);
  const out = patch.data;
  const src = snapshot.data;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = minX + px, y = minY + py;
      const lx = x - dest.x, ly = y - dest.y;
      const distance = Math.hypot(lx, ly);
      if (distance > radius) continue;
      const sx = Math.round(source.x + lx), sy = Math.round(source.y + ly);
      if (sx < 0 || sy < 0 || sx >= snapshot.width || sy >= snapshot.height) continue;
      const feather = Math.min(1, Math.max(0, (radius - distance) / Math.max(1, radius * 0.3)));
      const alpha = opacity * feather;
      const si = (sy * snapshot.width + sx) * 4;
      const di = (py * width + px) * 4;
      for (let c = 0; c < 4; c++) out[di + c] = Math.round(out[di + c] * (1 - alpha) + src[si + c] * alpha);
    }
  }
  surface.ctx.putImageData(patch, minX, minY);
  refreshSurface(surface);
}

function sampleColour(surface, point) {
  const x = Math.max(0, Math.min(surface.canvas.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(surface.canvas.height - 1, Math.round(point.y)));
  const px = surface.ctx.getImageData(x, y, 1, 1).data;
  const hex = `#${[px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  if (paintColor) paintColor.value = hex;
  say(`Picked ${hex} from the car. Paint mode is active.`);
  setMode('paint');
}

function modifierOrbit(evt) { return evt.metaKey || evt.ctrlKey || viewer?.classList.contains('modifier-rotate'); }

function screenDistance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

function screenSamples(from, to) {
  const distance = screenDistance(from, to);
  const stepPx = Math.max(2, Math.min(7, Number(brushSize?.value || 32) * 0.12));
  const steps = Math.max(1, Math.ceil(distance / stepPx));
  const result = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    result.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return result;
}

function updateCloneMarker(point) {
  if (!viewer || !point) return;
  const rect = viewer.getBoundingClientRect();
  cloneMarker.style.left = `${point.x - rect.left}px`;
  cloneMarker.style.top = `${point.y - rect.top}px`;
  viewer.classList.add('clone-ready');
}

async function dabAtScreen(point, mode) {
  const destHit = rayHitAt(point);
  if (!destHit) return;
  const destMaterial = materialForHit(destHit);
  if (!destMaterial?.map) return;
  const destIndex = textureIndexForMaterial(destMaterial);
  if (destIndex !== state.activeTextureIndex || destMaterial !== state.activeMaterial) return;
  const destUV = texturePoint(destHit, destMaterial, state.activeSurface.canvas);
  if (!destUV) return;

  if (mode === 'paint') {
    paintDab(state.activeSurface, destUV);
    return;
  }

  const sourceScreen = { x: point.x + state.cloneOffsetScreen.x, y: point.y + state.cloneOffsetScreen.y };
  const sourceHit = rayHitAt(sourceScreen);
  if (!sourceHit) return;
  const sourceMaterial = materialForHit(sourceHit);
  if (!sourceMaterial?.map || textureIndexForMaterial(sourceMaterial) !== state.activeTextureIndex) return;
  const sourceUV = texturePoint(sourceHit, sourceMaterial, state.activeSurface.canvas);
  if (!sourceUV) return;
  cloneDab(state.activeSurface, destUV, sourceUV, state.cloneSnapshot);
}

async function handlePointerDown(evt) {
  if (state.mode === 'navigate' || evt.button !== 0 || modifierOrbit(evt)) return;
  const v = getViewerState();
  if (!v?.renderer || evt.target !== v.renderer.domElement) return;
  evt.preventDefault(); evt.stopImmediatePropagation();

  const screen = screenPoint(evt);
  const hit = rayHitAt(screen);
  if (!hit) { say('No paintable surface under the pointer.', true); return; }
  const material = materialForHit(hit);
  if (!material?.map) { say('That part of the model does not use an image colour texture.', true); return; }
  const surface = await ensureSurfaceForMaterial(material);
  if (!surface) return;
  attachSurfaceToMaterial(material, surface);
  const uv = texturePoint(hit, material, surface.canvas);
  if (!uv) return;

  if (state.mode === 'sample') {
    sampleColour(surface, uv);
    return;
  }

  if (state.mode === 'clone' && evt.altKey) {
    state.cloneSourceScreen = screen;
    updateCloneMarker(screen);
    say('Clone source set. Now drag over the area you want to replace.');
    return;
  }

  if (state.mode === 'clone' && !state.cloneSourceScreen) {
    say('Set a clone source first with Option-click (Mac) or Alt-click (Windows).', true);
    return;
  }

  if ((evt.buttons & 1) === 0) return;
  saveUndo();
  state.painting = true;
  state.lastScreen = screen;

  if (state.mode === 'clone') {
    state.cloneOffsetScreen = { x: state.cloneSourceScreen.x - screen.x, y: state.cloneSourceScreen.y - screen.y };
    state.cloneSnapshot = surface.ctx.getImageData(0, 0, surface.canvas.width, surface.canvas.height);
    await dabAtScreen(screen, 'clone');
    say('LIVE CLONE · source follows the car in screen space · Option/Alt-click to reset source.');
  } else {
    paintDab(surface, uv);
    say(`LIVE PAINT · Texture ${state.activeTextureIndex + 1} · screen-space raycast stroke.`);
  }

  try { v.renderer.domElement.setPointerCapture(evt.pointerId); } catch {}
}

async function handlePointerMove(evt) {
  if (!['paint', 'clone'].includes(state.mode) || !state.painting || modifierOrbit(evt)) return;
  if ((evt.buttons & 1) === 0) { stopPaint(evt); return; }
  evt.preventDefault(); evt.stopImmediatePropagation();
  const now = screenPoint(evt);
  const samples = screenSamples(state.lastScreen || now, now);
  for (const point of samples) await dabAtScreen(point, state.mode);
  state.lastScreen = now;
}

function stopPaint(evt) {
  if (!state.painting) return;
  if (state.mode !== 'navigate' && !modifierOrbit(evt)) {
    evt?.preventDefault?.(); evt?.stopImmediatePropagation?.();
  }
  state.painting = false;
  state.lastScreen = null;
  state.cloneOffsetScreen = null;
  state.cloneSnapshot = null;
  try { getViewerState()?.renderer?.domElement?.releasePointerCapture(evt.pointerId); } catch {}
}

viewer?.addEventListener('pointerdown', handlePointerDown, true);
viewer?.addEventListener('pointermove', handlePointerMove, true);
viewer?.addEventListener('pointerup', stopPaint, true);
viewer?.addEventListener('pointercancel', stopPaint, true);
viewer?.addEventListener('pointerleave', evt => { if ((evt.buttons & 1) === 0) stopPaint(evt); }, true);

undo3DBtn.addEventListener('click', () => {
  if (!state.undoImage || !paintCtx || !state.activeSurface) return;
  paintCtx.putImageData(state.undoImage, 0, 0);
  state.activeSurface.ctx.clearRect(0, 0, state.activeSurface.canvas.width, state.activeSurface.canvas.height);
  state.activeSurface.ctx.drawImage(textureCanvas, 0, 0);
  refreshSurface(state.activeSurface);
  state.undoImage = null;
  undo3DBtn.disabled = true;
  say('Last 3D paint stroke undone.');
});

window.addEventListener('shrink:undo-restored', () => {
  if (!state.activeSurface || Number(textureSelect?.value) !== state.activeSurface.index) return;
  state.activeSurface.ctx.clearRect(0, 0, state.activeSurface.canvas.width, state.activeSurface.canvas.height);
  state.activeSurface.ctx.drawImage(textureCanvas, 0, 0);
  refreshSurface(state.activeSurface);
});

textureSelect?.addEventListener('change', () => {
  state.cloneSourceScreen = null;
  viewer?.classList.remove('clone-ready');
});

applyBtn?.addEventListener('click', () => {
  state.painting = false;
  state.lastScreen = null;
  state.cloneSourceScreen = null;
  state.cloneOffsetScreen = null;
  state.cloneSnapshot = null;
  viewer?.classList.remove('clone-ready');
  setMode('paint');
});

setMode('navigate');
