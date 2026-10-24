// SHRINK 3D v2.139 — Add part (Game mode). "Add part…" in the viewer toolbar: pick another .glb (a separate wheel, say), place it on the car with the move / turn / size
// gizmo, make copies (a mirrored copy for the other side), then "Add to car" merges it into the model under its own node. The merge goes through the source GLB
// (like the Remove brush), so Optimise and the download use it. The placement maths is in the page; the merge itself is add-part-core.js (tested in Node).
import { TransformControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/TransformControls.js';

const $ = id => document.getElementById(id);
const A = () => window.__shrinkApp, V = () => window.__shrinkViewer;
const viewer = $('viewer');
const st = { on: false, busy: false, lib: new Map(), bases: new Map(), parts: [], cur: null, gizmo: null, mode: 'translate', sizePrev: 100, down: null, carBox: null };
const say = (t, bad) => { const s = $('status'); if (s) { s.textContent = t; s.classList.toggle('error', !!bad); } };

function buildUI() {
  const controls = document.querySelector('.model-paint-controls'), toolbar = document.querySelector('.viewer-toolbar');
  if (!controls || !toolbar || $('addPartBtn')) return !!$('addPartBtn');
  const btn = document.createElement('button'); btn.id = 'addPartBtn'; btn.type = 'button'; btn.className = 'button ghost small model-paint-button game-only'; btn.textContent = 'Add part';
  btn.title = 'Add another model (a separate wheel .glb, say) to the car, then move, turn and size it into place';
  controls.insertBefore(btn, $('undo3DBtn') || null);
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.glb,model/gltf-binary'; file.hidden = true; file.id = 'addPartFile'; document.body.appendChild(file);
  const bar = document.createElement('div'); bar.id = 'partBar'; bar.className = 'tool-options game-only'; bar.hidden = true;
  bar.innerHTML = `<span class="ap-group"><button id="apMove" class="button ghost small active" type="button">Move</button><button id="apRotate" class="button ghost small" type="button">Rotate</button><button id="apScale" class="button ghost small" type="button">Scale</button></span>
    <label>Size <input id="apSize" type="range" min="20" max="300" step="1" value="100" aria-label="Size"><output id="apSizeV">100%</output></label>
    <span class="ap-group" title="Turn the part a quarter turn about the car's axes"><button id="apX" class="button ghost small" type="button">Turn X 90°</button><button id="apY" class="button ghost small" type="button">Y 90°</button><button id="apZ" class="button ghost small" type="button">Z 90°</button></span>
    <span class="ap-group"><button id="apCopy" class="button ghost small" type="button">Copy</button><button id="apMirror" class="button ghost small" type="button" title="A copy placed on the other side of the car, mirrored">Mirror copy</button><button id="apFlip" class="button ghost small" type="button" title="Turn the selected part round (180° about the upright axis) so its other face points outwards; it stays where it is">Flip</button><button id="apDelete" class="button ghost small" type="button">Delete</button></span>
    <label title="The node name the part gets in the saved file (a game can spin Wheel_FL etc.)">Name <select id="apName"><option value="">Part name</option><option>Wheel_FL</option><option>Wheel_FR</option><option>Wheel_RL</option><option>Wheel_RR</option></select></label>
    <span id="apCount" class="rm-count">No part yet</span>
    <button id="apEdit" class="button ghost small" type="button" hidden title="Pick the parts you added earlier up again, so you can move, flip or copy them">Edit added parts</button>
    <button id="apUndo" class="button ghost small" type="button" disabled title="Take back the last part added to the car">Undo last add</button>
    <button id="apGo" class="button small rm-go" type="button" disabled>Add to car</button>
    <button id="apCancel" class="button ghost small" type="button" style="margin-left:auto">Cancel</button>`;
  toolbar.insertAdjacentElement('afterend', bar);
  const css = document.createElement('style');
  css.textContent = '.ap-group{display:inline-flex;gap:4px}.ap-after>:not(#apUndo):not(#apCancel):not(#apEdit){display:none!important}.ap-group .button.active{border-color:#7dbdff!important;background:#1d3a5a!important;color:#fff!important}';
  document.head.appendChild(css);
  btn.addEventListener('click', () => { if (st.on) cancel(); else { cancel(); file.click(); } });
  file.addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(f); });
  for (const [id, m] of [['apMove', 'translate'], ['apRotate', 'rotate'], ['apScale', 'scale']]) $(id).addEventListener('click', () => setMode(m));
  $('apSize').addEventListener('input', e => { const v = Number(e.target.value); $('apSizeV').textContent = v + '%'; if (st.cur) st.cur.scale.multiplyScalar(v / st.sizePrev); st.sizePrev = v; });
  for (const [id, axis] of [['apX', 'x'], ['apY', 'y'], ['apZ', 'z']]) $(id).addEventListener('click', () => { if (st.cur) st.cur['rotate' + axis.toUpperCase()](Math.PI / 2); });
  $('apCopy').addEventListener('click', () => copy(false)); $('apMirror').addEventListener('click', () => copy(true)); $('apFlip').addEventListener('click', flip); $('apName').addEventListener('change', e => { if (st.cur) { st.cur.userData.nodeName = e.target.value || ''; counts(); } }); $('apEdit').addEventListener('click', editAdded); $('apDelete').addEventListener('click', del);
  $('apGo').addEventListener('click', commit); $('apCancel').addEventListener('click', () => cancel()); $('apUndo').addEventListener('click', () => window.__shrinkRemove?.undo?.());
  return true;
}

