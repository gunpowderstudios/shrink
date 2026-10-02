import './paint-mode-v08.js?v=2.12';
import './gltf-texture-index.js';
import * as THREE from 'https://esm.sh/three@0.180.0';
import { ensureBVH, raycasterFor } from './bvh-support.js?v=2.12';

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

function setMode(mode) {
  state.mode = mode;
  state.painting = false;
  state.lastScreen = null;
  state.cloneOffset = null;
  state.cloneSnapshot = null;
  paintModelBtn.classList.toggle('active', mode === 'paint');
  cloneModelBtn.classList.toggle('active', mode === 'clone');
  sampleModelBtn.classList.toggle('active', mode === 'sample');
  navigateModelBtn.classList.toggle('active', mode === 'navigate');
  viewer?.classList.toggle('direct-paint', mode === 'paint' || mode === 'clone');
  viewer?.classList.toggle('direct-sample', mode === 'sample');
  if (mode !== 'clone') sourceMarker.style.display = 'none';

  if (mode !== 'navigate' && originalBtn && !originalBtn.classList.contains('active')) originalBtn.click();
  window.dispatchEvent(new CustomEvent('shrink:paint-mode', { detail: { mode } }));

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
  const viewWidth = viewer?.clientWidth || 700;
  const textureWidth = textureCanvas?.width || 2048;
  const size = Number(brushSize?.value || 32);
  return Math.max(8, Math.min(140, size * viewWidth / textureWidth)) / 2;
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
/* Brush stamps (all pixel work happens on a CPU mirror, then only the dirty rectangle is pushed to the canvas) */
/* ------------------------------------------------------------------ */
function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function feather(d, r) { return Math.min(1, Math.max(0, (1 - d / r) / 0.28)); }

const dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
function touch(x, y) { if (x < dirty.x0) dirty.x0 = x; if (y < dirty.y0) dirty.y0 = y; if (x > dirty.x1) dirty.x1 = x; if (y > dirty.y1) dirty.y1 = y; }

function flushDirty() {
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
  const r2 = r * r, opacity = Number(brushOpacity?.value || 100) / 100;
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
  state.mirror = state.undoImage ? new ImageData(new Uint8ClampedArray(state.undoImage.data), state.undoImage.width, state.undoImage.height) : null;
  if (!state.mirror) { say('Could not read the texture for painting.', true); return; }
  attachLiveCanvas(material);
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
    say(`LIVE PAINT · Texture ${state.activeTextureIndex + 1} · ${paintColor?.value || '#000000'} · 3D brush.`);
  }
  try { v.renderer.domElement.setPointerCapture(pointerId); } catch {}
}

function handlePointerMove(evt) {
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
  state.mirror = null;
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
  return out;
}

function resetAfterModelChange() {
  state.painting = false;
  state.lastScreen = null;
  state.activeMaterial = null;
  state.liveTexture = null;
  state.activeTextureIndex = Number(textureSelect?.value ?? -1);
  state.cloneSource = null; state.cloneOffset = null; state.cloneSnapshot = null;
  state.layers.clear();
  state.paintMaps.clear();
  sourceMarker.style.display = 'none';
}
window.addEventListener('shrink:texture-applied', () => { resetAfterModelChange(); setMode('paint'); });
window.addEventListener('shrink:model-opened', () => { resetAfterModelChange(); state.activeTextureIndex = null; if (state.mode !== 'navigate') setMode('navigate'); });

window.__shrinkPaint = { setMode, getMode: () => state.mode, collectDirtyLayers, hasEdits: () => [...state.layers.values()].some(l => l.dirty) };

setMode('navigate');
