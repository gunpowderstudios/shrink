import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl, buildObjBlob } from './mesh-tools.js?v=2.18';
import { gatherWorld, repairMesh } from './repair-core.js?v=2.27';

// SHRINK 3D v2.48 — gentle repair + optional Boolean union / make-manifold pass,
// with a best-effort cleanup repair before Manifold gives up.
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
const say = (msg, error = false) => app()?.setStatus?.(msg, error);

const MANIFOLD_JS = 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.js';
const MANIFOLD_WASM = 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.wasm';
let manifoldPromise = null;
async function loadManifold() {
  if (!manifoldPromise) {
    manifoldPromise = import(MANIFOLD_JS).then(async mod => {
      const factory = mod.default;
      const wasm = await factory({ locateFile: path => path.endsWith('.wasm') ? MANIFOLD_WASM : new URL(path, MANIFOLD_JS).href });
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

function sourceModel() { return app()?.optimizedModel || app()?.originalModel || null; }

function statusText(solid) {
  try {
    const s = solid?.status?.();
    if (s == null || s === 0 || String(s).toLowerCase() === 'noerror') return '';
    return String(s);
  } catch { return ''; }
}

function rawWorldMesh(mesh) {
  const g = mesh.geometry;
  const pos = g?.attributes?.position;
  if (!pos || pos.count < 3) return null;
  mesh.updateWorldMatrix(true, false);
  const world = mesh.matrixWorld;
  const flipped = world.determinant() < 0;
  const v = new THREE.Vector3();
  const verts = new Float64Array(pos.count * 3);
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(world);
    verts[i*3]=v.x; verts[i*3+1]=v.y; verts[i*3+2]=v.z;
    minX=Math.min(minX,v.x); minY=Math.min(minY,v.y); minZ=Math.min(minZ,v.z);
    maxX=Math.max(maxX,v.x); maxY=Math.max(maxY,v.y); maxZ=Math.max(maxZ,v.z);
  }
  const count = g.index ? g.index.count : pos.count;
  const tris = new Uint32Array(Math.floor(count / 3) * 3);
  for (let i=0;i<tris.length;i+=3) {
    const a=g.index ? g.index.getX(i) : i;
    const b=g.index ? g.index.getX(i+1) : i+1;
    const c=g.index ? g.index.getX(i+2) : i+2;
    tris[i]=a; tris[i+1]=flipped?c:b; tris[i+2]=flipped?b:c;
  }
  const diag=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)||1;
  return { verts, tris, diag };
}

function repairMeshData(raw, toleranceScale = 1) {
  const tol=Math.max(raw.diag*1e-6*toleranceScale,1e-8);
  const inv=1/tol;
  const map=new Map();
  const remap=new Uint32Array(raw.verts.length/3);
  const out=[];
  for(let i=0;i<remap.length;i++){
    const x=raw.verts[i*3],y=raw.verts[i*3+1],z=raw.verts[i*3+2];
    const key=`${Math.round(x*inv)},${Math.round(y*inv)},${Math.round(z*inv)}`;
    let ni=map.get(key);
    if(ni===undefined){ ni=out.length/3; map.set(key,ni); out.push(x,y,z); }
    remap[i]=ni;
  }

  const tris=[];
  const seen=new Set();
  let droppedDegenerate=0,droppedDuplicate=0;
  const areaTol2=Math.max(raw.diag*raw.diag*1e-20,1e-24);
  for(let i=0;i<raw.tris.length;i+=3){
    const a=remap[raw.tris[i]],b=remap[raw.tris[i+1]],c=remap[raw.tris[i+2]];
    if(a===b||b===c||a===c){ droppedDegenerate++; continue; }
    const ax=out[a*3],ay=out[a*3+1],az=out[a*3+2];
    const bx=out[b*3],by=out[b*3+1],bz=out[b*3+2];
    const cx=out[c*3],cy=out[c*3+1],cz=out[c*3+2];
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nx*nx+ny*ny+nz*nz<=areaTol2){ droppedDegenerate++; continue; }
    const sorted=[a,b,c].sort((p,q)=>p-q);
    const key=`${sorted[0]},${sorted[1]},${sorted[2]}`;
    if(seen.has(key)){ droppedDuplicate++; continue; }
    seen.add(key); tris.push(a,b,c);
  }
  return {
    verts:new Float32Array(out),
    tris:new Uint32Array(tris),
    stats:{ tolerance:tol, inputVertices:raw.verts.length/3, outputVertices:out.length/3, inputTriangles:raw.tris.length/3, outputTriangles:tris.length/3, droppedDegenerate, droppedDuplicate }
  };
}

function solidFromData(data, wasm) {
  const { Mesh, Manifold } = wasm;
  const mg = new Mesh({ numProp: 3, vertProperties: data.verts, triVerts: data.tris });
  try { mg.merge(); } catch (err) { console.warn('Manifold mesh.merge warning:', err); }
  let solid;
  try { solid = new Manifold(mg); }
  finally { try { mg.delete?.(); } catch {} }
  return solid;
}

function meshToSolid(mesh, wasm) {
  const raw=rawWorldMesh(mesh);
  if(!raw) return null;
  const attempts=[1,10];
  let lastStatus='';
  for(const factor of attempts){
    const repaired=repairMeshData(raw,factor);
    console.info('[SHRINK 3D v1.88] Pre-fuse repair', repaired.stats);
    let solid=null;
    try {
      solid=solidFromData(repaired,wasm);
      const status=statusText(solid);
      if(!solid?.isEmpty?.()) return solid;
      lastStatus=status||lastStatus;
    } catch(err){
      lastStatus=err?.message||String(err);
    }
    try { solid?.delete?.(); } catch {}
  }
  throw new Error(lastStatus ? `Manifold rejected a mesh part after repair: ${lastStatus}` : 'Manifold rejected a mesh part after repair as non-manifold.');
}

function repairWholeModelSolid(model, wasm) {
  const raw = gatherWorld(THREE, model);
  const repaired = repairMesh({
    positions: raw.positions,
    indices: raw.indices,
    onProgress: () => {}
  });
  console.info('[SHRINK 3D v2.43] Detail-preserving whole-model repair before Fuse', repaired.stats);
  const solid = solidFromData({ verts: repaired.positions, tris: repaired.indices }, wasm);
  const status = statusText(solid);
  if (!solid || solid.isEmpty?.()) {
    try { solid?.delete?.(); } catch {}
    throw new Error(status ? `Detail-preserving repair was still rejected: ${status}` : 'Detail-preserving repair was still non-manifold.');
  }
  return solid;
}

function repairedRootFromModel(model) {
  const raw = gatherWorld(THREE, model);
  const repaired = repairMesh({
    positions: raw.positions,
    indices: raw.indices,
    onProgress: () => {}
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(repaired.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(repaired.indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.72, metalness: 0 })
  );
  const root = new THREE.Group();
  root.name = 'SHRINK gentle repair';
  root.userData.shrinkGentleRepair = true;
  root.userData.repairStats = repaired.stats;
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, stats: repaired.stats };
}

async function modelToSolid(model) {
  const wasm = await loadManifold();
  const solids = [];
  const failures = [];
  model.updateMatrixWorld(true);
  model.traverse(obj => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    try {
      const solid = meshToSolid(obj, wasm);
      if (solid) solids.push(solid);
    } catch (err) {
      failures.push(err?.message || String(err));
      console.warn('Could not convert one mesh part to a manifold solid after repair', err);
    }
  });
  // If even one part failed, do not silently omit it. Repair the complete model in
  // world space first, preserving the existing axis/orientation, then retry Manifold.
  if (failures.length) {
    for (const s of solids) try { s.delete?.(); } catch {}
    solids.length = 0;
    try {
      solids.push(repairWholeModelSolid(model, wasm));
      failures.length = 0;
    } catch (err) {
      const first = failures[0] ? ` ${failures[0]}` : '';
      throw new Error(`No printable solid parts could be read from this model after detail-preserving repair.${first} ${err?.message || ''}`.trim());
    }
  }
  if (!solids.length) throw new Error('No printable solid parts could be read from this model after repair.');

  let result = null;
  try {
    result = solids.length === 1 ? solids[0] : wasm.Manifold.union(solids);
    const status = statusText(result);
    if (result?.isEmpty?.()) throw new Error(status ? `Boolean union failed: ${status}` : 'Boolean union produced an empty mesh.');
    const pieces = result.decompose();
    const components = pieces.length;
    for (const p of pieces) try { p.delete?.(); } catch {}
    for (const s of solids) if (s !== result) try { s.delete?.(); } catch {}
    return { solid: result, components, wasm };
  } catch (err) {
    for (const s of solids) try { s.delete?.(); } catch {}
    try { result?.delete?.(); } catch {}
    throw err;
  }
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  geometry.computeVertexNormals();
  try { m.delete?.(); } catch {}
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.72, metalness: 0 }));
  const root = new THREE.Group(); root.add(mesh); root.updateMatrixWorld(true);
  return root;
}

