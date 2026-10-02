import * as THREE from 'https://esm.sh/three@0.180.0';
import { ensureBVH, raycasterFor, getMeshBVH } from './bvh-support.js?v=2.07';
import {
  stlBytes, objBytesEstimate, glbBytesEstimate, computeDetailLoss, heatColorArray, heatColor,
  buildBinaryStl, buildObjBlob, modelHeight
} from './mesh-tools.js?v=2.07';

/* Print & Share: reduce a sculpt while SEEING what you lose, then save STL / OBJ / GLB to send to a printer. */

const $ = id => document.getElementById(id);
const els = {
  panel: $('printPanel'), height: $('figureHeightMm'), detail: $('printerDetailMm'), target: $('targetTris'),
  estimate: $('estimateLine'), actual: $('actualLine'), geometry: $('geometry'), geometryValue: $('geometryValue'),
  protectBtn: $('protectBtn'), protectClear: $('protectClearBtn'), protectRadius: $('protectRadius'), protectRadiusValue: $('protectRadiusValue'),
  protectKeep: $('protectKeep'), protectKeepValue: $('protectKeepValue'), protectInfo: $('protectInfo'),
  compareBtn: $('compareBtn'), heatBtn: $('heatBtn'), heatLegend: $('heatLegend'),
  saveStl: $('saveStlBtn'), saveObj: $('saveObjBtn'), zUp: $('zUpToggle'), exportNote: $('exportNote'),
  meshopt: $('meshoptToggle'), viewer: $('viewer'), showOptimizedBtn: $('showOptimizedBtn'), showOriginalBtn: $('showOriginalBtn')
};
if (!els.panel || !els.viewer) throw new Error('Print & Share markup is missing.');

const app = () => window.__shrinkApp;
const say = (m, err = false) => app()?.setStatus?.(m, err);
const fmt = n => new Intl.NumberFormat().format(Math.round(n));
const fmtBytes = b => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const mmText = v => (v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4)) ;

const P = {
  modelHeightUnits: 0,
  originalTriangles: 0,
  optimizedTriangles: 0,
  dabs: [],                 // flat [x,y,z,r,...] in world units
  lastDab: null,
  protectActive: false,
  protectMeshes: null,      // per-mesh spatial data for the protect brush
  heat: { on: false, distances: null, stats: null, forBytes: null, busy: false },
  raycaster: raycasterFor()
};

/* ------------------------------------------------------------------ */
/* Units + estimates                                                    */
/* ------------------------------------------------------------------ */
const uiMode = () => window.__shrinkUI?.getMode?.() || 'print';
const GAME_DETAIL_PCT = 0.2;                      // "looks the same" threshold in game mode: 0.2% of the model's height
function mmPerUnit() {
  if (uiMode() === 'game') return P.modelHeightUnits > 0 ? 100 / P.modelHeightUnits : 1;   // 1 "mm" == 1% of height
  const mm = Number(els.height.value);
  return P.modelHeightUnits > 0 && mm > 0 ? mm / P.modelHeightUnits : 1;
}
function printMmPerUnit() { const mm = Number(els.height.value); return P.modelHeightUnits > 0 && mm > 0 ? mm / P.modelHeightUnits : 1; }
function detailMM() { return uiMode() === 'game' ? GAME_DETAIL_PCT : Math.max(0.001, Number(els.detail.value) || 0.05); }
const unitLabel = () => uiMode() === 'game' ? '%' : ' mm';

function currentModelForExport() { return app()?.optimizedModel || app()?.originalModel; }

function updateEstimates() { /* live size readouts are handled by live-ui.js */ }

function syncTargetFromSlider() {
  if (!P.originalTriangles) return;
  els.target.value = Math.max(1, Math.round(P.originalTriangles * Number(els.geometry.value) / 100));
  updateEstimates();
}

els.geometry.addEventListener('input', syncTargetFromSlider);
els.geometry.addEventListener('change', syncTargetFromSlider);
els.target.addEventListener('input', () => {
  if (!P.originalTriangles) return;
  const wanted = Math.max(1, Number(els.target.value) || 1);
  const ratio = Math.max(0.01, Math.min(1, wanted / P.originalTriangles));
  els.geometry.value = (ratio * 100).toFixed(1);
  els.geometry.dispatchEvent(new Event('input', { bubbles: true }));
  els.target.value = wanted;
  updateEstimates();
});
[els.height, els.detail, els.meshopt].forEach(el => el?.addEventListener('input', () => { updateEstimates(); if (P.heat.on) applyHeat(); }));
els.meshopt?.addEventListener('change', updateEstimates);

