import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl } from './mesh-tools.js?v=1.80';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';

// SHRINK 3D v1.80 — split tall print models into watertight STL sections with keyed alignment pegs.
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
const say = (msg, error = false) => app()?.setStatus?.(msg, error);

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function sourceModel() { return app()?.optimizedModel || app()?.originalModel || null; }
function finishedHeightMM() { return Math.max(1, Number($('figureHeightMm')?.value) || 75); }
function mmPerUnit() { return window.__shrinkPrint?.mmPerUnit?.() || 1; }

function partCount() {
  const mode = $('splitMode')?.value || 'off';
  if (mode === '2' || mode === '3') return Number(mode);
  if (mode === 'max') {
    const max = Math.max(20, Number($('splitMaxHeight')?.value) || 80);
    return Math.max(2, Math.min(6, Math.ceil(finishedHeightMM() / max)));
  }
  return 1;
}

function boundsFor(model) { return new THREE.Box3().setFromObject(model); }

let previewGroup = null;
function clearPreview() {
  const scene = window.__shrinkViewer?.scene;
  if (previewGroup && scene) scene.remove(previewGroup);
  if (previewGroup) previewGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  previewGroup = null;
}

function updatePreview() {
  clearPreview();
  const n = partCount(), model = sourceModel(), scene = window.__shrinkViewer?.scene;
  const info = $('splitInfo');
  if (!model || !scene || n <= 1 || !document.body.classList.contains('app-mode-print')) {
    if (info) info.textContent = 'Off — export one STL.';
    return;
  }
  const box = boundsFor(model), size = box.getSize(new THREE.Vector3());
  previewGroup = new THREE.Group();
  previewGroup.name = 'shrink-split-preview';
  for (let i = 1; i < n; i++) {
    const y = box.min.y + size.y * i / n;
    const geom = new THREE.PlaneGeometry(Math.max(size.x * 1.15, .01), Math.max(size.z * 1.15, .01));
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x56ff9a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(geom, mat); plane.position.y = y; previewGroup.add(plane);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: 0x56ff9a, transparent: true, opacity: .9 }));
    edges.position.y = y + size.y * 0.0005; previewGroup.add(edges);
  }
  scene.add(previewGroup);
  const each = finishedHeightMM() / n;
  if (info) info.textContent = `${n} sections · about ${each.toFixed(0)} mm high each · green planes show the cuts.`;
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
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.72 })));
  root.updateMatrixWorld(true);
  return root;
}

function disposeThree(root) {
  root?.traverse?.(o => { if (o.isMesh) { o.geometry?.dispose?.(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m?.dispose?.()); } });
}

function makeYCylinder(wasm, height, radius, x, y, z, segments = 28) {
  return wasm.Manifold.cylinder(height, radius, radius, segments, false).rotate([-90, 0, 0]).translate([x, y, z]);
}

function choosePegPoints(solid, wasm, y, box, r, depth) {
  const min = box.min, max = box.max;
  const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
  const dx = (max.x - min.x) * .22, dz = (max.z - min.z) * .22;
  const candidates = [[cx,cz],[cx-dx,cz],[cx+dx,cz],[cx,cz-dz],[cx,cz+dz],[cx-dx,cz-dz],[cx+dx,cz+dz],[cx-dx,cz+dz],[cx+dx,cz-dz]];
  const scored = [];
  for (const [x,z] of candidates) {
    let probe = null, hit = null;
    try {
      const h = Math.max(depth * .35, r * 1.5);
      probe = makeYCylinder(wasm, h, r * 1.2, x, y - h / 2, z, 18);
      hit = solid.intersect(probe);
      const vol = hit.volume?.() || 0;
      if (vol > 0) scored.push({ x, z, vol });
    } catch {} finally { try { hit?.delete?.(); } catch {} try { probe?.delete?.(); } catch {} }
  }
  scored.sort((a,b) => b.vol - a.vol);
  if (!scored.length) return [];
  const first = scored[0];
  const second = scored.slice(1).sort((a,b) => ((b.x-first.x)**2 + (b.z-first.z)**2) - ((a.x-first.x)**2 + (a.z-first.z)**2))[0];
  return second ? [first, second] : [first];
}

