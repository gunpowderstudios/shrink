// SHRINK 3D v2.90 — "Separate the wheels" panel (Game mode). The cutting is in wheel-split-core.js; this is the switch and the message. The live preview keeps showing the reduced model; the split exists in the saved GLB only.
import { splitWheels } from './wheel-split-core.js?v=2.91';

const $ = id => document.getElementById(id);
const api = window.__shrinkWheels = { enabled: false, last: null };

// Called by app.js on the document that is about to be saved. Never throws: a failure leaves the model as it was.
api.apply = function (doc) {
  api.last = null;
  try {
    const r = splitWheels(doc); api.last = r; report(r);
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
    const g = new T.CylinderGeometry(r.radius * 1.02, r.radius * 1.02, r.width * 1.1, 32);
    if (r.axle === 'z') g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2);
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: colours[w.name.slice(-2)], transparent: true, opacity: 0.55, depthTest: false }));
    m.position.set(...w.centre); m.renderOrder = 999; V.scene.add(m); markers.push(m);
  }
  const b = $('wheelMarkers'); if (b) b.textContent = 'Hide wheel markers';
}

function report(r) {
  const el = $('wheelSplitNote'); if (el) el.textContent = text(r);
  const d = $('wheelDetails'); if (d && r) d.open = true;
  const c = $('wheelResult'); if (c) { c.textContent = r ? text(r) : ''; c.hidden = !r; c.classList.toggle('error', !!r && !r.found); }
}
window.addEventListener('shrink:optimized', () => { if (api.enabled && api.last) { report(api.last); showMarkers(api.last); } });

function inject() {
  if ($('wheelDetails')) return true;
  const host = $('stepExtra'), before = $('retouchDetails'); if (!host || !before) return false;
  const d = document.createElement('details'); d.id = 'wheelDetails'; d.className = 'fold game-only';
  d.innerHTML = `<summary>Car wheels</summary><div class="fold-inner">
    <label class="check"><input id="wheelSplit" type="checkbox"> Separate the wheels</label>
    <div class="hint">For car models: when you press Optimize, the four wheels are cut out as their own parts (Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR), each pivoting around its own centre so a game can spin and steer them. Everything else stays exactly as it is. The car must sit on its wheels. The preview looks the same; the wheels are separate in the saved file.</div>
    <div class="material-presets"><button id="wheelMarkers" class="button ghost small" type="button">Show wheel markers</button></div>
    <div id="wheelSplitNote" class="hint"></div></div>`;
  host.insertBefore(d, before);
  $('wheelSplit').addEventListener('change', e => { api.enabled = e.target.checked; if (!api.enabled) { clearMarkers(); report(null); } });
  $('wheelMarkers').addEventListener('click', () => { if (markers.length) clearMarkers(); else if (api.last?.found) showMarkers(api.last); else $('wheelSplitNote').textContent = 'Press Optimize with “Separate the wheels” ticked first.'; });
  // a visible result line under the Optimize results, where you are already looking
  const rc = $('resultCard'); if (rc && !$('wheelResult')) { const p = document.createElement('div'); p.id = 'wheelResult'; p.hidden = true; p.style.cssText = 'margin:8px 0;padding:8px 10px;border-radius:8px;background:rgba(80,224,112,.15);font-size:13px'; rc.appendChild(p); }
  return true;
}
document.addEventListener('shrink:model-opened', () => { clearMarkers(); api.last = null; report(null); });
if (!inject()) { const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
