import './paint-mode-v08.js?v=2.18';
import './gltf-texture-index.js';
import * as THREE from 'https://esm.sh/three@0.180.0';
import { ensureBVH, raycasterFor } from './bvh-support.js?v=2.18';
import { patchCoords, samplePatch, edgeFalloff, pasteRadius, patchStep, blendNormalBlock, sliceRegion } from './stamp-core.js?v=2.82';

/* Shrink 3D paint engine (v1.5)
 *  - fast raycasting (BVH) so painting stays live on very dense meshes
 *  - brush is a true 3D sphere: every texel within the brush radius (in 3D) is painted, so strokes never
 *    streak across unrelated UV islands and the brush stays the same size on the surface
 *  - stamps are placed along the mouse path in SCREEN space (no gaps on fast strokes)
 *  - clone brush copies from a point on the model by screen offset (projective clone), not by UV offset
 *  - every texture keeps its own edits, so painting one texture never corrupts another
 */

const state = {
  mode: 'navigate',
  painting: false,
  lastScreen: null,
  activeMaterial: null,
  liveTexture: null,
  undoImage: null,
  activeTextureIndex: null,
  cloneSource: null,        // { point: Vector3 (world), textureIndex }
  cloneOffset: null,        // screen-space offset (client px) from brush to source, fixed at stroke start
  cloneSnapshot: null,
  pointerHeld: false,
  layers: new Map(),        // textureIndex -> { canvas, texture, dirty }
  mirror: null,             // CPU copy of the active texture while a stroke is in progress
  paintMaps: new Map()      // textureIndex -> { key, W, H, k, mw, mh, pos, valid }
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
const raycaster = raycasterFor();

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
const stampModelBtn = makeButton('stampModelBtn', 'Stamp');
const sampleModelBtn = makeButton('sampleModelBtn', 'Pick colour');
const navigateModelBtn = makeButton('navigateModelBtn', 'Navigate');
const undo3DBtn = makeButton('undo3DBtn', 'Undo');
undo3DBtn.disabled = true;
controls.append(paintModelBtn, cloneModelBtn, stampModelBtn, sampleModelBtn, navigateModelBtn, undo3DBtn);

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
  .clone-source-marker{position:absolute;z-index:31;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #7dff9b;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none;display:none}
  .clone-source-marker::before,.clone-source-marker::after{content:"";position:absolute;background:#7dff9b;left:50%;top:50%}
  .clone-source-marker::before{width:12px;height:2px;margin:-1px 0 0 -6px}
  .clone-source-marker::after{width:2px;height:12px;margin:-6px 0 0 -1px}
  @media(max-width:1100px){.viewer-toolbar{flex-wrap:wrap}.model-paint-controls{order:3;width:100%;margin:4px 0 0}}
`;
document.head.appendChild(style);

const sourceMarker = document.createElement('div');
sourceMarker.className = 'clone-source-marker';
viewer?.appendChild(sourceMarker);

// End whatever is in progress right now (brush stroke, spray timer, stamp box) without waiting for a mouse-up that may never arrive.
function abortStroke() {
  stopSpray();
  if (state.painting) { state.painting = false; finishNormalStroke(); state.mirror = null; }
  state.pointerHeld = false;
  state.lastScreen = null;
  state.cloneOffset = null;
  state.cloneSnapshot = null;
  if (stamp.sel) { stamp.sel = null; stampRect.hidden = true; }
}

function setMode(mode) {
  state.mode = mode;
  abortStroke();
  paintModelBtn.classList.toggle('active', mode === 'paint');
  cloneModelBtn.classList.toggle('active', mode === 'clone');
  stampModelBtn.classList.toggle('active', mode === 'stamp');
  stampModeChanged(mode === 'stamp');
  sampleModelBtn.classList.toggle('active', mode === 'sample');
  navigateModelBtn.classList.toggle('active', mode === 'navigate');
  viewer?.classList.toggle('direct-paint', mode === 'paint' || mode === 'clone' || mode === 'stamp');
  viewer?.classList.toggle('direct-sample', mode === 'sample');
  if (mode !== 'clone') sourceMarker.style.display = 'none';
  optionsBar.hidden = !(mode === 'paint' || mode === 'clone' || mode === 'stamp');
  const sizeRow = optionsBar.querySelector('#vwBrushSizeRow'); if (sizeRow) sizeRow.hidden = mode === 'stamp';
  const softRow = optionsBar.querySelector('#vwSoftRow'); if (softRow) softRow.hidden = mode === 'stamp';
  const sprayRow = optionsBar.querySelector('#vwSprayRow'); if (sprayRow) sprayRow.hidden = mode !== 'paint';
  const colorRow = optionsBar.querySelector('#vwColorRow'); if (colorRow) colorRow.hidden = mode !== 'paint';
  const flatText = optionsBar.querySelector('#vwFlatText'); if (flatText) flatText.textContent = mode === 'clone' ? 'Copy the bumps too' : 'Flatten the bumps too';
  stopSpray();

  if (mode !== 'navigate' && originalBtn && !originalBtn.classList.contains('active')) { const A = window.__shrinkApp, vs = A?.getViewState?.(); if (A?.show) A.show('original'); else originalBtn.click(); if (vs) A?.restoreViewState?.(vs); }
  window.dispatchEvent(new CustomEvent('shrink:paint-mode', { detail: { mode } }));

  if (help) {
    help.textContent = mode === 'paint'
      ? 'PAINT · drag on model · hold Cmd / Ctrl to rotate · Esc or click Paint again when done'
      : mode === 'clone'
        ? 'CLONE · Option/Alt-click a clean source · drag to clone · Cmd/Ctrl to rotate'
        : mode === 'stamp'
          ? 'STAMP · drag a box to copy · click to paste · Option/Alt-drag copies again · Cmd/Ctrl to rotate'
          : mode === 'sample'
          ? 'PICK COLOUR · click the model to sample its texture colour'
          : 'Drag to rotate · Scroll to zoom · Right-drag to pan';
  }

  if (mode === 'paint') say('Paint mode: drag directly on the model. Hold Cmd / Ctrl while dragging to rotate.');
  if (mode === 'clone') say(state.cloneSource
    ? 'Clone mode: drag to clone from the saved source. Option/Alt-click anywhere to choose a new source.'
    : 'Clone mode: Option-click (Mac) or Alt-click (Windows) a clean area of the car to set the source.');
  if (mode === 'stamp') say(stamp.patch ? 'Stamp mode: aim at the destination and click to paste. Option/Alt-drag copies something new.' : 'Stamp mode: drag a box around what you want to copy (for example a number).');
  if (mode === 'sample') say('Pick colour: click the model to sample a colour, then Paint resumes automatically.');
}

// Clicking the tool that is already on switches it off again (back to rotating the model); so does Esc or the Done button.
const toggleMode = m => setMode(state.mode === m ? 'navigate' : m);
paintModelBtn.addEventListener('click', () => toggleMode('paint'));
cloneModelBtn.addEventListener('click', () => toggleMode('clone'));
sampleModelBtn.addEventListener('click', () => toggleMode('sample'));
stampModelBtn.addEventListener('click', () => toggleMode('stamp'));
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (state.mode === 'navigate') { stampGhost.hidden = true; return; }   // a ghost left behind by a late copy/paste goes too
  if (state.mode === 'stamp') { stamp.patch = null; stamp.sel = null; stampRect.hidden = true; }   // Esc cancels the stamp: the copied patch is forgotten, so it does not come back next time
  setMode('navigate');          // also ends a stroke that is still running (a lost mouse-up used to leave the brush painting)
});
navigateModelBtn.addEventListener('click', () => setMode('navigate'));

/* ------------------------------------------------------------------ */
/* Ray casting                                                          */
/* ------------------------------------------------------------------ */
function materialForHit(hit) {
  const object = hit?.object;
  if (!object?.material) return null;
  if (!Array.isArray(object.material)) return object.material;
  const index = hit.face?.materialIndex ?? 0;
  return object.material[index] || object.material[0] || null;
}

function rayAt(clientX, clientY) {
  const v = getViewerState();
  if (!v?.renderer || !v?.scene || !v?.camera) return null;
  const rect = v.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, v.camera);
  const hits = raycaster.intersectObjects(v.scene.children, true);
  return hits.find(hit => hit.object?.isMesh && hit.uv) || null;
}

function rayHit(evt) { return rayAt(evt.clientX, evt.clientY); }

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

function ringRadiusPx() {
  // radius in screen pixels = half the Brush size slider (the ring drawn by brush-cursor.js has that diameter)
  return Math.max(4, Number(brushSize?.value || 32)) / 2;
}

function worldPerPixel(distance) {
  const v = getViewerState();
  const rect = v.renderer.domElement.getBoundingClientRect();
  return (2 * distance * Math.tan(THREE.MathUtils.degToRad(v.camera.fov) / 2)) / Math.max(1, rect.height);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
// texels per world unit around the hit triangle (so a brush of N screen pixels covers the right number of texels)
function texelsPerWorld(hit) {
  const g = hit.object.geometry, uv = g.attributes.uv, pos = g.attributes.position, f = hit.face;
  if (!uv || !f) return null;
  _a.fromBufferAttribute(pos, f.a).applyMatrix4(hit.object.matrixWorld);
  _b.fromBufferAttribute(pos, f.b).applyMatrix4(hit.object.matrixWorld);
  _c.fromBufferAttribute(pos, f.c).applyMatrix4(hit.object.matrixWorld);
  const worldArea = _b.clone().sub(_a).cross(_c.clone().sub(_a)).length() / 2;
  const ux = uv.getX(f.b) - uv.getX(f.a), uy = uv.getY(f.b) - uv.getY(f.a);
  const vx = uv.getX(f.c) - uv.getX(f.a), vy = uv.getY(f.c) - uv.getY(f.a);
  const uvArea = Math.abs(ux * vy - uy * vx) / 2 * textureCanvas.width * textureCanvas.height;
  if (!(worldArea > 1e-18) || !(uvArea > 1e-9)) return null;
  return Math.sqrt(uvArea / worldArea);
}

/* ------------------------------------------------------------------ */
/* Paint map: for every texel, the 3D (world) position it lives at       */
/* ------------------------------------------------------------------ */
function textureIndexOfMaterial(material) {
  const exact = material?.map?.userData?.gltfTextureIndex;
  if (Number.isInteger(exact) && exact >= 0 && exact < (textureSelect?.options?.length || 0)) return exact;
  return fallbackTextureIndex(material);
}

function meshesForTexture(index) {
  const v = getViewerState();
  const out = [];
  v?.scene?.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.uv) return;
    const g = o.geometry;
    if (Array.isArray(o.material)) {
      const groups = g.groups?.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const m = o.material[gr.materialIndex];
        if (m?.map && textureIndexOfMaterial(m) === index) out.push({ mesh: o, start: gr.start, count: gr.count });
      }
    } else if (o.material?.map && textureIndexOfMaterial(o.material) === index) {
      out.push({ mesh: o, start: 0, count: g.index ? g.index.count : g.attributes.position.count });
    }
  });
  return out;
}

async function ensurePaintMap(index) {
  const W = textureCanvas.width, H = textureCanvas.height;
  const items = meshesForTexture(index);
  const key = `${W}x${H}:${items.map(i => i.mesh.geometry.uuid).join(',')}`;
  const cached = state.paintMaps.get(index);
  if (cached && cached.key === key) return cached;

  say('Preparing this texture for 3D painting…');
  await new Promise(r => setTimeout(r, 30));

  const k = Math.max(1, Math.ceil(Math.max(W, H) / 2048));
  const mw = Math.ceil(W / k), mh = Math.ceil(H / k);
  const pos = new Float32Array(mw * mh * 3);
  const valid = new Uint8Array(mw * mh);
  const wp = new THREE.Vector3();
  let skipped = 0;

  for (const { mesh, start, count } of items) {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry, P = g.attributes.position, UVa = g.attributes.uv, idx = g.index;
    const n = P.count;
    const wx = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      wp.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
      wx[i * 3] = wp.x; wx[i * 3 + 1] = wp.y; wx[i * 3 + 2] = wp.z;
      uvs[i * 2] = UVa.getX(i) * mw; uvs[i * 2 + 1] = UVa.getY(i) * mh;
    }
    const total = idx ? idx.count : n;
    const ind = new Uint32Array(total);
    if (idx) for (let i = 0; i < total; i++) ind[i] = idx.getX(i); else for (let i = 0; i < total; i++) ind[i] = i;
    const ratio = (a, b) => {
      const wl = Math.hypot(wx[a * 3] - wx[b * 3], wx[a * 3 + 1] - wx[b * 3 + 1], wx[a * 3 + 2] - wx[b * 3 + 2]);
      const ul = Math.hypot(uvs[a * 2] - uvs[b * 2], uvs[a * 2 + 1] - uvs[b * 2 + 1]);
      return wl > 1e-12 ? ul / wl : 0;
    };
    // typical texels-per-world-unit; triangles far above it are UV-wrap artefacts (an edge that jumps across the atlas)
    const samples = [];
    const stepT = Math.max(3, Math.floor(count / 3 / 4000) * 3);
    for (let t = start; t + 2 < start + count; t += stepT) { const e = ratio(ind[t], ind[t + 1]); if (e > 0) samples.push(e); }
    samples.sort((x, y) => x - y);
    const limit = (samples[Math.floor(samples.length / 2)] || 1) * 40;

    for (let t = start; t + 2 < start + count; t += 3) {
      const i0 = ind[t], i1 = ind[t + 1], i2 = ind[t + 2];
      if (ratio(i0, i1) > limit || ratio(i1, i2) > limit || ratio(i2, i0) > limit) { skipped++; continue; }
      const x0 = uvs[i0 * 2], y0 = uvs[i0 * 2 + 1], x1 = uvs[i1 * 2], y1 = uvs[i1 * 2 + 1], x2 = uvs[i2 * 2], y2 = uvs[i2 * 2 + 1];
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 0.5)), maxX = Math.min(mw - 1, Math.ceil(Math.max(x0, x1, x2) - 0.5));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 0.5)), maxY = Math.min(mh - 1, Math.ceil(Math.max(y0, y1, y2) - 0.5));
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-12) continue;
      const ax = wx[i0 * 3], ay = wx[i0 * 3 + 1], az = wx[i0 * 3 + 2], bx = wx[i1 * 3], by = wx[i1 * 3 + 1], bz = wx[i1 * 3 + 2], cx = wx[i2 * 3], cy = wx[i2 * 3 + 1], cz = wx[i2 * 3 + 2];
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den;
          const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
          const l2 = 1 - l0 - l1;
          if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
          const o = (y * mw + x) * 3;
          pos[o] = l0 * ax + l1 * bx + l2 * cx;
          pos[o + 1] = l0 * ay + l1 * by + l2 * cy;
          pos[o + 2] = l0 * az + l1 * bz + l2 * cz;
          valid[y * mw + x] = 1;
        }
      }
    }
    await new Promise(r => setTimeout(r, 0));
  }

  // Grow the map a few texels into the empty gutters so strokes also paint the padding (no visible seam lines).
  for (let pass = 0; pass < 3; pass++) {
    const grow = [];
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const i = y * mw + x;
      if (valid[i]) continue;
      let src = -1;
      if (x > 0 && valid[i - 1]) src = i - 1;
      else if (x < mw - 1 && valid[i + 1]) src = i + 1;
      else if (y > 0 && valid[i - mw]) src = i - mw;
      else if (y < mh - 1 && valid[i + mw]) src = i + mw;
      if (src >= 0) grow.push(i, src);
    }
    for (let g = 0; g < grow.length; g += 2) {
      const i = grow[g], s = grow[g + 1];
      pos[i * 3] = pos[s * 3]; pos[i * 3 + 1] = pos[s * 3 + 1]; pos[i * 3 + 2] = pos[s * 3 + 2]; valid[i] = 1;
    }
  }

  // 3D grid over texel positions: a dab finds every texel within the brush sphere no matter which UV island it lives on.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, nValid = 0;
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) continue;
    nValid++;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const cell = extent / 64;
  const nx = Math.floor((maxX - minX) / cell) + 1, ny = Math.floor((maxY - minY) / cell) + 1, nz = Math.floor((maxZ - minZ) / cell) + 1;
  const cellOf = i => (Math.floor((pos[i * 3 + 2] - minZ) / cell) * ny + Math.floor((pos[i * 3 + 1] - minY) / cell)) * nx + Math.floor((pos[i * 3] - minX) / cell);
  const cStart = new Int32Array(nx * ny * nz + 1);
  for (let i = 0; i < valid.length; i++) if (valid[i]) cStart[cellOf(i) + 1]++;
  for (let c = 0; c < cStart.length - 1; c++) cStart[c + 1] += cStart[c];
  const fill = cStart.slice(0, -1), cItems = new Int32Array(nValid);
  for (let i = 0; i < valid.length; i++) if (valid[i]) cItems[fill[cellOf(i)]++] = i;

  const entry = { key, W, H, k, mw, mh, pos, valid, skipped, grid: { min: [minX, minY, minZ], cell, dims: [nx, ny, nz], start: cStart, items: cItems } };
  state.paintMaps.set(index, entry);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Bumps: the normal map is edited together with the colour (flatten for Paint / Stamp, copy for Clone) */
/* ------------------------------------------------------------------ */
const flat = { on: true, layers: new Map(), cur: null, undo: new Map(), serial: null };
const FLAT_RGB = [128, 128, 255];          // a perfectly flat surface in a normal map

// A private, editable copy of a material's normal map (kept per glTF texture index; every material using it points at the copy).
function normalLayerFor(material) {
  const nm = material?.normalMap;
  if (!nm) return null;
  const idx = nm.userData?.gltfTextureIndex;
  if (!Number.isInteger(idx)) return null;
  let L = flat.layers.get(idx);
  if (L) { if (material.normalMap !== L.texture) { material.normalMap = L.texture; material.needsUpdate = true; } return L; }
  const img = nm.image, w = img?.naturalWidth || img?.width, h = img?.naturalHeight || img?.height;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try { ctx.drawImage(img, 0, 0); } catch { return null; }
  const live = new THREE.CanvasTexture(canvas);
  live.flipY = nm.flipY; live.colorSpace = nm.colorSpace; live.wrapS = nm.wrapS; live.wrapT = nm.wrapT;
  live.magFilter = nm.magFilter; live.minFilter = nm.minFilter; live.anisotropy = nm.anisotropy;
  live.offset.copy(nm.offset); live.repeat.copy(nm.repeat); live.center.copy(nm.center); live.rotation = nm.rotation;
  live.userData = { ...(nm.userData || {}) };
  live.needsUpdate = true;
  L = { idx, canvas, ctx, w, h, texture: live, orig: nm, dirty: false, work: null, before: null, box: null, pend: null, cw: 1, ch: 1 };
  flat.layers.set(idx, L);
  getViewerState()?.scene?.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && m.normalMap === nm) { m.normalMap = live; m.needsUpdate = true; }
  });
  return L;
}

function beginNormalStroke(material) {
  flat.cur = null;
  if (!flat.on) return;
  const L = normalLayerFor(material);
  if (!L) return;
  L.work = L.ctx.getImageData(0, 0, L.w, L.h);
  L.before = new Uint8ClampedArray(L.work.data);
  L.box = null; L.pend = null; L.cw = textureCanvas.width; L.ch = textureCanvas.height;
  flat.cur = L;
}

const grow = (b, x0, y0, x1, y1) => b ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0, y0, x1, y1 };

// Blend the normal map towards `rgb` at the place that colour texel (px, py) covers.
function normalBlend(px, py, w, rgb) {
  const L = flat.cur;
  if (!L || !L.work) return;
  const r = blendNormalBlock(L.work.data, L.w, L.h, L.cw, L.ch, px, py, w, rgb);
  if (r) { L.box = grow(L.box, r.x0, r.y0, r.x1, r.y1); L.pend = grow(L.pend, r.x0, r.y0, r.x1, r.y1); }
}

// The normal-map colour at the source of a clone (read from the picture as it was when the stroke began).
function normalSource(cx, cy) {
  const L = flat.cur;
  if (!L || !L.before) return null;
  const x = Math.min(L.w - 1, Math.max(0, Math.floor(cx * L.w / L.cw))), y = Math.min(L.h - 1, Math.max(0, Math.floor(cy * L.h / L.ch))), o = (y * L.w + x) * 4;
  return [L.before[o], L.before[o + 1], L.before[o + 2]];
}

function flushNormal() {
  const L = flat.cur;
  if (!L || !L.pend || !L.work) return;
  const b = L.pend; L.pend = null;
  L.ctx.putImageData(L.work, 0, 0, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  L.texture.needsUpdate = true;
}

// End of a stroke: remember just the changed rectangle so Undo can put it back.
function finishNormalStroke() {
  const L = flat.cur;
  if (!L) return;
  flushNormal();
  flat.cur = null;
  const b = L.box;
  if (b) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, keep = sliceRegion(L.before, L.w, b);
    if (flat.serial != null) {
      flat.undo.set(flat.serial, { idx: L.idx, x: b.x0, y: b.y0, w, h, data: keep });
      while (flat.undo.size > 25) flat.undo.delete(flat.undo.keys().next().value);
    }
    L.dirty = true;
  }
  L.work = null; L.before = null; L.box = null; L.pend = null;
}

// Undo / redo of the bumps (normal map) part of a stroke: each step swaps the saved region with what is there now, so the same record serves both directions.
flat.redo = new Map();
function swapRegion(from, to, serial) {
  const u = from.get(serial); if (!u) return;
  from.delete(serial);
  const L = flat.layers.get(u.idx); if (!L) return;
  const now = L.ctx.getImageData(u.x, u.y, u.w, u.h);
  L.ctx.putImageData(new ImageData(u.data, u.w, u.h), u.x, u.y);
  L.texture.needsUpdate = true; L.dirty = true;
  to.set(serial, { ...u, data: now.data });
}
window.addEventListener('shrink:paint-undo', e => swapRegion(flat.undo, flat.redo, e.detail?.serial));
window.addEventListener('shrink:paint-redo', e => swapRegion(flat.redo, flat.undo, e.detail?.serial));
window.addEventListener('shrink:paint-redo-cleared', () => flat.redo.clear());
window.addEventListener('shrink:paint-undo-cleared', () => { flat.undo.clear(); flat.redo.clear(); });

/* ------------------------------------------------------------------ */
/* Brush stamps (all pixel work happens on a CPU mirror, then only the dirty rectangle is pushed to the canvas) */
/* ------------------------------------------------------------------ */
function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

// How soft the brush edge is: edge = the fraction of the radius over which it fades (28% = the old fixed look, 100% = airbrush).
const brush = { edge: 0.28, spray: false, timer: null };
function feather(d, r) { return Math.min(1, Math.max(0, (1 - d / r) / brush.edge)); }
const SPRAY_FLOW = 0.14;     // spray: each dab is faint, so colour builds up with strokes and while you hold still

const dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
function touch(x, y) { if (x < dirty.x0) dirty.x0 = x; if (y < dirty.y0) dirty.y0 = y; if (x > dirty.x1) dirty.x1 = x; if (y > dirty.y1) dirty.y1 = y; }

function flushDirty() {
  flushNormal();
  if (!state.mirror || dirty.x1 < dirty.x0) return;
  const x = Math.max(0, dirty.x0), y = Math.max(0, dirty.y0);
  const w = Math.min(state.mirror.width - 1, dirty.x1) - x + 1, h = Math.min(state.mirror.height - 1, dirty.y1) - y + 1;
  if (w > 0 && h > 0) paintCtx.putImageData(state.mirror, 0, 0, x, y, w, h);
  dirty.x0 = dirty.y0 = Infinity; dirty.x1 = dirty.y1 = -Infinity;
  markDirty();
}

function markDirty() {
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
  const layer = state.layers.get(state.activeTextureIndex);
  if (layer) layer.dirty = true;
}

// Paint every texel whose 3D position lies inside the sphere (centre P, radius r).
function paintSphere(P, r, mapEntry, rgb) {
  const { k, mw, pos, grid, W, H } = mapEntry, data = state.mirror.data;
  const [nx, ny, nz] = grid.dims, [gx, gy, gz] = grid.min, cell = grid.cell;
  const x0 = Math.max(0, Math.floor((P.x - r - gx) / cell)), x1 = Math.min(nx - 1, Math.floor((P.x + r - gx) / cell));
  const y0 = Math.max(0, Math.floor((P.y - r - gy) / cell)), y1 = Math.min(ny - 1, Math.floor((P.y + r - gy) / cell));
  const z0 = Math.max(0, Math.floor((P.z - r - gz) / cell)), z1 = Math.min(nz - 1, Math.floor((P.z + r - gz) / cell));
  const r2 = r * r, opacity = Number(brushOpacity?.value || 100) / 100 * (brush.spray && state.mode === 'paint' ? SPRAY_FLOW : 1);
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = (z * ny + y) * nx + x;
    for (let s = grid.start[c], e = grid.start[c + 1]; s < e; s++) {
      const mi = grid.items[s];
      const dx = pos[mi * 3] - P.x, dy = pos[mi * 3 + 1] - P.y, dz = pos[mi * 3 + 2] - P.z;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd > r2) continue;
      const w = opacity * feather(Math.sqrt(dd), r);
      if (w <= 0) continue;
      const tx = mi % mw, ty = (mi / mw) | 0;
      for (let by = 0; by < k; by++) {
        const py = ty * k + by; if (py >= H) break;
        for (let bx = 0; bx < k; bx++) {
          const px = tx * k + bx; if (px >= W) break;
          const o = (py * W + px) * 4;
          data[o] = data[o] * (1 - w) + rgb[0] * w;
          data[o + 1] = data[o + 1] * (1 - w) + rgb[1] * w;
          data[o + 2] = data[o + 2] * (1 - w) + rgb[2] * w;
          touch(px, py);
          if (flat.cur) normalBlend(px, py, w, FLAT_RGB);
        }
      }
    }
  }
}

function paintDabAtScreen(x, y) {
  const hit = rayAt(x, y);
  if (!hit) return;
  const material = materialForHit(hit);
  if (material !== state.activeMaterial) return;
  const mapEntry = state.paintMaps.get(state.activeTextureIndex);
  if (!mapEntry || !state.mirror) return;
  const rWorld = ringRadiusPx() * worldPerPixel(hit.distance);
  paintSphere(hit.point, rWorld, mapEntry, hexToRgb(paintColor?.value));
}

// Projective clone: sample a grid of points across the brush disc; for each, find the model point under
// (pointer + offset) and copy its colour to the model point under the pointer.
function cloneDabAtScreen(x, y) {
  const snapshot = state.cloneSnapshot, off = state.cloneOffset, src = state.cloneSource;
  if (!snapshot || !off || !src || !state.mirror) return;
  const Rpx = ringRadiusPx();
  const step = Math.max(2, Rpx / 8);
  const opacity = Number(brushOpacity?.value || 100) / 100;
  const data = state.mirror.data, W = state.mirror.width, H = state.mirror.height;
  for (let dy = -Rpx; dy <= Rpx; dy += step) {
    for (let dx = -Rpx; dx <= Rpx; dx += step) {
      const dist = Math.hypot(dx, dy);
      if (dist > Rpx) continue;
      const dest = rayAt(x + dx, y + dy);
      if (!dest || materialForHit(dest) !== state.activeMaterial) continue;
      const source = rayAt(x + off.x + dx, y + off.y + dy);
      if (!source) continue;
      const sMat = materialForHit(source);
      if (!sMat?.map || textureIndexOfMaterial(sMat) !== state.activeTextureIndex) continue;
      const sp = texturePoint(source, sMat), dp = texturePoint(dest, state.activeMaterial);
      if (!sp || !dp) continue;
      const si = ((Math.round(sp.y) * snapshot.width) + Math.round(sp.x)) * 4;
      const tpw = texelsPerWorld(dest) || Math.sqrt(W * H);
      const rs = Math.max(1.5, step * worldPerPixel(dest.distance) * tpw * 1.1);
      const w = opacity * feather(dist, Rpx);
      const cr = snapshot.data[si], cg = snapshot.data[si + 1], cb = snapshot.data[si + 2];
      const nrgb = flat.cur ? normalSource(sp.x, sp.y) : null;
      const cxp = Math.round(dp.x), cyp = Math.round(dp.y);
      const rr = Math.ceil(rs);
      for (let ty = Math.max(0, cyp - rr); ty <= Math.min(H - 1, cyp + rr); ty++) {
        for (let tx = Math.max(0, cxp - rr); tx <= Math.min(W - 1, cxp + rr); tx++) {
          const q = Math.hypot(tx - cxp, ty - cyp) / rs;
          if (q > 1) continue;
          const ww = w * (1 - q * q);
          const o = (ty * W + tx) * 4;
          data[o] = data[o] * (1 - ww) + cr * ww; data[o + 1] = data[o + 1] * (1 - ww) + cg * ww; data[o + 2] = data[o + 2] * (1 - ww) + cb * ww;
          touch(tx, ty);
          if (nrgb) normalBlend(tx, ty, ww, nrgb);
        }
      }
    }
  }
}

function strokeTo(x, y) {
  const last = state.lastScreen || { x, y };
  const dist = Math.hypot(x - last.x, y - last.y);
  const step = Math.max(1.5, ringRadiusPx() * 0.3);
  const n = Math.min(60, Math.max(1, Math.ceil(dist / step)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, px = last.x + (x - last.x) * t, py = last.y + (y - last.y) * t;
    if (state.mode === 'clone') cloneDabAtScreen(px, py); else paintDabAtScreen(px, py);
  }
  flushDirty();
  state.lastScreen = { x, y };
}

/* ------------------------------------------------------------------ */
/* Undo                                                                 */
/* ------------------------------------------------------------------ */
function saveUndo() {
  if (!paintCtx || !textureCanvas.width || !textureCanvas.height) return;
  try {
    state.undoImage = paintCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height);
    undo3DBtn.disabled = false;
  } catch (err) {
    console.warn('3D paint undo unavailable:', err);
  }
}

/* ------------------------------------------------------------------ */
/* Texture selection + per-texture layers                               */
/* ------------------------------------------------------------------ */
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

function textureIndexForMaterial(material) { return textureIndexOfMaterial(material); }

async function waitForTextureEditor(index, material) {
  const image = material?.map?.image;
  const expectedWidth = image?.width || image?.videoWidth || image?.naturalWidth || 0;
  const expectedHeight = image?.height || image?.videoHeight || image?.naturalHeight || 0;
  const started = performance.now();
  while (performance.now() - started < 4000) {
    const sameIndex = Number(textureSelect?.value) === index;
    const hasCanvas = textureCanvas.width > 1 && textureCanvas.height > 1;
    const rightSize = !expectedWidth || !expectedHeight || (textureCanvas.width === expectedWidth && textureCanvas.height === expectedHeight);
    if (sameIndex && hasCanvas && rightSize && !applyBtn?.disabled) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return Number(textureSelect?.value) === index && textureCanvas.width > 1 && textureCanvas.height > 1;
}

// The editor has ONE shared canvas. Before it is reused for another texture, move its pixels into a private canvas so
// the material that was showing it keeps its own (painted) picture.
function stashLayer(index) {
  const layer = state.layers.get(index);
  if (!layer || !textureCanvas.width || textureCanvas.width < 2) return;
  const copy = document.createElement('canvas');
  copy.width = textureCanvas.width; copy.height = textureCanvas.height;
  copy.getContext('2d').drawImage(textureCanvas, 0, 0);
  layer.canvas = copy;
  if (layer.texture) { layer.texture.image = copy; layer.texture.needsUpdate = true; }
}

function restoreLayerIntoEditor(index) {
  const layer = state.layers.get(index);
  if (!layer?.canvas) return;
  textureCanvas.width = layer.canvas.width; textureCanvas.height = layer.canvas.height;
  paintCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  paintCtx.drawImage(layer.canvas, 0, 0);
  layer.canvas = null;
  if (layer.texture) { layer.texture.image = textureCanvas; layer.texture.needsUpdate = true; }
}

async function ensureTextureForMaterial(material) {
  const index = textureIndexForMaterial(material);
  if (!Number.isInteger(index)) {
    say('This surface has a texture, but Shrink could not link it to the embedded GLB image.', true);
    return false;
  }

  if (Number(textureSelect.value) !== index || state.activeTextureIndex !== index) {
    textureSelect.value = String(index);
    textureSelect.dispatchEvent(new Event('change', { bubbles: true }));   // our listener below stashes the old layer
    state.activeTextureIndex = index;
  }

  const ready = await waitForTextureEditor(index, material);
  if (!ready) {
    say(`Texture ${index + 1} was identified, but its image did not finish loading into the paint canvas.`, true);
    return false;
  }
  restoreLayerIntoEditor(index);
  return true;
}

function attachLiveCanvas(material) {
  if (!material?.map || !textureCanvas.width || !textureCanvas.height) return;
  const index = state.activeTextureIndex;
  let layer = state.layers.get(index);
  if (state.activeMaterial === material && state.liveTexture && layer?.texture === state.liveTexture) {
    if (layer.texture.image !== textureCanvas) { layer.texture.image = textureCanvas; layer.texture.needsUpdate = true; }
    return;
  }
  if (layer?.texture) {
    layer.texture.image = textureCanvas;
    layer.texture.needsUpdate = true;
    if (material.map !== layer.texture) { material.map = layer.texture; material.needsUpdate = true; }
    state.activeMaterial = material; state.liveTexture = layer.texture;
    return;
  }
  const oldMap = material.map;
  const live = new THREE.CanvasTexture(textureCanvas);
  live.name = oldMap.name;
  live.flipY = oldMap.flipY;
  live.colorSpace = oldMap.colorSpace || THREE.SRGBColorSpace;
  live.wrapS = oldMap.wrapS; live.wrapT = oldMap.wrapT;
  live.magFilter = oldMap.magFilter; live.minFilter = oldMap.minFilter;
  live.anisotropy = oldMap.anisotropy;
  live.offset.copy(oldMap.offset); live.repeat.copy(oldMap.repeat); live.center.copy(oldMap.center);
  live.rotation = oldMap.rotation;
  live.matrixAutoUpdate = oldMap.matrixAutoUpdate;
  if (!oldMap.matrixAutoUpdate) live.matrix.copy(oldMap.matrix);
  live.userData = { ...(oldMap.userData || {}) };
  live.needsUpdate = true;
  material.map = live;
  material.needsUpdate = true;
  state.activeMaterial = material;
  state.liveTexture = live;
  state.layers.set(index, { canvas: null, texture: live, dirty: false });
}

/* ------------------------------------------------------------------ */
/* Pointer handling                                                     */
/* ------------------------------------------------------------------ */
function sampleAt(point) {
  const x = Math.max(0, Math.min(textureCanvas.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(textureCanvas.height - 1, Math.round(point.y)));
  const px = paintCtx.getImageData(x, y, 1, 1).data;
  const hex = `#${[px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  if (paintColor) paintColor.value = hex;
  vwColor.value = hex; rememberColour(hex);
  say(`Picked ${hex} from the model. Paint mode is active again.`);
  setMode('paint');
}

function modifierOrbit(evt) {
  return evt.metaKey || evt.ctrlKey || viewer?.classList.contains('modifier-rotate');
}

function projectToClient(point) {
  const v = getViewerState();
  const rect = v.renderer.domElement.getBoundingClientRect();
  const p = point.clone().project(v.camera);
  return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
}

function showSourceMarker(clientX, clientY) {
  const rect = viewer.getBoundingClientRect();
  sourceMarker.style.display = 'block';
  sourceMarker.style.left = `${clientX - rect.left}px`;
  sourceMarker.style.top = `${clientY - rect.top}px`;
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
  if (state.mode === 'stamp') { stampPointerDown(evt, v); return; }
  state.pointerHeld = true;
  const pointerId = evt.pointerId, clientX = evt.clientX, clientY = evt.clientY, altKey = evt.altKey;

  await ensureBVH(v.scene, say);
  if (!state.pointerHeld && state.mode !== 'sample' && !altKey) return;

  const hit = rayAt(clientX, clientY);
  if (!hit) { say('No paintable surface under the pointer.', true); return; }
  const material = materialForHit(hit);
  if (!material?.map) { say('That part of the model does not use an image colour texture.', true); return; }

  const ready = await ensureTextureForMaterial(material);
  if (!ready) return;

  const point = texturePoint(hit, material);
  if (!point) return;

  if (state.mode === 'sample') { sampleAt(point); return; }

  if (state.mode === 'clone' && altKey) {
    state.cloneSource = { point: hit.point.clone(), textureIndex: state.activeTextureIndex };
    state.cloneOffset = null;
    showSourceMarker(clientX, clientY);
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

  if (!state.pointerHeld) return;          // released while the texture was loading

  const map = await ensurePaintMap(state.activeTextureIndex);
  if (!state.pointerHeld) return;

  saveUndo();
  if (state.mode === 'paint') { vwColor.value = paintColor?.value || vwColor.value; rememberColour(paintColor?.value); }
  state.mirror = state.undoImage ? new ImageData(new Uint8ClampedArray(state.undoImage.data), state.undoImage.width, state.undoImage.height) : null;
  if (!state.mirror) { say('Could not read the texture for painting.', true); return; }
  attachLiveCanvas(material);
  flat.serial = window.__shrinkUndoSerial ?? null;
  beginNormalStroke(material);
  state.painting = true;
  state.lastScreen = { x: clientX, y: clientY };

  if (state.mode === 'clone') {
    const sp = projectToClient(state.cloneSource.point);
    state.cloneOffset = { x: sp.x - clientX, y: sp.y - clientY };
    state.cloneSnapshot = state.undoImage;
    cloneDabAtScreen(clientX, clientY);
    flushDirty();
    say(`LIVE CLONE · Texture ${state.activeTextureIndex + 1} · Option/Alt-click to choose another source.`);
  } else {
    paintDabAtScreen(clientX, clientY);
    flushDirty();
    stopSpray();
    if (brush.spray) brush.timer = setInterval(() => { if (state.painting && state.lastScreen) { paintDabAtScreen(state.lastScreen.x, state.lastScreen.y); flushDirty(); } }, 60);
    say(`LIVE PAINT · Texture ${state.activeTextureIndex + 1} · ${paintColor?.value || '#000000'} · 3D brush.`);
  }
  try { v.renderer.domElement.setPointerCapture(pointerId); } catch {}
}

function handlePointerMove(evt) {
  if (state.mode === 'stamp') { stampMove(evt); return; }
  if (state.mode === 'clone' && state.cloneSource && !state.painting) {
    const sp = getViewerState() ? projectToClient(state.cloneSource.point) : null;
    if (sp) showSourceMarker(sp.x, sp.y);
  }
  if (!['paint', 'clone'].includes(state.mode) || !state.painting || modifierOrbit(evt)) return;
  if ((evt.buttons & 1) === 0) { stopPaint(evt); return; }
  evt.preventDefault();
  evt.stopImmediatePropagation();
  strokeTo(evt.clientX, evt.clientY);
  if (state.mode === 'clone' && state.cloneOffset) showSourceMarker(evt.clientX + state.cloneOffset.x, evt.clientY + state.cloneOffset.y);
}

function stopPaint(evt) {
  stopSpray();
  if (state.mode === 'stamp') { stampUp(evt); return; }
  state.pointerHeld = false;
  if (!state.painting) return;
  if (state.mode !== 'navigate' && !modifierOrbit(evt)) {
    evt?.preventDefault?.();
    evt?.stopImmediatePropagation?.();
  }
  state.painting = false;
  state.lastScreen = null;
  state.cloneOffset = null;
  state.cloneSnapshot = null;
  finishNormalStroke();
  state.mirror = null;
  try { getViewerState()?.renderer?.domElement?.releasePointerCapture(evt.pointerId); } catch {}
}


/* ------------------------------------------------------------------ */
/* Stamp: copy a box of the model as you see it, paste it somewhere else (any angle, size, flipped)       */
/* ------------------------------------------------------------------ */
const stamp = { patch: null, sel: null, scale: 1, rot: 0, flip: false, busy: false, lastSc: 1 };

const stampBar = document.createElement('div');
stampBar.className = 'stamp-group'; stampBar.hidden = true;
stampBar.innerHTML = `<b>Stamp</b>
  <label>Size <input id="stampScale" type="range" min="25" max="300" step="1" value="100"><output id="stampScaleValue">100%</output></label>
  <label>Rotate <input id="stampRot" type="range" min="-180" max="180" step="1" value="0"><output id="stampRotValue">0°</output></label>
  <button id="stampFlip" class="button ghost small" type="button">Flip</button>
  <button id="stampNew" class="button ghost small" type="button">Copy something else</button>
  <span id="stampHint" class="stamp-hint">Drag a box on the model to copy it.</span>`;
const optionsBar = document.createElement('div');
optionsBar.className = 'tool-options'; optionsBar.hidden = true;
optionsBar.innerHTML = `<label id="vwBrushSizeRow">Brush size <input id="vwBrushSize" type="range" aria-label="Brush size"><output id="vwBrushSizeValue"></output></label>
  <label>Opacity <input id="vwBrushOpacity" type="range" aria-label="Opacity"><output id="vwBrushOpacityValue"></output></label>
  <label id="vwSoftRow">Softness <input id="vwSoft" type="range" min="2" max="100" step="1" value="28" aria-label="Edge softness"><output id="vwSoftValue">28%</output></label>
  <label id="vwFlatRow" title="The relief (raised lettering, panel edges) lives in a separate picture, the normal map. With this ticked, painting smooths it out, Stamp smooths what it covers, and Clone copies the source's relief."><span id="vwFlatText">Flatten the bumps too</span> <input id="vwFlat" type="checkbox" checked></label>
  <button id="vwDone" class="button ghost small" type="button" title="Stop painting and go back to rotating the model (Esc)" style="margin-left:auto">Done · Esc</button>
  <span id="vwColorRow" class="vw-colours" title="Paint colour. Colours you use or pick are kept here; click one to use it again."><label>Colour <input id="vwColor" type="color" value="#000000" aria-label="Paint colour"></label><span id="vwSwatches" class="vw-swatches"></span></span>
  <label id="vwSprayRow" title="Faint dabs that build up as you go over the same spot or hold still, like a spray can">Spray can <input id="vwSpray" type="checkbox"></label>`;
optionsBar.appendChild(stampBar);
if (toolbar) toolbar.insertAdjacentElement('afterend', optionsBar); else viewer?.prepend(optionsBar);
optionsBar.querySelector('#vwSoft').addEventListener('input', e => { brush.edge = Math.max(0.02, Number(e.target.value) / 100); optionsBar.querySelector('#vwSoftValue').textContent = `${e.target.value}%`; });
optionsBar.querySelector('#vwDone').addEventListener('click', () => setMode('navigate'));
optionsBar.querySelector('#vwFlat').addEventListener('change', e => { flat.on = e.target.checked; });
optionsBar.querySelector('#vwSpray').addEventListener('change', e => { brush.spray = e.target.checked; stopSpray(); });
function stopSpray() { if (brush.timer) { clearInterval(brush.timer); brush.timer = null; } }
// the two sliders mirror the ones in the left panel, both ways
for (const [mine, theirs, unit] of [['vwBrushSize', brushSize, ' px'], ['vwBrushOpacity', brushOpacity, '%']]) {
  const a = optionsBar.querySelector('#' + mine), out = optionsBar.querySelector('#' + mine + 'Value');
  if (!a || !theirs) continue;
  a.min = theirs.min; a.max = theirs.max; a.step = theirs.step || 1;
  const pull = () => { if (a.value !== theirs.value) a.value = theirs.value; out.textContent = theirs.value + unit; };
  pull();
  theirs.addEventListener('input', pull);
  a.addEventListener('input', () => { theirs.value = a.value; theirs.dispatchEvent(new Event('input', { bubbles: true })); out.textContent = a.value + unit; });
}
/* Colours: the picker here mirrors the one in the left panel; every colour you paint with or pick is kept as a swatch (this browser only). */
const vwColor = optionsBar.querySelector('#vwColor'), vwSwatches = optionsBar.querySelector('#vwSwatches');
const MAX_SW = 12; let recent = [];
try { const j = JSON.parse(localStorage.getItem('shrink-paint-colours') || '[]'); if (Array.isArray(j)) recent = j.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_SW); } catch {}
function renderSwatches() {
  const cur = (paintColor?.value || '').toLowerCase();
  vwSwatches.replaceChildren(...recent.map(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vw-sw' + (c === cur ? ' on' : ''); b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Use colour ' + c); b.dataset.c = c; return b; }));
}
function rememberColour(hex) {
  hex = String(hex || '').toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(hex)) return;
  if (recent[0] !== hex) { recent = [hex, ...recent.filter(c => c !== hex)].slice(0, MAX_SW); try { localStorage.setItem('shrink-paint-colours', JSON.stringify(recent)); } catch {} }
  renderSwatches();
}
function setPaintColour(hex) { if (paintColor) { paintColor.value = hex; paintColor.dispatchEvent(new Event('input', { bubbles: true })); } vwColor.value = hex; renderSwatches(); }
vwColor.addEventListener('input', () => { if (paintColor) { paintColor.value = vwColor.value; paintColor.dispatchEvent(new Event('input', { bubbles: true })); } renderSwatches(); });
vwColor.addEventListener('change', () => rememberColour(vwColor.value));
paintColor?.addEventListener('change', () => { vwColor.value = paintColor.value; rememberColour(paintColor.value); });
vwSwatches.addEventListener('click', e => { const b = e.target.closest('.vw-sw'); if (b) { setPaintColour(b.dataset.c); rememberColour(b.dataset.c); } });
if (paintColor) vwColor.value = paintColor.value;
renderSwatches();
const stampRect = document.createElement('div'); stampRect.className = 'stamp-rect'; stampRect.hidden = true; viewer?.appendChild(stampRect);
const stampGhost = document.createElement('canvas'); stampGhost.className = 'stamp-ghost'; stampGhost.hidden = true; viewer?.appendChild(stampGhost);
const stampStyle = document.createElement('style');
stampStyle.textContent = `.tool-options{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:6px 14px 10px;font-size:12px;color:#fff;border-bottom:1px solid rgba(255,255,255,.08)}
.tool-options[hidden],.stamp-group[hidden],.tool-options label[hidden]{display:none}
.tool-options label{display:flex;gap:8px;align-items:center;font-weight:700}.tool-options input[type=range]{width:150px}.tool-options output{min-width:44px;font-weight:500;opacity:.85}
.vw-colours{display:flex;gap:8px;align-items:center;font-weight:700}.vw-colours[hidden]{display:none}.vw-colours input[type=color]{width:34px;height:24px;padding:0;border:1px solid rgba(255,255,255,.35);border-radius:5px;background:none}
.vw-swatches{display:flex;gap:4px;flex-wrap:wrap}.vw-sw{width:20px;height:20px;padding:0;border-radius:5px;border:1px solid rgba(255,255,255,.4);cursor:pointer}.vw-sw.on{outline:2px solid #fff;outline-offset:1px}
.stamp-group{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.stamp-hint{flex-basis:100%;opacity:.75;font-size:12px}
.stamp-rect{position:absolute;z-index:28;border:2px dashed #ff4e55;background:rgba(255,78,85,.12);pointer-events:none}
.stamp-ghost{position:absolute;z-index:27;pointer-events:none;opacity:.6;outline:2px dashed #fff;transform-origin:50% 50%;image-rendering:auto}`;
document.head.appendChild(stampStyle);
const $s = id => stampBar.querySelector('#' + id);