function setMode(m) {
  st.mode = m; st.gizmo?.setMode(m);
  for (const [id, mm] of [['apMove', 'translate'], ['apRotate', 'rotate'], ['apScale', 'scale']]) $(id).classList.toggle('active', mm === m);
}
function counts() {
  const n = st.parts.length;
  const names = st.parts.map(p => p.userData.nodeName).filter(Boolean);
  $('apCount').textContent = n ? `${n} part${n > 1 ? 's' : ''} placed${names.length ? ' (' + names.join(', ') + ')' : ''}; click one to select it` : 'No part yet';
  $('apGo').disabled = !n || st.busy; $('apUndo').disabled = st.busy;
}
function select(root) { st.cur = root; if ($('apName')) $('apName').value = root?.userData.nodeName || ''; if (root) { st.gizmo.attach(root); st.sizePrev = 100; $('apSize').value = 100; $('apSizeV').textContent = '100%'; } else st.gizmo.detach(); }

async function loadBase(key) {
  if (st.bases.has(key)) return st.bases.get(key);
  const url = URL.createObjectURL(new Blob([st.lib.get(key).bytes], { type: 'model/gltf-binary' }));
  try { const m = await A().loadScene(url); st.bases.set(key, m); return m; } finally { URL.revokeObjectURL(url); }
}
function ghostFrom(key, base) { const g = new (A().THREE.Group)(); g.add(base.clone(true)); g.userData.lib = key; return g; }

// the gizmo, the bar and the car's size, shared by a new part and by "Edit added parts"
function openSession() {
  const app = A(), T = app.THREE, v = V();
  window.__shrinkRemove?.exit?.(); window.__shrinkPaint?.setMode?.('navigate'); app.show('original');
  const car = new T.Box3().setFromObject(app.originalModel);
  st.carBox = { min: car.min.clone(), max: car.max.clone(), centre: car.getCenter(new T.Vector3()), size: car.getSize(new T.Vector3()) };
  st.gizmo = new TransformControls(v.camera, v.renderer.domElement); st.gizmo.setSize(0.9);
  st.gizmo.addEventListener('dragging-changed', e => { v.controls.enabled = !e.value; });
  v.scene.add(st.gizmo.getHelper());
  st.on = true; st.parts = []; $('partBar').classList.remove('ap-after'); $('apCancel').textContent = 'Cancel'; $('partBar').hidden = false; $('addPartBtn').classList.add('active');
  const help = document.querySelector('.viewer-help'); if (help) help.textContent = 'ADD PART · drag the arrows to move · Rotate / Scale for the other gizmos · click a placed part to select it';
}
async function applyPaintFirst() {
  if (!window.__shrinkPaint?.hasEdits?.()) return;      // keep painted-on colour: write it into the model first
  say('Saving your paint into the model first…');
  await new Promise(res => { const done = () => { window.removeEventListener('shrink:texture-applied', done); res(); }; window.addEventListener('shrink:texture-applied', done); setTimeout(done, 30000); $('applyTextureBtn')?.click(); });
  window.__shrinkPaint?.setMode?.('navigate');
}

