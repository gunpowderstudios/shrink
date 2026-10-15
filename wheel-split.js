// SHRINK 3D v2.90 — "Separate the wheels" panel (Game mode). The cutting is in wheel-split-core.js; this is the switch and the message. The live preview keeps showing the reduced model; the split exists in the saved GLB only.
import { splitWheels } from './wheel-split-core.js?v=2.104';

const $ = id => document.getElementById(id);
function fresh(layout) { return { layout: layout || '4', shiftFront: 0, shiftRear: 0, track: 0, front: 0, rear: 0, dyFront: 0, dyRear: 0, dyW: { Wheel_FL: 0, Wheel_FR: 0, Wheel_RL: 0, Wheel_RR: 0, Wheel_F: 0 }, size: 1, widthFront: 1, widthRear: 1 }; }
const api = window.__shrinkWheels = { enabled: true, last: null, adj: fresh() };

// Called by app.js on the document that is about to be saved. Never throws: a failure leaves the model as it was.
api.apply = function (doc) {
  api.last = null;
  try {
    const r = splitWheels(doc, JSON.parse(JSON.stringify(api.adj))); api.last = r; report(r);
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
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: colours[w.name.slice(-2)] || 0xff4040, transparent: true, opacity: 0.5 }));
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
    c[lead] += r.frontSign * ((a[w.role] || 0) - (a0[w.role] || 0)) * rad; const dyk = w.role === 'front' ? 'dyFront' : 'dyRear';
    c[1] += (((a[dyk] || 0) - (a0[dyk] || 0)) + ((a.dyW?.[w.name] || 0) - (a0.dyW?.[w.name] || 0))) * rad;
    const sk = w.role === 'front' ? 'shiftFront' : 'shiftRear', wide = r.axle === 'z' ? 2 : 0, wsign = r.axle === 'z' ? 1 : -1;
    c[wide] += wsign * (r.frontSign * ((a[sk] || 0) - (a0[sk] || 0)) + (w.single ? 0 : w.sz * ((a.track || 0) - (a0.track || 0)))) * rad;
    const wk = w.role === 'front' ? 'widthFront' : 'widthRear', Wd = w.width * (a[wk] || 1) / (a0[wk] || 1) * 1.1, R = rad * a.size;
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
  const d = document.createElement('details'); d.id = 'wheelDetails'; d.className = 'fold game-only'; d.open = true;
  d.innerHTML = `<summary>Car wheels</summary><div class="fold-inner">
    <label class="check"><input id="wheelSplit" type="checkbox" checked> Separate the wheels</label>
    <div class="control-block compact"><label for="wheelLayout">Wheel layout</label><select id="wheelLayout"><option value="4">4 wheels (two axles)</option><option value="3">3 wheels (one at the front, two at the back)</option><option value="auto">Auto (try 4, then 3)</option></select></div>
    <div class="hint">Cuts the wheels out as their own parts (Wheel_FL/FR/RL/RR, or Wheel_F + Wheel_RL/RR on a three-wheeler), each pivoting on its own centre, so a game can spin and steer them. The car must sit on its wheels. The preview looks the same; the wheels are separate in the saved file.</div>
    <details id="wheelAdjust" class="fold tiny"><summary>Adjust wheels (only if the markers look wrong)</summary><div class="fold-inner">
      <div class="range-heading"><label for="wheelFront">Front wheels forward / back</label><output id="wheelFrontV">0</output></div><input id="wheelFront" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelRear">Rear wheels forward / back</label><output id="wheelRearV">0</output></div><input id="wheelRear" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelShiftFront">Front wheels left / right</label><output id="wheelShiftFrontV">0</output></div><input id="wheelShiftFront" type="range" min="-150" max="150" step="1" value="0">
      <div class="range-heading"><label for="wheelShiftRear">Rear wheels left / right</label><output id="wheelShiftRearV">0</output></div><input id="wheelShiftRear" type="range" min="-150" max="150" step="1" value="0">
      <div class="range-heading"><label for="wheelTrack">Wheels in / out (wider or narrower track)</label><output id="wheelTrackV">0</output></div><input id="wheelTrack" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelDyFront">Front wheels up / down</label><output id="wheelDyFrontV">0</output></div><input id="wheelDyFront" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelDyRear">Rear wheels up / down</label><output id="wheelDyRearV">0</output></div><input id="wheelDyRear" type="range" min="-100" max="100" step="1" value="0">
      <div class="range-heading"><label for="wheelWidthFront">Front wheel width</label><output id="wheelWidthFrontV">100%</output></div><input id="wheelWidthFront" type="range" min="40" max="160" step="1" value="100">
      <div class="range-heading"><label for="wheelWidthRear">Rear wheel width</label><output id="wheelWidthRearV">100%</output></div><input id="wheelWidthRear" type="range" min="40" max="160" step="1" value="100">
      <div class="range-heading"><label for="wheelSize">Wheel size</label><output id="wheelSizeV">100%</output></div><input id="wheelSize" type="range" min="50" max="150" step="1" value="100">
      <details class="fold tiny"><summary>Each wheel up / down</summary><div class="fold-inner">
        <div id="wheelDy4"><div class="range-heading"><label for="wheelDyFL">Front left</label><output id="wheelDyFLV">0</output></div><input id="wheelDyFL" type="range" min="-100" max="100" step="1" value="0">
        <div class="range-heading"><label for="wheelDyFR">Front right</label><output id="wheelDyFRV">0</output></div><input id="wheelDyFR" type="range" min="-100" max="100" step="1" value="0"></div>
        <div id="wheelDy3" hidden><div class="range-heading"><label for="wheelDyF">Front wheel (single)</label><output id="wheelDyFV">0</output></div><input id="wheelDyF" type="range" min="-100" max="100" step="1" value="0"></div>
        <div class="range-heading"><label for="wheelDyRL">Rear left</label><output id="wheelDyRLV">0</output></div><input id="wheelDyRL" type="range" min="-100" max="100" step="1" value="0">
        <div class="range-heading"><label for="wheelDyRR">Rear right</label><output id="wheelDyRRV">0</output></div><input id="wheelDyRR" type="range" min="-100" max="100" step="1" value="0">
      </div></details>
      <div class="hint">Move the sliders until the markers sit on the wheels, then press Optimise again. 100 = one tyre radius. Markers hidden by the car are depth-tested, so turn the car to check the far side.</div>
      <div class="material-presets"><button id="wheelMarkers" class="button ghost small" type="button">Show wheel markers</button><button id="wheelAdjReset" class="button ghost small" type="button">Reset adjustments</button></div></div></details>
    <div id="wheelSplitNote" class="hint"></div></div>`;
  host.insertBefore(d, before);
  $('wheelSplit').addEventListener('change', e => { api.enabled = e.target.checked; if (!api.enabled) { clearMarkers(); report(null); } });
  const bind = (id, key, scale, label) => $(id).addEventListener('input', e => { const v = Number(e.target.value); api.adj[key] = v / scale; $(id + 'V').textContent = label(v); placeMarkers(); });
  bind('wheelFront', 'front', 100, v => String(v)); bind('wheelShiftFront', 'shiftFront', 100, v => String(v)); bind('wheelShiftRear', 'shiftRear', 100, v => String(v)); bind('wheelTrack', 'track', 100, v => String(v)); bind('wheelRear', 'rear', 100, v => String(v)); bind('wheelDyFront', 'dyFront', 100, v => String(v)); bind('wheelDyRear', 'dyRear', 100, v => String(v)); bind('wheelSize', 'size', 100, v => v + '%'); bind('wheelWidthFront', 'widthFront', 100, v => v + '%'); bind('wheelWidthRear', 'widthRear', 100, v => v + '%');
  for (const k of ['FL', 'FR', 'RL', 'RR', 'F']) $('wheelDy' + k).addEventListener('input', e => { const v = Number(e.target.value); api.adj.dyW['Wheel_' + k] = v / 100; $('wheelDy' + k + 'V').textContent = String(v); placeMarkers(); });
  $('wheelAdjReset').addEventListener('click', () => { api.adj = fresh(api.adj.layout); for (const id of ['wheelFront', 'wheelRear', 'wheelShiftFront', 'wheelShiftRear', 'wheelTrack', 'wheelDyFront', 'wheelDyRear', 'wheelDyFL', 'wheelDyFR', 'wheelDyRL', 'wheelDyRR', 'wheelDyF', 'wheelSize', 'wheelWidthFront', 'wheelWidthRear']) { const e = $(id); e.value = /Size|Width/.test(id) ? 100 : 0; e.dispatchEvent(new Event('input')); } });
  $('wheelLayout').addEventListener('change', e => { api.adj.layout = e.target.value; const three = e.target.value === '3'; $('wheelDy4').hidden = three; $('wheelDy3').hidden = !three; });
  $('wheelMarkers').addEventListener('click', () => { if (markers.length) clearMarkers(); else if (api.last?.found) showMarkers(api.last); else $('wheelSplitNote').textContent = 'Press Optimise with “Separate the wheels” ticked first.'; });
  return true;
}
document.addEventListener('shrink:model-opened', () => { clearMarkers(); api.last = null; report(null); });
if (!inject()) { const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
