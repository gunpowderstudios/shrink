// SHRINK 3D v2.140 — "Racer" export preset (Game mode): the card, the panel and the export hook. The document work is racer-core.js (tested in Node).
import { apply, plan, TARGET_MB, FAIL_MB, ROLE_LABEL } from './racer-core.js?v=2.208';
import { applyGeometry, vertexReport, describeGeometry, GEO_DEFAULTS } from './racer-geometry-core.js?v=2.208';
import { compactPrimitive, getPrimitiveVertexCount } from '@gltf-transform/functions';

const $ = id => document.getElementById(id);
const A = () => window.__shrinkApp;
const active = () => document.querySelector('#targetCards .target-card.active')?.dataset.target === 'racer';
const st = { last: null, est: null, estFor: null, busy: 0, geo: null, bytes: 0 };
const FILE_MAX_MB = 2.5, FILE_TYPICAL_MB = 1.8;
const fmtMB = n => (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' MB';
const px = (w, h) => (w && h ? `${w}×${h}` : '?');

const geoOpts = () => ({ totalVerts: Math.max(20000, Number($('racerVerts')?.value) || GEO_DEFAULTS.totalVerts), wheelVerts: Math.max(2000, Number($('racerWheelVerts')?.value) || GEO_DEFAULTS.wheelVerts) });
function opts() {
  return { baseSize: 1024, mrSize: 1024, normalSize: 512, quality: Math.max(0.45, Math.min(0.95, Number($('textureQuality')?.value || 85) / 100)), merge: !!$('racerMerge')?.checked };
}

/* ---------- browser pixel work for racer-core ---------- */
const canvasFor = (w, h) => ('OffscreenCanvas' in window ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const ops = {
  async decode(bytes, mime, w, h) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = canvasFor(w, h), ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    return ctx.getImageData(0, 0, w, h).data;
  },
  async encode(rgba, w, h, quality) {
    const c = canvasFor(w, h), ctx = c.getContext('2d'); ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/webp', quality }) : await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Texture conversion failed.'))), 'image/webp', quality));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/webp' };
  },
  prune: doc => A().pruneDoc(doc),
  enableWebP: doc => A().enableWebP(doc),
};

/* ---------- panel ---------- */
function build() {
  const cards = $('targetCards'); if (!cards || $('racerPanel')) return !!$('racerPanel');
  const css = document.createElement('style');
  css.textContent = `#targetCards .target-card[data-target="racer"]{grid-column:1/-1;display:flex;align-items:center;gap:10px;text-align:left;padding-top:8px;padding-bottom:8px}
#targetCards .target-card[data-target="racer"] small{margin-left:auto;text-align:right}
.racer-panel{margin-top:8px;padding:8px 10px;border:1px solid var(--line,#2a3140);border-radius:10px;background:rgba(255,255,255,.03);font-size:12.5px;line-height:1.45}
.racer-panel .toggle-row{padding:3px 0}
.racer-gpu{font-weight:800;padding:6px 8px;border-radius:8px;margin:6px 0}
.racer-gpu[data-level="ok"]{background:rgba(60,200,120,.14);color:#7ee2a8}.racer-gpu[data-level="warn"]{background:rgba(255,176,32,.14);color:#ffc65a}.racer-gpu[data-level="fail"]{background:rgba(255,75,75,.18);color:#ff8d8d}
.racer-gpu small{display:block;font-weight:500;opacity:.85}
.racer-warn{margin:4px 0;color:#ffc65a}.racer-warn.info{color:#9fb4d0}
.racer-panel table{width:100%;border-collapse:collapse;margin-top:4px}.racer-panel td{padding:2px 4px;border-top:1px solid rgba(255,255,255,.07);vertical-align:top}.racer-panel td:last-child{text-align:right;white-space:nowrap}
.racer-panel summary{cursor:pointer;margin-top:4px;font-weight:700}`;
  document.head.appendChild(css);
  const panel = document.createElement('div'); panel.id = 'racerPanel'; panel.className = 'racer-panel game-only'; panel.hidden = true;
  panel.innerHTML = `<label class="toggle-row" title="Most vertices the whole car may have. The wheels are taken out first, the rest is the body."><span>Whole car, vertices</span><input id="racerVerts" type="number" min="20000" max="300000" step="1000" value="80000" style="width:90px"></label>
    <label class="toggle-row" title="Vertices for each wheel (a round tyre and a clear rim need about 6,000 to 8,000)"><span>Each wheel, vertices</span><input id="racerWheelVerts" type="number" min="2000" max="30000" step="500" value="7000" style="width:90px"></label>
    <label class="toggle-row" title="If the model has several materials (the wheels often have their own textures), re-pack them into one atlas with one set of textures"><span>Merge into one texture set</span><input id="racerMerge" type="checkbox" checked></label>
    <div id="racerGpu" class="racer-gpu" data-level="none"></div><div id="racerGeo" class="racer-warn info"></div><div id="racerWarn"></div>
    <details id="racerList"><summary>Textures and what is dropped</summary><div id="racerDetail"></div></details>`;
  ($('budgetChip') || cards).insertAdjacentElement('afterend', panel);
  cards.addEventListener('click', () => setTimeout(refresh, 0));
  for (const id of ['racerMerge']) $(id).addEventListener('change', () => { st.last = null; refresh(); });
  $('textureQuality')?.addEventListener('change', () => refresh());
  return true;
}