function stampModeChanged(on) {
  stampBar.hidden = !on;
  stampBar.dataset.on = on ? '1' : '';
  if (!on) { stampRect.hidden = true; stampGhost.hidden = true; stamp.sel = null; }
  else updateStampUI();
}
function updateStampUI() {
  $s('stampScaleValue').textContent = `${Math.round(stamp.scale * 100)}%`;
  $s('stampRotValue').textContent = `${Math.round(stamp.rot)}°`;
  $s('stampHint').textContent = stamp.patch
    ? 'Aim at where it should go and click. Hold Cmd/Ctrl and drag to turn the car first. Option/Alt-drag copies something new.'
    : 'Drag a box on the model to copy it (for example a number on a sign).';
  if (stamp.patch && !stampGhost.hidden) layoutGhost(stamp.lastPos); else if (!stamp.patch) stampGhost.hidden = true;     // the ghost only shows while aiming (after a copy, or once the pointer moves)
}
$s('stampScale').addEventListener('input', () => { stamp.scale = Number($s('stampScale').value) / 100; updateStampUI(); });
$s('stampRot').addEventListener('input', () => { stamp.rot = Number($s('stampRot').value); updateStampUI(); });
$s('stampFlip').addEventListener('click', () => { stamp.flip = !stamp.flip; $s('stampFlip').classList.toggle('active', stamp.flip); updateStampUI(); });
$s('stampNew').addEventListener('click', () => { stamp.patch = null; stampGhost.hidden = true; updateStampUI(); say('Drag a box around what you want to copy.'); });

