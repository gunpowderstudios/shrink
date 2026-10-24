// SHRINK 3D v2.141 — CLAY tool for 3D Print. Paint pink clay over holes and gaps ("Add clay") or mark parts to carve away ("Cut away").
// Nothing in the model changes until FIX IT / QUICK-FIX runs: then the clay is joined to the model (or carved out of it) and the
// usual repair makes the result printable. Geometry maths lives in clay-core.js; this file is the brush, the preview and the apply step.
import * as THREE from 'https://esm.sh/three@0.180.0';
import { dabSoup, dabsAlong, joinSoups, thin } from './clay-core.js?v=2.143';
import { gatherWorldMesh } from './solid-rebuild.js?v=2.27';
import { healthOfModel } from './repair-core.js?v=2.27';

const $ = id => document.getElementById(id);
const V = () => window.__shrinkViewer;
const model = () => window.__shrinkWorkingModel?.() || null;
const mmPerUnit = () => window.__shrinkPrint?.mmPerUnit?.() || 1;
const st = { on: false, mode: 'add', mm: 3, strokes: [], down: false, last: null, group: null, inst: {}, count: { add: 0, cut: 0 }, busy: false };
const CAP = 40000;
const raycaster = new THREE.Raycaster();

const say = (text, bad = false) => { const n = $('v2ClayNote'); if (n) { n.textContent = text; n.dataset.bad = bad ? '1' : ''; } };

/* ----------------------------- preview (pink balls in the viewer) ----------------------------- */
function ensureGroup() {
  const scene = V()?.scene; if (!scene) return null;
  if (st.group && st.group.parent === scene) return st.group;
  const g = new THREE.Group(); g.name = 'shrinkClay'; g.renderOrder = 10;
  const geo = new THREE.SphereGeometry(1, 12, 9);
  const mk = (color, opacity) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: color, emissiveIntensity: 0.18, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }), CAP); m.count = 0; m.frustumCulled = false; m.raycast = () => {}; g.add(m); return m; };
  st.inst = { add: mk(0xff4fb8, 1), cut: mk(0xff5a1f, 0.6) };
  scene.add(g); st.group = g; return g;
}
const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
function drawPreview() {
  if (!ensureGroup()) return;
  const n = { add: 0, cut: 0 };
  for (const s of st.strokes) for (const d of s.dabs) {
    if (n[s.mode] >= CAP) continue;
    tmpM.compose(tmpP.set(d.x, d.y, d.z), tmpQ.identity(), tmpS.setScalar(d.r)); st.inst[s.mode].setMatrixAt(n[s.mode]++, tmpM);
  }
  for (const k of ['add', 'cut']) { st.inst[k].count = n[k]; st.inst[k].instanceMatrix.needsUpdate = true; }
  st.count = n; refreshUi();
}
function removePreview() { if (st.group) { st.group.parent?.remove(st.group); st.group = null; st.inst = {}; } }

