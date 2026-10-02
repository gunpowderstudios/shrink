import * as THREE from 'https://esm.sh/three@0.180.0';
import { createLiveReducer } from './live-reduce.js?v=2.09';
import { getMeshBVH } from './bvh-support.js?v=2.09';
import { computeDetailLoss, analyzeTopology, stlBytes, glbBytesEstimate } from './mesh-tools.js?v=2.09';

/* Live UI: drag the slider -> the model updates -> a plain-language verdict says whether it still looks the same. */

const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
const mode = () => window.__shrinkUI?.getMode?.() || 'game';
const fmt = n => new Intl.NumberFormat().format(Math.round(n));
const fmtBytes = b => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;
const say = (m, err = false) => app()?.setStatus?.(m, err);
const num = v => (v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4));

const el = {
  geometry: $('geometry'), target: $('targetTris'), live: $('liveLine'), verdict: $('verdict'), verdictText: $('verdictText'), verdictNums: $('verdictNums'),
  auto: $('autoBtn'), cards: $('targetCards'), chip: $('budgetChip'), topo: $('topoLine'),
  textureSize: $('textureSize'), textureQuality: $('textureQuality'), webp: $('webpToggle'), meshopt: $('meshoptToggle'),
  preset: $('printerPreset'), detail: $('printerDetailMm'), customField: $('customDetailField'), printerHint: $('printerHint'),
  height: $('figureHeightMm'), saveStl: $('saveStlBtn'), saveObj: $('saveObjBtn'), kept: $('keptLine'), liveCard: document.querySelector('.live-card')
};

const GAME_TARGETS = {
  web:  { label: 'web / mobile',   tris: 25000,  tex: 1024, quality: 80 },
  pc:   { label: 'PC / console',   tris: 100000, tex: 2048, quality: 85 },
  hero: { label: 'close-up / hero', tris: 300000, tex: 4096, quality: 90 }
};

const S = { tris: 0, target: 'pc', firstShow: true, autoRunning: false, measureTimer: 0, measureToken: 0, topoOrig: null, textures: null, busy: false, lastLive: null };
const engine = createLiveReducer(window.__shrinkApp);
window.__shrinkLive = engine;

/* ---------------- helpers ---------------- */
const ratio = () => Math.max(0.01, Math.min(1, Number(el.geometry.value) / 100));
const reduceOpts = () => ({ protectKeep: window.__shrinkPrint?.getReduceOptions?.().protectKeep ?? 1 });
const scale = () => ({ perUnit: window.__shrinkPrint.mmPerUnit(), detail: window.__shrinkPrint.detailMM(), unit: window.__shrinkPrint.unitLabel() });

function setRatio(r, { notify = true } = {}) {
  el.geometry.value = (Math.max(0.01, Math.min(1, r)) * 100).toFixed(1);
  if (notify) el.geometry.dispatchEvent(new Event('input', { bubbles: true }));
}

function gatherTextures() {
  const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
  const seen = new Map();
  let meshes = 0; const mats = new Set();
  app()?.originalModel?.traverse(o => {
    if (!o.isMesh) return; meshes++;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue; mats.add(m);
      for (const k of maps) { const t = m[k]; const im = t?.image; if (t && im?.width && !seen.has(t.uuid)) seen.set(t.uuid, { w: im.width, h: im.height }); }
    }
  });
  S.textures = { list: [...seen.values()], meshes, materials: mats.size };
}

function textureEstimate() {
  const cap = Number(el.textureSize?.value || 1024), webp = el.webp?.checked !== false;
  let gpu = 0, file = 0;
  for (const { w, h } of S.textures?.list || []) {
    const s = Math.min(1, cap / Math.max(w, h)), tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
    gpu += tw * th * 4 * 1.33; file += tw * th * (webp ? 0.4 : 1.5);
  }
  return { gpu, file, count: S.textures?.list.length || 0, cap };
}