// The ghost only ever shows while Stamp is on. Slow copies/pastes finish after the person has already left Stamp (Esc, another tool), so every unhide goes through here.
function showGhost(pos) {
  if (state.mode !== 'stamp' || !stamp.patch) { stampGhost.hidden = true; return; }
  layoutGhost(pos); stampGhost.hidden = false;
}
function layoutGhost(pos) {
  if (!stamp.patch || !pos || !viewer) return;
  const { pw, ph, s } = stamp.patch, sc = stamp.lastSc * stamp.scale, w = pw * s * sc, h = ph * s * sc;
  const r = viewer.getBoundingClientRect();
  stampGhost.style.width = `${w}px`; stampGhost.style.height = `${h}px`;
  stampGhost.style.left = `${pos.x - r.left - w / 2}px`; stampGhost.style.top = `${pos.y - r.top - h / 2}px`;
  stampGhost.style.transform = `rotate(${stamp.rot}deg)${stamp.flip ? ' scaleX(-1)' : ''}`;
}

function stampPointerDown(evt, v) {
  if (stamp.busy) return;
  if (evt.altKey || !stamp.patch) {
    stamp.sel = { x0: evt.clientX, y0: evt.clientY, x1: evt.clientX, y1: evt.clientY };
    try { v.renderer.domElement.setPointerCapture(evt.pointerId); } catch {}
    return;
  }
  pasteStamp(evt.clientX, evt.clientY, evt.shiftKey);
}