/* ----------------------------- painting ----------------------------- */
const viewer = () => V()?.renderer?.domElement?.closest?.('.viewer') || document.getElementById('viewer');
function pick(clientX, clientY) {
  const v = V(), root = model(); if (!v?.renderer || !root) return null;
  const rect = v.renderer.domElement.getBoundingClientRect(); if (!rect.width) return null;
  raycaster.setFromCamera({ x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 }, v.camera);
  const h = raycaster.intersectObject(root, true).find(x => x.object.isMesh && x.object.visible);
  return h ? { x: h.point.x, y: h.point.y, z: h.point.z } : null;
}
const radius = () => Math.max(0.01, st.mm / mmPerUnit());
function dabTo(x, y, stroke) {
  const p = pick(x, y); if (!p) { stroke.prev = null; return; }
  const r = stroke.r;
  if (stroke.prev) stroke.dabs.push(...dabsAlong(stroke.prev, p, r)); else stroke.dabs.push({ ...p, r });
  stroke.prev = p;
}
function strokeTo(e, stroke) {
  const to = { x: e.clientX, y: e.clientY }, from = st.last || to, d = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(d / 6));
  for (let i = 1; i <= steps; i++) dabTo(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, stroke);
  st.last = to; stroke.dabs = thin(stroke.dabs); drawPreview();
}
let cur = null;
const rotating = e => e.metaKey || e.ctrlKey;
function wire() {
  const el = viewer(); if (!el || el.dataset.clayWired) return; el.dataset.clayWired = '1';
  el.addEventListener('pointerdown', e => {
    if (!st.on || st.busy || e.button !== 0 || rotating(e)) return;
    e.stopPropagation(); e.preventDefault();
    cur = { mode: st.mode, r: radius(), dabs: [], prev: null }; st.strokes.push(cur); st.down = true; st.last = null; strokeTo(e, cur);
  }, true);
  el.addEventListener('pointermove', e => { if (st.on && st.down && cur) { e.stopPropagation(); if ((e.buttons & 1) === 0) end(); else strokeTo(e, cur); } }, true);
  const end = () => { if (!st.down) return; st.down = false; st.last = null; if (cur && !cur.dabs.length) st.strokes.pop(); cur = null; drawPreview(); };
  el.addEventListener('pointerup', end, true); el.addEventListener('pointercancel', end, true);
  window.addEventListener('pointerup', end, true); window.addEventListener('blur', end);
  const orbitLeft = pan => { const c = V()?.controls; if (c?.mouseButtons) c.mouseButtons.LEFT = pan ? 2 : 0; };
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && st.on) setTool(false); if (st.on && (e.key === 'Meta' || e.key === 'Control')) { orbitLeft(true); end(); } }, true);
  window.addEventListener('keyup', e => { if (st.on && (e.key === 'Meta' || e.key === 'Control')) orbitLeft(false); }, true);
}
function setTool(on, mode) {
  if (mode) st.mode = mode;
  st.on = !!on; wire();
  const c = V()?.controls; if (c?.mouseButtons) c.mouseButtons.LEFT = st.on ? 0 : 0;
  viewer()?.classList.toggle('v2-clay-on', st.on);
  if (st.on) { ensureGroup(); say(st.mode === 'add' ? 'Add clay: drag over a hole or gap. Hold Ctrl or Cmd and drag to turn the model.' : 'Cut away: drag over what you want carved off (shows orange). Hold Ctrl or Cmd and drag to turn the model.'); }
  refreshUi();
}
function undo() { if (st.busy) return; st.strokes.pop(); drawPreview(); }
function clear() { if (st.busy) return; st.strokes = []; drawPreview(); say('Clay cleared.'); }
const hasClay = () => st.strokes.some(s => s.dabs.length);

/* ----------------------------- apply: join / carve, then the usual health check ----------------------------- */
// Keep the number of balls (and so triangles) sensible: a long stroke is thinned, and a big pile gets coarser balls.
const dabsOf = mode => thin(st.strokes.filter(s => s.mode === mode).flatMap(s => s.dabs), 0.5);
const ballLevel = n => n > 1500 ? 0 : n > 400 ? 1 : 2;
const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const disposeRoot = r => r?.traverse?.(o => { if (o.isMesh) { o.geometry?.dispose?.(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m?.dispose?.()); } });
const triCount = m => { let n = 0; m.traverse(o => { if (o.isMesh) n += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3); }); return n; };

function soupGroup(soup) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(soup.positions, 3)); g.setIndex(new THREE.BufferAttribute(soup.indices, 1));
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial())); grp.updateMatrixWorld(true); return grp;
}
async function manifoldSolid(m) { return window.__shrinkFuse.modelToSolid(m); }
function ballsSolid(wasm, dabs) {
  const parts = dabs.map(d => wasm.Manifold.sphere(d.r, dabs.length > 500 ? 12 : 24).translate([d.x, d.y, d.z]));
  const u = parts.length === 1 ? parts[0] : wasm.Manifold.union(parts);
  for (const p of parts) if (p !== u) try { p.delete(); } catch {}
  return u;
}

