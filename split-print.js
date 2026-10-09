import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl } from './mesh-tools.js?v=2.18';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';

// SHRINK 3D v2.71 — peg report (green/amber/red per peg), worst-depth auto placement, Find best cut, export uses the pegs shown.
// Joint convention: upper section carries downward male pegs; lower section carries matching sockets.
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
const say = (msg, error = false) => app()?.setStatus?.(msg, error);

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function sourceModel() { return window.__shrinkWorkingModel?.() || app()?.optimizedModel || app()?.originalModel || null; }
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

function cutFractions(n = partCount()) {
  if (n === 2 && $('splitCutHeight')) {
    return [Math.max(.05, Math.min(.95, Number($('splitCutHeight').value || 50) / 100))];
  }
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n);
}

function boundsFor(model) { return new THREE.Box3().setFromObject(model); }
const manualPegPositions = new Map(); // cut index -> [{x,z}, ...]
let previewCutData = [];

function pegPositionMode() { return $('splitPegPosition')?.value || 'auto'; }
function manualPegMode() { return pegPositionMode() === 'manual' && $('splitJoint')?.value !== 'flat'; }
function clearManualPegPositions() { manualPegPositions.clear(); updatePreview(); }

function pegSizing() {
  const scale = mmPerUnit();
  const radius = Math.max(.5, Number($('pegDiameter')?.value || 4) / 2) / scale;
  const depth = Math.max(2, Number($('pegDepth')?.value || 6)) / scale;
  const clearance = Math.max(.05, Number($('pegClearance')?.value || .2)) / scale;
  const safetyWall = 0.6 / Math.max(scale, 1e-9);
  return { radius, depth, clearance, safeRadius: radius + clearance + safetyWall };
}

function linkLoops(segments, tol) {
  const key = q => `${Math.round(q.x/tol)},${Math.round(q.z/tol)}`;
  const entries = segments.map((seg,i) => ({i,a:seg[0],b:seg[1],used:false})), byKey = new Map();
  const add = (k,i) => { let list = byKey.get(k); if (!list) byKey.set(k, list = []); list.push(i); };
  entries.forEach((e,i) => { add(key(e.a),i); add(key(e.b),i); });
  const loops = [];
  for (let seed=0; seed<entries.length; seed++) {
    if (entries[seed].used) continue;
    const e = entries[seed]; e.used = true;
    const loop = [e.a,e.b]; let current = e.b, closed = false, guard = 0;
    while (guard++ < entries.length+4) {
      const k = key(current), ids = byKey.get(k) || []; let next = null;
      for (const id of ids) if (!entries[id].used) { next = entries[id]; break; }
      if (!next) break;
      next.used = true; current = key(next.a) === k ? next.b : next.a;
      if (Math.hypot(current.x-loop[0].x, current.z-loop[0].z) <= tol*1.5) { closed = true; break; }
      loop.push(current);
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// A cut that lands exactly on a ring of vertices (a flat plateau, a sphere's equator) gives doubled, unusable outlines.
// Slice a hair higher or lower instead (0.02% of the height) so the outline is always clean.
const CUT_NUDGES = [0, 1, -1, 2.5, -2.5];

function cutLoopsFromModel(model, y) {
  if (!model) return [];
  model.updateMatrixWorld(true);
  const box = boundsFor(model), size = box.getSize(new THREE.Vector3());
  const diag = Math.max(size.length(), 1e-6), tol = Math.max(diag * 1e-6, 1e-7), nudge = Math.max(size.y * 2e-4, tol * 50);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const slice = yy => {
    const segments = []; let touched = false;
    const intersect = (p,q) => { const dy = q.y-p.y, t = Math.abs(dy) < 1e-20 ? 0 : (yy-p.y)/dy; return {x:p.x+(q.x-p.x)*t, y:yy, z:p.z+(q.z-p.z)*t}; };
    model.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const g = o.geometry, pos = g.attributes.position, idx = g.index, count = idx ? idx.count : pos.count;
      for (let i=0; i+2<count; i+=3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, idx ? idx.getX(i+1) : i+1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, idx ? idx.getX(i+2) : i+2).applyMatrix4(o.matrixWorld);
        if (Math.min(a.y,b.y,c.y) > yy + tol || Math.max(a.y,b.y,c.y) < yy - tol) continue;   // most triangles never reach the cut
        if (Math.abs(a.y-yy) <= tol || Math.abs(b.y-yy) <= tol || Math.abs(c.y-yy) <= tol) touched = true;
        const tri = [a.clone(), b.clone(), c.clone()], hits = [];
        for (let e=0; e<3; e++) {
          const p = tri[e], q = tri[(e+1)%3], dp = p.y-yy, dq = q.y-yy;
          if (Math.abs(dp) <= tol && Math.abs(dq) <= tol) continue;
          if ((dp < -tol && dq > tol) || (dp > tol && dq < -tol)) hits.push(intersect(p,q));
          else if (Math.abs(dp) <= tol) hits.push({x:p.x, y:yy, z:p.z});
        }
        const unique = [];
        for (const h of hits) if (!unique.some(v => Math.hypot(v.x-h.x, v.z-h.z) <= tol)) unique.push(h);
        if (unique.length >= 2) segments.push([unique[0], unique[1]]);
      }
    });
    return { segments, touched };
  };
  for (const k of CUT_NUDGES) { const r = slice(y + k*nudge); if (!r.touched) return linkLoops(r.segments, tol); }
  return linkLoops(slice(y + nudge).segments, tol);
}

// Signed distance from a point to the edge of the cross-section: positive inside material, negative outside.
function signedDistXZ(x, z, loops) {
  const d = boundaryDistanceXZ(x, z, loops);
  return materialAtCut(x, z, loops) ? d : -d;
}