function stampMove(evt) {
  if (stamp.sel) {
    stamp.sel.x1 = evt.clientX; stamp.sel.y1 = evt.clientY;
    const r = viewer.getBoundingClientRect(), s = stamp.sel;
    stampRect.hidden = false;
    stampRect.style.left = `${Math.min(s.x0, s.x1) - r.left}px`; stampRect.style.top = `${Math.min(s.y0, s.y1) - r.top}px`;
    stampRect.style.width = `${Math.abs(s.x1 - s.x0)}px`; stampRect.style.height = `${Math.abs(s.y1 - s.y0)}px`;
    evt.preventDefault(); evt.stopImmediatePropagation();
    return;
  }
  if (!stamp.patch || modifierOrbit(evt) || evt.target !== getViewerState()?.renderer?.domElement) return;
  stamp.lastPos = { x: evt.clientX, y: evt.clientY };
  const hit = rayAt(evt.clientX, evt.clientY);
  if (hit) stamp.lastSc = stamp.patch.wpp0 / worldPerPixel(hit.distance);     // same real-world size as the original
  showGhost(stamp.lastPos);
}

function stampUp(evt) {
  state.pointerHeld = false;
  const sel = stamp.sel; if (!sel) return;
  stamp.sel = null; stampRect.hidden = true;
  try { getViewerState()?.renderer?.domElement?.releasePointerCapture(evt.pointerId); } catch {}
  const x0 = Math.min(sel.x0, sel.x1), y0 = Math.min(sel.y0, sel.y1), w = Math.abs(sel.x1 - sel.x0), h = Math.abs(sel.y1 - sel.y0);
  if (w < 8 || h < 8) { say('That box is too small. Drag a larger one around what you want to copy.', true); return; }
  captureStamp(x0, y0, w, h);
}