async function fuseModel(model) {
  const { solid, components } = await modelToSolid(model);
  try { return { root: solidToThree(solid), components }; }
  finally { try { solid.delete?.(); } catch {} }
}

function injectUI() {
  if ($('fuseSolidToggle')) return;
  const save = $('stepSave');
  const exportRow = save?.querySelector('.export-row');
  if (!save || !exportRow) return;
  const box = document.createElement('div');
  box.className = 'fuse-solid-box print-only';
  box.innerHTML = `<label class="toggle-row fuse-solid-row"><span><strong>Fuse into one solid</strong><small>Repair/weld the mesh, Boolean-union touching parts, remove internal faces and make a manifold shell before export.</small></span><input id="fuseSolidToggle" type="checkbox" checked /></label><div class="hint fuse-solid-hint">If SHRINK still cannot make a valid solid, Split will use the direct capped fallback instead.</div>`;
  save.insertBefore(box, exportRow);
  const style = document.createElement('style');
  style.textContent = `.fuse-solid-box{margin:12px 0;padding:10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.018)}.fuse-solid-row{border:0!important;margin:0!important;padding:0!important;background:transparent!important;align-items:flex-start!important}.fuse-solid-row span{display:block;min-width:0}.fuse-solid-row strong{display:block;font-size:13px;margin-bottom:3px}.fuse-solid-row small{display:block;color:var(--muted);font-size:11px;line-height:1.4;font-weight:400}.fuse-solid-hint{margin-top:7px}`;
  document.head.appendChild(style);
}