/* ------------------------------------------------------------------ */
/* Overlay (vertex colours) management on the original model            */
/* ------------------------------------------------------------------ */
function setMatVC(material, value) {
  const list = Array.isArray(material) ? material : [material];
  const values = Array.isArray(value) ? value : list.map(() => value);
  list.forEach((m, i) => { if (m && m.vertexColors !== values[i]) { m.vertexColors = values[i]; m.needsUpdate = true; } });
}
function snapshot(mesh) {
  if (mesh.userData._ov) return;
  mesh.userData._ov = {
    material: mesh.material,
    color: mesh.geometry.getAttribute('color') || null,
    vc: Array.isArray(mesh.material) ? mesh.material.map(m => m.vertexColors) : mesh.material.vertexColors
  };
}
function restore(mesh) {
  const ov = mesh.userData._ov;
  if (!ov) return;
  if (mesh.material !== ov.material) { (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m?.dispose?.()); mesh.material = ov.material; }
  setMatVC(ov.material, ov.vc);
  if (ov.color) mesh.geometry.setAttribute('color', ov.color); else mesh.geometry.deleteAttribute('color');
  delete mesh.userData._ov;
}
function eachOriginalMesh(fn) {
  const root = app()?.originalModel;
  if (!root) return;
  root.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) fn(o); });
}
function clearOverlay() { eachOriginalMesh(restore); }

function refreshOverlay() {
  clearOverlay();
  if (P.heat.on && P.heat.distances) return applyHeat(true);
  if (P.dabs.length && P.protectMeshes) {
    for (const pm of P.protectMeshes) {
      snapshot(pm.mesh);
      pm.mesh.geometry.setAttribute('color', pm.attr);
      setMatVC(pm.mesh.material, true);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Protect brush                                                        */
/* ------------------------------------------------------------------ */
function buildProtectMeshes() {
  const list = [];
  const root = app().originalModel;
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const pos = mesh.geometry.attributes.position, n = pos.count;
    const world = new Float32Array(n * 3);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z;
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const cell = extent / 48;
    const nx = Math.floor((maxX - minX) / cell) + 1, ny = Math.floor((maxY - minY) / cell) + 1, nz = Math.floor((maxZ - minZ) / cell) + 1;
    const cellOf = i => (Math.floor((world[i * 3 + 2] - minZ) / cell) * ny + Math.floor((world[i * 3 + 1] - minY) / cell)) * nx + Math.floor((world[i * 3] - minX) / cell);
    const start = new Int32Array(nx * ny * nz + 1);
    for (let i = 0; i < n; i++) start[cellOf(i) + 1]++;
    for (let c = 0; c < start.length - 1; c++) start[c + 1] += start[c];
    const fill = start.slice(0, -1), items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fill[cellOf(i)]++] = i;
    const base = new Float32Array(n * 3).fill(1);
    const old = mesh.geometry.getAttribute('color');
    if (old) for (let i = 0; i < n; i++) { base[i * 3] = old.getX(i); base[i * 3 + 1] = old.getY(i); base[i * 3 + 2] = old.getZ(i); }
    const colors = base.slice();
    list.push({ mesh, world, min: [minX, minY, minZ], cell, dims: [nx, ny, nz], start, items, base, colors, mask: new Uint8Array(n), attr: new THREE.BufferAttribute(colors, 3) });
  });
  return list;
}

function markProtected(cx, cy, cz, r) {
  const r2 = r * r;
  for (const pm of P.protectMeshes) {
    const [nx, ny, nz] = pm.dims, [mx, my, mz] = pm.min, cell = pm.cell;
    const x0 = Math.max(0, Math.floor((cx - r - mx) / cell)), x1 = Math.min(nx - 1, Math.floor((cx + r - mx) / cell));
    const y0 = Math.max(0, Math.floor((cy - r - my) / cell)), y1 = Math.min(ny - 1, Math.floor((cy + r - my) / cell));
    const z0 = Math.max(0, Math.floor((cz - r - mz) / cell)), z1 = Math.min(nz - 1, Math.floor((cz + r - mz) / cell));
    let changed = false;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = (z * ny + y) * nx + x;
      for (let k = pm.start[c]; k < pm.start[c + 1]; k++) {
        const i = pm.items[k];
        if (pm.mask[i]) continue;
        const dx = pm.world[i * 3] - cx, dy = pm.world[i * 3 + 1] - cy, dz = pm.world[i * 3 + 2] - cz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        pm.mask[i] = 1;
        pm.colors[i * 3] = pm.base[i * 3] * 1.0; pm.colors[i * 3 + 1] = pm.base[i * 3 + 1] * 0.3; pm.colors[i * 3 + 2] = pm.base[i * 3 + 2] * 0.3;
        changed = true;
      }
    }
    if (changed) pm.attr.needsUpdate = true;
  }
}

