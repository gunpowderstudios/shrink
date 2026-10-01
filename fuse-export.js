import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl, buildObjBlob } from './mesh-tools.js?v=1.77';

// SHRINK 3D v1.77 — optional print export Boolean union / make-manifold pass.
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
const say = (msg, error = false) => app()?.setStatus?.(msg, error);

let manifoldPromise = null;
async function loadManifold() {
  if (!manifoldPromise) {
    manifoldPromise = import('https://esm.sh/manifold-3d@3.5.1?bundle').then(async mod => {
      const wasm = await mod.default();
      wasm.setup();
      return wasm;
    });
  }
  return manifoldPromise;
}

function saveBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

function sourceModel() {
  return app()?.optimizedModel || app()?.originalModel || null;
}

function meshToSolid(mesh, wasm) {
  const { Mesh, Manifold } = wasm;
  const g = mesh.geometry;
  const pos = g?.attributes?.position;
  if (!pos || pos.count < 3) return null;

  mesh.updateWorldMatrix(true, false);
  const world = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const verts = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(world);
    verts[i * 3] = v.x;
    verts[i * 3 + 1] = v.y;
    verts[i * 3 + 2] = v.z;
  }

  const count = g.index ? g.index.count : pos.count;
  const tris = new Uint32Array(Math.floor(count / 3) * 3);
  const flipped = world.determinant() < 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = g.index ? g.index.getX(i) : i;
    const b = g.index ? g.index.getX(i + 1) : i + 1;
    const c = g.index ? g.index.getX(i + 2) : i + 2;
    tris[i] = a;
    tris[i + 1] = flipped ? c : b;
    tris[i + 2] = flipped ? b : c;
  }

  const mg = new Mesh({ numProp: 3, vertProperties: verts, triVerts: tris });
  // Best-effort repair for STL-style duplicate/open seams before constructing the solid.
  try { mg.merge(); } catch {}
  const solid = Manifold.ofMesh(mg);
  try { mg.delete?.(); } catch {}
  return solid;
}

function solidToThree(solid) {
  const m = solid.getMesh();
  const n = Math.floor(m.vertProperties.length / m.numProp);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = m.vertProperties[i * m.numProp];
    positions[i * 3 + 1] = m.vertProperties[i * m.numProp + 1];
    positions[i * 3 + 2] = m.vertProperties[i * m.numProp + 2];
  }
  const indices = new Uint32Array(m.triVerts);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  try { m.delete?.(); } catch {}
  const material = new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.72, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  const root = new THREE.Group();
  root.add(mesh);
  root.updateMatrixWorld(true);
  return root;
}

async function fuseModel(model) {
  const wasm = await loadManifold();
  const solids = [];
  model.updateMatrixWorld(true);
  model.traverse(obj => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    try {
      const solid = meshToSolid(obj, wasm);
      if (solid) solids.push(solid);
    } catch (err) {
      console.warn('Could not convert one mesh part to a manifold solid', err);
    }
  });
  if (!solids.length) throw new Error('No printable solid parts could be read from this model.');

  let result = null;
  let pieces = [];
  try {
    result = solids.length === 1 ? solids[0] : wasm.Manifold.union(solids);
    // Force evaluation before asking how many disconnected components remain.
    const status = result.status?.();
    if (status && String(status).toLowerCase() !== 'noerror' && String(status) !== '0') {
      console.warn('Manifold status:', status);
    }
    pieces = result.decompose();
    const components = pieces.length;
    const root = solidToThree(result);
    return { root, components };
  } finally {
    for (const p of pieces) try { p.delete?.(); } catch {}
    for (const s of solids) {
      if (s !== result) try { s.delete?.(); } catch {}
    }
    try { result?.delete?.(); } catch {}
  }
}

function injectUI() {
  if ($('fuseSolidToggle')) return;
  const save = $('stepSave');
  const exportRow = save?.querySelector('.export-row');
  if (!save || !exportRow) return;

  const box = document.createElement('div');
  box.className = 'fuse-solid-box print-only';
  box.innerHTML = `
    <label class="toggle-row fuse-solid-row">
      <span><strong>Fuse into one solid</strong><small>Boolean-union touching/overlapping parts, remove internal faces and make a manifold shell before export.</small></span>
      <input id="fuseSolidToggle" type="checkbox" checked />
    </label>
    <div class="hint fuse-solid-hint">If parts are genuinely separate and do not touch, SHRINK will stop and tell you instead of saving a fake “single solid”.</div>`;
  save.insertBefore(box, exportRow);

  const style = document.createElement('style');
  style.textContent = `
    .fuse-solid-box{margin:12px 0;padding:10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.018)}
    .fuse-solid-row{border:0!important;margin:0!important;padding:0!important;background:transparent!important;align-items:flex-start!important}
    .fuse-solid-row span{display:block;min-width:0}.fuse-solid-row strong{display:block;font-size:13px;margin-bottom:3px}.fuse-solid-row small{display:block;color:var(--muted);font-size:11px;line-height:1.4;font-weight:400}
    .fuse-solid-hint{margin-top:7px}
  `;
  document.head.appendChild(style);
}

async function fusedExport(kind, evt) {
  const toggle = $('fuseSolidToggle');
  if (!toggle?.checked || document.body.classList.contains('app-mode-game')) return;
  evt.preventDefault();
  evt.stopImmediatePropagation();

  const model = sourceModel();
  if (!model) return;
  const stlBtn = $('saveStlBtn'), objBtn = $('saveObjBtn');
  stlBtn.disabled = true; objBtn.disabled = true;
  const oldStl = stlBtn.textContent, oldObj = objBtn.textContent;
  const clicked = kind === 'stl' ? stlBtn : objBtn;
  clicked.textContent = 'Fusing parts…';

  try {
    say('Fusing overlapping parts and removing internal geometry…');
    // Let the UI repaint before the WASM Boolean operation starts.
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    const { root, components } = await fuseModel(model);
    if (components !== 1) {
      root.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
      throw new Error(`The Boolean union still contains ${components} disconnected solids. Move/overlap those parts, or use a voxel-remesh tool to bridge the gaps.`);
    }

    const scale = window.__shrinkPrint?.mmPerUnit?.() || 1;
    const zUp = $('zUpToggle')?.checked !== false;
    const name = app()?.baseName?.() || 'model';
    if (kind === 'stl') {
      const { buffer, triangles } = buildBinaryStl({ THREE, model: root, mmPerUnit: scale, zUp });
      saveBlob(new Blob([buffer], { type: 'model/stl' }), `${name}-fused.stl`);
      say(`Saved fused STL: ${new Intl.NumberFormat().format(triangles)} triangles · one connected manifold solid.`);
    } else {
      const { blob, triangles } = buildObjBlob({ THREE, model: root, mmPerUnit: scale, zUp });
      saveBlob(blob, `${name}-fused.obj`);
      say(`Saved fused OBJ: ${new Intl.NumberFormat().format(triangles)} triangles · one connected manifold solid.`);
    }
    root.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
  } catch (err) {
    console.error(err);
    say(`Fuse failed: ${err.message}`, true);
  } finally {
    stlBtn.disabled = false; objBtn.disabled = false;
    stlBtn.textContent = oldStl; objBtn.textContent = oldObj;
  }
}

function wire() {
  injectUI();
  $('saveStlBtn')?.addEventListener('click', e => fusedExport('stl', e), true);
  $('saveObjBtn')?.addEventListener('click', e => fusedExport('obj', e), true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
else wire();

window.__shrinkFuse = { fuseModel };