async function fusedExport(kind, evt) {
  const toggle = $('fuseSolidToggle');
  if (!toggle?.checked || document.body.classList.contains('app-mode-game')) return;
  evt.preventDefault(); evt.stopImmediatePropagation();
  const model = sourceModel(); if (!model) return;
  const stlBtn = $('saveStlBtn'), objBtn = $('saveObjBtn');
  stlBtn.disabled = true; objBtn.disabled = true;
  const oldStl = stlBtn.textContent, oldObj = objBtn.textContent;
  (kind === 'stl' ? stlBtn : objBtn).textContent = 'Repairing + fusing…';
  try {
    say('Repairing seams, removing bad triangles and fusing overlapping parts…');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    const { root, components } = await fuseModel(model);
    if (components !== 1) {
      root.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
      throw new Error(`The Boolean union still contains ${components} disconnected solids. Move/overlap those parts, or use a voxel-remesh tool to bridge real gaps.`);
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
    console.error(err); say(`Fuse failed: ${err.message}`, true);
  } finally {
    stlBtn.disabled = false; objBtn.disabled = false; stlBtn.textContent = oldStl; objBtn.textContent = oldObj;
  }
}

function wire() {
  injectUI();
  $('saveStlBtn')?.addEventListener('click', e => fusedExport('stl', e), true);
  $('saveObjBtn')?.addEventListener('click', e => fusedExport('obj', e), true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true }); else wire();
window.__shrinkFuse = { fuseModel, modelToSolid, loadManifold, solidToThree, repairModel: repairedRootFromModel };