// Returns { root, route, note }. Throws (leaving everything untouched) when the result is not a clean closed model.
async function apply(source, onStatus = () => {}) {
  if (!hasClay()) throw new Error('There is no clay to apply.');
  if (!source) throw new Error('No model is loaded.');
  const adds = dabsOf('add'), cuts = dabsOf('cut');
  const F = window.__shrinkFuse; if (!F?.modelToSolid) throw new Error('The solid engine is still loading.');
  const wasm = await F.loadManifold();
  let route = '', solid = null, temp = null;
  try {
    // Route A: the model is already a proper solid, so join/carve with exact geometry and keep every bit of detail.
    onStatus('Joining the clay to the model…'); await tick();
    try {
      const base = await manifoldSolid(source); solid = base.solid; route = 'exact';
    } catch (e) { solid = null; }
    // Route B: the surface leaks, so Manifold cannot read it. The clay balls join the surface and the voxel wrap seals the lot.
    if (!solid) {
      route = 'wrap';
      const wt = await import('./watertight-remesh.js?v=2.63');
      let soup = gatherWorldMesh(source);
      if (adds.length) soup = joinSoups(soup, dabSoup(adds, ballLevel(adds.length)));
      const grp = soupGroup(soup);
      let lastErr = null, wrapped = null;
      for (const q of ['balanced', 'fast']) {
        try { onStatus(`Sealing the model around the clay (${q})…`); const r = await wt.makeWatertight(grp, q, t => onStatus(t)); const h = healthOfModel(THREE, r.root); if (h.clean) { wrapped = r.root; break; } disposeRoot(r.root); lastErr = new Error(`The sealed result still had ${h.openEdges} open and ${h.pinchedEdges} pinched edges.`); }
        catch (e) { lastErr = e; }
      }
      disposeRoot(grp);
      if (!wrapped) throw lastErr || new Error('The model could not be sealed.');
      temp = wrapped;
      if (!cuts.length) return { root: wrapped, route, note: 'Sealed with the clay; the wrap softens very fine detail slightly.' };
      solid = (await manifoldSolid(wrapped)).solid; disposeRoot(wrapped); temp = null;
    } else if (adds.length) {
      const balls = ballsSolid(wasm, adds), u = wasm.Manifold.union([solid, balls]);
      try { solid.delete(); balls.delete(); } catch {} solid = u;
    }
    if (cuts.length) {
      onStatus('Carving the cut-away areas…'); await tick();
      const balls = ballsSolid(wasm, cuts), d = wasm.Manifold.difference(solid, balls);
      try { solid.delete(); balls.delete(); } catch {} solid = d;
    }
    if (solid.isEmpty?.()) throw new Error('Nothing was left after the clay was applied.');
    const root = F.solidToThree(solid);
    const h = healthOfModel(THREE, root);
    if (!h.clean) { disposeRoot(root); throw new Error(`The result still has ${h.openEdges} open and ${h.pinchedEdges} pinched edges, so nothing was changed.`); }
    return { root, route, note: route === 'exact' ? 'Clay joined exactly; no detail was lost.' : 'Clay applied after sealing.' };
  } finally { try { solid?.delete?.(); } catch {} if (temp) disposeRoot(temp); }
}

async function applyNow() {
  if (st.busy || !hasClay()) return;
  const src = model(); if (!src) return;
  st.busy = true; refreshUi(); setTool(false);
  try {
    const r = await apply(src, t => say(t));
    window.__shrinkInstallWorkingModel(r.root, 'clay');
    st.strokes = []; drawPreview(); removePreview();
    window.__shrinkRefreshHealth?.();
    say(`✓ Clay applied (${new Intl.NumberFormat().format(triCount(r.root))} triangles). ${r.note}`);
  } catch (err) { console.error('[SHRINK 3D v2.141] Clay failed', err); say(`Clay could not be applied: ${err.message} Your model is unchanged and the clay is still there.`, true); }
  finally { st.busy = false; refreshUi(); }
}