function protectRadiusUnits() { return Number(els.protectRadius.value) / printMmPerUnit(); }

function updateProtectInfo() {
  els.protectInfo.textContent = P.dabs.length
    ? 'Protected area painted in red. Reduction will keep its triangles and take them from the rest of the model.'
    : 'Paint over faces, hands and fine ornament you want to keep sharp. Everything else is reduced first.';
  els.protectClear.disabled = !P.dabs.length;
}

const ring = document.createElement('div');
ring.className = 'protect-ring';
els.viewer.appendChild(ring);

async function setProtectActive(on) {
  if (on && !app()?.originalModel) return;
  P.protectActive = on;
  els.protectBtn.classList.toggle('active', on);
  els.viewer.classList.toggle('direct-protect', on);
  if (!on) { ring.style.display = 'none'; return; }
  window.__shrinkPaint?.setMode?.('navigate');
  if (P.heat.on) await setHeat(false);
  app().show('original');
  say('Protect brush: paint the areas whose detail must survive. Hold Cmd / Ctrl to rotate.');
  await ensureBVH(app().originalModel, say);
  if (!P.protectMeshes) { say('Preparing protect brush…'); await new Promise(r => setTimeout(r, 20)); P.protectMeshes = buildProtectMeshes(); refreshOverlay(); }
  say('Protect brush: paint the areas whose detail must survive. Hold Cmd / Ctrl to rotate.');
}
els.protectBtn.addEventListener('click', () => setProtectActive(!P.protectActive));
els.protectRadius.addEventListener('input', () => { els.protectRadiusValue.textContent = `${Number(els.protectRadius.value).toFixed(1)} mm`; });
els.protectKeep.addEventListener('input', () => { els.protectKeepValue.textContent = `${els.protectKeep.value}%`; });
els.protectClear.addEventListener('click', () => {
  P.dabs = []; P.lastDab = null;
  if (P.protectMeshes) for (const pm of P.protectMeshes) { pm.mask.fill(0); pm.colors.set(pm.base); pm.attr.needsUpdate = true; }
  refreshOverlay(); updateProtectInfo();
  window.dispatchEvent(new Event('shrink:protect-changed'));
});
window.addEventListener('shrink:paint-mode', e => { if (e.detail.mode !== 'navigate' && P.protectActive) setProtectActive(false); });

function protectRay(evt) {
  const v = window.__shrinkViewer, root = app()?.originalModel;
  if (!v || !root) return null;
  const rect = v.renderer.domElement.getBoundingClientRect();
  P.raycaster.setFromCamera(new THREE.Vector2(((evt.clientX - rect.left) / rect.width) * 2 - 1, -((evt.clientY - rect.top) / rect.height) * 2 + 1), v.camera);
  return P.raycaster.intersectObject(root, true)[0] || null;
}

let protecting = false;
function protectAt(evt) {
  const hit = protectRay(evt);
  if (!hit || !P.protectMeshes) return;
  const r = protectRadiusUnits();
  const last = P.lastDab;
  if (last && Math.hypot(hit.point.x - last[0], hit.point.y - last[1], hit.point.z - last[2]) < r * 0.35) return;
  P.dabs.push(hit.point.x, hit.point.y, hit.point.z, r);
  P.lastDab = [hit.point.x, hit.point.y, hit.point.z];
  markProtected(hit.point.x, hit.point.y, hit.point.z, r);
  refreshOverlayLight();
}
function refreshOverlayLight() {
  // first dab of a session: attach the colour attribute; afterwards attr.needsUpdate is enough
  const pm = P.protectMeshes?.[0];
  if (pm && pm.mesh.geometry.getAttribute('color') !== pm.attr) refreshOverlay();
  updateProtectInfo();
}