// The smallest signed distance over several cross-sections: how close the peg's centre ever gets to the outside.
function worstClearance(x, z, slices) {
  let worst = Infinity;
  for (const s of slices) { const v = signedDistXZ(x, z, s.loops || []); if (v < worst) worst = v; }
  return worst;
}

function previewCandidateSafe(point, loops, safeRadius) {
  return !!point && materialAtCut(point.x, point.z, loops) && boundaryDistanceXZ(point.x, point.z, loops) >= safeRadius;
}

function previewCandidateInside(point, loops, radius) {
  return !!point && materialAtCut(point.x, point.z, loops) && boundaryDistanceXZ(point.x, point.z, loops) >= radius;
}

const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[.7071,.7071],[.7071,-.7071],[-.7071,.7071],[-.7071,-.7071]];

// Auto placement: the spot whose WORST cross-section (anywhere along the peg's depth) is the roomiest, polished by a
// small pattern search, so the peg sits in the thickest part of the model instead of at a fixed point near the middle.
function previewAutoPegPoints(loops, safeRadius, slices = null, minClear = 0) {
  if (!loops.length) return [];
  const bounds = loopBoundsXZ(loops), width = bounds.maxX-bounds.minX, depth = bounds.maxZ-bounds.minZ;
  if (!(width > safeRadius*2 && depth > safeRadius*2)) return [];
  const all = slices?.length ? slices : [{ loops }];
  const steps = 19, cands = [];
  const consider = (x, z) => {
    if (!materialAtCut(x, z, loops)) return;
    const edge = boundaryDistanceXZ(x, z, loops);
    if (edge >= Math.max(minClear, safeRadius * .6)) cands.push({ x, z, edge });
  };
  for (let iz=1; iz<steps; iz++) for (let ix=1; ix<steps; ix++) consider(bounds.minX + width*ix/steps, bounds.minZ + depth*iz/steps);
  for (const loop of loops) consider(loop.reduce((n,q) => n+q.x, 0)/loop.length, loop.reduce((n,q) => n+q.z, 0)/loop.length);
  if (!cands.length) return [];
  cands.sort((p,q) => q.edge-p.edge);
  const shortlist = cands.slice(0, 48);
  for (const c of shortlist) c.clear = worstClearance(c.x, c.z, all);
  shortlist.sort((p,q) => q.clear-p.clear);
  const refine = c => {
    let step = Math.min(width, depth) / steps, best = { x:c.x, z:c.z, clear:c.clear };
    for (let it=0; it<8; it++) {
      let moved = false;
      for (const [dx,dz] of DIRS8) {
        const x = best.x + dx*step, z = best.z + dz*step, cl = worstClearance(x, z, all);
        if (cl > best.clear + 1e-9) { best = { x, z, clear:cl }; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return best;
  };
  if (!(shortlist[0].clear >= minClear)) return [];
  const first = refine(shortlist[0]);
  const minSep = safeRadius * 2.2;
  const second = shortlist.filter(c => c.clear >= minClear && Math.hypot(c.x-first.x, c.z-first.z) >= minSep)
    .sort((p,q) => (Math.hypot(q.x-first.x, q.z-first.z) + q.clear) - (Math.hypot(p.x-first.x, p.z-first.z) + p.clear))[0];
  if (!second) return [{ x:first.x, z:first.z }];
  const polished = refine(second);
  const useP = polished.clear >= second.clear && Math.hypot(polished.x-first.x, polished.z-first.z) >= minSep;
  const s = useP ? polished : second;
  return [{ x:first.x, z:first.z }, { x:s.x, z:s.z }];
}

function manualPointsForCut(cutIndex, auto, loops, safeRadius) {
  // A hand-placed peg is kept wherever it still sits on material (even if it now sticks out: the report says so);
  // only pegs that fell off the model altogether are replaced by the automatic spot.
  let points = (manualPegPositions.get(cutIndex) || []).filter(p => materialAtCut(p.x, p.z, loops));
  const minSep = safeRadius * 2.0;
  points = points.filter((p, i) => points.every((q, j) => j >= i || Math.hypot(p.x-q.x, p.z-q.z) >= minSep));
  for (const p of auto) {
    if (points.length >= 2) break;
    if (points.every(q => Math.hypot(p.x-q.x, p.z-q.z) >= minSep)) points.push({ x:p.x, z:p.z });
  }
  points = points.slice(0, 2);
  manualPegPositions.set(cutIndex, points);
  return points;
}

function loopBoundsXZ(loops) {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const loop of loops||[]) for (const q of loop) {
    minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);
    minZ=Math.min(minZ,q.z);maxZ=Math.max(maxZ,q.z);
  }
  return {minX,maxX,minZ,maxZ};
}

function axisPercent(value,min,max) {
  if(!Number.isFinite(value)||!Number.isFinite(min)||!Number.isFinite(max)||max<=min) return 50;
  return Math.max(0,Math.min(100,100*(value-min)/(max-min)));
}

function currentPegControls(cutIndex=0) {
  const data=previewCutData[cutIndex];
  const points=manualPegPositions.get(cutIndex)||data?.points||[];
  if(!data) return null;
  const b=loopBoundsXZ(data.loops);
  return {
    cutIndex,
    count:points.length,
    pegs:points.map((p,i)=>({
      index:i,
      leftRight:axisPercent(p.x,b.minX,b.maxX),
      backForward:axisPercent(p.z,b.minZ,b.maxZ),
      status:data.verdicts?.[i]?.status || 'ok'
    }))
  };
}

// ---- Is the peg inside the model? ---------------------------------------------------------------
// The male peg hangs below the cut (it belongs to the upper part) so the LOWER part's cross-sections at the peg's
// depths decide whether it sticks out. The cross-section a little above the cut decides whether the peg has a root.
const STATUS_COLOUR = { ok: 0x56ff9a, warn: 0xffd24a, bad: 0xff3f5f };

function assessPeg(point, radius, data, sizing) {
  const scale = mmPerUnit(), mm = v => Math.abs(v * scale);
  const slices = data.exposureSlices || [];
  const below = slices.length ? worstClearance(point.x, point.z, slices) : Infinity;
  const above = data.aboveSlice ? signedDistXZ(point.x, point.z, data.aboveSlice.loops || []) : Infinity;
  const margin = below - radius, wall = margin - sizing.clearance, root = above - radius;
  let exposedSlices = 0;
  for (const s of slices) if (signedDistXZ(point.x, point.z, s.loops || []) < radius) exposedSlices++;
  const exposedMM = slices.length > 1 ? (exposedSlices / (slices.length - 1)) * sizing.depth * scale : 0;
  const base = { marginMM: Number.isFinite(margin) ? margin * scale : null, wallMM: Number.isFinite(wall) ? wall * scale : null, exposedMM };
  if (!Number.isFinite(below)) return { ...base, status:'bad', text:'there is no model under the peg here' };
  if (margin < 0) return { ...base, status:'bad', text:`sticks out of the model by ${mm(margin).toFixed(1)} mm (the lowest ${Math.min(sizing.depth*scale, exposedMM).toFixed(0)} mm of the peg)` };
  if (wall < 0) return { ...base, status:'bad', text:`its socket would break through the surface (${mm(wall).toFixed(1)} mm short)` };
  if (root < 0) return { ...base, status:'warn', text:`the top of the peg overhangs the upper part by ${mm(root).toFixed(1)} mm` };
  if (wall < sizing.safetyWall) return { ...base, status:'warn', text:`only ${mm(wall).toFixed(1)} mm of wall around the socket (aim for ${(sizing.safetyWall*scale).toFixed(1)}+)` };
  return { ...base, status:'ok', text:`fits inside the model, ${mm(wall).toFixed(1)} mm of wall around the socket` };
}

function lookFor(group, verdict) {
  if (!group) return;
  const ring = group.children.find(o => o.userData?.pegRing);
  if (ring) ring.material.color.setHex(STATUS_COLOUR[verdict?.status] ?? STATUS_COLOUR.ok);
  group.userData.status = verdict?.status || 'ok';
}

function refreshVerdicts(cutIndex) {
  const data = previewCutData[cutIndex]; if (!data) return;
  const sizing = pegSizing();
  data.verdicts = data.points.slice(0,2).map((p,i) => assessPeg(p, i===0 ? sizing.radius : sizing.radius*.76, data, sizing));
  if (previewGroup) for (const g of previewGroup.children) if (g.userData?.shrinkPegPreview && g.userData.cutIndex === cutIndex) lookFor(g, data.verdicts[g.userData.pegIndex]);
}

function pegReport() {
  const out = [];
  previewCutData.forEach((data, cut) => (data?.verdicts || []).forEach((v, peg) => out.push({ cut, peg, ...v })));
  return out;
}

function manualPegAxisMove(cutIndex,pegIndex,axis,percent) {
  const data=previewCutData[cutIndex];
  const points=manualPegPositions.get(cutIndex)||[];
  const current=points[pegIndex];
  if(!data||!current) return currentPegControls(cutIndex);

  const b=loopBoundsXZ(data.loops);
  const min=axis==='x'?b.minX:b.minZ, max=axis==='x'?b.maxX:b.maxZ;
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min) return currentPegControls(cutIndex);

  const desired=min+(max-min)*Math.max(0,Math.min(100,Number(percent)||0))/100;
  const start=axis==='x'?current.x:current.z;
  const other=points[pegIndex===0?1:0];
  // The slider may take a peg anywhere on the model so the person can SEE it turn red; it only refuses to leave the
  // material altogether or to land on the other peg.
  const allowed=c=>materialAtCut(c.x,c.z,data.loops) && (!other || Math.hypot(c.x-other.x,c.z-other.z)>=data.safeRadius*2.0);

  let best={x:current.x,z:current.z};
  const steps=120;
  for(let i=1;i<=steps;i++){
    const v=start+(desired-start)*i/steps;
    const candidate=axis==='x'?{x:v,z:current.z}:{x:current.x,z:v};
    if(!allowed(candidate)) break;
    best=candidate;
  }
  points[pegIndex]=best;
  manualPegPositions.set(cutIndex,points);
  data.points=points.slice(0,2);

  if(previewGroup){
    const pegs=previewGroup.children.filter(o=>o.userData?.shrinkPegPreview);
    const target=pegs.find(o=>o.userData.cutIndex===cutIndex&&o.userData.pegIndex===pegIndex);
    if(target){
      target.position.x=best.x;target.position.z=best.z;
      colourPegExposure(target,data.exposureSlices);
    }
  }
  refreshVerdicts(cutIndex);
  window.dispatchEvent(new CustomEvent('shrink:peg-position-changed',{detail:{cutIndex,pegIndex,controls:currentPegControls(cutIndex),report:pegReport()}}));
  return currentPegControls(cutIndex);
}