async function captureStamp(x0, y0, w, h) {
  stamp.busy = true;
  try {
    const v = getViewerState();
    await ensureBVH(v.scene, say);
    let hit = rayAt(x0 + w / 2, y0 + h / 2);
    for (let i = 0; !hit && i < 12; i++) hit = rayAt(x0 + ((i % 4) + 0.5) / 4 * w, y0 + (Math.floor(i / 4) + 0.5) / 3 * h);
    if (!hit) { say('There is no model inside that box.', true); return; }
    const material = materialForHit(hit);
    if (!material?.map) { say('That part of the model does not use an image colour texture.', true); return; }
    if (!await ensureTextureForMaterial(material)) return;
    const tmp = document.createElement('canvas'); tmp.width = textureCanvas.width; tmp.height = textureCanvas.height; tmp.getContext('2d').drawImage(textureCanvas, 0, 0);   // a copy, so reading it does not count as a paint stroke for Undo
    const snap = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height), TW = snap.width;
    const s = patchStep(w, h), pw = Math.max(1, Math.round(w / s)), ph = Math.max(1, Math.round(h / s));
    const data = new Uint8ClampedArray(pw * ph * 4);
    let got = 0;
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      const hh = rayAt(x0 + (i + 0.5) * s, y0 + (j + 0.5) * s);
      if (!hh) continue;
      const m = materialForHit(hh);
      if (!m?.map || textureIndexOfMaterial(m) !== state.activeTextureIndex) continue;
      const tp = texturePoint(hh, m); if (!tp) continue;
      const si = (Math.round(tp.y) * TW + Math.round(tp.x)) * 4, o = (j * pw + i) * 4;
      data[o] = snap.data[si]; data[o + 1] = snap.data[si + 1]; data[o + 2] = snap.data[si + 2]; data[o + 3] = 255; got++;
    }
    if (got < 20) { say('Not enough of the model on this texture inside that box.', true); return; }
    stamp.patch = { pw, ph, s, data, texIndex: state.activeTextureIndex, wpp0: worldPerPixel(hit.distance) };
    stampGhost.width = pw; stampGhost.height = ph;
    stampGhost.getContext('2d').putImageData(new ImageData(data, pw, ph), 0, 0);
    stamp.lastSc = 1; stamp.lastPos = { x: x0 + w / 2, y: y0 + h / 2 };
    updateStampUI(); showGhost(stamp.lastPos);
    say(state.mode === 'stamp' ? 'Copied. Turn the car to where it should go, aim, and click to paste. Use Size, Rotate and Flip first if needed. Undo works as usual.' : 'Copied, but Stamp was switched off meanwhile. Press Stamp to paste it.');
  } catch (err) { console.error(err); say(`Could not copy: ${err.message}`, true); }
  finally { stamp.busy = false; }
}

