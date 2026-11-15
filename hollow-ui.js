import { OrbitControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { gatherWorld } from './repair-core.js?v=2.196';
import { buildBinaryStl } from './mesh-tools.js?v=2.18';

const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
const alive = () => !$('v2HollowBtn')?.disabled && !!$('v2HollowBtn') && !window.__shrinkBatchRunning
  && document.body.classList.contains('app-mode-print');
let active = null;

export function cancelHollow() { active?.dialog.close(); }

export function openHollow() {
  if (active || !alive()) return;
  const source = window.__shrinkWorkingModel?.();
  const scale = window.__shrinkPrint?.printMmPerUnit?.();
  const THREE = app()?.THREE;
  if (!source || !THREE || !Number.isFinite(scale) || scale <= 0) throw Error('The finished model is not ready yet.');
  const data = gatherWorld(THREE, source);
  if (data.indices.length > 3_000_000) throw Error('This mesh is too dense to hollow here. Reduce the detail first or use your slicer.');
  for (let i = 0; i < data.positions.length; i++) data.positions[i] *= scale;

  const dialog = document.createElement('dialog');
  dialog.id = 'v2HollowDialog';
  dialog.setAttribute('aria-labelledby', 'v2HollowTitle');
  dialog.innerHTML = `
    <header><h2 id="v2HollowTitle">Hollow for Resin</h2><form method="dialog"><button aria-label="Close hollowing">Close</button></form></header>
    <div class="hollow-layout">
      <div class="hollow-preview"></div>
      <div class="hollow-controls">
        <p>Your solid download stays unchanged. This tool makes a separate hollow STL.</p>
        <label>Wall thickness (mm) <input id="hollowWall" type="number" min="0.8" max="10" step="0.1" value="2"></label>
        <button id="hollowBuild" type="button">Preview cavity</button>
        <label><input id="hollowXray" type="checkbox" disabled> Show cavity through shell</label>
        <label>Hole diameter (mm) <input id="hollowDiameter" type="number" min="1" max="15" step="0.1" value="3"></label>
        <button id="hollowPlace" type="button" aria-pressed="false" disabled>Add drain holes</button>
        <small>Drag to rotate. In Add drain holes mode, click the surface to place a hole. Add two separate openings for each cavity.</small>
        <ol id="hollowHoles" aria-label="Drain holes"></ol>
        <p id="hollowStatus" role="status" aria-live="polite">Preview the cavity first, then place the holes.</p>
        <button id="hollowSave" type="button" disabled>Download hollow STL</button>
        <small>Check drainage and suction cups after orienting in your slicer.</small>
      </div>
    </div>`;
  document.body.append(dialog);
  const find = s => dialog.querySelector(s);
  let renderer, controls, worker, observer, raf, inner, preview, markers, result, pending, ready = false, placing = false, cleaned = false;
  let holes = [], chambers = 0, saved = 0, request = 0, msg = '';
  const owned = [];
  const scene = new THREE.Scene();
  const dispose = o => { if (o) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } };
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    active = null;
    worker?.terminate();
    observer?.disconnect();
    cancelAnimationFrame(raf);
    controls?.dispose();
    dispose(inner); dispose(preview);
    for (const o of [...(markers?.children || []), ...owned.splice(0)]) dispose(o);
    renderer?.dispose();
    renderer?.forceContextLoss();
    dialog.remove();
  }
  active = { dialog };
  dialog.addEventListener('close', cleanup, { once: true });

  try {
    const host = find('.hollow-preview');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x172329);
    host.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1e5);
    controls = new OrbitControls(camera, renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe7f6ff, 0x485d66, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(4, 7, 5); scene.add(key);

    function mesh(positions, indices, color, side = THREE.FrontSide) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setIndex(new THREE.BufferAttribute(indices, 1));
      return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, side, roughness: 0.85, flatShading: true }));
    }
    const outer = mesh(data.positions, data.indices, 0xb0c5cc, THREE.DoubleSide);
    scene.add(outer); owned.push(outer);
    const bounds = new THREE.Box3().setFromObject(outer);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()).length();
    camera.position.copy(center).add(new THREE.Vector3(0.8, 0.55, 1).multiplyScalar(size));
    controls.target.copy(center);
    controls.update();
    const render = () => {
      raf = requestAnimationFrame(render);
      renderer.render(scene, camera);
    };
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    observer = new ResizeObserver(resize); observer.observe(host);

    const wall = find('#hollowWall'), diameter = find('#hollowDiameter'), xray = find('#hollowXray');
    const build = find('#hollowBuild'), place = find('#hollowPlace'), save = find('#hollowSave'), status = find('#hollowStatus'), list = find('#hollowHoles');
    markers = new THREE.Group();
    scene.add(markers);
    function display() {
      const ghost = ready && xray.checked;
      outer.material.transparent = ghost;
      outer.material.opacity = ghost ? 0.22 : 1;
      outer.material.depthWrite = !ghost;
      outer.visible = ghost || !preview;
      if (inner) inner.visible = ghost;
      if (preview) preview.visible = !ghost;
      for (const marker of [...markers.children]) dispose(marker);
      const radius = Number(diameter.value) / 2;
      if (!(radius > 0 && radius <= 7.5)) return;
      holes.forEach(({ point, normal, status: s }) => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 32),
          new THREE.MeshBasicMaterial({ color: s === 'Connected to cavity' ? 0x91f2ab : s ? 0xff906c : 0xffd485, side: THREE.DoubleSide, depthTest: !ghost }));
        ring.position.fromArray(point).addScaledVector(new THREE.Vector3().fromArray(normal), Math.max(0.05, size * 0.001));
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), new THREE.Vector3().fromArray(normal));
        ring.renderOrder = 3; markers.add(ring);
      });
    }
    function show() {
      const busy = !!pending;
      build.disabled = busy || !wall.checkValidity() || !wall.value;
      place.disabled = !ready || pending === 'prepare';
      place.setAttribute('aria-pressed', String(placing));
      place.textContent = placing ? 'Finish placing holes' : 'Add drain holes';
      renderer.domElement.style.cursor = placing ? 'crosshair' : '';
      xray.disabled = !ready;
      save.disabled = !result || busy;
      status.textContent = msg;
      display();
    }
    function listHoles() {
      list.replaceChildren(...holes.map((h, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = 'Remove'; b.setAttribute('aria-label', `Remove hole ${i + 1}`);
        li.append(`Hole ${i + 1}${h.status ? ' · ' + h.status : ''} `, b);
        b.addEventListener('click', () => { holes.splice(i, 1); drill(); });
        return li;
      }));
    }
    function clearResult() { result = null; dispose(preview); preview = null; }
    function drill() {
      clearResult();
      holes.forEach(h => { h.status = ''; });
      listHoles();
      request++;
      pending = null;
      if (!ready || !holes.length || !diameter.value || !diameter.checkValidity()) {
        msg = ready ? cavityMessage() : 'Preview the cavity first.';
        if (!diameter.value || !diameter.checkValidity()) msg = 'Choose a hole diameter between 1 and 15 mm.';
        show(); return;
      }
      pending = 'drill'; msg = 'Checking the drain holes…'; show();
      worker.postMessage({ type: 'drill', id: request, holes, diameter: Number(diameter.value) });
    }
    function cavityMessage() { return `${chambers} ${chambers === 1 ? 'cavity' : 'cavities'} · estimated resin saved ${saved.toFixed(2)} ml. Add two openings per cavity.`; }
    function resetCavity() {
      request++; pending = null; ready = false; placing = false;
      dispose(inner); inner = null; clearResult(); holes = []; listHoles();
      msg = 'Preview the cavity first, then place the holes.'; show();
    }
    worker = new Worker(new URL('./hollow-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: e }) => {
      if (e.id !== request || !dialog.open) return;
      if (e.type === 'progress') { msg = e.message; show(); return; }
      pending = null;
      if (e.type === 'prepared') {
        ready = true; chambers = e.chambers; saved = e.savedMl;
        inner = mesh(e.positions, e.indices, 0x46eeb1); scene.add(inner);
        inner.renderOrder = -1;
        xray.checked = true; msg = cavityMessage();
      } else if (e.type === 'drilled') {
        holes.forEach((h, i) => { h.status = e.statuses[i]; }); listHoles();
        if (e.positions) {
          result = e; preview = mesh(e.positions, e.indices, 0xb0c5cc); scene.add(preview);
          msg = `Drain holes connected · estimated resin saved ${e.savedMl.toFixed(2)} ml.`;
        } else {
          const need = e.count.reduce((n, count) => n + Math.max(0, 2 - count), 0);
          msg = need ? `Still needed: ${need} connected ${need === 1 ? 'opening' : 'openings'} across ${chambers} ${chambers === 1 ? 'cavity' : 'cavities'}.`
            : 'Move or remove the holes that do not connect cleanly.';
        }
      } else { msg = e.message || 'Could not hollow this model.'; }
      show();
    };
    worker.onerror = () => { if (!dialog.open) return; pending = null; msg = 'The hollowing engine could not start. Close this panel and try again.'; show(); };
    wall.addEventListener('input', resetCavity);
    diameter.addEventListener('change', () => { if (ready) drill(); });
    // Invalidate immediately while typing, so an older diameter cannot be exported.
    diameter.addEventListener('input', () => {
      if (!ready) return;
      request++; pending = null; clearResult(); msg = 'Apply the new diameter by pressing Enter or leaving the field.'; show();
    });
    diameter.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); diameter.blur(); } });
    xray.addEventListener('change', display);
    build.addEventListener('click', () => {
      resetCavity();
      pending = 'prepare'; msg = 'Preparing hollow preview…'; show();
      worker.postMessage({ type: 'prepare', id: request, ...data, wall: Number(wall.value) });
    });
    place.addEventListener('click', () => { placing = !placing; show(); });
    const raycaster = new THREE.Raycaster();
    let down;
    renderer.domElement.addEventListener('pointerdown', e => { down = e.button === 0 ? [e.clientX, e.clientY] : null; });
    renderer.domElement.addEventListener('pointerup', e => {
      const start = down; down = null;
      if (!placing || !ready || !start || !e.isPrimary || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5 || holes.length >= 20) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera);
      const hit = raycaster.intersectObject(outer)[0];
      if (!hit) return;
      const n = hit.face.normal.clone();
      if (n.dot(raycaster.ray.direction) > 0) n.negate();
      holes.push({ point: hit.point.toArray(), normal: n.toArray() }); drill();
    });
    save.addEventListener('click', () => {
      if (!result || pending || !alive() || source !== window.__shrinkWorkingModel?.() || scale !== window.__shrinkPrint?.printMmPerUnit?.()) return;
      const model = mesh(result.positions, result.indices, 0xffffff);
      try {
        const { buffer } = buildBinaryStl({ THREE, model, mmPerUnit: 1, zUp: $('zUpToggle')?.checked ?? true });
        const name = (app()?.baseName?.() || 'model') + '-SHRINK-HOLLOW.stl';
        const url = URL.createObjectURL(new Blob([buffer], { type: 'model/stl' }));
        const link = document.createElement('a'); link.href = url; link.download = name;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        msg = 'Hollow STL downloaded. Check the layers in your slicer.'; show();
      } catch (e) { msg = e.message || 'Could not export the hollow STL.'; show(); }
      finally { dispose(model); }
    });
    dialog.showModal(); resize(); show(); render();
  } catch (err) { cleanup(); throw err; }
}

for (const event of ['shrink:model-opened', 'shrink:reduced', 'shrink:ui-mode']) window.addEventListener(event, cancelHollow);
