// SHRINK 3D v2.109 — Remove part (Game mode). A "Remove" tool in the viewer toolbar: paint the part you do not want (a wing mirror, an aerial) red with a brush,
// press "Remove selected", and those triangles are cut out of the model. The cut goes into the source GLB (like applying a texture edit), so Optimise, the wheels and
// the download all use the trimmed model. Up to five removals can be undone. The picking maths and the document edit are in remove-part-core.js (tested in Node).
import { ensureBVH, raycasterFor } from './bvh-support.js?v=2.18';
import { prepare, select, clearSelection, selectedCorners, removeSelected } from './remove-part-core.js?v=2.109';

const $ = id => document.getElementById(id);
const A = () => window.__shrinkApp, V = () => window.__shrinkViewer;
const viewer = $('viewer'), raycaster = raycasterFor();
const st = { on: false, busy: false, data: null, doc: null, bytes: null, size: 40, front: false, erase: false, down: false, last: null, overlay: null, undo: [], timer: null };
const say = (t, bad) => { const s = $('status'); if (s) { s.textContent = t; s.classList.toggle('error', !!bad); } };

function buildUI() {
  const controls = document.querySelector('.model-paint-controls'), toolbar = document.querySelector('.viewer-toolbar');
  if (!controls || !toolbar || $('removeModelBtn')) return !!$('removeModelBtn');
  const btn = document.createElement('button'); btn.id = 'removeModelBtn'; btn.type = 'button'; btn.className = 'button ghost small model-paint-button game-only'; btn.textContent = 'Remove';
  btn.title = 'Brush over a part of the model (a wing mirror, an aerial) and cut it out';
  controls.insertBefore(btn, $('undo3DBtn') || null);
  const bar = document.createElement('div'); bar.id = 'removeBar'; bar.className = 'tool-options game-only'; bar.hidden = true;
  bar.innerHTML = `<label>Brush size <input id="rmSize" type="range" min="8" max="200" step="1" value="40" aria-label="Brush size"><output id="rmSizeV">40</output></label>
    <label title="Only pick faces that point at you. Leave it off to pick the part right through (both sides of a thin mirror)."><input id="rmFront" type="checkbox"> Only what I can see</label>
    <label title="Brush away the red instead (or hold Alt while you drag)"><input id="rmErase" type="checkbox"> Unselect</label>
    <span id="rmCount" class="rm-count">Nothing selected</span>
    <button id="rmClear" class="button ghost small" type="button" disabled>Clear</button>
    <button id="rmGo" class="button small rm-go" type="button" disabled>Remove selected</button>
    <button id="rmUndo" class="button ghost small" type="button" disabled>Undo remove</button>
    <button id="rmDone" class="button ghost small" type="button" style="margin-left:auto" title="Stop and go back to rotating the model (Esc)">Done · Esc</button>`;
  toolbar.insertAdjacentElement('afterend', bar);
  const ring = document.createElement('div'); ring.id = 'rmRing'; ring.className = 'rm-ring'; viewer.appendChild(ring);
  const css = document.createElement('style');
  css.textContent = `.rm-ring{position:absolute;z-index:30;border:2px solid #ff5a5a;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none;transform:translate(-50%,-50%);display:none}
    .viewer.direct-remove canvas{cursor:none!important;touch-action:none}
    .viewer.direct-remove.modifier-rotate canvas{cursor:grab!important}
    .rm-count{font-size:12px;color:#ffb3b3;font-weight:700}
    .rm-go:not(:disabled){background:#e23d3d;color:#fff;border-color:#e23d3d}`;
  document.head.appendChild(css);
  btn.addEventListener('click', () => (st.on ? exit() : enter()));
  $('rmDone').addEventListener('click', () => exit());
  $('rmSize').addEventListener('input', e => { st.size = Number(e.target.value); $('rmSizeV').textContent = String(st.size); sizeRing(); });
  $('rmFront').addEventListener('change', e => { st.front = e.target.checked; });
  $('rmErase').addEventListener('change', e => { st.erase = e.target.checked; });
  $('rmClear').addEventListener('click', () => { if (st.data) { clearSelection(st.data); refresh(); } });
  $('rmGo').addEventListener('click', doRemove);
  $('rmUndo').addEventListener('click', doUndo);
  return true;
}

