// SHRINK 3D v2.129 — save the whole tweaked model (a .glb with the settings inside) or just the settings (.json), and load either back.
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
    kind: KIND, version: FILE_VERSION, app: 'SHRINK 3D', release: window.__shrinkRelease || '2.129',
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


// ---- project file: the model itself (with paint, removed parts and Look baked in) as a normal .glb, with the settings stored in its glTF extras ----
// It opens in any viewer as the tweaked vehicle; SHRINK reads the settings back when the file is opened, so the wheel adjustments and every control return too.
export function projectFromBytes(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67 || dv.getUint32(16, true) !== 0x4E4F534A) return null;   // 'glTF', then a JSON chunk
    const len = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
    const p = json?.extras?.shrinkProject;
    return p && p.kind === KIND ? p : null;
  } catch { return null; }
}
async function applyPaintFirst() {
  if (!window.__shrinkPaint?.hasEdits?.()) return false;
  say('Saving your paint into the model first…');
  await new Promise(res => { const done = () => { window.removeEventListener('shrink:texture-applied', done); res(); }; window.addEventListener('shrink:texture-applied', done); setTimeout(done, 30000); $('applyTextureBtn')?.click(); });
  window.__shrinkPaint?.setMode?.('navigate');      // applying paint switches Paint on; go back to rotating
  return true;
}
async function saveProject() {
  const app = window.__shrinkApp; if (!app?.sourceBytes) { say('Open a model first.', true); return; }
  const btn = $('settingsProject'); if (btn) btn.disabled = true;
  try {
    await applyPaintFirst();
    say('Building the project file…');
    const doc = await app.readDoc(), look = window.__shrinkMaterial;
    app.stripEmpty?.(doc);
    if (look?.changed) { look.applyToDocument(doc); await look.applyColourToDocument?.(doc); }
    const d = collect(), root = doc.getRoot();
    root.setExtras({ ...(root.getExtras() || {}), shrinkProject: d });
    const bytes = await app.writeDoc(doc), stem = (d.model || 'model').replace(/\.[^.]+$/, '').replace(/-SHRINK-project$/, '');
    download(bytes, `${stem}-SHRINK-project.glb`, 'model/gltf-binary');
    say(`Saved ${stem}-SHRINK-project.glb — the model with your paint, removed parts and wheel adjustments. Open this file in SHRINK to carry on.`);
  } catch (err) { console.error(err); say(`Could not save the project: ${err.message}`, true); }
  finally { if (btn) btn.disabled = false; }
}

function say(text, bad) { for (const id of ['settingsFileNote', 'settingsStartNote']) { const n = $(id); if (n) { n.textContent = text; n.classList.toggle('stale', !!bad); } } }

function download(obj, name, type) {
  const url = URL.createObjectURL(new Blob([type ? obj : JSON.stringify(obj, null, 2)], { type: type || 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = window.__shrinkCapShrink?.(name) || name; document.body.appendChild(a); a.click(); a.remove();
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
  let fromFile = false;
  if (!pending) { const p = projectFromBytes(window.__shrinkApp?.sourceBytes || new Uint8Array(0)); if (p) { pending = p; fromFile = true; } }
  if (!pending) return;
  const data = pending; pending = null;
  const go = () => { try { const r = apply(data); say(fromFile ? `Project opened: your settings and wheel adjustments are back (${r.applied} controls). Press Optimise to build.` : `Settings applied (${r.applied} controls). Press Optimise to build.`, false); } catch (err) { say(err.message, true); } };
  let done = false; const once = () => { if (done) return; done = true; window.removeEventListener('shrink:live-ready', onReady); setTimeout(go, 200); };
  const onReady = () => once();
  window.addEventListener('shrink:live-ready', onReady); setTimeout(once, 20000);
});

function buildStart() {
  if ($('settingsStartRow')) return true;
  const drop = $('dropZone'); if (!drop) return false;
  const row = document.createElement('div'); row.id = 'settingsStartRow'; row.className = 'hint game-only settings-start';
  row.innerHTML = 'Have a settings file from before? (A saved project .glb needs no loading: just open it as your model.) <button id="settingsStartLoad" class="button ghost small" type="button">Load settings</button> <span id="settingsStartNote"></span>';
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
  row.innerHTML = '<button id="settingsProject" class="button ghost small" type="button" title="Save the whole tweaked model as one .glb: your paint, removed parts, look and wheel adjustments, with every setting stored inside. Open it in SHRINK later to carry on.">Save project (GLB)</button>' +
    '<button id="settingsSave" class="button ghost small" type="button" title="Save only the settings (detail, textures, wheel adjustments) to a small .json file">Settings only</button>' +
    '<button id="settingsLoad" class="button ghost small" type="button" title="Load a settings .json saved earlier (a saved project .glb is simply opened as the model)">Load settings</button>';
  const note = document.createElement('div'); note.id = 'settingsFileNote'; note.className = 'hint flow-note';
  anchor.after(row); row.after(note);
  $('settingsProject').addEventListener('click', saveProject);
  $('settingsSave').addEventListener('click', () => {
    const d = collect(); const stem = (window.__shrinkCapShrink?.(d.model || 'model') || 'model').replace(/\.[^.]+$/, '').replace(/[-_ ]SHRINK(?:-project|-settings)?$/i, '');
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
window.__shrinkSettings = { collect, apply, takeFile, saveProject, projectFromBytes };
ensureInput(); buildStart();
if (!$('settingsStartRow')) { const t0 = setInterval(() => { if (buildStart()) clearInterval(t0); }, 300); setTimeout(() => clearInterval(t0), 15000); }
if (!build()) { const t = setInterval(() => { if (build()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