async function pasteStamp(cx, cy, keepOn = false) {
  if (stamp.busy || !stamp.patch) return;
  stamp.busy = true;
  try {
    const v = getViewerState(), P = stamp.patch;
    await ensureBVH(v.scene, say);
    const centre = rayAt(cx, cy);
    if (!centre) { say('Aim at the model to paste.', true); return; }
    const material = materialForHit(centre);
    if (!material?.map) { say('That part of the model does not use an image colour texture.', true); return; }
    if (!await ensureTextureForMaterial(material)) return;
    if (state.activeTextureIndex !== P.texIndex) { say('That surface uses a different texture from the copied one, so it cannot be pasted there.', true); return; }
    saveUndo();
    state.mirror = state.undoImage ? new ImageData(new Uint8ClampedArray(state.undoImage.data), state.undoImage.width, state.undoImage.height) : null;
    if (!state.mirror) { say('Could not read the texture for pasting.', true); return; }
    attachLiveCanvas(material);
    flat.serial = window.__shrinkUndoSerial ?? null;
    beginNormalStroke(material);

    const sc = (P.wpp0 / worldPerPixel(centre.distance)) * stamp.scale, opts = { scale: sc, rotDeg: stamp.rot, flip: stamp.flip, pw: P.pw, ph: P.ph, s: P.s };
    const R = pasteRadius(P.pw, P.ph, P.s, sc);
    let step = 1.5; while ((2 * R / step) ** 2 > 120000) step *= 1.25;
    const opacity = Number(brushOpacity?.value || 100) / 100, data = state.mirror.data, W = state.mirror.width, H = state.mirror.height, rgb = [0, 0, 0];
    let n = 0;
    for (let dy = -R; dy <= R; dy += step) {
      for (let dx = -R; dx <= R; dx += step) {
        const { u, v: pv } = patchCoords(dx, dy, opts);
        if (u < 0 || pv < 0 || u > P.pw || pv > P.ph) continue;
        const a = samplePatch(P, u, pv, rgb); if (a <= 0.02) continue;
        const dest = rayAt(cx + dx, cy + dy);
        if (!dest || materialForHit(dest) !== state.activeMaterial) continue;
        const dp = texturePoint(dest, state.activeMaterial); if (!dp) continue;
        const tpw = texelsPerWorld(dest) || Math.sqrt(W * H);
        const rs = Math.max(1.5, step * worldPerPixel(dest.distance) * tpw * 1.1);
        const w = opacity * a * edgeFalloff(u, pv, P.pw, P.ph);
        if (w <= 0) continue;
        const cxp = Math.round(dp.x), cyp = Math.round(dp.y), rr = Math.ceil(rs);
        for (let ty = Math.max(0, cyp - rr); ty <= Math.min(H - 1, cyp + rr); ty++) {
          for (let tx = Math.max(0, cxp - rr); tx <= Math.min(W - 1, cxp + rr); tx++) {
            const q = Math.hypot(tx - cxp, ty - cyp) / rs; if (q > 1) continue;
            const ww = w * (1 - q * q), o = (ty * W + tx) * 4;
            data[o] = data[o] * (1 - ww) + rgb[0] * ww; data[o + 1] = data[o + 1] * (1 - ww) + rgb[1] * ww; data[o + 2] = data[o + 2] * (1 - ww) + rgb[2] * ww;
            touch(tx, ty);
            if (flat.cur) normalBlend(tx, ty, ww, FLAT_RGB);
          }
        }
        n++;
      }
    }
    flushDirty();
    finishNormalStroke();
    state.mirror = null;
    if (n && !keepOn) {
      stampGhost.hidden = true;
      setMode('navigate');      // the stamp is finished: ghost gone, car can be rotated. The copied patch is kept for the next time Stamp is switched on.
      say('Pasted. Press Stamp to paste it again (hold Shift while clicking to keep Stamp on), or Undo.');
    } else say(n ? 'Pasted. Shift is held, so Stamp stays on: click to paste another copy, or Undo.' : 'Nothing was pasted: the target did not land on the model.', !n);
  } catch (err) { console.error(err); finishNormalStroke(); state.mirror = null; say(`Could not paste: ${err.message}`, true); }
  finally { stamp.busy = false; }
}