/* ---------------- live readout ---------------- */
function updateLiveLine(trisOverride) {
  if (!S.tris) { el.live.textContent = '—'; return; }
  const tris = trisOverride ?? Math.round(S.tris * ratio());
  const pct = (100 * tris / S.tris).toFixed(tris / S.tris < 0.1 ? 1 : 0);
  const busy = S.busy ? ' <span class="spin" aria-label="updating"></span>' : '';
  let html = `<strong>${fmt(tris)}</strong> triangles <span class="dim">${pct}% of the original (${fmt(S.tris)})</span>${busy}`;
  if (mode() === 'print') {
    html += `<div class="dim">STL file ≈ ${fmtBytes(stlBytes(tris))}</div>`;
    if (el.saveStl) el.saveStl.textContent = `Save STL · ${fmtBytes(stlBytes(tris))}`;
    if (el.saveObj) el.saveObj.textContent = 'Save OBJ';
  } else {
    const t = textureEstimate();
    const glb = glbBytesEstimate(tris, { meshopt: el.meshopt?.checked !== false, textureBytes: t.file });
    html += `<div class="dim">GLB file ≈ ${fmtBytes(glb)}</div>`;
    if (t.count) html += `<div class="dim">${t.count} texture${t.count > 1 ? 's' : ''} use ≈ ${fmtBytes(t.gpu)} of graphics memory at ${t.cap}px</div>`;
    if (S.textures) html += `<div class="dim">${S.textures.meshes} mesh part${S.textures.meshes === 1 ? '' : 's'} · ${S.textures.materials} material${S.textures.materials === 1 ? '' : 's'} <span class="dim2">(roughly one draw call each)</span></div>`;
  }
  el.live.innerHTML = html;
  updateChip(tris);
}

function updateChip(tris) {
  const b = GAME_TARGETS[S.target];
  if (mode() !== 'game' || !b) { el.chip.hidden = true; return; }
  el.chip.hidden = false;
  if (tris <= b.tris * 1.02) { el.chip.dataset.level = 'good'; el.chip.textContent = `✔ Within the ~${fmt(b.tris)} triangle guide for ${b.label}`; }
  else { el.chip.dataset.level = 'warn'; el.chip.textContent = `● ${fmt(tris - b.tris)} over the ~${fmt(b.tris)} guide for ${b.label} — a rule of thumb, not a hard limit`; }
}

/* ---------------- verdict ---------------- */
function setVerdict(level, text, nums = '') {
  el.verdict.dataset.level = level; el.verdictText.textContent = text; el.verdictNums.textContent = nums;
}

async function measureLoss() {
  const a = app();
  if (!engine.root || !a?.originalModel) return null;
  const MeshBVH = await getMeshBVH();
  if (!MeshBVH) return null;
  let total = 0; a.originalModel.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) total += o.geometry.attributes.position.count; });
  const stride = Math.max(1, Math.floor(total / 20000));
  const { stats } = await computeDetailLoss({ THREE, MeshBVH, original: a.originalModel, reduced: engine.root, stride, yieldToUi: false });
  return stats;
}

function judge(stats) {
  const { perUnit, detail, unit } = scale();
  const p95 = stats.p95 * perUnit, max = stats.max * perUnit;
  const game = mode() === 'game';
  let level, text;
  if (p95 <= detail * 0.5) { level = 'good'; text = game ? 'Looks the same' : 'Invisible at print size'; }
  else if (p95 <= detail) { level = 'good'; text = game ? 'Looks the same' : 'Looks the same when printed'; }
  else if (p95 <= detail * 2) { level = 'warn'; text = 'Slight softening of fine detail'; }
  else { level = 'bad'; text = game ? 'Visibly simplified — raise the slider or choose a bigger target' : 'Visible loss — raise the slider or protect the important areas'; }
  const nums = game
    ? `95% of the surface moved less than ${num(p95)}${unit} of the model's height (worst ${num(max)}${unit}).`
    : `95% of the surface moved less than ${num(p95)} mm (worst ${num(max)} mm). Your printer shows about ${num(detail)} mm.`;
  return { level, text, nums, p95, detail };
}

function scheduleMeasure(delay = 450) {
  clearTimeout(S.measureTimer);
  setVerdict('busy', 'Checking what changed…');
  S.measureTimer = setTimeout(doMeasure, delay);
}

async function doMeasure() {
  const token = ++S.measureToken;
  if (!engine.ready || !S.tris) return;
  if (ratio() >= 0.999) { setVerdict('good', 'Original — nothing removed'); if (mode() === 'print') updateTopo(); return; }
  let stats = null;
  try { stats = await measureLoss(); } catch (err) { console.warn('measure failed', err); }
  if (token !== S.measureToken) return;
  if (!stats) { setVerdict('none', 'Could not measure the difference', ''); return; }
  const v = judge(stats);
  setVerdict(v.level, v.text, v.nums);
  if (mode() === 'print') updateTopo();
}