const PINK = new THREE.Color(0xff3f7f);
const PEG1 = new THREE.Color(0xffb13b);
const PEG2 = new THREE.Color(0x55d9ff);

function makeExposureSlices(model, cutY, pegDepth, count=9) {
  const slices=[];
  for(let i=0;i<count;i++){
    const t=i/(count-1);
    const y=cutY-pegDepth*t;
    slices.push({y,loops:cutLoopsFromModel(model,y)});
  }
  return slices;
}

function nearestExposureSlice(y,slices) {
  let best=null,dist=Infinity;
  for(const s of slices||[]){
    const d=Math.abs(s.y-y);
    if(d<dist){dist=d;best=s;}
  }
  return best;
}

function colourPegExposure(group, slices) {
  if(!group||!slices?.length) return;
  group.updateMatrixWorld(true);
  const world=new THREE.Vector3();
  for(const mesh of group.children){
    if(!mesh.isMesh||!mesh.userData?.truePegPreview||!mesh.geometry?.attributes?.position) continue;
    const pos=mesh.geometry.attributes.position;
    let colorAttr=mesh.geometry.getAttribute('color');
    if(!colorAttr||colorAttr.count!==pos.count){
      colorAttr=new THREE.BufferAttribute(new Float32Array(pos.count*3),3);
      mesh.geometry.setAttribute('color',colorAttr);
    }
    const base=mesh.userData.basePegColor||PEG1;
    for(let i=0;i<pos.count;i++){
      world.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
      const slice=nearestExposureSlice(world.y,slices);
      const inside=!!slice?.loops?.length && materialAtCut(world.x,world.z,slice.loops);
      const c=inside?base:PINK;
      colorAttr.setXYZ(i,c.r,c.g,c.b);
    }
    colorAttr.needsUpdate=true;
    mesh.material.vertexColors=true;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate=true;
  }
}

