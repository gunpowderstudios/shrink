// SHRINK 3D v2.90 — "Separate the wheels" panel (Game mode). The cutting is in wheel-split-core.js; this is the switch and the message. The live preview keeps showing the reduced model; the split exists in the saved GLB only.
import { splitWheels } from './wheel-split-core.js?v=2.90';

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

function report(r) {
  const el = $('wheelSplitNote'); if (!el) return;
  if (!r) { el.textContent = ''; return; }
  if (!r.found) el.textContent = `No wheels separated: ${r.reason} The model was saved as it is.`;
  else if (r.partial) el.textContent = `Only ${r.wheels.length} wheel(s) could be cut out (${r.wheels.map(w => w.name).join(', ')}). Check the result.`;
  else el.textContent = `Wheels separated: ${r.wheels.map(w => w.name).join(', ')}. Tyre radius ${r.radius.toFixed(3)}, width ${r.width.toFixed(3)} (model units); wheels turn around the ${r.axle.toUpperCase()} axis.`;
}

function inject() {
  if ($('wheelDetails')) return true;
  const host = $('stepExtra'), before = $('retouchDetails'); if (!host || !before) return false;
  const d = document.createElement('details'); d.id = 'wheelDetails'; d.className = 'fold game-only';
  d.innerHTML = `<summary>Car wheels</summary><div class="fold-inner">
    <label class="check"><input id="wheelSplit" type="checkbox"> Separate the wheels</label>
    <div class="hint">For car models: when you press Optimize, the four wheels are cut out as their own parts (Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR), each pivoting around its own centre so a game can spin and steer them. Everything else stays exactly as it is. The car must sit on its wheels. The preview looks the same; the wheels are separate in the saved file.</div>
    <div id="wheelSplitNote" class="hint"></div></div>`;
  host.insertBefore(d, before);
  $('wheelSplit').addEventListener('change', e => { api.enabled = e.target.checked; });
  return true;
}
document.addEventListener('shrink:model-opened', () => report(null));
if (!inject()) { const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