/* ---------------- printability ---------------- */
function updateTopo() {
  if (!engine.root || !el.topo) return;
  try {
    const a = app();
    if (!S.topoOrig && a.originalModel) S.topoOrig = analyzeTopology(THREE, a.originalModel);
    const r = ratio() >= 0.999 ? S.topoOrig : analyzeTopology(THREE, engine.root);
    const issues = r.openEdges + r.nonManifold;
    el.topo.hidden = false;
    if (!issues) { el.topo.dataset.level = 'good'; el.topo.textContent = '✔ Watertight — a closed surface, ready for a slicer.'; return; }
    const parts = [];
    if (r.openEdges) parts.push(`${fmt(r.openEdges)} open edge${r.openEdges === 1 ? '' : 's'} (gaps in the surface)`);
    if (r.nonManifold) parts.push(`${fmt(r.nonManifold)} pinched edge${r.nonManifold === 1 ? '' : 's'} (shared by more than two faces)`);
    const before = S.topoOrig && (S.topoOrig.openEdges + S.topoOrig.nonManifold) > 0;
    el.topo.dataset.level = 'warn';
    el.topo.textContent = `● ${parts.join(' and ')} — ${before ? 'the original already has some' : 'left by the reduction'}. Many slicers fix this automatically; if yours complains, run its repair tool.`;
  } catch (err) { console.warn('topology check failed', err); }
}

/* ---------------- slider, presets, targets ---------------- */
function onSlider() {
  updateLiveLine();
  if (!engine.ready) return;
  setVerdict('busy', 'Updating…');
  engine.request(ratio(), reduceOpts());
}
el.geometry.addEventListener('input', onSlider);

function chooseTarget(key, { initial = false } = {}) {
  const t = GAME_TARGETS[key]; if (!t) return;
  S.target = key;
  el.cards?.querySelectorAll('.target-card').forEach(b => b.classList.toggle('active', b.dataset.target === key));
  if (el.textureSize) { el.textureSize.value = String(t.tex); el.textureSize.dispatchEvent(new Event('change', { bubbles: true })); }
  if (el.textureQuality) { el.textureQuality.value = String(t.quality); el.textureQuality.dispatchEvent(new Event('input', { bubbles: true })); }
  if (S.tris) setRatio(Math.min(1, t.tris / S.tris));
  if (!initial) say(`Set up for ${t.label}: about ${fmt(t.tris)} triangles and ${t.tex}px textures. Adjust the slider if you want more or less detail.`);
}
el.cards?.addEventListener('click', e => { const b = e.target.closest('.target-card'); if (b) chooseTarget(b.dataset.target); });
[el.textureSize, el.webp, el.meshopt].forEach(x => x?.addEventListener('change', () => updateLiveLine()));

el.preset?.addEventListener('change', () => {
  const custom = el.preset.value === 'custom';
  el.customField.hidden = !custom;
  if (!custom) { el.detail.value = el.preset.value; el.detail.dispatchEvent(new Event('input', { bubbles: true })); }
  scheduleMeasure(200);
});
el.detail?.addEventListener('input', () => scheduleMeasure(500));
el.height?.addEventListener('input', () => { updateLiveLine(); scheduleMeasure(500); });