function makePegPreview(cutIndex, pegIndex, point, y, pegRadius, pegDepth, exposureSlices) {
  const baseColor=pegIndex===0?PEG1:PEG2;
  const group=new THREE.Group();
  group.position.set(point.x,y,point.z);
  group.renderOrder=1000;
  group.userData.shrinkPegPreview=true;
  group.userData.cutIndex=cutIndex;
  group.userData.pegIndex=pegIndex;

  // This is the actual male peg shape: same radius and depth as the exported STL.
  // X-ray rendering keeps the whole cylinder visible through the model.
  const peg=new THREE.Mesh(
    new THREE.CylinderGeometry(pegRadius,pegRadius,pegDepth,28,8,false),
    new THREE.MeshBasicMaterial({
      color:0xffffff,
      vertexColors:true,
      transparent:true,
      opacity:.44,
      depthTest:false,
      depthWrite:false,
      side:THREE.DoubleSide
    })
  );
  peg.renderOrder=1002;
  peg.userData.truePegPreview=true;
  peg.userData.basePegColor=baseColor;
  peg.position.y=-pegDepth*.5;

  // A fine edge overlay is part of the peg preview itself, not a control handle.
  const outline=new THREE.Mesh(
    new THREE.CylinderGeometry(pegRadius*1.012,pegRadius*1.012,pegDepth*1.004,28,8,true),
    new THREE.MeshBasicMaterial({
      color:0xffffff,
      vertexColors:true,
      transparent:true,
      opacity:.9,
      depthTest:false,
      depthWrite:false,
      wireframe:true
    })
  );
  outline.renderOrder=1003;
  outline.userData.truePegPreview=true;
  outline.userData.basePegColor=baseColor;
  outline.position.y=-pegDepth*.5;

  // Status ring on the cut plane: green = fits, amber = thin or overhanging, red = sticks out of the model.
  const ringGeom = new THREE.RingGeometry(pegRadius * 1.15, pegRadius * 1.5, 40); ringGeom.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: STATUS_COLOUR.ok, transparent: true, opacity: .95, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  ring.renderOrder = 1004; ring.userData.pegRing = true; ring.position.y = pegDepth * 0.0;

  group.add(peg,outline,ring);
  previewGroup.add(group);
  colourPegExposure(group,exposureSlices);
  return group;
}

function addPegPreviews(model, cutIndex, y) {
  const loops=cutLoopsFromModel(model,y);
  const sizing=pegSizing(), {radius,depth,safeRadius}=sizing;
  const manual=manualPegMode();
  const exposureSlices=makeExposureSlices(model,y,depth,9);
  const aboveSlice={y:y+depth*.35,loops:cutLoopsFromModel(model,y+depth*.35)};
  const auto=previewAutoPegPoints(loops,safeRadius,[...exposureSlices,aboveSlice],radius);
  const points=manual ? manualPointsForCut(cutIndex,auto,loops,safeRadius) : auto;
  previewCutData[cutIndex]={y,loops,safeRadius,points,exposureSlices,aboveSlice,verdicts:[]};
  refreshVerdicts(cutIndex);

  points.slice(0,2).forEach((p,i)=>{
    const pegRadius=i===0?radius:radius*.76;
    const g=makePegPreview(cutIndex,i,p,y,pegRadius,depth,exposureSlices);
    lookFor(g,previewCutData[cutIndex].verdicts[i]);
  });
}

let previewGroup = null;
function clearPreview() {
  const scene = window.__shrinkViewer?.scene;
  if (previewGroup && scene) scene.remove(previewGroup);
  if (previewGroup) previewGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  previewGroup = null;
}

function updateCutLabel() {
  const slider = $('splitCutHeight'), out = $('splitCutHeightValue');
  if (!slider || !out) return;
  const f = Number(slider.value || 50) / 100;
  out.textContent = `${(finishedHeightMM() * f).toFixed(1)} mm (${Math.round(f * 100)}%)`;
}