/* ----------------------------- card ----------------------------- */
function refreshUi() {
  const q = id => $(id); if (!q('v2ClayAdd')) return;
  q('v2ClayAdd').setAttribute('aria-pressed', String(st.on && st.mode === 'add')); q('v2ClayCut').setAttribute('aria-pressed', String(st.on && st.mode === 'cut'));
  q('v2ClayUndo').disabled = !st.strokes.length || st.busy; q('v2ClayClear').disabled = !st.strokes.length || st.busy; q('v2ClayApply').disabled = !hasClay() || st.busy;
  q('v2ClaySizeVal').textContent = `${st.mm.toFixed(1)} mm`;
  q('v2ClayCount').textContent = hasClay() ? `${st.strokes.filter(s => s.mode === 'add').length} clay · ${st.strokes.filter(s => s.mode === 'cut').length} cut` : 'No clay yet';
}
function buildCard() {
  const host = $('v2ClayHost'); if (!host || host.dataset.built) return; host.dataset.built = '1';
  host.innerHTML = `<div class="v2-card-head"><div><h2>CLAY <em>(optional)</em></h2><p>Paint pink clay over holes and gaps you want sealed, or mark parts to carve away. FIX IT then joins it all up.</p></div></div>
    <div class="v2-clay-tools"><button id="v2ClayAdd" type="button" aria-pressed="false">ADD CLAY</button><button id="v2ClayCut" type="button" aria-pressed="false">CUT AWAY</button></div>
    <label class="v2-clay-size">Brush size <input id="v2ClaySize" type="range" min="0.5" max="15" step="0.5" value="3"><output id="v2ClaySizeVal">3.0 mm</output></label>
    <div class="v2-clay-row"><span id="v2ClayCount">No clay yet</span><button id="v2ClayUndo" type="button">UNDO</button><button id="v2ClayClear" type="button">CLEAR</button></div>
    <button id="v2ClayApply" class="v2-mega v2-green" type="button">APPLY CLAY NOW</button>
    <div id="v2ClayNote" class="v2-result">Pink clay joins the model when you press FIX IT or QUICK-FIX. Nothing changes until then.</div>`;
  $('v2ClayAdd').addEventListener('click', () => setTool(!(st.on && st.mode === 'add'), 'add'));
  $('v2ClayCut').addEventListener('click', () => setTool(!(st.on && st.mode === 'cut'), 'cut'));
  $('v2ClaySize').addEventListener('input', e => { st.mm = Number(e.target.value) || 3; refreshUi(); });
  $('v2ClayUndo').addEventListener('click', undo); $('v2ClayClear').addEventListener('click', clear); $('v2ClayApply').addEventListener('click', applyNow);
  refreshUi();
}

window.__shrinkClay = { apply, hasClay, clear, strokes: () => st.strokes, addStroke: (mode, dabs) => { st.strokes.push({ mode, r: dabs[0]?.r || radius(), dabs }); drawPreview(); }, setTool, state: st, applyNow, finish: () => { st.strokes = []; drawPreview(); removePreview(); } };
const init = () => { buildCard(); if (!document.body.classList.contains('app-mode-print')) setTool(false); };
window.addEventListener('shrink:ui-mode', init);
window.addEventListener('shrink:model-opened', () => { setTool(false); st.strokes = []; drawPreview(); say('Pink clay joins the model when you press FIX IT or QUICK-FIX. Nothing changes until then.'); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
{ let tries = 0; const retry = () => { if ($('v2ClayHost')?.dataset.built || ++tries > 20) return; buildCard(); setTimeout(retry, 500); }; setTimeout(retry, 300); }
