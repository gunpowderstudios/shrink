// SHRINK 3D v2.73 — Material look (Game mode): turn down the metallic effect of a GLB.
// glTF "metallic" makes a surface mirror its surroundings and tint the reflection with its own colour, so a scanned car with
// metallic = 1 looks like chrome. The slider scales every material's metallic factor (it also scales a metallic texture,
// because glTF multiplies the two). It changes the live preview AND the saved GLB, never the original upload.
(() => {
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  let scale = 1;                                   // 1 = exactly as in the file

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

  function applyToViewer() { const a = app(); if (!a) return; applyToModel(a.originalModel); if (a.optimizedModel && a.optimizedModel !== a.originalModel) applyToModel(a.optimizedModel); }

  // Export: a glTF-Transform document (what is written into the GLB).
  function applyToDocument(doc, s = scale) {
    if (!doc || Math.abs(s - 1) < 1e-6) return 0;
    let n = 0;
    for (const m of doc.getRoot().listMaterials()) {
      const f = m.getMetallicFactor();
      const v = Math.max(0, Math.min(1, f * s));
      if (v !== f) { m.setMetallicFactor(v); n++; }
    }
    return n;
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

  function setScale(pct, { notify = true } = {}) {
    scale = Math.max(0, Math.min(100, Number(pct))) / 100;
    if (!Number.isFinite(scale)) scale = 1;
    applyToViewer(); render();
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
      <div id="metalScaleNote" class="hint"></div></div>`;
    host.insertBefore(d, before);
    const style = document.createElement('style');
    style.textContent = '.material-presets{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}';
    document.head.appendChild(style);
    $('metalScale').addEventListener('input', () => setScale($('metalScale').value));
    $('metalPaint').addEventListener('click', () => setScale(20));
    $('metalMatt').addEventListener('click', () => setScale(0));
    $('metalReset').addEventListener('click', () => setScale(100));
    render();
  }

  // A newly opened model starts "as in the file". Rebuilt previews (live reducer, texture apply) re-use the current setting.
  window.addEventListener('shrink:model-opened', () => { scale = 1; setTimeout(() => { render(); }, 0); });
  for (const ev of ['shrink:live-ready', 'shrink:live-updated', 'shrink:texture-applied', 'shrink:optimized']) window.addEventListener(ev, () => { applyToViewer(); render(); });

  window.__shrinkMaterial = { applyToModel, applyToDocument, applyToViewer, setScale, get metalScale() { return scale; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true }); else inject();
})();