function sizeRing() { const r = $('rmRing'); if (r) { r.style.width = r.style.height = st.size + 'px'; } }
function counts() {
  const n = st.data?.selected || 0;
  $('rmCount').textContent = n ? `${n.toLocaleString()} of ${st.data.total.toLocaleString()} triangles selected` : 'Nothing selected';
  $('rmClear').disabled = !n; $('rmGo').disabled = !n || st.busy; $('rmUndo').disabled = !st.undo.length || st.busy;
}

function clearOverlay() {
  if (!st.overlay) return;
  V()?.scene.remove(st.overlay); st.overlay.geometry.dispose(); st.overlay.material.dispose(); st.overlay = null;
}
function rebuildOverlay() {
  st.timer = null; clearOverlay();
  const T = A()?.THREE, corners = st.data ? selectedCorners(st.data) : null;
  if (!T || !corners?.length) return;
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(corners, 3));
  const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.7, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.frustumCulled = false; m.raycast = () => {}; m.renderOrder = 10; V().scene.add(m); st.overlay = m;
}
function refresh(soon) { counts(); if (soon) { if (!st.timer) st.timer = setTimeout(rebuildOverlay, 60); } else { clearTimeout(st.timer); rebuildOverlay(); } }

async function load() {
  clearOverlay();
  await ensureBVH(A().originalModel, say);
  st.bytes = A().sourceBytes; st.doc = await A().readDoc(); st.data = prepare(st.doc); counts();
}

async function enter() {
  const app = A(); if (!app?.sourceBytes) { say('Open a model first.', true); return; }
  if (st.busy) return; st.busy = true;
  try {
    if (window.__shrinkPaint?.hasEdits?.()) {          // keep painted-on colour: write it into the model first, then cut
      say('Saving your paint into the model first…');
      await new Promise(res => { const done = () => { window.removeEventListener('shrink:texture-applied', done); res(); }; window.addEventListener('shrink:texture-applied', done); setTimeout(done, 30000); $('applyTextureBtn')?.click(); });
    }
    window.__shrinkPaint?.setMode?.('navigate');
    app.show('original');
    say('Preparing the model for the Remove brush…');
    await load();
    st.on = true; st.last = null;
    viewer.classList.add('direct-remove'); $('removeModelBtn').classList.add('active'); $('removeBar').hidden = false; sizeRing();
    const help = document.querySelector('.viewer-help'); if (help) help.textContent = 'REMOVE · drag to paint the part red · Alt-drag unselects · Cmd/Ctrl to rotate · Esc when done';
    say('Remove: brush over the part you want gone (it turns red), then press “Remove selected”. Nothing is cut until you do.');
  } catch (err) { console.error(err); say(`Could not start the Remove brush: ${err.message}`, true); }
  finally { st.busy = false; counts(); }
}

function exit(restoreHelp = true) {
  if (!st.on) return;
  st.on = false; st.down = false; st.last = null;
  clearTimeout(st.timer); clearOverlay(); if (st.data) clearSelection(st.data);
  viewer.classList.remove('direct-remove', 'modifier-rotate'); $('removeModelBtn')?.classList.remove('active'); if ($('removeBar')) $('removeBar').hidden = true; if ($('rmRing')) $('rmRing').style.display = 'none';
  if (window.__shrinkViewer?.controls?.mouseButtons) window.__shrinkViewer.controls.mouseButtons.LEFT = 0;
  if (restoreHelp) window.__shrinkPaint?.setMode?.('navigate');
}