viewer?.addEventListener('pointerdown', handlePointerDown, true);
viewer?.addEventListener('pointermove', handlePointerMove, true);
viewer?.addEventListener('pointerup', stopPaint, true);
viewer?.addEventListener('pointercancel', stopPaint, true);
viewer?.addEventListener('pointerleave', evt => { if ((evt.buttons & 1) === 0) stopPaint(evt); if (state.mode === 'stamp') stampGhost.hidden = true; }, true);
window.addEventListener('pointerup', evt => { if (state.painting || state.pointerHeld || stamp.sel) stopPaint(evt); }, true);
window.addEventListener('pointercancel', evt => { if (state.painting || state.pointerHeld || stamp.sel) stopPaint(evt); }, true);
window.addEventListener('pointermove', evt => { if (state.painting && (evt.buttons & 1) === 0) stopPaint(evt); }, true);
window.addEventListener('blur', () => { if (state.painting || state.pointerHeld) abortStroke(); });
viewer?.addEventListener('lostpointercapture', evt => { if (state.painting && (evt.buttons & 1) === 0) stopPaint(evt); }, true);

undo3DBtn.addEventListener('click', () => {
  if (!state.undoImage || !paintCtx) return;
  paintCtx.putImageData(state.undoImage, 0, 0);
  if (state.liveTexture) state.liveTexture.needsUpdate = true;
  state.undoImage = null;
  undo3DBtn.disabled = true;
  say('Last 3D paint stroke undone.');
});