els.viewer.addEventListener('pointerdown', evt => {
  if (!P.protectActive || evt.button !== 0 || evt.metaKey || evt.ctrlKey) return;
  const v = window.__shrinkViewer;
  if (!v || evt.target !== v.renderer.domElement) return;
  evt.preventDefault(); evt.stopImmediatePropagation();
  protecting = true;
  try { v.renderer.domElement.setPointerCapture(evt.pointerId); } catch {}
  protectAt(evt);
}, true);
els.viewer.addEventListener('pointermove', evt => {
  if (!P.protectActive) return;
  const v = window.__shrinkViewer;
  const rotating = evt.metaKey || evt.ctrlKey;
  if (rotating) { ring.style.display = 'none'; return; }
  const hit = v ? protectRay(evt) : null;
  if (hit) {
    const rect = v.renderer.domElement.getBoundingClientRect();
    const wpp = (2 * hit.distance * Math.tan(THREE.MathUtils.degToRad(v.camera.fov) / 2)) / rect.height;
    const px = Math.max(6, (protectRadiusUnits() / wpp) * 2);
    const vr = els.viewer.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.width = ring.style.height = `${px}px`;
    ring.style.left = `${evt.clientX - vr.left}px`; ring.style.top = `${evt.clientY - vr.top}px`;
  } else ring.style.display = 'none';
  if (protecting && (evt.buttons & 1)) { evt.preventDefault(); evt.stopImmediatePropagation(); protectAt(evt); }
}, true);
const endProtect = evt => { if (!protecting) return; protecting = false; P.lastDab = null; evt.stopImmediatePropagation?.(); window.dispatchEvent(new Event('shrink:protect-changed')); };
els.viewer.addEventListener('pointerup', endProtect, true);
els.viewer.addEventListener('pointercancel', endProtect, true);

/* ------------------------------------------------------------------ */
/* Detail-loss heat map                                                 */
/* ------------------------------------------------------------------ */
function drawLegend() {
  const s = P.heat.stats, d = detailMM(), mm = mmPerUnit(), u = unitLabel(), game = uiMode() === 'game';
  const stops = [0, 0.5, 1, 3, 6].map(r => { const c = heatColor(r, [0, 0, 0]); return `rgb(${c.map(x => Math.round(x * 255)).join(',')})`; });
  const above = P.heat.aboveShare != null ? P.heat.aboveShare : 0;
  els.heatLegend.innerHTML =
    `<div class="legend-title">DETAIL LOSS <span>vs original, ${game ? 'as % of model height' : 'in mm'}</span></div>` +
    `<div class="legend-bar" style="background:linear-gradient(90deg,${stops.join(',')})"></div>` +
    `<div class="legend-scale"><span>0</span><span>${mmText(d)}${u} (${game ? 'looks the same' : 'printer detail'})</span><span>≥ ${mmText(d * 6)}${u}</span></div>` +
    `<div class="legend-stats">Average <b>${mmText(s.mean * mm)}${u}</b> · 95% of the surface within <b>${mmText(s.p95 * mm)}${u}</b> · worst <b>${mmText(s.max * mm)}${u}</b> · ` +
    `<b>${(above * 100).toFixed(1)}%</b> of the surface changed by more than ${game ? 'you would notice' : 'the printer can show'}</div>`;
}

function applyHeat(silent = false) {
  if (!P.heat.distances) return;
  const mm = mmPerUnit(), d = detailMM();
  let over = 0, total = 0;
  for (const r of P.heat.distances) {
    snapshot(r.mesh);
    const colors = heatColorArray(r.distances, mm, d);
    r.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!(r.mesh.material instanceof THREE.MeshLambertMaterial && r.mesh.material.userData.shrinkHeat)) {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true });
      m.userData.shrinkHeat = true;
      r.mesh.material = m;
    }
    for (let i = 0; i < r.distances.length; i++) { if (r.distances[i] * mm > d) over++; total++; }
  }
  P.heat.aboveShare = total ? over / total : 0;
  drawLegend();
  els.heatLegend.style.display = 'block';
}

