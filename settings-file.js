// SHRINK 3D v2.105 — save the left-panel settings to a small JSON file and load them back.
// It stores what is set, not the model: target card, detail %, texture options, protect options and every wheel slider.
// Paint edits and "Look" (material) changes are pixels/maths on the model itself, so they are NOT in the file.
// Loading just sets the controls and fires their normal events, so the Optimise button turns red ("Optimise again") by itself.
const $ = id => document.getElementById(id);
const KIND = 'shrink-settings', FILE_VERSION = 1;
// Mirrors of other controls, file pickers and painting tools are left out on purpose.
const SKIP = new Set(['fileInput', 'targetTris', 'geometryNumber', 'preset', 'textureSelect', 'brushSize', 'brushOpacity', 'paintColor']);

function controls() {
  const panel = document.querySelector('.control-panel'); if (!panel) return [];
  return [...panel.querySelectorAll('input, select')].filter(el => el.id && el.type !== 'file' && !SKIP.has(el.id) && !el.closest('#textureEditor'));
}
function modelName() { const t = $('fileName')?.textContent?.trim(); return t && t !== '—' ? t : ''; }

export function collect() {
  const values = {};
  for (const el of controls()) values[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  return {
    kind: KIND, version: FILE_VERSION, app: 'SHRINK 3D', release: window.__shrinkRelease || '2.105',
    saved: new Date().toISOString(), model: modelName(),
    target: document.querySelector('.control-panel .target-card.active')?.dataset.target || '',
    values,
  };
}

// Returns { applied, skipped:[ids] } or throws Error with a message fit to show.
export function apply(data) {
  if (!data || data.kind !== KIND || typeof data.values !== 'object' || !data.values) throw new Error('That is not a SHRINK settings file.');
  if (data.version > FILE_VERSION) throw new Error('That settings file is from a newer SHRINK. Reload the page and try again.');
  let applied = 0; const skipped = [];
  const fire = (el, types) => { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true })); };
  // Target card first (it sets texture size and detail), then individual values on top, detail slider last.
  if (data.target) [...document.querySelectorAll('.control-panel .target-card')].find(b => b.dataset.target === data.target)?.click();
  const order = Object.keys(data.values).sort((a, b) => (a === 'geometry') - (b === 'geometry'));
  for (const id of order) {
    const el = $(id), v = data.values[id];
    if (!el || SKIP.has(id) || el.type === 'file' || !el.closest('.control-panel') || el.closest('#textureEditor')) { skipped.push(id); continue; }
    if (el.type === 'checkbox') { const b = !!v; if (el.checked !== b) { el.checked = b; fire(el, ['input', 'change']); } applied++; continue; }
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(v))) { skipped.push(id); continue; }
    if (el.value !== String(v)) { el.value = String(v); fire(el, ['input', 'change']); }
    applied++;
  }
  return { applied, skipped };
}

function say(text, bad) { for (const id of ['settingsFileNote', 'settingsStartNote']) { const n = $(id); if (n) { n.textContent = text; n.classList.toggle('stale', !!bad); } } }

function download(obj, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Read a settings file. With a model open it applies at once; on the start screen it is kept and applied as soon as a model has loaded
// (opening a model resets Detail kept and the target card, so it must wait for that to finish).
let pending = null;
function hasModel() { return !!window.__shrinkApp?.sourceFile; }
async function takeFile(f) {
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.kind !== KIND) throw new Error('That is not a SHRINK settings file.');
    if (hasModel()) {
      const r = apply(data);
      const other = data.model && modelName() && data.model !== modelName() ? ` These were saved for “${data.model}”.` : '';
      say(`Settings loaded (${r.applied} controls).${other} Press Optimise to build.`, false);
    } else {
      pending = data; say(`Settings ready${data.model ? ' for “' + data.model + '”' : ''}. Now choose your model and they will be applied.`, false);
    }
  } catch (err) { say(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, true); }
}
window.addEventListener('shrink:model-opened', () => {
  if (!pending) return;
  const data = pending; pending = null;
  const go = () => { try { const r = apply(data); say(`Settings applied (${r.applied} controls). Press Optimise to build.`, false); } catch (err) { say(err.message, true); } };
  let done = false; const once = () => { if (done) return; done = true; window.removeEventListener('shrink:live-ready', onReady); setTimeout(go, 200); };
  const onReady = () => once();
  window.addEventListener('shrink:live-ready', onReady); setTimeout(once, 20000);
});

function buildStart() {
  if ($('settingsStartRow')) return true;
  const drop = $('dropZone'); if (!drop) return false;
  const row = document.createElement('div'); row.id = 'settingsStartRow'; row.className = 'hint game-only settings-start';
  row.innerHTML = 'Have a settings file from before? <button id="settingsStartLoad" class="button ghost small" type="button">Load settings</button> <span id="settingsStartNote"></span>';
  drop.after(row);
  const sync = () => { row.hidden = drop.classList.contains('hidden'); };
  sync(); new MutationObserver(sync).observe(drop, { attributes: true, attributeFilter: ['class'] });
  $('settingsStartLoad').addEventListener('click', () => $('settingsLoadInput')?.click());
  return true;
}

function build() {
  if ($('settingsFileRow')) return true;
  const anchor = $('flowNote') || $('stepSave'); if (!anchor) return false;
  const row = document.createElement('div'); row.id = 'settingsFileRow'; row.className = 'settings-file-row game-only';
  row.innerHTML = '<button id="settingsSave" class="button ghost small" type="button" title="Save these settings (detail, textures, wheel adjustments) to a .json file">Save settings</button>' +
    '<button id="settingsLoad" class="button ghost small" type="button" title="Load a settings file saved earlier">Load settings</button>' +
    '';
  const note = document.createElement('div'); note.id = 'settingsFileNote'; note.className = 'hint flow-note';
  anchor.after(row); row.after(note);
  $('settingsSave').addEventListener('click', () => {
    const d = collect(); const stem = (d.model || 'model').replace(/\.[^.]+$/, '');
    download(d, `${stem}-SHRINK-settings.json`);
    say(`Saved ${stem}-SHRINK-settings.json` + (window.__shrinkPaint?.hasEdits?.() ? ' — your paint is not in this file; use Download GLB to keep the painted model.' : ''));
  });
  $('settingsLoad').addEventListener('click', () => $('settingsLoadInput').click());
  return true;
}

function ensureInput() {
  if ($('settingsLoadInput')) return;
  const i = document.createElement('input'); i.id = 'settingsLoadInput'; i.type = 'file'; i.accept = '.json,application/json'; i.hidden = true; document.body.appendChild(i);
  i.addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) takeFile(f); });
}
window.__shrinkSettings = { collect, apply, takeFile };
ensureInput(); buildStart();
if (!$('settingsStartRow')) { const t0 = setInterval(() => { if (buildStart()) clearInterval(t0); }, 300); setTimeout(() => clearInterval(t0), 15000); }
if (!build()) { const t = setInterval(() => { if (build()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