// ---- brushing ----
function pick(clientX, clientY) {
  const v = V(), root = A()?.originalModel; if (!v || !root) return null;
  const rect = v.renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
  raycaster.setFromCamera({ x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 }, v.camera);
  const h = raycaster.intersectObject(root, true).find(x => x.object.isMesh); if (!h) return null;
  const cam = v.camera, wpp = cam.isPerspectiveCamera ? 2 * h.distance * Math.tan((cam.fov * Math.PI / 360)) / rect.height : (cam.top - cam.bottom) / cam.zoom / rect.height;
  return { point: h.point, wpp, eye: [cam.position.x, cam.position.y, cam.position.z] };
}
function dab(x, y, alt) {
  const h = pick(x, y); if (!h || !st.data) return;
  const n = select(st.data, [h.point.x, h.point.y, h.point.z], st.size / 2 * h.wpp, { erase: st.erase || alt, eye: st.front ? h.eye : null });
  if (n) refresh(true);
}
function stroke(e) {
  const to = { x: e.clientX, y: e.clientY }, from = st.last || to, d = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(d / Math.max(4, st.size / 4)));
  for (let i = 1; i <= steps; i++) dab(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, e.altKey);
  st.last = to;
}
const rotating = e => e.metaKey || e.ctrlKey;
viewer?.addEventListener('pointerdown', e => {
  if (!st.on || st.busy || e.button !== 0 || rotating(e)) return;
  e.stopPropagation(); e.preventDefault(); st.down = true; st.last = null; stroke(e);
}, true);
viewer?.addEventListener('pointermove', e => {
  if (!st.on) return;
  const ring = $('rmRing');
  if (ring) { const r = viewer.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; ring.style.display = inside && !rotating(e) ? 'block' : 'none'; ring.style.left = (e.clientX - r.left) + 'px'; ring.style.top = (e.clientY - r.top) + 'px'; }
  if (st.down) { e.stopPropagation(); if ((e.buttons & 1) === 0) { st.down = false; refresh(); } else stroke(e); }
}, true);
const stop = e => { if (st.down) { st.down = false; st.last = null; refresh(); if (e?.stopPropagation && st.on) e.stopPropagation(); } };
viewer?.addEventListener('pointerup', stop, true); viewer?.addEventListener('pointercancel', stop, true);
window.addEventListener('pointerup', stop, true); window.addEventListener('pointercancel', stop, true);
window.addEventListener('blur', () => { st.down = false; });
// Cmd / Ctrl + drag rotates (OrbitControls treats modifier+left as pan when left is rotate, so swap while the key is held, as the paint tools do)
const orbitLeft = pan => { const c = V()?.controls; if (c?.mouseButtons) c.mouseButtons.LEFT = pan ? 2 : 0; };
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && st.on) { exit(); return; }
  if (st.on && (e.key === 'Meta' || e.key === 'Control')) { viewer.classList.add('modifier-rotate'); orbitLeft(true); st.down = false; }
}, true);
window.addEventListener('keyup', e => { if (st.on && (e.key === 'Meta' || e.key === 'Control')) { viewer.classList.remove('modifier-rotate'); orbitLeft(false); } }, true);

// ---- removing and undoing ----
async function swapIn(bytes, message) {
  await A().replaceSource(bytes);              // reloads the preview; the paint tool answers its texture-applied event by switching Paint on, so put it back
  window.__shrinkPaint?.setMode?.('navigate'); A().show('original');
  await load(); refresh(); say(message);
}
async function doRemove() {
  if (!st.data?.selected || st.busy) return; st.busy = true; counts();
  try {
    if (A().sourceBytes !== st.bytes) throw new Error('The model changed since you started brushing. Brush again.');
    say('Cutting the selection out…');
    const r = removeSelected(st.doc, st.data);
    await A().pruneDoc(st.doc);
    const bytes = await A().writeDoc(st.doc), prev = st.bytes;
    st.undo.push(prev); if (st.undo.length > 5) st.undo.shift();
    await swapIn(bytes, `Removed ${r.removed.toLocaleString()} triangles (${r.remaining.toLocaleString()} left). Press Optimise to build the file. Undo remove puts them back.`);
  } catch (err) { console.error(err); say(`Could not remove that: ${err.message}`, true); try { await load(); } catch {} refresh(); }
  finally { st.busy = false; counts(); }
}
async function doUndo() {
  if (!st.undo.length || st.busy) return; st.busy = true; counts();
  try { await swapIn(st.undo.pop(), 'Put the last removed part back.'); }
  catch (err) { console.error(err); say(`Could not undo: ${err.message}`, true); }
  finally { st.busy = false; counts(); }
}

window.addEventListener('shrink:paint-mode', e => { if (st.on && !st.busy && e.detail?.mode !== 'navigate') exit(false); });
window.addEventListener('shrink:model-opened', () => { st.undo = []; st.data = null; st.doc = null; st.bytes = null; if (st.on) exit(false); if ($('rmCount')) counts(); });
window.__shrinkRemove = { get active() { return st.on; }, enter, exit, get selected() { return st.data?.selected || 0; } };

if (!buildUI()) { const t = setInterval(() => { if (buildUI()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 20000); }