async function setHeat(on) {
  if (P.heat.busy) return;
  const a = app();
  if (!on) {
    P.heat.on = false;
    els.heatBtn.classList.remove('active');
    els.heatLegend.style.display = 'none';
    refreshOverlay();
    return;
  }
  if (!a?.optimizedModel) { say('Move the detail slider first, then Detail loss shows what changed.', true); return; }
  if (P.protectActive) await setProtectActive(false);
  window.__shrinkPaint?.setMode?.('navigate');
  a.show('original');
  els.heatBtn.classList.add('active');
  P.heat.on = true;
  if (!P.heat.distances || P.heat.forBytes !== a.reducedVersion) {
    const MeshBVH = await getMeshBVH();
    if (!MeshBVH) { say('Could not load the measuring library (three-mesh-bvh). Check your connection and try again.', true); P.heat.on = false; els.heatBtn.classList.remove('active'); return; }
    P.heat.busy = true;
    try {
      say('Measuring detail loss…');
      const { results, stats } = await computeDetailLoss({
        THREE, MeshBVH, original: a.originalModel, reduced: a.optimizedModel,
        onProgress: p => say(`Measuring detail loss… ${Math.round(p * 100)}%`)
      });
      P.heat.distances = results; P.heat.stats = stats; P.heat.forBytes = a.reducedVersion;
      say('Detail loss shown on the original: blue = unchanged, green ≈ one printer pixel, yellow/red = visibly changed.');
    } catch (err) {
      console.error(err); say(`Could not measure detail loss: ${err.message}`, true);
      P.heat.on = false; els.heatBtn.classList.remove('active');
    } finally { P.heat.busy = false; }
  }
  if (P.heat.on) { clearOverlay(); applyHeat(); }
}
els.heatBtn.addEventListener('click', () => setHeat(!P.heat.on));

/* ------------------------------------------------------------------ */
/* Compare slider                                                       */
/* ------------------------------------------------------------------ */
const divider = document.createElement('div');
divider.className = 'compare-divider';
divider.innerHTML = '<div class="compare-line"></div><div class="compare-handle">⇆</div>';
const labelL = document.createElement('div'); labelL.className = 'compare-label left';
const labelR = document.createElement('div'); labelR.className = 'compare-label right';
[divider, labelL, labelR].forEach(el => { el.style.display = 'none'; els.viewer.appendChild(el); });