/* ---------------- Auto: smallest that still looks the same ---------------- */
async function autoFind() {
  if (S.autoRunning || !engine.ready || !S.tris) return;
  S.autoRunning = true; el.auto.disabled = true; engine.lock(true);
  clearTimeout(S.measureTimer);
  const opts = reduceOpts();
  try {
    const { perUnit, detail } = scale();
    let lo = Math.max(0.01, 1500 / S.tris), hi = 1, best = 1, lastApplied = 1, steps = 0;
    for (let i = 0; i < 8 && hi / lo > 1.04; i++) {
      const mid = Math.sqrt(lo * hi); steps++;
      say(`Looking for the smallest version that still looks the same… step ${steps}`);
      setVerdict('busy', `Trying ${Math.round(mid * 1000) / 10}% …`);
      await engine.runExact(mid, opts); lastApplied = mid;
      const s = await measureLoss();
      if (s && s.p95 * perUnit <= detail) { hi = mid; best = mid; } else lo = mid;
    }
    // In game mode a chosen budget wins if it is smaller than what "looks the same" needs only when the user asked for it.
    if (lastApplied !== best) await engine.runExact(best, opts);
    setRatio(best, { notify: false });
    el.geometry.dispatchEvent(new Event('input', { bubbles: true }));   // labels only: engine is locked
    const tris = Math.round(S.tris * best);
    say(best >= 0.999 ? 'Every polygon matters here — at this printer detail nothing can be removed without a visible change.' : `Found it: about ${fmt(tris)} triangles (${(best * 100).toFixed(1)}%) looks the same at this ${mode() === 'print' ? 'printer detail' : 'quality bar'}.`);
  } catch (err) {
    console.error(err); say(`Auto search stopped: ${err.message}`, true);
  } finally {
    engine.lock(false); S.autoRunning = false; el.auto.disabled = false;
    scheduleMeasure(0);
  }
}
el.auto?.addEventListener('click', autoFind);

/* ---------------- engine events ---------------- */
window.addEventListener('shrink:live-busy', e => { S.busy = !!e.detail.busy; updateLiveLine(S.lastLive?.triangles); });
window.addEventListener('shrink:live-error', e => say(`Live preview problem: ${e.detail.message}`, true));
window.addEventListener('shrink:live-updated', e => {
  S.lastLive = e.detail;
  updateLiveLine(e.detail.triangles);
  if (S.firstShow) { S.firstShow = false; app().show('optimized'); }
  if (!S.autoRunning) scheduleMeasure(450);
  const keep = e.detail.keepUsed;
  if (keep < 0.999 && !S.autoRunning) say(`The protected area was thinned to ${(keep * 100).toFixed(0)}% so it does not use up the whole triangle budget.`);
});

window.addEventListener('shrink:model-opened', async e => {
  // STL files are shown faceted (as slicers show them); only the shading changes, never the mesh itself.
  if (app()?.sourceKind === 'stl') app().originalModel?.traverse(o => { if (o.isMesh) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && 'flatShading' in m) { m.flatShading = true; m.needsUpdate = true; } });
  S.tris = e.detail.triangles; S.firstShow = true; S.topoOrig = null; S.lastLive = null;
  setVerdict('busy', 'Preparing the live preview…'); el.live.textContent = 'Preparing…';
  if (el.topo) el.topo.hidden = true;
  gatherTextures();
  try { await engine.prepare(); } catch (err) { console.error(err); say(`Could not prepare the live preview: ${err.message}`, true); return; }
  if (mode() === 'game') chooseTarget(S.target, { initial: true }); else setRatio(Math.min(1, 0.5));
  if (!engine.last.triangles) return;
  onSlider();
  setTimeout(() => { if (mode() === 'print' && app()?.originalModel) { try { S.topoOrig = analyzeTopology(THREE, app().originalModel); updateTopo(); } catch {} } }, 600);
});

window.addEventListener('shrink:texture-applied', async () => {
  gatherTextures(); S.topoOrig = null;
  try { await engine.prepare(); onSlider(); } catch (err) { console.warn(err); }
});
window.addEventListener('shrink:protect-changed', async () => { await engine.syncLocks(); engine.request(ratio(), reduceOpts(), 30); });
window.addEventListener('shrink:ui-mode', () => {
  updateLiveLine(S.lastLive?.triangles);
  if (mode() === 'print') { el.chip.hidden = true; if (engine.ready) { S.topoOrig = null; setTimeout(updateTopo, 50); } }
  if (engine.ready) scheduleMeasure(100);
});

window.addEventListener('shrink:optimized', e => {
  const m = mode();
  el.kept.innerHTML = m === 'print'
    ? '<b>Kept:</b> the shape, plus colours and textures exactly as they were. <b>Not changed:</b> no texture resizing and no compression, so Blender, ShapeLab and Cinema 4D can open it.'
    : `<b>Kept:</b> textures (resized to ${el.textureSize?.value}px${el.webp?.checked ? ', WebP' : ''}), UV maps and smooth shading. <b>Removed:</b> unused materials and data${el.meshopt?.checked ? ' · mesh compressed (Meshopt)' : ''}.`;
});

window.__shrinkLiveUI = { autoFind, chooseTarget, setRatio, state: S, measureLoss };