function updatePreview() {
  clearPreview();
  const n = partCount(), model = sourceModel(), scene = window.__shrinkViewer?.scene;
  const info = $('splitInfo');
  if (!model || !scene || n <= 1 || !document.body.classList.contains('app-mode-print')) {
    previewCutData = [];
    if (info) info.textContent = 'Off — export one STL.';
    window.dispatchEvent(new CustomEvent('shrink:peg-preview-updated',{detail:{cuts:0,report:[]}}));
    return;
  }
  const box = boundsFor(model), size = box.getSize(new THREE.Vector3());
  const fractions = cutFractions(n);
  previewGroup = new THREE.Group(); previewGroup.name = 'shrink-split-preview';
  previewCutData = [];
  for (let cutIndex=0; cutIndex<fractions.length; cutIndex++) {
    const f = fractions[cutIndex];
    const y = box.min.y + size.y * f;
    const geom = new THREE.PlaneGeometry(Math.max(size.x * 1.15, .01), Math.max(size.z * 1.15, .01));
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x56ff9a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(geom, mat); plane.position.y = y; previewGroup.add(plane);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: 0x56ff9a, transparent: true, opacity: .9 }));
    edges.position.y = y + size.y * 0.0005; previewGroup.add(edges);
    if ($('splitJoint')?.value !== 'flat') addPegPreviews(model, cutIndex, y);
  }
  scene.add(previewGroup);
  window.dispatchEvent(new CustomEvent('shrink:peg-preview-updated',{detail:{cuts:previewCutData.length,report:pegReport()}}));
  updateCutLabel();
  if (info) {
    if (n === 2) {
      const f = fractions[0];
      info.textContent = `2 sections · cut at ${(finishedHeightMM() * f).toFixed(1)} mm (${Math.round(f * 100)}%) · green plane and true-size peg previews shown (ring: green fits · amber thin · red sticks out).`;
    } else {
      const each = finishedHeightMM() / n;
      info.textContent = `${n} sections · about ${each.toFixed(0)} mm high each · green planes show the cuts.`;
    }
  }
}

function solidToThree(solid) {
  const m = solid.getMesh(), n = Math.floor(m.vertProperties.length / m.numProp);
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
  root.updateMatrixWorld(true); return root;
}

function disposeThree(root) {
  root?.traverse?.(o => { if (o.isMesh) { o.geometry?.dispose?.(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m?.dispose?.()); } });
}

function makeYCylinder(wasm, height, radius, x, y, z, segments = 28) {
  return wasm.Manifold.cylinder(height, radius, radius, segments, false).rotate([-90, 0, 0]).translate([x, y, z]);
}

function pointInPolyXZ(x, z, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    const hit = ((a.z > z) !== (b.z > z)) &&
      (x < (b.x - a.x) * (z - a.z) / ((b.z - a.z) || 1e-20) + a.x);
    if (hit) inside = !inside;
  }
  return inside;
}

function distToSegXZ(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x-a.x)*dx + (z-a.z)*dz) / l2));
  return Math.hypot(x - (a.x + t*dx), z - (a.z + t*dz));
}

function boundaryDistanceXZ(x, z, loops) {
  let d = Infinity;
  for (const loop of loops) {
    for (let i=0;i<loop.length;i++) d = Math.min(d, distToSegXZ(x, z, loop[i], loop[(i+1)%loop.length]));
  }
  return d;
}

function materialAtCut(x, z, loops) {
  // Even/odd rule handles separate islands and holes: inside an outer outline = material,
  // inside an outer + inner outline = a void.
  let crossings = 0;
  for (const loop of loops) if (pointInPolyXZ(x, z, loop)) crossings++;
  return (crossings & 1) === 1;
}

function cutLoopsFromSolid(solid, y, span) {
  const mesh = solid.getMesh(), np = mesh.numProp, verts = mesh.vertProperties, tris = mesh.triVerts;
  const tol = Math.max(Math.abs(span) * 1e-6, 1e-7), nudge = Math.max(Math.abs(span) * 2e-4, tol * 50);
  const p = i => ({ x:verts[i*np], y:verts[i*np+1], z:verts[i*np+2] });
  const slice = yy => {
    const segments = []; let touched = false;
    const intersect = (a,b) => { const dy=b.y-a.y, t=Math.abs(dy)<1e-20 ? 0 : (yy-a.y)/dy; return {x:a.x+(b.x-a.x)*t, y:yy, z:a.z+(b.z-a.z)*t}; };
    for (let t=0;t+2<tris.length;t+=3) {
      const y0=verts[tris[t]*np+1], y1=verts[tris[t+1]*np+1], y2=verts[tris[t+2]*np+1];
      if (Math.min(y0,y1,y2) > yy+tol || Math.max(y0,y1,y2) < yy-tol) continue;
      if (Math.abs(y0-yy)<=tol || Math.abs(y1-yy)<=tol || Math.abs(y2-yy)<=tol) touched = true;
      const tri=[p(tris[t]),p(tris[t+1]),p(tris[t+2])], hits=[];
      for (let i=0;i<3;i++) {
        const a=tri[i], b=tri[(i+1)%3], da=a.y-yy, db=b.y-yy;
        if (Math.abs(da)<=tol && Math.abs(db)<=tol) continue;
        if ((da < -tol && db > tol) || (da > tol && db < -tol)) hits.push(intersect(a,b));
        else if (Math.abs(da)<=tol) hits.push({x:a.x,y:yy,z:a.z});
      }
      const unique=[];
      for (const q of hits) if (!unique.some(v => Math.hypot(v.x-q.x,v.z-q.z)<=tol)) unique.push(q);
      if (unique.length>=2) segments.push([unique[0],unique[1]]);
    }
    return { segments, touched };
  };
  try {
    for (const k of CUT_NUDGES) { const r = slice(y + k*nudge); if (!r.touched) return linkLoops(r.segments, tol); }
    return linkLoops(slice(y + nudge).segments, tol);
  } finally { try { mesh.delete?.(); } catch {} }
}