function placeDivider() {
  const s = app().getCompareSplit();
  divider.style.left = `${s * 100}%`;
}
els.compareBtn.addEventListener('click', async () => {
  const a = app();
  if (a.isCompare()) { a.setCompare(false); return; }
  if (!a.optimizedModel) { say('Move the detail slider first, then Compare shows original and reduced side by side.', true); return; }
  if (P.heat.on) await setHeat(false);
  if (P.protectActive) await setProtectActive(false);
  window.__shrinkPaint?.setMode?.('navigate');
  a.setCompare(true);
});
window.addEventListener('shrink:compare', e => {
  const on = e.detail.on;
  els.compareBtn.classList.toggle('active', on);
  [divider, labelL, labelR].forEach(el => { el.style.display = on ? 'block' : 'none'; });
  if (on) {
    const a = app();
    labelL.textContent = `ORIGINAL · ${fmt(P.originalTriangles)} tris`;
    labelR.textContent = `REDUCED · ${fmt(P.optimizedTriangles)} tris`;
    window.__shrinkPrintRefreshLabels = () => { labelR.textContent = `REDUCED · ${fmt(P.optimizedTriangles)} tris`; };
    placeDivider();
  }
});
let draggingDivider = false;
divider.addEventListener('pointerdown', e => { draggingDivider = true; divider.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
divider.addEventListener('pointermove', e => {
  if (!draggingDivider) return;
  const rect = els.viewer.getBoundingClientRect();
  app().setCompareSplit((e.clientX - rect.left) / rect.width);
  placeDivider();
});
divider.addEventListener('pointerup', e => { draggingDivider = false; try { divider.releasePointerCapture(e.pointerId); } catch {} });

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */
function saveBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}
function exportModel(kind) {
  const model = currentModelForExport();
  if (!model) return;
  const a = app(), reduced = model === a.optimizedModel;
  const opts = { THREE, model, mmPerUnit: printMmPerUnit(), zUp: els.zUp.checked };
  const heightMM = Number(els.height.value);
  say(`Building ${kind.toUpperCase()}…`);
  setTimeout(() => {
    try {
      const suffix = reduced ? '-reduced' : '';
      if (kind === 'stl') {
        const { buffer, triangles } = buildBinaryStl(opts);
        saveBlob(new Blob([buffer], { type: 'model/stl' }), `${a.baseName()}${suffix}.stl`);
        say(`Saved STL: ${fmt(triangles)} triangles, ${fmtBytes(buffer.byteLength)}, scaled so the figure is ${heightMM} mm tall${els.zUp.checked ? ' (Z-up)' : ''}.`);
      } else {
        const { blob, triangles } = buildObjBlob(opts);
        saveBlob(blob, `${a.baseName()}${suffix}.obj`);
        say(`Saved OBJ: ${fmt(triangles)} triangles, ${fmtBytes(blob.size)}, scaled so the figure is ${heightMM} mm tall.`);
      }
    } catch (err) { console.error(err); say(`Export failed: ${err.message}`, true); }
  }, 30);
}
els.saveStl.addEventListener('click', () => exportModel('stl'));
els.saveObj.addEventListener('click', () => exportModel('obj'));

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */
window.addEventListener('shrink:model-opened', e => {
  const a = app();
  P.originalTriangles = e.detail.triangles;
  P.optimizedTriangles = 0;
  P.modelHeightUnits = modelHeight(THREE, a.originalModel);
  const defaultMM = a.sourceKind === 'glb' ? P.modelHeightUnits * 1000 : P.modelHeightUnits;   // glTF is metres, STL/OBJ usually mm
  els.height.value = Number(defaultMM.toPrecision(4));
  P.dabs = []; P.lastDab = null; P.protectMeshes = null;
  P.heat = { on: false, distances: null, stats: null, forBytes: null, busy: false };
  els.heatBtn.classList.remove('active'); els.heatLegend.style.display = 'none';
  els.protectBtn.classList.remove('active'); P.protectActive = false; els.viewer.classList.remove('direct-protect');
  els.protectRadiusValue.textContent = `${Number(els.protectRadius.value).toFixed(1)} mm`;
  els.protectKeepValue.textContent = `${els.protectKeep.value}%`;
  updateProtectInfo();
  syncTargetFromSlider();
  els.panel.classList.remove('hidden');
});

window.addEventListener('shrink:optimized', e => {
  P.optimizedTriangles = e.detail.triangles;
  P.heat = { on: false, distances: null, stats: null, forBytes: null, busy: false };
  els.heatBtn.classList.remove('active'); els.heatLegend.style.display = 'none';
  refreshOverlay();
  els.compareBtn.disabled = false; els.heatBtn.disabled = false;
  updateEstimates();
  const r = e.detail.reduce;
  if (r && !r.reachedTarget) say('Reduced as far as the protected areas allow. Lower "Protected detail kept" or paint a smaller area to go further.', false);
  else if (r && r.protectKeepUsed < 0.999) say(`Done. The protected area was thinned to ${(r.protectKeepUsed * 100).toFixed(0)}% so it does not use up the whole triangle budget.`);
});

window.addEventListener('shrink:texture-applied', () => {
  // The original model was reloaded: rebuild the protect data on the new meshes and re-apply the stored strokes.
  P.protectMeshes = null;
  P.heat = { on: false, distances: null, stats: null, forBytes: null, busy: false };
  els.heatBtn.classList.remove('active'); els.heatLegend.style.display = 'none';
  if (P.dabs.length) {
    P.protectMeshes = buildProtectMeshes();
    for (let i = 0; i < P.dabs.length; i += 4) markProtected(P.dabs[i], P.dabs[i + 1], P.dabs[i + 2], P.dabs[i + 3]);
    refreshOverlay();
  }
});

let heatTimer = 0;
window.addEventListener('shrink:reduced', e => {
  P.optimizedTriangles = e.detail.triangles;
  els.compareBtn.disabled = false; els.heatBtn.disabled = false;
  window.__shrinkPrintRefreshLabels?.();
  // The measurement belongs to the previous slider position: refresh it once the slider settles.
  if (P.heat.on) { clearTimeout(heatTimer); heatTimer = setTimeout(async () => { if (P.heat.on && !P.heat.busy) { P.heat.distances = null; await setHeat(false); await setHeat(true); } }, 700); }
  else P.heat = { ...P.heat, distances: null, stats: null, forBytes: null };
});
window.addEventListener('shrink:ui-mode', () => { if (P.heat.on) { if (P.heat.distances) applyHeat(true); } });

els.compareBtn.disabled = true;
els.heatBtn.disabled = true;

window.__shrinkPrint = {
  getReduceOptions() { return { dabs: P.dabs.slice(), protectKeep: Number(els.protectKeep.value) / 100 }; },
  mmPerUnit, printMmPerUnit, detailMM, unitLabel,
  getLocks() { return P.dabs.length && P.protectMeshes ? P.protectMeshes.map(pm => ({ mesh: pm.mesh, mask: pm.mask })) : []; },
  get state() { return P; }
};
