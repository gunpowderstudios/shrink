// SHRINK 3D v2.90 — "Separate the wheels" panel (Game mode). The cutting is in wheel-split-core.js; this is the switch and the message. The live preview keeps showing the reduced model; the split exists in the saved GLB only.
import { splitWheels } from './wheel-split-core.js?v=2.93';

const $ = id => document.getElementById(id);
const api = window.__shrinkWheels = { enabled: false, last: null, adj: { front: 0, rear: 0, dy: 0, size: 1 } };

// Called by app.js on the document that is about to be saved. Never throws: a failure leaves the model as it was.
api.apply = function (doc) {
  api.last = null;
  try {
    const r = splitWheels(doc, { ...api.adj }); api.last = r; report(r);
    return r;
  } catch (err) { console.error(err); api.last = { found: false, reason: err.message }; report(api.last); return api.last; }
};

function text(r) {
  if (!r) return '';
  if (!r.found) return `No wheels separated: ${r.reason} The model was saved as it is.`;
  if (r.partial) return `Only ${r.wheels.length} wheel(s) separated (${r.wheels.map(w => w.name).join(', ')}). Check the result.`;
  return `✔ Wheels separated! ${r.wheels.map(w => `${w.name} (${w.triangles} triangles)`).join(', ')}. Tyre radius ${r.radius.toFixed(3)}, width ${r.width.toFixed(3)}; they turn around the ${r.axle.toUpperCase()} axis.`;
}
api.message = () => text(api.last);

// Coloured discs in the viewer at the detected wheel positions, so you can see what was found. They are only for looking: never saved.
let markers = [];
function clearMarkers() {
  const V = window.__shrinkViewer; for (const m of markers) { V?.scene?.remove(m); m.geometry.dispose(); m.material.dispose(); } markers = [];
  const b = $('wheelMarkers'); if (b) b.textContent = 'Show wheel markers';
}
function showMarkers(r) {
  clearMarkers(); const A = window.__shrinkApp, V = window.__shrinkViewer, T = A?.THREE;
  if (!r?.found || !T || !V?.scene) return;
  const colours = { FL: 0xff4040, FR: 0x40c0ff, RL: 0xffb020, RR: 0x50e070 };
  for (const w of r.wheels) {
    const g = new T.CylinderGeometry(1, 1, 1, 32);
    if (r.axle === 'z') g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2);
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: colours[w.name.slice(-2)], transparent: true, opacity: 0.5 }));
    m.userData.w = w; V.scene.add(m); markers.push(m);
  }
  placeMarkers(); const b = $('wheelMarkers'); if (b) b.textContent = 'Hide wheel markers';
}
// Markers follow the sliders live: the last result was made with adj0, so only the difference is applied here.
function placeMarkers() {
  const r = api.last; if (!r?.found || !markers.length) return; const a0 = r.adj || {}, a = api.adj;
  const lead = r.lengthAxis === 'z' ? 2 : 0;
  for (const m of markers) {
    const w = m.userData.w, c = [...w.centre], rad = r.radius / ((a0.size > 0) ? a0.size : 1);
    c[lead] += r.frontSign * ((a[w.role] || 0) - (a0[w.role] || 0)) * rad; c[1] += ((a.dy || 0) - (a0.dy || 0)) * rad;
    const R = rad * a.size, Wd = r.width * 1.1;
    m.position.set(c[0], c[1], c[2]);
    if (r.axle === 'z') m.scale.set(R, R, Wd); else m.scale.set(Wd, R, R);
  }
}

function report(r) {
  const el = $('wheelSplitNote'); if (el) el.textContent = text(r);
  const d = $('wheelDetails'); if (d && r) d.open = true;
}
window.addEventListener('shrink:optimized', () => { if (api.enabled && api.last) { report(api.last); showMarkers(api.last); } });

function inject() {
  if ($('wheelDetails')) return true;
  const host = $('stepExtra'), before = $('retouchDetails'); if (!host || !before) return false;
  const d = document.createElement('details'); d.id = 'wheelDetails'; d.className = 'fold game-only';
  d.innerHTML = `<summary>Car wheels</summary><div class="fold-inner">
    <label class="check"><input id="wheelSplit" type="checkbox"> Separate the wheels</label>
    <div class="hint">Cuts the four wheels out as their own parts (Wheel_FL/FR/RL/RR), each pivoting on its own centre, so a game can spin and steer them. The car must sit on its wheels. The preview looks the same; the wheels are separate in the saved file.</div>
    <details id="wheelAdjust" class="fold tiny"><summary>Adjust wheels (only if the markers look wrong)</summary><div class="fold-inner">
      <div class="range-heading"><label for="wheelFront">Front wheels forward / back</label><output id="wheelFrontV">0</output></div><input id="wheelFront" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelRear">Rear wheels forward / back</label><output id="wheelRearV">0</output></div><input id="wheelRear" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelDy">All wheels up / down</label><output id="wheelDyV">0</output></div><input id="wheelDy" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelSize">Wheel size</label><output id="wheelSizeV">100%</output></div><input id="wheelSize" type="range" min="70" max="130" step="1" value="100">
      <div class="hint">Move the sliders until the markers sit on the wheels, then press Optimise again. 100 = one tyre radius. Markers hidden by the car are depth-tested, so turn the car to check the far side.</div>
      <div class="material-presets"><button id="wheelMarkers" class="button ghost small" type="button">Show wheel markers</button><button id="wheelAdjReset" class="button ghost small" type="button">Reset adjustments</button></div></div></details>
    <div id="wheelSplitNote" class="hint"></div></div>`;
  host.insertBefore(d, before);
  $('wheelSplit').addEventListener('change', e => { api.enabled = e.target.checked; if (!api.enabled) { clearMarkers(); report(null); } });
  const bind = (id, key, scale, label) => $(id).addEventListener('input', e => { const v = Number(e.target.value); api.adj[key] = v / scale; $(id + 'V').textContent = label(v); placeMarkers(); });
  bind('wheelFront', 'front', 100, v => String(v)); bind('wheelRear', 'rear', 100, v => String(v)); bind('wheelDy', 'dy', 100, v => String(v)); bind('wheelSize', 'size', 100, v => v + '%');
  $('wheelAdjReset').addEventListener('click', () => { api.adj = { front: 0, rear: 0, dy: 0, size: 1 }; for (const [id, v] of [['wheelFront', 0], ['wheelRear', 0], ['wheelDy', 0], ['wheelSize', 100]]) { $(id).value = v; $(id).dispatchEvent(new Event('input')); } });
  $('wheelMarkers').addEventListener('click', () => { if (markers.length) clearMarkers(); else if (api.last?.found) showMarkers(api.last); else $('wheelSplitNote').textContent = 'Press Optimise with “Separate the wheels” ticked first.'; });
  return true;
}
document.addEventListener('shrink:model-opened', () => { clearMarkers(); api.last = null; report(null); });
if (!inject()) { const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
