// SHRINK 3D v2.73 — Material look (Game mode): turn down the metallic effect of a GLB.
// glTF "metallic" makes a surface mirror its surroundings and tint the reflection with its own colour, so a scanned car with
// metallic = 1 looks like chrome. The slider scales every material's metallic factor (it also scales a metallic texture,
// because glTF multiplies the two). It changes the live preview AND the saved GLB, never the original upload.
(() => {
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  let scale = 1;                                   // 1 = exactly as in the file
  let dropMR = false, dropAO = false, rough = 0.5; // optional: remove maps that add little, to make the file smaller
  const MAPS = new WeakMap();                      // original material -> its own maps (textures must not go in userData: clone() would copy them)

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
    for (const m of materialsOf(model)) if (!MAPS.has(m)) MAPS.set(m, { roughnessMap: m.roughnessMap || null, metalnessMap: m.metalnessMap || null, aoMap: m.aoMap || null, roughness: m.roughness });
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
      const r = dropMR ? rough : saved.roughness;
      if (m.roughness !== r) m.roughness = r;
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
    }
    return n;
  }

  // What dropping a map would save. A texture is only freed if every slot that uses it is being dropped, and never if
  // it is also the base colour, normal or emissive image.
  function savings() {
    const a = app(), cap = Number($('textureSize')?.value || 1024), webp = $('webpToggle')?.checked !== false;
    const tex = new Map(), used = new Set();
    for (const m of materialsOf(a?.originalModel)) {
      const saved = MAPS.get(m); if (!saved) continue;
      for (const t of [m.map, m.normalMap, m.emissiveMap]) if (t) used.add(t.uuid);
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
        const sc = Math.min(1, cap / Math.max(e.w, e.h)), w = Math.max(1, Math.round(e.w * sc)), h = Math.max(1, Math.round(e.h * sc));
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
      <div class="control-block"><div class="range-heading"><label for="metalScale">Metallic</label><output id="metalScaleValue">As in the file</output></div>
      <input id="metalScale" type="range" min="0" max="100" step="1" value="100" aria-label="Metallic effect, percent of the original">
      <div class="slider-ends"><span>Matt</span><span>As in the file</span></div></div>
      <div class="material-presets"><button id="metalPaint" class="button ghost small" type="button">Car paint (20%)</button><button id="metalMatt" class="button ghost small" type="button">No metal (0%)</button><button id="metalReset" class="button ghost small" type="button">As in the file</button></div>
      <div id="metalScaleNote" class="hint"></div>
      <div id="dropMapsBlock" class="control-block" hidden><div class="label">Smaller file</div>
        <label id="dropMRRow" class="toggle-row"><span>Drop the metallic/roughness map <small id="dropMRRowSave" class="dim"></small></span><input id="dropMR" type="checkbox"></label>
        <div id="roughWrap" hidden><div class="range-heading"><label for="roughVal">Roughness without the map</label><output id="roughValue">50%</output></div><input id="roughVal" type="range" min="0" max="100" step="1" value="50"></div>
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
    $('dropMR').addEventListener('change', () => setMaps({ mr: $('dropMR').checked }));
    $('dropAO').addEventListener('change', () => setMaps({ ao: $('dropAO').checked }));
    $('roughVal').addEventListener('input', () => setMaps({ r: Number($('roughVal').value) / 100 }));
    for (const id of ['textureSize', 'webpToggle']) $(id)?.addEventListener('change', renderMaps);
    render(); renderMaps();
  }

  // A newly opened model starts "as in the file". Rebuilt previews (live reducer, texture apply) re-use the current setting.
  window.addEventListener('shrink:model-opened', () => { scale = 1; dropMR = false; dropAO = false; rough = 0.5; setTimeout(() => { const a = app(); if (a) capture(a.originalModel); for (const id of ['dropMR', 'dropAO']) if ($(id)) $(id).checked = false; render(); renderMaps(); }, 0); });
  for (const ev of ['shrink:live-ready', 'shrink:live-updated', 'shrink:texture-applied', 'shrink:optimized']) window.addEventListener(ev, () => { applyToViewer(); render(); });

  window.__shrinkMaterial = { applyToModel, applyToDocument, applyToViewer, setScale, setMaps, savings, refresh: renderMaps, get metalScale() { return scale; }, get changed() { return Math.abs(scale - 1) > 1e-6 || dropMR || dropAO; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true }); else inject();
})();