async function start(file) {
  const app = A(); if (!app?.sourceBytes) { say('Open a model first.', true); return; }
  if (st.busy || st.on) return; st.busy = true;
  try {
    await applyPaintFirst();
    say(`Loading ${file.name}…`);
    const stem = file.name.replace(/\.[^.]+$/, '') || 'part', key = stem + '@' + Date.now();
    st.lib.set(key, { stem, bytes: new Uint8Array(await file.arrayBuffer()) });
    const base = await loadBase(key);
    openSession();
    const T = app.THREE, cs = st.carBox.size;
    // the first copy: scaled to about a fifth of the car, put in the middle of it
    const pb = new T.Box3().setFromObject(base), ps = pb.getSize(new T.Vector3()), pc = pb.getCenter(new T.Vector3());
    const s = 0.2 * Math.max(cs.x, cs.y, cs.z) / (Math.max(ps.x, ps.y, ps.z) || 1);
    const root = ghostFrom(key, base); root.scale.setScalar(s); root.position.copy(st.carBox.centre).sub(pc.multiplyScalar(s));
    root.userData.nodeName = 'Wheel_FL'; V().scene.add(root); st.parts = [root]; select(root); setMode('translate'); counts();
    say(`${file.name} is in the middle of the car. Move, turn and size it into place (Copy / Mirror copy for the other wheels), then press “Add to car”.`);
  } catch (err) { console.error(err); say(`Could not open that part: ${err.message}`, true); cleanup(); }
  finally { st.busy = false; if (st.on) counts(); }
}

// pick the parts added earlier in this session out of the model again and show them as movable ghosts
async function editAdded() {
  const app = A(); if (st.busy || st.on || !app?.sourceBytes) return; st.busy = true;
  try {
    await applyPaintFirst();
    const doc = await app.readDoc(), scene = doc.getRoot().listScenes()[0], found = [];
    for (const n of scene.listChildren()) {
      const key = n.getExtras()?.shrinkPart;
      if (key && st.lib.has(key)) found.push({ name: n.getName(), key, t: n.getTranslation(), r: n.getRotation(), sc: n.getScale(), node: n });
    }
    if (!found.length) { say('There are no parts from this session to edit. (A part added before the project was reopened is part of the model now: Add part again.)', true); return; }
    say('Picking the added parts up again…');
    const prev = app.sourceBytes, kill = n => { n.listChildren().forEach(kill); n.dispose(); };
    found.forEach(f => kill(f.node));
    await app.pruneDoc(doc);
    await app.replaceSource(await app.writeDoc(doc));
    window.__shrinkRemove?.noteChange?.(prev);
    window.__shrinkPaint?.setMode?.('navigate');
    openSession(); st.editing = true;
    for (const f of found) {
      const g = ghostFrom(f.key, await loadBase(f.key)); g.position.fromArray(f.t); g.quaternion.fromArray(f.r); g.scale.fromArray(f.sc); g.userData.nodeName = f.name;
      V().scene.add(g); st.parts.push(g);
    }
    select(st.parts[st.parts.length - 1]); setMode('translate'); counts();
    say(`${found.length} added part${found.length > 1 ? 's' : ''} picked up. Move, flip or copy them, then press “Add to car”.`);
  } catch (err) { console.error(err); say(`Could not pick the parts up: ${err.message}`, true); cleanup(); }
  finally { st.busy = false; if (st.on) counts(); }
}

function flip() {
  if (!st.cur) return;
  const T = A().THREE; st.cur.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI));
}

function copy(mirror) {
  if (!st.cur) return;
  const T = A().THREE, c = st.cur.clone(true); c.userData.lib = st.cur.userData.lib;
  const WN = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'], cn = st.cur.userData.nodeName, used = new Set(st.parts.map(p => p.userData.nodeName));
  if (WN.includes(cn)) { const pair = { Wheel_FL: 'Wheel_FR', Wheel_FR: 'Wheel_FL', Wheel_RL: 'Wheel_RR', Wheel_RR: 'Wheel_RL' }[cn]; c.userData.nodeName = [mirror ? pair : null, ...WN].find(x => x && !used.has(x)) || ''; } else c.userData.nodeName = '';
  if (mirror && st.carBox) {
    // reflect across the car's middle plane (the plane across its narrower horizontal side): position mirrored, turn conjugated, size flipped on that axis
    const w = st.carBox.size.x < st.carBox.size.z ? 'x' : 'z', mid = st.carBox.centre[w];
    c.position[w] = 2 * mid - st.cur.position[w];
    const q = st.cur.quaternion; const keep = w === 'x' ? [1, -1, -1] : [-1, -1, 1];
    c.quaternion.set(q.x * keep[0], q.y * keep[1], q.z * keep[2], q.w);
    c.scale[w] = -st.cur.scale[w];
  } else c.position.x += 0.05 * (st.carBox?.size.x || 1);
  V().scene.add(c); st.parts.push(c); select(c); counts();
}
function del() {
  if (!st.cur) return;
  V().scene.remove(st.cur); st.parts = st.parts.filter(p => p !== st.cur); select(st.parts[st.parts.length - 1] || null); counts();
}

