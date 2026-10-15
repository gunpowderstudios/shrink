// SHRINK 3D v2.93 — Game mode: one Optimise button that tells you whether the saved file matches the settings.
//   green "Optimise"        nothing built yet for this model
//   green "✔ Optimised"     the built file matches every setting on screen  (Download is enabled)
//   red   "Optimise again"  something was changed since the last build     (Download is disabled)
// It only watches the controls in the left panel (input / change / click events, no page-wide observer) and compares a signature of their values.
const $ = id => document.getElementById(id);
const api = window.__shrinkGameFlow = { state: 'new', active: () => document.body.classList.contains('app-mode-game') };
let baseline = null, builtFor = null;

const SKIP = new Set(['fileInput', 'targetTris', 'geometryNumber', 'preset', 'textureSelect', 'brushSize', 'brushOpacity', 'paintColor']);
function signature() {
  const panel = document.querySelector('.control-panel'); if (!panel) return '';
  const parts = [];
  panel.querySelectorAll('input, select').forEach(el => {
    if (!el.id || SKIP.has(el.id) || el.closest('#textureEditor')) return;
    parts.push(el.id + '=' + (el.type === 'checkbox' ? +el.checked : el.value));
  });
  parts.push('target=' + (panel.querySelector('.target-card.active')?.dataset.target || ''));
  parts.push('look=' + !!window.__shrinkMaterial?.changed);
  parts.push('paint=' + !!window.__shrinkPaint?.hasEdits?.());
  return parts.join('|');
}

const LABEL = { new: 'Optimise', done: '✔ Optimised', stale: 'Optimise again' };
function render() {
  const opt = $('optimizeBtn'), dl = $('flowDownload'); if (!opt) return;
  if (!api.active()) { opt.classList.remove('flow-new', 'flow-done', 'flow-stale'); return; }
  opt.classList.toggle('flow-new', api.state === 'new');
  opt.classList.toggle('flow-done', api.state === 'done');
  opt.classList.toggle('flow-stale', api.state === 'stale');
  opt.dataset.label = LABEL[api.state];
  if (!opt.disabled) opt.textContent = LABEL[api.state];
  if (dl) { dl.disabled = api.state !== 'done' || !window.__shrinkApp?.optimizedBytes; dl.classList.toggle('ready', !dl.disabled); }
  const note = $('flowNote');
  if (note) {
    const wm = api.state === 'done' && window.__shrinkWheels?.enabled ? (window.__shrinkWheels.message?.() || '') : '';
    note.textContent = api.state === 'stale' ? 'Settings changed — press Optimise again to rebuild the file.' : wm;
    note.classList.toggle('stale', api.state === 'stale');
  }
}
function setState(s) { api.state = s; render(); }
function check() {
  if (!baseline) return;
  setState(signature() === baseline ? 'done' : 'stale');
}

function build() {
  const step = $('stepSave'), opt = $('optimizeBtn'); if (!step || !opt || $('flowBar')) return !!$('flowBar');
  const bar = document.createElement('div'); bar.id = 'flowBar'; bar.className = 'flow-bar';
  const dl = document.createElement('button'); dl.id = 'flowDownload'; dl.type = 'button'; dl.className = 'button flow-download'; dl.textContent = 'Download GLB'; dl.disabled = true;
  dl.addEventListener('click', () => $('downloadBtn')?.click());
  opt.parentNode.insertBefore(bar, opt); bar.appendChild(opt); bar.appendChild(dl);
  const note = document.createElement('div'); note.id = 'flowNote'; note.className = 'hint flow-note'; bar.after(note);
  return true;
}

function init() {
  build();
  const panel = document.querySelector('.control-panel');
  if (panel && !panel.dataset.flow) {
    panel.dataset.flow = '1';
    const later = () => setTimeout(check, 60);
    panel.addEventListener('input', later, true); panel.addEventListener('change', later, true); panel.addEventListener('click', later, true);
  }
  render();
}
window.addEventListener('shrink:optimized', e => {
  if (!api.active() || e.detail?.liveExport) return;
  baseline = signature(); setState('done');
});
window.addEventListener('shrink:model-opened', () => { baseline = null; setState('new'); });
window.addEventListener('shrink:ui-mode', () => { init(); });
window.addEventListener('shrink:material-look', () => setTimeout(check, 60));
window.addEventListener('shrink:paint-undo', () => setTimeout(check, 60));
init();
if (!$('flowBar')) { const t = setInterval(() => { init(); if ($('flowBar')) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