function choosePegPoints(solid, wasm, y, box, r, depth, clearance, span, preferred = null) {
  const loops = cutLoopsFromSolid(solid, y, span);
  if (!loops.length) return [];
  const safetyWall = 0.6 / Math.max(mmPerUnit(), 1e-9);
  const safeRadius = r + clearance + safetyWall;

  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const loop of loops) for (const q of loop) {
    minX=Math.min(minX,q.x); maxX=Math.max(maxX,q.x);
    minZ=Math.min(minZ,q.z); maxZ=Math.max(maxZ,q.z);
  }
  const width=maxX-minX, depthZ=maxZ-minZ;
  if (!(width>safeRadius*2 && depthZ>safeRadius*2)) return [];

  let candidates=[];
  if(Array.isArray(preferred)&&preferred.length){
    candidates=preferred
      .filter(p=>previewCandidateInside(p,loops,r))
      .map((p,i)=>({x:p.x,z:p.z,edge:boundaryDistanceXZ(p.x,p.z,loops),manualIndex:i}));
  } else {
    const steps=17;
    for (let iz=1;iz<steps;iz++) for (let ix=1;ix<steps;ix++) {
      const x=minX + width*ix/steps, z=minZ + depthZ*iz/steps;
      if (!materialAtCut(x,z,loops)) continue;
      const edge=boundaryDistanceXZ(x,z,loops);
      if (edge >= safeRadius) candidates.push({x,z,edge});
    }
    for (const loop of loops) {
      const x=loop.reduce((n,q)=>n+q.x,0)/loop.length, z=loop.reduce((n,q)=>n+q.z,0)/loop.length;
      if (materialAtCut(x,z,loops)) {
        const edge=boundaryDistanceXZ(x,z,loops);
        if (edge>=safeRadius) candidates.push({x,z,edge});
      }
    }
  }
  if (!candidates.length) return [];

  const probeH=Math.max(depth*.8, r*1.5), probeR=r+clearance;
  const fullProbeVolume=Math.PI*probeR*probeR*probeH;
  const volumeIn = (x,z,baseY) => {
    let probe=null, hit=null;
    try { probe=makeYCylinder(wasm,probeH,probeR,x,baseY,z,20); hit=solid.intersect(probe); return hit.volume?.() || 0; }
    catch { return 0; }
    finally { try { hit?.delete?.(); } catch {} try { probe?.delete?.(); } catch {} }
  };
  const scored=[];
  for (const c of candidates) {
    const below=volumeIn(c.x,c.z,y-probeH), above=volumeIn(c.x,c.z,y);
    const belowFrac=fullProbeVolume ? below/fullProbeVolume : 0, aboveFrac=fullProbeVolume ? above/fullProbeVolume : 0;
    if (belowFrac >= .72 && aboveFrac >= .30) scored.push({...c,score:c.edge + Math.min(belowFrac,1)*safeRadius});
  }
  if (!scored.length) return [];

  if(Array.isArray(preferred)&&preferred.length) {
    scored.sort((a,b)=>(a.manualIndex??0)-(b.manualIndex??0));
    return scored.slice(0,2).map(({x,z})=>({x,z}));
  }

  scored.sort((a,b)=>b.score-a.score);
  const first=scored[0], minSeparation=(r+clearance+safetyWall)*2.6;
  const second=scored.filter(c=>c!==first&&Math.hypot(c.x-first.x,c.z-first.z)>=minSeparation)
    .sort((a,b)=>(Math.hypot(b.x-first.x,b.z-first.z)+b.edge)-(Math.hypot(a.x-first.x,a.z-first.z)+a.edge))[0];
  return second ? [first,second] : [first];
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

function previewPegsFor(cutIndex, y, span) {
  const data = previewCutData[cutIndex];
  if (!data || !data.verdicts || Math.abs(data.y - y) > Math.max(span * 1e-3, 1e-6)) return null;
  const use = [], total = data.points.slice(0, 2).length;
  data.points.slice(0, 2).forEach((p, i) => { if (data.verdicts[i]?.status !== 'bad') use.push({ x:p.x, z:p.z }); });
  return { use, skipped: total - use.length };
}

async function splitSolid(solid, wasm, n, withPegs, fractions = cutFractions(n)) {
  const m = solid.getMesh(), np = m.numProp;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i=0;i<m.vertProperties.length;i+=np) {
    const x=m.vertProperties[i], y=m.vertProperties[i+1], z=m.vertProperties[i+2];
    minX=Math.min(minX,x); minY=Math.min(minY,y); minZ=Math.min(minZ,z); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); maxZ=Math.max(maxZ,z);
  }
  try { m.delete?.(); } catch {}
  const box = { min:{x:minX,y:minY,z:minZ}, max:{x:maxX,y:maxY,z:maxZ} };
  const span = maxY - minY;
  const cuts = fractions.map(f => minY + span * f);
  const parts = Array.from({length:n}, (_,i) => sectionSolid(solid, i===0 ? minY-span*.01 : cuts[i-1], i===n-1 ? maxY+span*.01 : cuts[i]));

  if (withPegs) {
    const scale = mmPerUnit();
    const radiusMain = Math.max(.5, Number($('pegDiameter')?.value || 4) / 2) / scale;
    const depth = Math.max(2, Number($('pegDepth')?.value || 6)) / scale;
    const clearance = Math.max(.05, Number($('pegClearance')?.value || .2)) / scale;
    const eps = Math.max(clearance * .25, span*1e-5);
    parts.pegCuts = 0;
    for (let i=0;i<cuts.length;i++) {
      const y = cuts[i];
      // What you see is what you get: use the pegs the preview showed (red ones are left out).
      const shown = previewPegsFor(i, y, span);
      const points = shown ? (shown.use.length ? choosePegPoints(solid, wasm, y, box, radiusMain, depth, clearance, span, shown.use) : []) : choosePegPoints(solid, wasm, y, box, radiusMain, depth, clearance, span, null);
      if (shown?.skipped) parts.pegSkipped = (parts.pegSkipped || 0) + shown.skipped;
      let added = 0;
      for (let p=0;p<Math.min(2,points.length);p++) {
        const {x,z} = points[p], r = p===0 ? radiusMain : radiusMain*.76;
        let peg=null,socket=null,newLower=null,newUpper=null;
        try {
          peg = makeYCylinder(wasm, depth+eps, r, x, y-depth, z);
          socket = makeYCylinder(wasm, depth+eps*2, r+clearance, x, y-depth-eps, z);
          newLower = parts[i].subtract(socket);
          newUpper = parts[i+1].add(peg);
          try { parts[i].delete?.(); } catch {} try { parts[i+1].delete?.(); } catch {}
          parts[i]=newLower; parts[i+1]=newUpper; newLower=null; newUpper=null; added++;
        } catch (err) {
          // Pegs are a bonus. If one cannot be built, keep the flat cut for it rather than failing the whole split.
          console.warn('[SHRINK 3D] A peg/socket could not be built; leaving that joint flat.', err);
        } finally {
          try { peg?.delete?.(); } catch {} try { socket?.delete?.(); } catch {} try { newLower?.delete?.(); } catch {} try { newUpper?.delete?.(); } catch {}
        }
      }
      if (added) parts.pegCuts++;
    }
  }
  return parts;
}

