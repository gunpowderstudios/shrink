// SHRINK 3D v2.87 — Tron (beta), Game mode: turn a car into a solid, flat-faced low-poly version with four separate wheels.
// The maths is in tron-core.js (run in tron-worker.js). This file gathers the model's triangles and colours, shows the result in the viewer
// in place of the model, and saves it as a GLB. It never changes the loaded model: "Back to the normal model" (or any other viewer button) returns to it.
(() => {
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  const VERSION = '2.87';
  const fmt = n => Number(n).toLocaleString('en-GB');
  let worker = null, workerFailed = false, jobId = 0, cache = null, lastResult = null, previewRoot = null, hiddenModel = null, busy = false, timer = null;

  /* ---------- gather the model: world-space positions, normals, per-vertex sRGB colour ---------- */
  const textureCache = new Map();
  function texelData(tex) {
    if (textureCache.has(tex)) return textureCache.get(tex);
    let out = null;
    try {
      const img = tex.image; const w0 = img.width || img.videoWidth, h0 = img.height || img.videoHeight;
      if (w0 && h0) {
        const k = Math.min(1, 2048 / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
        out = { w, h, data: g.getImageData(0, 0, w, h).data, flipY: !!tex.flipY };
      }
    } catch (e) { console.warn('[Tron] could not read a texture', e); }
    textureCache.set(tex, out);
    return out;
  }
  function collect(root) {
    const THREE = app().THREE;
    root.updateWorldMatrix(true, true);
    const parts = []; let nv = 0, ni = 0;
    root.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position && o.visible && !o.isSkinnedMesh) { parts.push(o); nv += o.geometry.attributes.position.count; ni += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; } });
    if (!parts.length) throw new Error('There is no model to flatten.');
    const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), colors = new Uint8Array(nv * 3), indices = new Uint32Array(ni);
    const v = new THREE.Vector3(), n = new THREE.Vector3(), tmp = { r: 0, g: 0, b: 0 };
    let vo = 0, io = 0;
    for (const o of parts) {
      const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ca = g.attributes.color, count = pa.count;
      const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const matOf = new Uint8Array(count);   // which material each vertex belongs to (multi-material meshes list groups of the index)
      if (Array.isArray(o.material) && g.groups.length) for (const gr of g.groups) for (let q = gr.start; q < gr.start + gr.count; q++) { const vi = g.index ? g.index.getX(q) : q; if (vi < count) matOf[vi] = gr.materialIndex; }
      const base = mats.map(m => { const rgb = { r: 1, g: 1, b: 1 }; if (m?.color) m.color.getRGB(rgb, THREE.SRGBColorSpace); return { rgb, tex: m?.map ? texelData(m.map) : null, vc: !!(m?.vertexColors && ca) }; });
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
        positions[(vo + i) * 3] = v.x; positions[(vo + i) * 3 + 1] = v.y; positions[(vo + i) * 3 + 2] = v.z;
        if (na) { n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); normals[(vo + i) * 3] = n.x; normals[(vo + i) * 3 + 1] = n.y; normals[(vo + i) * 3 + 2] = n.z; }
        const b = base[matOf[i]] || base[0]; let r = 255, gg = 255, bl = 255;
        if (b.tex && ua) {
          const tu = ua.getX(i), tv = ua.getY(i), w = b.tex.w, h = b.tex.h;
          const fx = ((tu % 1) + 1) % 1, fy = ((tv % 1) + 1) % 1;
          const px = Math.min(w - 1, Math.floor(fx * w)), py = Math.min(h - 1, Math.floor((b.tex.flipY ? 1 - fy : fy) * h)), o4 = (py * w + px) * 4;
          r = b.tex.data[o4]; gg = b.tex.data[o4 + 1]; bl = b.tex.data[o4 + 2];
        } else if (b.vc) { r = ca.getX(i) * 255; gg = ca.getY(i) * 255; bl = ca.getZ(i) * 255; }
        colors[(vo + i) * 3] = Math.round(r * b.rgb.r); colors[(vo + i) * 3 + 1] = Math.round(gg * b.rgb.g); colors[(vo + i) * 3 + 2] = Math.round(bl * b.rgb.b);
      }
      if (g.index) for (let q = 0; q < g.index.count; q++) indices[io++] = g.index.getX(q) + vo; else for (let q = 0; q < count; q++) indices[io++] = q + vo;
      vo += count;
    }
    // Tron works with the car's length along X. A car that is long in Z is turned a quarter turn about the vertical axis: (x,y,z) -> (z,y,-x).
    let x0 = 1e30, x1 = -1e30, z0 = 1e30, z1 = -1e30;
    for (let i = 0; i < nv; i++) { const x = positions[i * 3], z = positions[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const turned = (z1 - z0) > (x1 - x0) * 1.2;
    if (turned) for (let i = 0; i < nv; i++) {
      const x = positions[i * 3], z = positions[i * 3 + 2]; positions[i * 3] = z; positions[i * 3 + 2] = -x;
      const nx = normals[i * 3], nz = normals[i * 3 + 2]; normals[i * 3] = nz; normals[i * 3 + 2] = -nx;
    }
    return { data: { positions, normals, colors, indices }, turned, triangles: ni / 3 };
  }

  /* ---------- run the flatten (worker, or the page's own thread if a worker cannot start) ---------- */
  function startWorker() {
    if (worker || workerFailed) return worker;
    try { worker = new Worker(`./tron-worker.js?v=${VERSION}`, { type: 'module' }); worker.addEventListener('error', () => { workerFailed = true; worker = null; }); }
    catch { workerFailed = true; worker = null; }
    return worker;
  }
  async function runFlatten(faces, onProgress) {
    const id = ++jobId;
    const w = startWorker();
    if (w) {
      if (!cache.sent) { w.postMessage({ type: 'load', data: { positions: cache.data.positions.slice(), normals: cache.data.normals.slice(), colors: cache.data.colors.slice(), indices: cache.data.indices.slice() } }); cache.sent = true; }
      return new Promise((resolve, reject) => {
        const on = e => {
          const m = e.data; if (m.id !== id) return;
          if (m.type === 'progress') onProgress?.(m.text);
          else { w.removeEventListener('message', on); w.removeEventListener('error', onErr); m.type === 'done' ? resolve(m.result) : reject(new Error(m.message)); }
        };
        const onErr = () => { w.removeEventListener('message', on); workerFailed = true; worker = null; cache.sent = false; reject(new Error('worker')); };
        w.addEventListener('message', on); w.addEventListener('error', onErr, { once: true });
        w.postMessage({ type: 'run', id, faces });
      }).catch(async err => { if (err.message !== 'worker') throw err; return runOnPage(faces, onProgress); });
    }
    return runOnPage(faces, onProgress);
  }
  async function runOnPage(faces, onProgress) {
    const [core, mod] = await Promise.all([import(`./tron-core.js?v=${VERSION}`), import('meshoptimizer')]);
    await mod.MeshoptSimplifier.ready; await new Promise(r => setTimeout(r, 30));
    return core.flattenCar(cache.data, { faces, simplifier: mod.MeshoptSimplifier, onProgress });
  }

  /* ---------- show / hide the result in the viewer ---------- */
  const SRGB = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; SRGB[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function build(result) {
    const THREE = app().THREE, root = new THREE.Group(); root.name = 'TronCar';
    const b = result.body, geo = new THREE.BufferGeometry(), lin = new Float32Array(b.colors.length);
    for (let i = 0; i < lin.length; i++) lin[i] = SRGB[b.colors[i]];
    geo.setAttribute('position', new THREE.BufferAttribute(b.positions, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3)); geo.setAttribute('color', new THREE.BufferAttribute(lin, 3));
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 })); body.name = 'Body'; root.add(body);
    const tyreMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(38 / 255, 38 / 255, 40 / 255, THREE.SRGBColorSpace), roughness: 0.85, flatShading: true });
    const hubMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(170 / 255, 170 / 255, 175 / 255, THREE.SRGBColorSpace), roughness: 0.5, metalness: 0.3, flatShading: true });
    for (const w of result.wheels) {
      const g = new THREE.Group(); g.name = w.name; g.position.set(w.x, w.y, w.z);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, w.width, 18).rotateX(Math.PI / 2), tyreMat); tyre.name = w.name + '_tyre';
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(w.radius * 0.55, w.radius * 0.55, w.width * 1.04, 18).rotateX(Math.PI / 2), hubMat); hub.name = w.name + '_hub';
      g.add(tyre, hub); root.add(g);
    }
    return root;
  }
  function showPreview(root) {
    hidePreview();
    const A = app(), V = window.__shrinkViewer; if (!V) return;
    try { window.__shrinkPaint?.setMode?.('navigate'); } catch {}
    hiddenModel = A.currentModel; if (hiddenModel) hiddenModel.visible = false;
    V.scene.add(root); previewRoot = root; syncButtons();
  }
  function hidePreview() {
    if (previewRoot) {
      previewRoot.parent?.remove(previewRoot);
      previewRoot.traverse(o => { o.geometry?.dispose?.(); });
    }
    if (hiddenModel) hiddenModel.visible = true;
    previewRoot = null; hiddenModel = null; syncButtons();
  }
  function syncButtons() {
    if (!$('tronBack')) return;
    $('tronBack').hidden = !previewRoot; $('tronDownload').hidden = !lastResult; $('tronMake').textContent = previewRoot ? 'Make it again' : 'Make Tron version';
  }

  /* ---------- the button / slider ---------- */
  const setStatus = (t, bad) => { const s = $('tronStatus'); if (s) { s.textContent = t || ''; s.classList.toggle('bad', !!bad); } };
  async function make() {
    if (busy) return;
    const A = app(), model = A?.originalModel;
    if (!model) { setStatus('Open a model first.', true); return; }
    busy = true; $('tronMake').disabled = true; const faces = Number($('tronFaces').value);
    try {
      setStatus('Reading the model…'); await new Promise(r => setTimeout(r, 30));
      if (!cache || cache.key !== model.uuid) { cache = { key: model.uuid, sent: false, ...collect(model) }; }
      const t0 = performance.now();
      const result = await runFlatten(faces, t => setStatus(t));
      lastResult = result; lastResult.turned = cache.turned;
      showPreview(build(result));
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      setStatus(`${fmt(result.body.faces)} triangles in the body${result.wheels.length ? ' + 4 separate wheels' : ' · no wheels found, so the body is one piece'} · ${fmt(cache.triangles)} before · ${secs}s` + (cache.turned ? ' · turned so the length runs along X' : ''));
    } catch (err) {
      console.warn('[Tron]', err); setStatus(`Tron could not finish: ${err.message}`, true);
    } finally { busy = false; $('tronMake').disabled = false; syncButtons(); }
  }
  async function download() {
    if (!previewRoot || !lastResult) return;
    try {
      setStatus('Saving…');
      const { GLTFExporter } = await import('https://esm.sh/three@0.180.0/examples/jsm/exporters/GLTFExporter.js');
      const buf = await new Promise((res, rej) => new GLTFExporter().parse(previewRoot, res, rej, { binary: true }));
      const blob = new Blob([buf], { type: 'model/gltf-binary' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${app().baseName?.() || 'model'}-TRON${lastResult.body.faces}.glb`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus(`Saved ${(blob.size / 1024).toFixed(0)} KB · ${fmt(lastResult.body.faces)} triangles`);
    } catch (err) { console.warn('[Tron]', err); setStatus(`Could not save: ${err.message}`, true); }
  }

  function inject() {
    if ($('tronDetails')) return;
    const host = $('stepExtra'), before = $('retouchDetails'); if (!host || !before) return;
    const d = document.createElement('details'); d.id = 'tronDetails'; d.className = 'fold game-only';
    d.innerHTML = `<summary>Tron <span class="dim">(beta)</span></summary><div class="fold-inner">
      <div class="hint">Turns a car into a solid, flat-faced low-poly version for games: true to the shape, painted in the original colours, with four separate wheels you can spin and steer. Best on a car that sits on its wheels. The interior, wipers and aerial are dropped.</div>
      <div class="control-block"><div class="range-heading"><label for="tronFaces">Triangles</label><output id="tronFacesValue">800</output></div>
        <input id="tronFaces" type="range" min="300" max="5000" step="100" value="800" aria-label="Triangles in the body">
        <div class="slider-ends"><span>Flatter</span><span>Closer to the real car</span></div></div>
      <div class="material-presets"><button id="tronMake" class="button small" type="button">Make Tron version</button><button id="tronDownload" class="button ghost small" type="button" hidden>Download Tron GLB</button><button id="tronBack" class="button ghost small" type="button" hidden>Back to the normal model</button></div>
      <div id="tronStatus" class="hint" aria-live="polite"></div></div>`;
    host.insertBefore(d, before);
    const style = document.createElement('style');
    style.textContent = '#tronStatus.bad{color:#ff9d8f}#tronDetails .material-presets{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}';
    document.head.appendChild(style);
    $('tronFaces').addEventListener('input', () => { $('tronFacesValue').textContent = fmt($('tronFaces').value); });
    $('tronFaces').addEventListener('change', () => { if (previewRoot) { clearTimeout(timer); timer = setTimeout(make, 250); } });   // once a Tron car is showing, the slider re-makes it
    $('tronMake').addEventListener('click', make);
    $('tronDownload').addEventListener('click', download);
    $('tronBack').addEventListener('click', () => { hidePreview(); setStatus(''); });
    for (const id of ['showOriginalBtn', 'showOptimizedBtn', 'compareBtn']) $(id)?.addEventListener('click', () => { if (previewRoot) { hidePreview(); setStatus(''); } }, true);
    syncButtons();
  }
  // a new model, a changed colour or a fresh reduction means the Tron car is out of date
  window.addEventListener('shrink:model-opened', () => { hidePreview(); cache = null; lastResult = null; textureCache.clear(); setStatus(''); syncButtons(); });
  window.addEventListener('shrink:material-look', () => { cache = null; textureCache.clear(); });
  for (const ev of ['shrink:live-updated', 'shrink:optimized']) window.addEventListener(ev, () => { if (previewRoot) hidePreview(); });
  window.__shrinkTron = { make, hide: hidePreview, get showing() { return !!previewRoot; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true }); else inject();
})();