textureSelect?.addEventListener('change', () => {
  // Runs before the editor loads the newly selected texture, so the canvas still holds the previous one.
  const next = Number(textureSelect.value);
  if (state.activeTextureIndex !== null && state.activeTextureIndex !== next) stashLayer(state.activeTextureIndex);
  state.activeTextureIndex = next;
  state.activeMaterial = null;
  state.liveTexture = null;
  state.cloneSource = null;
  state.cloneOffset = null;
  state.cloneSnapshot = null;
  sourceMarker.style.display = 'none';
});

// The flat editor's Apply reads the active canvas itself; other painted textures are handed over through this hook.
applyBtn?.addEventListener('click', () => {
  state.painting = false;
  state.lastScreen = null;
});

function collectDirtyLayers() {
  const out = [];
  for (const [index, layer] of state.layers) {
    if (index === Number(textureSelect?.value)) continue;     // the editor itself commits the selected texture
    if (layer.dirty && layer.canvas) out.push({ index, canvas: layer.canvas });
  }
  for (const L of flat.layers.values()) if (L.dirty && L.idx !== Number(textureSelect?.value)) out.push({ index: L.idx, canvas: L.canvas });
  return out;
}

function resetAfterModelChange() {
  state.painting = false;
  state.lastScreen = null;
  state.activeMaterial = null;
  state.liveTexture = null;
  state.activeTextureIndex = Number(textureSelect?.value ?? -1);
  state.cloneSource = null; state.cloneOffset = null; state.cloneSnapshot = null;
  stamp.patch = null; stampGhost.hidden = true;
  flat.layers.clear(); flat.undo.clear(); flat.cur = null;
  state.layers.clear();
  state.paintMaps.clear();
  sourceMarker.style.display = 'none';
}
window.addEventListener('shrink:texture-applied', () => { resetAfterModelChange(); setMode('paint'); });
window.addEventListener('shrink:model-opened', () => { resetAfterModelChange(); state.activeTextureIndex = null; if (state.mode !== 'navigate') setMode('navigate'); });

window.__shrinkPaint = { stamp: () => ({ hasPatch: !!stamp.patch, scale: stamp.scale, rot: stamp.rot, flip: stamp.flip }), setMode, getMode: () => state.mode, collectDirtyLayers, hasEdits: () => [...state.layers.values()].some(l => l.dirty) || [...flat.layers.values()].some(l => l.dirty), flat: () => ({ on: flat.on, layers: [...flat.layers.values()].map(l => ({ idx: l.idx, w: l.w, h: l.h, dirty: l.dirty })) }) };

setMode('navigate');