function sectionSolid(solid, minY, maxY) {
  let part = solid.trimByPlane([0, 1, 0], minY);
  if (Number.isFinite(maxY)) {
    const next = part.trimByPlane([0, -1, 0], -maxY);
    try { part.delete?.(); } catch {}
    part = next;
  }
  return part;
}

async function splitSolid(solid, wasm, n, withPegs) {
  const m = solid.getMesh();
  const np = m.numProp;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i=0;i<m.vertProperties.length;i+=np) {
    const x=m.vertProperties[i], y=m.vertProperties[i+1], z=m.vertProperties[i+2];
    minX=Math.min(minX,x); minY=Math.min(minY,y); minZ=Math.min(minZ,z); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); maxZ=Math.max(maxZ,z);
  }
  try { m.delete?.(); } catch {}
  const box = { min:{x:minX,y:minY,z:minZ}, max:{x:maxX,y:maxY,z:maxZ} };
  const cuts = Array.from({length:n-1}, (_,i) => minY + (maxY-minY)*(i+1)/n);
  const parts = Array.from({length:n}, (_,i) => sectionSolid(solid, i===0 ? minY-(maxY-minY)*.01 : cuts[i-1], i===n-1 ? maxY+(maxY-minY)*.01 : cuts[i]));

  if (withPegs) {
    const scale = mmPerUnit();
    const radiusMain = Math.max(.5, Number($('pegDiameter')?.value || 4) / 2) / scale;
    const depth = Math.max(2, Number($('pegDepth')?.value || 6)) / scale;
    const clearance = Math.max(.05, Number($('pegClearance')?.value || .2)) / scale;
    const eps = Math.max(clearance * .25, (maxY-minY)*1e-5);
    for (let i=0;i<cuts.length;i++) {
      const y = cuts[i];
      const points = choosePegPoints(solid, wasm, y, box, radiusMain, depth);
      for (let p=0;p<Math.min(2,points.length);p++) {
        const {x,z} = points[p];
        const r = p===0 ? radiusMain : radiusMain*.76;
        let peg=null,socket=null,newLower=null,newUpper=null;
        try {
          peg = makeYCylinder(wasm, depth+eps, r, x, y-eps, z);
          socket = makeYCylinder(wasm, depth+eps*2, r+clearance, x, y-eps, z);
          newLower = parts[i].add(peg);
          newUpper = parts[i+1].subtract(socket);
          try { parts[i].delete?.(); } catch {} try { parts[i+1].delete?.(); } catch {}
          parts[i]=newLower; parts[i+1]=newUpper; newLower=null; newUpper=null;
        } finally {
          try { peg?.delete?.(); } catch {} try { socket?.delete?.(); } catch {} try { newLower?.delete?.(); } catch {} try { newUpper?.delete?.(); } catch {}
        }
      }
    }
  }
  return parts;
}

async function exportSplitSTL(evt) {
  const n = partCount();
  if (n <= 1 || !document.body.classList.contains('app-mode-print')) return;
  evt.preventDefault(); evt.stopImmediatePropagation();
  const btn = $('saveStlBtn');
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Splitting model…';
  let solid = null, parts = [];
  try {
    const model = sourceModel(); if (!model) return;
    if (!window.__shrinkFuse?.modelToSolid) throw new Error('Fuse engine is not ready yet. Reload SHRINK 3D and try again.');
    say('Fusing the model, cutting watertight sections and adding alignment pegs…');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r,0)));
    const built = await window.__shrinkFuse.modelToSolid(model);
    solid = built.solid;
    const wasm = built.wasm;
    if (built.components !== 1) throw new Error(`The model still contains ${built.components} disconnected solids after fusion. Overlap the parts before splitting.`);
    const withPegs = $('splitJoint')?.value !== 'flat';
    parts = await splitSolid(solid, wasm, n, withPegs);
    const files = {}, scale = mmPerUnit(), zUp = $('zUpToggle')?.checked !== false;
    const base = app()?.baseName?.() || 'model';
    let totalTris = 0;
    for (let i=0;i<parts.length;i++) {
      if (parts[i]?.isEmpty?.()) throw new Error(`Part ${i+1} is empty. Move the cut position or use fewer sections.`);
      const root = solidToThree(parts[i]);
      const out = buildBinaryStl({ THREE, model: root, mmPerUnit: scale, zUp });
      totalTris += out.triangles;
      files[`${base}-part-${i+1}-of-${parts.length}.stl`] = new Uint8Array(out.buffer);
      disposeThree(root);
    }
    const zip = zipSync(files, { level: 0 });
    saveBlob(new Blob([zip], {type:'application/zip'}), `${base}-split-${parts.length}-parts.zip`);
    say(`Saved ${parts.length} watertight STL sections in one ZIP${withPegs ? ' with keyed alignment pegs' : ''} · ${new Intl.NumberFormat().format(totalTris)} triangles total.`);
  } catch (err) {
    console.error(err); say(`Split failed: ${err.message}`, true);
  } finally {
    for (const p of parts) try { p?.delete?.(); } catch {}
    try { solid?.delete?.(); } catch {}
    btn.disabled = false; btn.textContent = old;
  }
}