function render(rep, built) {
  const lvl = rep.status, mb = rep.afterMB;
  const verdict = lvl === 'ok' ? `within the ~${TARGET_MB} MB target` : lvl === 'warn' ? `over the ~${TARGET_MB} MB target` : `FAIL: ${FAIL_MB} MB or more is likely to run out of memory on phones`;
  $('racerGpu').dataset.level = lvl;
  $('racerGpu').innerHTML = `${built ? 'Built' : 'Estimate'}: GPU texture memory ≈ ${fmtMB(mb)} <small>${verdict}${rep.beforeMB > mb + 0.5 ? ` · the original needs ${fmtMB(rep.beforeMB)}` : ''}${built ? '' : ' · press Optimise to build it'}</small>`;
  $('racerGeo').innerHTML = built && st.geo ? describeGeometry(st.geo, st.bytes).map(esc).join('<br>') : 'Press Optimise: the car is reduced to the vertex budget, wheels first, and the Detail slider is not used.';
  const warns = [...(rep.warnings || [])]; for (const n of new Set(rep.notes || [])) warns.push({ level: 'info', text: n });
  if (built && rep.finalMaterials > 1) warns.push({ level: 'warn', text: `The file still has ${rep.finalMaterials} materials.` });
  if (st.geo && built) {
    for (const w of st.geo.warnings) warns.push({ level: 'warn', text: w });
    const mb = st.bytes / 1048576;
    if (mb > FILE_MAX_MB) warns.push({ level: 'warn', text: `The file is ${mb.toFixed(2)} MB, over the ${FILE_MAX_MB} MB limit for a car.` });
    else if (mb > FILE_TYPICAL_MB) warns.push({ level: 'info', text: `The file is ${mb.toFixed(2)} MB (typical is 1.2 to ${FILE_TYPICAL_MB} MB, ${FILE_MAX_MB} MB at most).` });
  }
  warns.push($('groundToggle')?.checked === false ? { level: 'info', text: 'Centre on ground is off: the car keeps the position it has in the source file.' } : { level: 'info', text: 'Centre on ground is on: the car is centred on the origin with its tyres on y = 0, like the earlier exports.' });
  { const wl = window.__shrinkWheels?.last; if (wl?.found && wl.upright === false) warns.push({ level: 'warn', text: `The car is not standing on its wheels in the file (${wl.tiltDeg}° from upright). The wheels were found by turning it, but Centre on ground uses the lowest point of the model, not the tyres: stand the car on its wheels in the source if the tyres do not end on y = 0.` }); }
  if (lvl === 'fail') warns.unshift({ level: 'warn', text: 'This is over the phone memory limit. Try the merge, a smaller base colour, or fewer textures.' });
  $('racerWarn').innerHTML = warns.map(w => `<div class="racer-warn ${w.level === 'info' ? 'info' : ''}">${w.level === 'info' ? 'ℹ' : '⚠'} ${esc(w.text)}</div>`).join('');
  const rows = built
    ? (rep.final || []).map(t => `<tr><td>${esc((t.roles.length ? t.roles.map(r => ROLE_LABEL[r] || r).join(' + ') : 'other'))}</td><td>${px(t.w, t.h)}</td><td>${t.mb.toFixed(1)} MB</td></tr>`)
    : (rep.merged !== undefined || (rep.options.merge && rep.used > 1 && rep.mergeable.ok)
      ? [`<tr><td>base colour (atlas)</td><td>${px(rep.options.baseSize, rep.options.baseSize)}</td><td></td></tr>`, `<tr><td>metal / rough + occlusion (ORM)</td><td>${px(rep.options.mrSize, rep.options.mrSize)}</td><td></td></tr>`, `<tr><td>normal</td><td>${px(rep.options.normalSize, rep.options.normalSize)}</td><td></td></tr>`]
      : rep.textures.map(t => `<tr><td>${esc(t.roles.map(r => ROLE_LABEL[r] || r).join(' + '))} <small>${esc(t.name)}</small></td><td>${px(t.from?.w, t.from?.h)} → ${px(t.to?.w, t.to?.h)}</td><td></td></tr>`));
  const drop = (rep.dropped || []).map(d => `<tr><td>✂ ${esc(d.name)} <small>${esc(d.reason)}</small></td><td>${px(d.w, d.h)}</td><td></td></tr>`);
  $('racerDetail').innerHTML = `<table>${rows.join('')}${drop.join('')}</table>` + (!rows.length && !drop.length ? '<div>No textures in this model.</div>' : '');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function refresh() {
  const panel = $('racerPanel'); if (!panel) return;
  const on = active(); panel.hidden = !on; if (!on) return;
  const app = A(); if (!app?.sourceBytes) { $('racerGpu').dataset.level = 'none'; $('racerGpu').textContent = 'Open a model to see its texture memory.'; $('racerWarn').innerHTML = ''; $('racerDetail').innerHTML = ''; return; }
  if (st.last && st.last.source === app.sourceBytes && st.last.key === JSON.stringify(opts())) { render(st.last.report, true); return; }
  const token = ++st.busy;
  try {
    const bytes = app.sourceBytes;
    if (st.estFor !== bytes) { st.est = await app.readDoc(); st.estFor = bytes; }
    if (token !== st.busy) return;
    render(plan(st.est, opts()), false);
  } catch (err) { console.warn(err); $('racerGpu').textContent = 'Could not read the textures: ' + err.message; }
}

/* ---------- called by app.js while the GLB is built ---------- */
async function process(doc, progress) {
  const rep = await apply(doc, opts(), ops, progress);
  st.last = { report: rep, source: A().sourceBytes, key: JSON.stringify(opts()) };
  return rep;
}

async function geometry(doc, simplifier, progress) {
  await simplifier.ready;
  st.geo = await applyGeometry(doc, geoOpts(), { simplifier, compactPrimitive, getPrimitiveVertexCount }, progress);
  return st.geo;
}
// first reduction before the wheels are cut out: down to about 450k vertices (never up, never below 1.6 x the budget). v2.202 went straight to 1.6 x the budget, which left the wheel finder a mangled tyre ring (uneven wheels, off-centre pivots); the exact budget is applied after the cut.
const WHEEL_FINDER_VERTS = 450000;
function preRatio(doc) { const total = vertexReport(doc).total; return total > 0 ? Math.min(1, Math.max(geoOpts().totalVerts * 1.6, WHEEL_FINDER_VERTS) / total) : 1; }

window.__shrinkRacer = { active, process, opts, geoOpts, geometry, preRatio, get last() { return st.last?.report || null; }, refresh };
for (const ev of ['shrink:model-opened', 'shrink:source-replaced', 'shrink:texture-applied']) window.addEventListener(ev, () => { st.est = null; st.estFor = null; st.last = null; setTimeout(refresh, 400); });
window.addEventListener('shrink:optimized', e => { st.bytes = e.detail?.bytes || 0; refresh(); });
window.addEventListener('shrink:ui-mode', () => setTimeout(refresh, 0));
if (!build()) { const t = setInterval(() => { if (build()) { clearInterval(t); refresh(); } }, 300); setTimeout(() => clearInterval(t), 20000); }