// click a placed part to select it (a quick click, not a gizmo drag)
viewer?.addEventListener('pointerdown', e => { st.down = st.on ? { x: e.clientX, y: e.clientY } : null; }, true);
viewer?.addEventListener('pointerup', e => {
  if (!st.on || !st.down || st.gizmo?.dragging) { st.down = null; return; }
  const moved = Math.hypot(e.clientX - st.down.x, e.clientY - st.down.y); st.down = null; if (moved > 4) return;
  const v = V(), rect = v.renderer.domElement.getBoundingClientRect(), T = A().THREE, rc = new T.Raycaster();
  rc.setFromCamera({ x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 }, v.camera);
  const hit = rc.intersectObjects(st.parts, true)[0]; if (!hit) return;
  let o = hit.object; while (o && !st.parts.includes(o)) o = o.parent; if (o && o !== st.cur) select(o);
}, true);

function cleanup() {
  const v = V();
  for (const p of st.parts) v?.scene.remove(p);
  if (st.gizmo) { v?.scene.remove(st.gizmo.getHelper()); st.gizmo.detach(); st.gizmo.dispose(); if (v) v.controls.enabled = true; }
  Object.assign(st, { on: false, parts: [], cur: null, gizmo: null, editing: false });
  if ($('partBar')) { $('partBar').hidden = true; $('partBar').classList.remove('ap-after'); $('apCancel').textContent = 'Cancel'; }
  $('addPartBtn')?.classList.remove('active');
}
function cancel(keepModel) {
  const bar = $('partBar');
  if (!st.on) { if (bar && !bar.hidden) { bar.hidden = true; bar.classList.remove('ap-after'); } return; }
  const restore = st.editing && !keepModel; cleanup();
  window.__shrinkPaint?.setMode?.('navigate');
  if (restore) { say('Putting the added parts back…'); window.__shrinkRemove?.undo?.(); } else say('Add part cancelled.');
}

async function commit() {
  if (!st.on || !st.parts.length || st.busy) return; st.busy = true; counts();
  try {
    const given = st.parts.map(p => p.userData.nodeName).filter(Boolean), dup = given.find((x, i) => given.indexOf(x) !== i);
    if (dup) { say(`Two parts are named ${dup}. Give each part its own name (the Name box).`, true); return; }
    say('Adding the part to the car…');
    const app = A(), doc = await app.readDoc(), prev = app.sourceBytes, n = st.parts.length, docs = new Map(), seq = new Map();
    for (const p of st.parts) {
      const key = p.userData.lib, e = st.lib.get(key); if (!e) continue;
      if (!docs.has(key)) docs.set(key, await app.readPart(e.bytes));
      const i = (seq.get(key) || 0) + 1; seq.set(key, i);
      app.mergePart(doc, docs.get(key), { translation: p.position.toArray(), rotation: p.quaternion.toArray(), scale: p.scale.toArray() }, p.userData.nodeName || `${e.stem}_${i}`, { shrinkPart: key });
    }
    await app.pruneDoc(doc);
    const bytes = await app.writeDoc(doc);
    cleanup();
    await app.replaceSource(bytes);
    const bar = $('partBar'); bar.classList.add('ap-after'); bar.hidden = false; $('apUndo').disabled = false; $('apEdit').hidden = !st.lib.size; $('apCancel').textContent = 'Done';
    window.__shrinkRemove?.noteChange?.(prev);
    window.__shrinkPaint?.setMode?.('navigate'); app.show('original');
    say(`Added ${n} part${n > 1 ? 's' : ''} to the car. “Edit added parts” picks them up again; press Optimise to build the file.`);
  } catch (err) { console.error(err); say(`Could not add the part: ${err.message}`, true); }
  finally { st.busy = false; if (st.on) counts(); }
}

window.addEventListener('shrink:paint-mode', e => { if (st.on && !st.busy && e.detail?.mode !== 'navigate') cancel(); });
window.addEventListener('shrink:model-opened', () => { cancel(true); st.lib.clear(); st.bases.clear(); });
window.__shrinkAddPart = { get active() { return st.on; }, exit: () => cancel(), get placed() { return st.parts.length; } };
if (!buildUI()) { const t = setInterval(() => { if (buildUI()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 20000); }