function injectUI() {
  if ($('splitMode')) return;
  const save = $('stepSave'), exportRow = save?.querySelector('.export-row');
  if (!save || !exportRow) return;
  const box = document.createElement('div');
  box.className = 'split-print-box print-only';
  box.innerHTML = `<div class="split-title"><strong>Split for printing</strong><small>Cut tall models into separate watertight STLs.</small></div><label class="field"><span>Sections</span><select id="splitMode"><option value="off">Off — one STL</option><option value="2">2 parts</option><option value="3">3 parts</option><option value="max">By maximum part height</option></select></label><label id="splitMaxWrap" class="field" hidden><span>Maximum part height (mm)</span><input id="splitMaxHeight" type="number" min="20" max="500" step="5" value="80"></label><label class="field"><span>Joint</span><select id="splitJoint"><option value="pegs" selected>Keyed twin pegs</option><option value="flat">Flat cut — no pegs</option></select></label><div id="splitPegSettings" class="field-grid split-peg-grid"><label class="field"><span>Peg Ø (mm)</span><input id="pegDiameter" type="number" min="1" max="20" step="0.5" value="4"></label><label class="field"><span>Depth (mm)</span><input id="pegDepth" type="number" min="2" max="30" step="0.5" value="6"></label></div><label id="splitClearanceWrap" class="field"><span>Socket clearance (mm)</span><input id="pegClearance" type="number" min="0.05" max="1" step="0.05" value="0.20"></label><div id="splitInfo" class="hint">Off — export one STL.</div>`;
  save.insertBefore(box, exportRow);
  const style = document.createElement('style');
  style.textContent = `.split-print-box{margin:12px 0;padding:11px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.018);display:grid;gap:9px}.split-title strong,.split-title small{display:block}.split-title strong{font-size:13px}.split-title small{font-size:11px;color:var(--muted);margin-top:2px}.split-peg-grid{margin:0!important}`;
  document.head.appendChild(style);
  const sync = () => {
    const on = $('splitMode').value !== 'off', max = $('splitMode').value === 'max', pegs = $('splitJoint').value === 'pegs';
    $('splitMaxWrap').hidden = !max; $('splitPegSettings').hidden = !on || !pegs; $('splitClearanceWrap').hidden = !on || !pegs; updatePreview();
  };
  ['splitMode','splitMaxHeight','splitJoint','pegDiameter','pegDepth','pegClearance','figureHeightMm'].forEach(id => $(id)?.addEventListener('input', sync));
  $('splitMode')?.addEventListener('change', sync); $('splitJoint')?.addEventListener('change', sync);
  window.addEventListener('shrink:model-opened', () => setTimeout(updatePreview, 0));
  window.addEventListener('shrink:live-updated', () => { if (partCount()>1) updatePreview(); });
  window.addEventListener('shrink:ui-mode', updatePreview);
  sync();
}

function wire() { injectUI(); $('saveStlBtn')?.addEventListener('click', exportSplitSTL, true); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, {once:true}); else wire();
window.__shrinkSplit = { updatePreview, partCount };