async function exportSplitSTL(evt) {
  const n = partCount();
  if (n <= 1 || !document.body.classList.contains('app-mode-print')) return;
  evt.preventDefault(); evt.stopImmediatePropagation();
  const btn = $('saveStlBtn'), old = btn.textContent; btn.disabled = true; btn.textContent = 'Splitting model…';
  let solid = null, parts = [];
  try {
    const model = sourceModel(); if (!model) return;
    if (!window.__shrinkFuse?.modelToSolid) throw new Error('Fuse engine is not ready yet. Reload SHRINK 3D and try again.');
    say('Cutting the current model into sections' + ($('splitJoint')?.value !== 'flat' ? ' and adding alignment pegs…' : '…'));
    await new Promise(r => requestAnimationFrame(() => setTimeout(r,0)));
    const built = await window.__shrinkFuse.modelToSolid(model);
    solid = built.solid; const wasm = built.wasm;
    // Separate closed pieces are fine: the cut planes slice every piece, so a single connected solid is not needed here.
    const withPegs = $('splitJoint')?.value !== 'flat';
    parts = await splitSolid(solid, wasm, n, withPegs, cutFractions(n));
    const files = {}, scale = mmPerUnit(), zUp = $('zUpToggle')?.checked !== false;
    const base = app()?.baseName?.() || 'model';
    const stem = window.__shrinkDownloadStem?.(base) || `${base}-SHRINK`;
    let totalTris = 0;
    for (let i=0;i<parts.length;i++) {
      if (parts[i]?.isEmpty?.()) throw new Error(`Part ${i+1} is empty. Move the cut position or use fewer sections.`);
      const root = solidToThree(parts[i]);
      const out = buildBinaryStl({ THREE, model: root, mmPerUnit: scale, zUp });
      totalTris += out.triangles;
      files[`${stem}-PART${i+1}of${parts.length}.stl`] = new Uint8Array(out.buffer);
      disposeThree(root);
    }
    const zip = zipSync(files, { level: 0 });
    saveBlob(new Blob([zip], {type:'application/zip'}), `${stem}-SPLIT${parts.length}.zip`);
    const cutText = n===2 ? ` · cut at ${(finishedHeightMM()*cutFractions(2)[0]).toFixed(1)} mm` : '';
    const skippedNote = parts.pegSkipped ? ` · ${parts.pegSkipped} peg${parts.pegSkipped === 1 ? ' was' : 's were'} left out because ${parts.pegSkipped === 1 ? 'it' : 'they'} stuck out of the model` : '';
    const joints = !withPegs ? '' : (parts.pegCuts ? ` with keyed alignment pegs on ${parts.pegCuts} cut${parts.pegCuts === 1 ? '' : 's'} (upper part pegs into lower sockets)` : ' with flat cuts (no safe peg position was found)') + skippedNote;
    say(`Saved ${parts.length} watertight STL sections${joints}${cutText} · ${new Intl.NumberFormat().format(totalTris)} triangles total.`);
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
  box.innerHTML = `<div class="split-title"><strong>Split for printing</strong><small>Cut tall models into separate watertight STLs.</small></div>
    <label class="field"><span>Sections</span><select id="splitMode"><option value="off">Off — one STL</option><option value="2">2 parts</option><option value="3">3 parts</option><option value="max">By maximum part height</option></select></label>
    <label id="splitMaxWrap" class="field" hidden><span>Maximum part height (mm)</span><input id="splitMaxHeight" type="number" min="20" max="500" step="5" value="80"></label>
    <div id="splitCutWrap" class="field split-cut-wrap" hidden><div class="range-heading"><label for="splitCutHeight">Cut height</label><output id="splitCutHeightValue">50%</output></div><input id="splitCutHeight" type="range" min="10" max="90" step="0.5" value="50"><div class="slider-ends"><span>Lower</span><span>Higher</span></div></div>
    <label class="field"><span>Joint</span><select id="splitJoint"><option value="pegs" selected>Keyed twin pegs</option><option value="flat">Flat cut — no pegs</option></select></label>
    <label id="splitPegPositionWrap" class="field"><span>Peg position</span><select id="splitPegPosition"><option value="auto" selected>Auto — safest position</option><option value="manual">Manual — position with sliders</option></select></label>
    <button id="splitPegReset" class="button ghost small" type="button" hidden>Reset peg positions</button>
    <div id="splitPegSettings" class="field-grid split-peg-grid"><label class="field"><span>Peg Ø (mm)</span><input id="pegDiameter" type="number" min="1" max="20" step="0.5" value="4"></label><label class="field"><span>Depth (mm)</span><input id="pegDepth" type="number" min="2" max="30" step="0.5" value="6"></label></div>
    <label id="splitClearanceWrap" class="field"><span>Socket clearance (mm)</span><input id="pegClearance" type="number" min="0.05" max="1" step="0.05" value="0.20"></label><div id="splitInfo" class="hint">Off — export one STL.</div>`;
  save.insertBefore(box, exportRow);
  const style = document.createElement('style');
  style.textContent = `.split-print-box{margin:12px 0;padding:11px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.018);display:grid;gap:9px}.split-title strong,.split-title small{display:block}.split-title strong{font-size:13px}.split-title small{font-size:11px;color:var(--muted);margin-top:2px}.split-peg-grid{margin:0!important}.split-cut-wrap{padding-top:2px}`;
  document.head.appendChild(style);
  const sync = () => {
    const mode = $('splitMode').value, on = mode !== 'off', max = mode === 'max', two = mode === '2', pegs = $('splitJoint').value === 'pegs';
    $('splitMaxWrap').hidden = !max; $('splitCutWrap').hidden = !two;
    $('splitPegSettings').hidden = !on || !pegs; $('splitClearanceWrap').hidden = !on || !pegs;
    if ($('splitPegPositionWrap')) $('splitPegPositionWrap').hidden = !on || !pegs;
    if ($('splitPegReset')) $('splitPegReset').hidden = !on || !pegs || !manualPegMode();
    updateCutLabel(); updatePreview();
  };
  ['splitMode','splitMaxHeight','splitCutHeight','splitJoint','splitPegPosition','pegDiameter','pegDepth','pegClearance','figureHeightMm'].forEach(id => $(id)?.addEventListener('input', sync));
  $('splitMode')?.addEventListener('change', sync); $('splitJoint')?.addEventListener('change', sync); $('splitPegPosition')?.addEventListener('change', sync);
  $('splitPegReset')?.addEventListener('click', clearManualPegPositions);
  window.addEventListener('shrink:model-opened', () => { manualPegPositions.clear(); setTimeout(updatePreview, 0); });
  window.addEventListener('shrink:live-updated', () => { if (partCount()>1) updatePreview(); });
  window.addEventListener('shrink:ui-mode', updatePreview);
  sync();
}

function wire() { injectUI(); $('saveStlBtn')?.addEventListener('click', exportSplitSTL, true); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, {once:true}); else wire();
// "Find best cut": try cut heights near the current one and prefer a cut that goes through ONE solid outline
// (not a thin arm, axe or cape as well) and leaves room for pegs that stay inside the model.
function findBestCut() {
  const model = sourceModel(); if (!model || partCount() !== 2) return null;
  const box = boundsFor(model), size = box.getSize(new THREE.Vector3()), sizing = pegSizing(), scale = mmPerUnit();
  const area = loop => { let a = 0; for (let i=0;i<loop.length;i++) { const p=loop[i], q=loop[(i+1)%loop.length]; a += p.x*q.z - q.x*p.z; } return Math.abs(a/2); };
  const countIslands = ls => { const ar = ls.map(area), mx = Math.max(0, ...ar); return ar.filter(a => a > mx * 0.02).length; };
  const current = Number($('splitCutHeight')?.value || 50);
  const scoreOf = r => Math.min(r.clearMM, 8) - 3 * (r.islands - 1) + 4 * r.solidShare - Math.abs(r.pct - current) * 0.03 - (r.pegs < 2 ? 1 : 0);
  // Pass 1: every height, cheaply.
  const results = [];
  for (let pct = 20; pct <= 80.001; pct += 2.5) {
    const y = box.min.y + size.y * pct / 100, loops = cutLoopsFromModel(model, y);
    if (!loops.length) continue;
    const areas = loops.map(area), big = Math.max(...areas), total = areas.reduce((n,a) => n + a, 0);
    const slices = [{ loops }, ...makeExposureSlices(model, y, sizing.depth, 3).slice(1), { loops: cutLoopsFromModel(model, y + sizing.depth * .35) }];
    const pts = previewAutoPegPoints(loops, sizing.safeRadius, slices, sizing.radius);
    const clear = pts.length ? Math.min(...pts.map(p => worstClearance(p.x, p.z, slices))) : -Infinity;
    const r = { pct, y, islands: countIslands(loops), solidShare: big / Math.max(total, 1e-9), clearMM: Number.isFinite(clear) ? Math.max(-5, clear * scale) : -5, pegs: pts.length };
    r.score = scoreOf(r); results.push(r);
  }
  if (!results.length) return null;
  // Pass 2: the best few again, also looking just above and below, because a cut within ~1% of the height of a ledge,
  // arm or plank is fragile and counts as crossing it.
  results.sort((a,b) => b.score - a.score);
  const near = size.y * 0.01;
  for (const r of results.slice(0, 6)) {
    r.islands = Math.max(r.islands, countIslands(cutLoopsFromModel(model, r.y + near)), countIslands(cutLoopsFromModel(model, r.y - near)));
    r.score = scoreOf(r);
  }
  results.sort((a,b) => b.score - a.score);
  const { pct, score, islands, clearMM, pegs } = results[0];
  return { pct, score, islands, clearMM, pegs };
}

function applyBestCut() {
  const best = findBestCut(); if (!best) return null;
  const slider = $('splitCutHeight');
  if (slider) { slider.value = String(best.pct); slider.dispatchEvent(new Event('input', { bubbles: true })); }
  return best;
}

window.__shrinkSplit = {
  updatePreview, partCount, cutFractions, pegReport, findBestCut, applyBestCut,
  resetManualPegPositions: clearManualPegPositions,
  getManualPegControls: currentPegControls,
  moveManualPegAxis: manualPegAxisMove,
  cutCount() { return previewCutData.length; },
  // The pegs the preview shows (red ones left out), per cut: the direct-split fallback uses these so it matches the preview.
  shownPegPoints() {
    const n=partCount(), out=[];
    for(let i=0;i<Math.max(0,n-1);i++){
      const d=previewCutData[i];
      out.push(d ? d.points.slice(0,2).filter((p,k)=>d.verdicts?.[k]?.status!=='bad').map(p=>({x:p.x,z:p.z})) : []);
    }
    return out;
  },
  manualPegPoints() {
    const n=partCount(), out=[];
    for(let i=0;i<Math.max(0,n-1);i++) out.push((manualPegPositions.get(i)||[]).map(p=>({x:p.x,z:p.z})));
    return out;
  }
};
