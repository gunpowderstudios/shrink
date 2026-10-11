// SHRINK 3D v2.76 — Material look (Game mode): turn down the metallic effect of a GLB.
// glTF "metallic" makes a surface mirror its surroundings and tint the reflection with its own colour, so a scanned car with
// metallic = 1 looks like chrome. The slider scales every material's metallic factor (it also scales a metallic texture,
// because glTF multiplies the two). It changes the live preview AND the saved GLB, never the original upload.
(() => {
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  let scale = 1;                                   // 1 = exactly as in the file
  let dropMR = false, dropAO = false, rough = 0.5; // optional: remove maps that add little, to make the file smaller
  let hue = 0, sat = 1, bright = 1, gloss = 1;     // colour correction (degrees / multipliers) and reflection (roughness multiplier, <= 1 = shinier)
  const BAKED = new Map();                         // original base-colour texture -> { key, tex } (a corrected copy for the preview)
  const PREVIEW_PX = 1024;
  let smallData = true;                            // data maps (metallic/roughness, AO) are saved at no more than DATA_CAP px: they hold smooth values, so it is barely visible
  const DATA_CAP = 512;
  const MAPS = new WeakMap();                      // original material -> its own maps (textures must not go in userData: clone() would copy them)

  /* ---------- colour correction ---------- */
  // One 3x3 matrix = hue rotation, then saturation, then brightness (the same maths as the CSS hue-rotate/saturate/brightness filters).
  function colourMatrix(h = hue, s = sat, b = bright) {
    const a = h * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    const H = [.213 + c * .787 - n * .213, .715 - c * .715 - n * .715, .072 - c * .072 + n * .928,
               .213 - c * .213 + n * .143, .715 + c * .285 + n * .140, .072 - c * .072 - n * .283,
               .213 - c * .213 - n * .787, .715 - c * .715 + n * .715, .072 + c * .928 + n * .072];
    const S = [.213 + .787 * s, .715 - .715 * s, .072 - .072 * s, .213 - .213 * s, .715 + .285 * s, .072 - .072 * s, .213 - .213 * s, .715 - .715 * s, .072 + .928 * s];
    const M = new Array(9);                          // M = S * H
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) M[r * 3 + k] = (S[r * 3] * H[k] + S[r * 3 + 1] * H[3 + k] + S[r * 3 + 2] * H[6 + k]) * b;
    return M;
  }
  const colourIsIdentity = () => Math.abs(hue) < 1e-6 && Math.abs(sat - 1) < 1e-6 && Math.abs(bright - 1) < 1e-6;
  const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;
  function adjustRGBA(data, M = colourMatrix()) {   // in place, sRGB 0-255, alpha untouched
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      data[i] = clamp255(M[0] * r + M[1] * g + M[2] * b); data[i + 1] = clamp255(M[3] * r + M[4] * g + M[5] * b); data[i + 2] = clamp255(M[6] * r + M[7] * g + M[8] * b);
    }
    return data;
  }
  const toSRGB = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const toLinear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  function adjustLinear(rgb, M = colourMatrix()) {   // a linear 0-1 colour factor
    const v = rgb.map(x => toSRGB(Math.max(0, Math.min(1, x))) * 255), d = adjustRGBA(new Float32Array([v[0], v[1], v[2], 255]), M);
    return [toLinear(d[0] / 255), toLinear(d[1] / 255), toLinear(d[2] / 255)];
  }
  const makeCanvas = (w, h) => { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // Preview copy of a base-colour texture, corrected and capped at 1024px. It gets its OWN image source: Texture.clone() shares
  // the original's Source, so assigning .image on the clone would overwrite the real picture.
  function bakeTexture(orig) {
    const key = `${hue}|${sat}|${bright}`, hit = BAKED.get(orig);
    if (hit && hit.key === key) return hit.tex;
    const im = orig.image, w0 = im?.naturalWidth || im?.width, h0 = im?.naturalHeight || im?.height;
    if (!w0 || !h0) return null;
    const sc = Math.min(1, PREVIEW_PX / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
    let data, ctx;
    try {
      const cv = makeCanvas(w, h); ctx = cv.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
      ctx.drawImage(im, 0, 0, w, h); data = ctx.getImageData(0, 0, w, h); adjustRGBA(data.data); ctx.putImageData(data, 0, 0);
      const tex = orig.clone(); if (orig.source?.constructor) tex.source = new orig.source.constructor(cv); else tex.image = cv;
      tex.userData = { origW: w0, origH: h0 }; tex.needsUpdate = true;
      if (hit) hit.tex.dispose?.();
      BAKED.set(orig, { key, tex }); return tex;
    } catch (err) { console.warn('Colour preview skipped:', err); return null; }
  }

  function materialsOf(model) {
    const out = new Set();
    model?.traverse?.(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && 'metalness' in m) out.add(m); });
    return [...out];
  }

  // Preview: scale each material from ITS OWN original value (remembered on first sight, and copied with material.clone()).
  function applyToModel(model, s = scale) {
    let n = 0;
    for (const m of materialsOf(model)) {
      if (m.userData._shrinkOrigMetal === undefined) m.userData._shrinkOrigMetal = m.metalness;
      const v = Math.max(0, Math.min(1, m.userData._shrinkOrigMetal * s));
      if (m.metalness !== v) { m.metalness = v; n++; }
    }
    return n;
  }

  function capture(model) {
    for (const m of materialsOf(model)) if (!MAPS.has(m)) MAPS.set(m, { roughnessMap: m.roughnessMap || null, metalnessMap: m.metalnessMap || null, aoMap: m.aoMap || null, roughness: m.roughness, map: m.map || null, color: m.color ? [m.color.r, m.color.g, m.color.b] : null });
  }

  // Preview of dropped maps. The reduced preview's materials are clones of the original's, matched by order, so ticking
  // a box off again can put the real maps back.
  function applyMaps(model) {
    const a = app(); if (!a || !model) return;
    const origs = materialsOf(a.originalModel), mats = model === a.originalModel ? origs : materialsOf(model);
    const paired = origs.length === mats.length;
    mats.forEach((m, i) => {
      const o = paired ? origs[i] : m, saved = MAPS.get(o); if (!saved) return;
      const want = { roughnessMap: dropMR ? null : saved.roughnessMap, metalnessMap: dropMR ? null : saved.metalnessMap, aoMap: dropAO ? null : saved.aoMap };
      let dirty = false;
      for (const k of Object.keys(want)) if ((m[k] || null) !== want[k]) { m[k] = want[k]; dirty = true; }
      const r = (dropMR ? rough : saved.roughness) * gloss;
      if (m.roughness !== r) m.roughness = r;
      // colour: the picture if there is one, otherwise the plain colour value
      if (saved.map) {
        const wantMap = colourIsIdentity() ? saved.map : (bakeTexture(saved.map) || saved.map);
        if (m.map !== wantMap) { m.map = wantMap; dirty = true; }
      } else if (saved.color && m.color) {
        const c = colourIsIdentity() ? saved.color : adjustLinear(saved.color);
        if (m.color.r !== c[0] || m.color.g !== c[1] || m.color.b !== c[2]) m.color.setRGB(c[0], c[1], c[2]);
      }
      if (dirty) m.needsUpdate = true;
    });
  }

  function applyToViewer() {
    const a = app(); if (!a) return;
    capture(a.originalModel); applyToModel(a.originalModel); applyMaps(a.originalModel);
    if (a.optimizedModel && a.optimizedModel !== a.originalModel) { applyToModel(a.optimizedModel); applyMaps(a.optimizedModel); }
  }

  // Export: a glTF-Transform document (what is written into the GLB).
  function applyToDocument(doc, s = scale) {
    if (!doc) return 0;
    let n = 0;
    for (const m of doc.getRoot().listMaterials()) {
      if (Math.abs(s - 1) > 1e-6) {
        const f = m.getMetallicFactor(), v = Math.max(0, Math.min(1, f * s));
        if (v !== f) { m.setMetallicFactor(v); n++; }
      }
      if (dropMR && m.getMetallicRoughnessTexture()) { m.setMetallicRoughnessTexture(null); m.setRoughnessFactor(rough); n++; }
      if (dropAO && m.getOcclusionTexture()) { m.setOcclusionTexture(null); n++; }
      if (gloss < 1 - 1e-6) { m.setRoughnessFactor(Math.max(0, m.getRoughnessFactor() * gloss)); n++; }
    }
    return n;
  }

  // Export, colour part (async: it has to repaint the picture). Run it before the textures are resized.
  async function decodeToCanvas(tex) {
    const bmp = await createImageBitmap(new Blob([tex.getImage()], { type: tex.getMimeType() || 'image/png' }));
    const cv = makeCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0); bmp.close?.(); return { cv, ctx, w: cv.width, h: cv.height };
  }
  async function toBytes(cv, mime) {
    const type = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', blob = cv.convertToBlob ? await cv.convertToBlob({ type, quality: 0.95 }) : await new Promise(r => cv.toBlob(r, type, 0.95));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
  }
  async function applyColourToDocument(doc) {
    if (!doc || colourIsIdentity()) return 0;
    const M = colourMatrix(); let n = 0; const done = new Set();
    for (const m of doc.getRoot().listMaterials()) {
      const tex = m.getBaseColorTexture();
      if (!tex) {                                      // a plain colour value
        const f = m.getBaseColorFactor(), c = adjustLinear(f.slice(0, 3), M); m.setBaseColorFactor([c[0], c[1], c[2], f[3]]); n++; continue;
      }
      if (done.has(tex)) continue; done.add(tex);
      try {
        const { cv, ctx, w, h } = await decodeToCanvas(tex), img = ctx.getImageData(0, 0, w, h);
        adjustRGBA(img.data, M); ctx.putImageData(img, 0, 0);
        const { bytes, type } = await toBytes(cv, tex.getMimeType());
        const shared = doc.getRoot().listMaterials().some(o => [o.getEmissiveTexture(), o.getNormalTexture(), o.getOcclusionTexture(), o.getMetallicRoughnessTexture()].includes(tex));
        if (shared) { const copy = doc.createTexture(tex.getName() + '-recoloured').setImage(bytes).setMimeType(type); m.setBaseColorTexture(copy); } else tex.setImage(bytes).setMimeType(type);
        n++;
      } catch (err) { console.warn('Colour correction skipped for one texture:', err); }
    }
    return n;
  }

  // Export: how large a texture may be. A picture that only feeds metallic/roughness or AO is capped at 512px; colour and
  // normal maps keep the chosen size.
  function textureCap(doc, tex, cap) {
    if (!smallData || !doc) return cap;
    let data = false, other = false;
    for (const m of doc.getRoot().listMaterials()) {
      if (m.getMetallicRoughnessTexture?.() === tex || m.getOcclusionTexture?.() === tex) data = true;
      if (m.getBaseColorTexture?.() === tex || m.getNormalTexture?.() === tex || m.getEmissiveTexture?.() === tex) other = true;
    }
    return data && !other ? Math.min(cap, DATA_CAP) : cap;
  }

  // What dropping a map would save. A texture is only freed if every slot that uses it is being dropped, and never if
  // it is also the base colour, normal or emissive image.
  function savings() {
    const a = app(), cap = Number($('textureSize')?.value || 1024), webp = $('webpToggle')?.checked !== false;
    const tex = new Map(), used = new Set();
    for (const m of materialsOf(a?.originalModel)) {
      const saved = MAPS.get(m); if (!saved) continue;
      for (const t of [saved.map, m.normalMap, m.emissiveMap]) if (t) used.add(t.uuid);
      for (const [slot, t] of [['mr', saved.roughnessMap], ['mr', saved.metalnessMap], ['ao', saved.aoMap]]) {
        if (!t) continue;
        const e = tex.get(t.uuid) || { w: t.image?.width || 1024, h: t.image?.height || 1024, slots: new Set() };
        e.slots.add(slot); tex.set(t.uuid, e);
      }
    }
    const freed = want => {
      let file = 0, gpu = 0, count = 0;
      for (const [uuid, e] of tex) {
        if (used.has(uuid) || ![...e.slots].every(sl => want.has(sl))) continue;
        const sc = Math.min(1, (smallData ? Math.min(cap, DATA_CAP) : cap) / Math.max(e.w, e.h)), w = Math.max(1, Math.round(e.w * sc)), h = Math.max(1, Math.round(e.h * sc));
        file += w * h * (webp ? 0.4 : 1.5); gpu += w * h * 4 * 1.33; count++;
      }
      return { file, gpu, count };
    };
    const has = slot => [...tex.values()].some(e => e.slots.has(slot));
    return { mr: { has: has('mr'), ...freed(new Set(['mr'])) }, ao: { has: has('ao'), ...freed(new Set(['ao'])) }, both: freed(new Set(['mr', 'ao'])) };
  }

  function highestMetal() {
    let hi = 0; for (const m of materialsOf(app()?.originalModel)) hi = Math.max(hi, m.userData._shrinkOrigMetal ?? m.metalness ?? 0);
    return hi;
  }

  function render() {
    const slider = $('metalScale'), out = $('metalScaleValue'), note = $('metalScaleNote');
    if (!slider) return;
    const pct = Math.round(scale * 100);
    if (Number(slider.value) !== pct) slider.value = String(pct);
    if (out) out.textContent = pct === 100 ? 'As in the file' : `${pct}%`;
    const hi = highestMetal();
    if (note) note.textContent = hi < 0.05
      ? 'This model is already non-metallic, so there is nothing to turn down.'
      : `This model is up to ${Math.round(hi * 100)}% metallic. Lower it if it looks too silver or chrome-like — the picture on the right and the saved GLB both follow.`;
  }

  const mb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  function renderMaps() {
    const sv = savings();
    const row = (id, info, other) => {
      const el = $(id); if (!el) return; if (el.hidden === info.has) el.hidden = !info.has;
      const note = $(id + 'Save'); if (!note) return;
      const own = info.count ? `saves ≈ ${mb(info.file)} file · ${mb(info.gpu)} memory` : (info.has ? `shares its image with the ${other} map — drop both to save ≈ ${mb(sv.both.file)}` : '');
      if (note.textContent !== own) note.textContent = own;
    };
    row('dropMRRow', sv.mr, 'occlusion'); row('dropAORow', sv.ao, 'metallic/roughness');
    const blk = $('dropMapsBlock'); if (blk && blk.hidden === (sv.mr.has || sv.ao.has)) blk.hidden = !(sv.mr.has || sv.ao.has);
    const rw = $('roughWrap'); if (rw && rw.hidden === dropMR) rw.hidden = !dropMR;
    const rv = $('roughValue'); if (rv && rv.textContent !== `${Math.round(rough * 100)}%`) rv.textContent = `${Math.round(rough * 100)}%`;
  }

  function setMaps({ mr = dropMR, ao = dropAO, r = rough } = {}) {
    const turningOnMR = mr && !dropMR;
    dropMR = !!mr; dropAO = !!ao; rough = Math.max(0, Math.min(1, r));
    if (turningOnMR && scale > 0.3) scale = 0.2;           // without its map the metallic value is flat: keep the car-paint look, not chrome
    applyToViewer();
    const c1 = $('dropMR'), c2 = $('dropAO'), r1 = $('roughVal');
    if (c1 && c1.checked !== dropMR) c1.checked = dropMR;
    if (c2 && c2.checked !== dropAO) c2.checked = dropAO;
    if (r1 && Number(r1.value) !== Math.round(rough * 100)) r1.value = String(Math.round(rough * 100));
    render(); renderMaps();
    window.dispatchEvent(new CustomEvent('shrink:material-look', { detail: { metalScale: scale, dropMR, dropAO } }));
  }

  function setColour({ h = hue, s = sat, b = bright, g = gloss } = {}) {
    hue = Math.max(-180, Math.min(180, Number(h))); sat = Math.max(0, Math.min(2, Number(s))); bright = Math.max(0.3, Math.min(1.7, Number(b))); gloss = Math.max(0.1, Math.min(1, Number(g)));
    for (const v of [hue, sat, bright, gloss]) if (!Number.isFinite(v)) { hue = 0; sat = 1; bright = 1; gloss = 1; break; }
    applyToViewer(); renderColour();
    window.dispatchEvent(new CustomEvent('shrink:material-look', { detail: { hue, sat, bright, gloss } }));
  }
  function renderColour() {
    const set = (id, v, label) => { const e = $(id); if (e && Number(e.value) !== v) e.value = String(v); const o = $(id + 'Value'); if (o && o.textContent !== label) o.textContent = label; };
    set('hueShift', Math.round(hue), hue === 0 ? 'As in the file' : `${hue > 0 ? '+' : ''}${Math.round(hue)}°`);
    set('satScale', Math.round(sat * 100), Math.round(sat * 100) === 100 ? 'As in the file' : `${Math.round(sat * 100)}%`);
    set('brightScale', Math.round(bright * 100), Math.round(bright * 100) === 100 ? 'As in the file' : `${Math.round(bright * 100)}%`);
    set('glossScale', Math.round(gloss * 100), Math.round(gloss * 100) === 100 ? 'As in the file' : `${Math.round(gloss * 100)}%`);
  }

  function setScale(pct, { notify = true } = {}) {
    scale = Math.max(0, Math.min(100, Number(pct))) / 100;
    if (!Number.isFinite(scale)) scale = 1;
    applyToViewer(); render(); renderMaps();
    if (notify) window.dispatchEvent(new CustomEvent('shrink:material-look', { detail: { metalScale: scale } }));
  }

  function inject() {
    if ($('materialDetails')) return;
    const host = $('stepExtra'), before = $('retouchDetails');
    if (!host || !before) return;
    const d = document.createElement('details'); d.id = 'materialDetails'; d.className = 'fold game-only'; d.open = true;
    d.innerHTML = `<summary>Material look</summary><div class="fold-inner">
      <div class="control-block"><div class="label">Colour</div>
        <div class="range-heading"><label for="hueShift">Hue</label><output id="hueShiftValue">As in the file</output></div>
        <input id="hueShift" type="range" min="-180" max="180" step="1" value="0" aria-label="Hue shift, degrees">
        <div class="range-heading"><label for="satScale">Saturation</label><output id="satScaleValue">As in the file</output></div>
        <input id="satScale" type="range" min="0" max="200" step="1" value="100" aria-label="Saturation, percent">
        <div class="slider-ends"><span>Grey</span><span>As in the file</span><span>Vivid</span></div>
        <div class="range-heading"><label for="brightScale">Brightness</label><output id="brightScaleValue">As in the file</output></div>
        <input id="brightScale" type="range" min="30" max="170" step="1" value="100" aria-label="Brightness, percent">
        <div class="material-presets"><button id="colourReset" class="button ghost small" type="button">Reset colour</button></div>
        <div class="hint">Changes the colour picture (or the plain colour) of the whole model, in the preview and the saved GLB. It is applied to everything, so a yellow car's yellow windows would shift too.</div></div>
      <div class="control-block"><div class="range-heading"><label for="glossScale">Reflection (shininess)</label><output id="glossScaleValue">As in the file</output></div>
      <input id="glossScale" type="range" min="10" max="100" step="1" value="100" aria-label="Surface smoothness, percent of the original roughness">
      <div class="slider-ends"><span>Mirror-like</span><span>As in the file</span></div>
      <div class="hint">Lowers the surface roughness so reflections get sharper and glossier. To cut reflections down, use Metallic above. The preview's room lighting is only for viewing; other engines light it their own way.</div></div>
      <div class="control-block"><div class="range-heading"><label for="metalScale">Metallic</label><output id="metalScaleValue">As in the file</output></div>
      <input id="metalScale" type="range" min="0" max="100" step="1" value="100" aria-label="Metallic effect, percent of the original">
      <div class="slider-ends"><span>Matt</span><span>As in the file</span></div></div>
      <div class="material-presets"><button id="metalPaint" class="button ghost small" type="button">Car paint (20%)</button><button id="metalMatt" class="button ghost small" type="button">No metal (0%)</button><button id="metalReset" class="button ghost small" type="button">As in the file</button></div>
      <div id="metalScaleNote" class="hint"></div>
      <div id="dropMapsBlock" class="control-block" hidden><div class="label">Smaller file</div>
        <label id="dropMRRow" class="toggle-row"><span>Drop the metallic/roughness map <small id="dropMRRowSave" class="dim"></small></span><input id="dropMR" type="checkbox"></label>
        <div id="roughWrap" hidden><div class="range-heading"><label for="roughVal">Roughness without the map</label><output id="roughValue">50%</output></div><input id="roughVal" type="range" min="0" max="100" step="1" value="50"></div>
        <label id="smallDataRow" class="toggle-row"><span>Save these two maps at half size <small class="dim">(recommended: smooth data, barely visible)</small></span><input id="smallData" type="checkbox" checked></label>
        <label id="dropAORow" class="toggle-row"><span>Drop the occlusion (AO) map <small id="dropAORowSave" class="dim"></small></span><input id="dropAO" type="checkbox"></label>
        <div class="hint">Removes the picture and uses one flat value instead. The metallic/roughness map controls where the car is shiny or dull, so check the preview. Applies to the preview and the saved GLB.</div></div></div>`;
    host.insertBefore(d, before);
    const style = document.createElement('style');
    style.textContent = '.material-presets{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}';
    document.head.appendChild(style);
    $('metalScale').addEventListener('input', () => setScale($('metalScale').value));
    $('metalPaint').addEventListener('click', () => setScale(20));
    $('metalMatt').addEventListener('click', () => setScale(0));
    $('metalReset').addEventListener('click', () => setScale(100));
    for (const [id, key] of [['hueShift', 'h'], ['satScale', 's'], ['brightScale', 'b'], ['glossScale', 'g']])
      $(id).addEventListener('input', () => { const v = Number($(id).value); setColour({ [key]: key === 'h' ? v : v / 100 }); });
    $('colourReset').addEventListener('click', () => setColour({ h: 0, s: 1, b: 1 }));
    $('dropMR').addEventListener('change', () => setMaps({ mr: $('dropMR').checked }));
    $('smallData').addEventListener('change', () => { smallData = $('smallData').checked; renderMaps(); window.dispatchEvent(new CustomEvent('shrink:material-look', { detail: { smallData } })); });
    $('dropAO').addEventListener('change', () => setMaps({ ao: $('dropAO').checked }));
    $('roughVal').addEventListener('input', () => setMaps({ r: Number($('roughVal').value) / 100 }));
    for (const id of ['textureSize', 'webpToggle']) $(id)?.addEventListener('change', renderMaps);
    render(); renderMaps(); renderColour();
  }

  // A newly opened model starts "as in the file". Rebuilt previews (live reducer, texture apply) re-use the current setting.
  window.addEventListener('shrink:model-opened', () => { smallData = true; if ($('smallData')) $('smallData').checked = true; scale = 1; hue = 0; sat = 1; bright = 1; gloss = 1; for (const b of BAKED.values()) b.tex.dispose?.(); BAKED.clear(); dropMR = false; dropAO = false; rough = 0.5; setTimeout(() => { const a = app(); if (a) capture(a.originalModel); for (const id of ['dropMR', 'dropAO']) if ($(id)) $(id).checked = false; render(); renderMaps(); renderColour(); }, 0); });
  for (const ev of ['shrink:live-ready', 'shrink:live-updated', 'shrink:texture-applied', 'shrink:optimized']) window.addEventListener(ev, () => { applyToViewer(); render(); });

  window.__shrinkMaterial = { applyToModel, applyToDocument, applyColourToDocument, textureCap, applyToViewer, setScale, setColour, colourMatrix, adjustRGBA, setMaps, savings, refresh: renderMaps, get metalScale() { return scale; }, get smallData() { return smallData; }, get colour() { return { hue, sat, bright, gloss }; }, get changed() { return Math.abs(scale - 1) > 1e-6 || dropMR || dropAO || !colourIsIdentity() || gloss < 1 - 1e-6; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true }); else inject();
})();
