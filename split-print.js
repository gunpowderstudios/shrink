import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl } from './mesh-tools.js?v=2.18';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';

// SHRINK 3D v2.70 — pink peg exposure uses cached cross-sections for smooth slider performance.
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

function cutLoopsFromModel(model, y) {
  if (!model) return [];
  model.updateMatrixWorld(true);
  const box = boundsFor(model), diag = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-6);
  const tol = Math.max(diag * 1e-6, 1e-7);
  const segments = [];
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
  const intersect=(p,q)=>{
    const dy=q.y-p.y, t=Math.abs(dy)<1e-20?0:(y-p.y)/dy;
    return {x:p.x+(q.x-p.x)*t,y,z:p.z+(q.z-p.z)*t};
  };
  model.traverse(o=>{
    if(!o.isMesh || !o.geometry?.attributes?.position) return;
    const g=o.geometry,pos=g.attributes.position,idx=g.index,count=idx?idx.count:pos.count;
    for(let i=0;i+2<count;i+=3){
      const ids=[idx?idx.getX(i):i,idx?idx.getX(i+1):i+1,idx?idx.getX(i+2):i+2];
      a.fromBufferAttribute(pos,ids[0]).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos,ids[1]).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos,ids[2]).applyMatrix4(o.matrixWorld);
      const tri=[a.clone(),b.clone(),c.clone()], hits=[];
      for(let e=0;e<3;e++){
        const p=tri[e],q=tri[(e+1)%3],dp=p.y-y,dq=q.y-y;
        if(Math.abs(dp)<=tol && Math.abs(dq)<=tol) continue;
        if((dp < -tol && dq > tol)||(dp > tol && dq < -tol)) hits.push(intersect(p,q));
        else if(Math.abs(dp)<=tol) hits.push({x:p.x,y,z:p.z});
      }
      const unique=[];
      for(const h of hits) if(!unique.some(v=>Math.hypot(v.x-h.x,v.z-h.z)<=tol)) unique.push(h);
      if(unique.length>=2) segments.push([unique[0],unique[1]]);
    }
  });
  const key=q=>`${Math.round(q.x/tol)},${Math.round(q.z/tol)}`;
  const entries=segments.map((seg,i)=>({i,a:seg[0],b:seg[1],used:false})), byKey=new Map();
  const add=(k,i)=>{let list=byKey.get(k);if(!list)byKey.set(k,list=[]);list.push(i);};
  entries.forEach((e,i)=>{add(key(e.a),i);add(key(e.b),i);});
  const loops=[];
  for(let seed=0;seed<entries.length;seed++){
    if(entries[seed].used) continue;
    const e=entries[seed]; e.used=true;
    const loop=[e.a,e.b]; let current=e.b,closed=false,guard=0;
    while(guard++<entries.length+4){
      const k=key(current),ids=byKey.get(k)||[]; let next=null;
      for(const id of ids) if(!entries[id].used){next=entries[id];break;}
      if(!next) break;
      next.used=true; current=key(next.a)===k?next.b:next.a;
      if(Math.hypot(current.x-loop[0].x,current.z-loop[0].z)<=tol*1.5){closed=true;break;}
      loop.push(current);
    }
    if(closed&&loop.length>=3) loops.push(loop);
  }
  return loops;
}

function previewCandidateSafe(point, loops, safeRadius) {
  return !!point && materialAtCut(point.x, point.z, loops) && boundaryDistanceXZ(point.x, point.z, loops) >= safeRadius;
}

function previewAutoPegPoints(loops, safeRadius) {
  if(!loops.length) return [];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const loop of loops) for(const q of loop){
    minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minZ=Math.min(minZ,q.z);maxZ=Math.max(maxZ,q.z);
  }
  const width=maxX-minX, depth=maxZ-minZ;
  if(!(width>safeRadius*2 && depth>safeRadius*2)) return [];
  const candidates=[], steps=19;
  for(let iz=1;iz<steps;iz++) for(let ix=1;ix<steps;ix++){
    const x=minX+width*ix/steps,z=minZ+depth*iz/steps;
    if(!materialAtCut(x,z,loops)) continue;
    const edge=boundaryDistanceXZ(x,z,loops);
    if(edge>=safeRadius) candidates.push({x,z,edge});
  }
  for(const loop of loops){
    const x=loop.reduce((n,q)=>n+q.x,0)/loop.length,z=loop.reduce((n,q)=>n+q.z,0)/loop.length;
    const edge=boundaryDistanceXZ(x,z,loops);
    if(materialAtCut(x,z,loops)&&edge>=safeRadius) candidates.push({x,z,edge});
  }
  if(!candidates.length) return [];
  candidates.sort((a,b)=>b.edge-a.edge);
  const first=candidates[0];
  const minSep=safeRadius*2.2;
  const second=candidates.filter(c=>c!==first&&Math.hypot(c.x-first.x,c.z-first.z)>=minSep)
    .sort((a,b)=>(Math.hypot(b.x-first.x,b.z-first.z)+b.edge)-(Math.hypot(a.x-first.x,a.z-first.z)+a.edge))[0];
  return second?[{x:first.x,z:first.z},{x:second.x,z:second.z}]:[{x:first.x,z:first.z}];
}

function manualPointsForCut(cutIndex, loops, safeRadius) {
  const auto=previewAutoPegPoints(loops,safeRadius);
  let points=(manualPegPositions.get(cutIndex)||[]).filter(p=>previewCandidateSafe(p,loops,safeRadius));
  const minSep=safeRadius*2.0;
  for(const p of auto){
    if(points.length>=2) break;
    if(points.every(q=>Math.hypot(p.x-q.x,p.z-q.z)>=minSep)) points.push({x:p.x,z:p.z});
  }
  points=points.slice(0,2);
  manualPegPositions.set(cutIndex,points);
  return points;
}

function loopBoundsXZ(loops) {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const loop of loops||[]) for(const q of loop){
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
  const points=manualPegPositions.get(cutIndex)||[];
  if(!data) return null;
  const b=loopBoundsXZ(data.loops);
  return {
    cutIndex,
    count:points.length,
    pegs:points.map((p,i)=>({
      index:i,
      leftRight:axisPercent(p.x,b.minX,b.maxX),
      backForward:axisPercent(p.z,b.minZ,b.maxZ)
    }))
  };
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
  const safe=c=>{
    if(!previewCandidateSafe(c,data.loops,data.safeRadius)) return false;
    return !other || Math.hypot(c.x-other.x,c.z-other.z)>=data.safeRadius*2.0;
  };

  // Travel continuously from the current safe point towards the requested position.
  // Once an unsafe boundary is hit, stop there rather than jumping to another island.
  let best={x:current.x,z:current.z};
  const steps=120;
  for(let i=1;i<=steps;i++){
    const v=start+(desired-start)*i/steps;
    const candidate=axis==='x'?{x:v,z:current.z}:{x:current.x,z:v};
    if(!safe(candidate)) break;
    best=candidate;
  }
  points[pegIndex]=best;
  manualPegPositions.set(cutIndex,points);

  // Move the existing gizmo immediately, then rebuild once so all slider/bounds data stays current.
  if(previewGroup){
    const pegs=previewGroup.children.filter(o=>o.userData?.shrinkPegPreview);
    const target=pegs.find(o=>o.userData.cutIndex===cutIndex&&o.userData.pegIndex===pegIndex);
    if(target){
      target.position.x=best.x;target.position.z=best.z;
      colourPegExposure(target,data.exposureSlices);
    }
  }
  window.dispatchEvent(new CustomEvent('shrink:peg-position-changed',{detail:{cutIndex,pegIndex,controls:currentPegControls(cutIndex)}}));
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

  group.add(peg,outline);
  previewGroup.add(group);
  colourPegExposure(group,exposureSlices);
  return group;
}

function addPegPreviews(model, cutIndex, y) {
  const loops=cutLoopsFromModel(model,y);
  const {radius,depth,safeRadius}=pegSizing();
  const manual=manualPegMode();
  const points=manual ? manualPointsForCut(cutIndex,loops,safeRadius) : previewAutoPegPoints(loops,safeRadius);
  const exposureSlices=makeExposureSlices(model,y,depth,9);
  previewCutData[cutIndex]={y,loops,safeRadius,points,exposureSlices};

  points.slice(0,2).forEach((p,i)=>{
    const pegRadius=i===0?radius:radius*.76;
    makePegPreview(cutIndex,i,p,y,pegRadius,depth,exposureSlices);
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
    if (info) info.textContent = 'Off — export one STL.';
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
  window.dispatchEvent(new CustomEvent('shrink:peg-preview-updated',{detail:{cuts:previewCutData.length}}));
  updateCutLabel();
  if (info) {
    if (n === 2) {
      const f = fractions[0];
      info.textContent = `2 sections · cut at ${(finishedHeightMM() * f).toFixed(1)} mm (${Math.round(f * 100)}%) · green plane and true-size peg previews shown.`;
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
  const tol = Math.max(Math.abs(span) * 1e-6, 1e-7);
  const segments = [];
  const p = i => ({ x:verts[i*np], y:verts[i*np+1], z:verts[i*np+2] });
  const intersect = (a,b) => {
    const dy=b.y-a.y, t=Math.abs(dy)<1e-20 ? 0 : (y-a.y)/dy;
    return {x:a.x+(b.x-a.x)*t, y, z:a.z+(b.z-a.z)*t};
  };
  try {
    for (let t=0;t+2<tris.length;t+=3) {
      const tri=[p(tris[t]),p(tris[t+1]),p(tris[t+2])], hits=[];
      for (let i=0;i<3;i++) {
        const a=tri[i], b=tri[(i+1)%3], da=a.y-y, db=b.y-y;
        if (Math.abs(da)<=tol && Math.abs(db)<=tol) continue;
        if ((da < -tol && db > tol) || (da > tol && db < -tol)) hits.push(intersect(a,b));
        else if (Math.abs(da)<=tol) hits.push({x:a.x,y,z:a.z});
      }
      const unique=[];
      for (const q of hits) if (!unique.some(v => Math.hypot(v.x-q.x,v.z-q.z)<=tol)) unique.push(q);
      if (unique.length>=2) segments.push([unique[0],unique[1]]);
    }
  } finally { try { mesh.delete?.(); } catch {} }

  const key = q => `${Math.round(q.x/tol)},${Math.round(q.z/tol)}`;
  const entries=segments.map((seg,i)=>({i,a:seg[0],b:seg[1],used:false})), byKey=new Map();
  const add=(k,i)=>{let list=byKey.get(k);if(!list)byKey.set(k,list=[]);list.push(i);};
  entries.forEach((e,i)=>{add(key(e.a),i);add(key(e.b),i);});
  const loops=[];
  for (let seed=0;seed<entries.length;seed++) {
    if (entries[seed].used) continue;
    const e=entries[seed]; e.used=true;
    const loop=[e.a,e.b]; let current=e.b, closed=false, guard=0;
    while (guard++ < entries.length+4) {
      const k=key(current), ids=byKey.get(k)||[];
      let next=null;
      for (const id of ids) if (!entries[id].used) { next=entries[id]; break; }
      if (!next) break;
      next.used=true;
      current = key(next.a)===k ? next.b : next.a;
      if (Math.hypot(current.x-loop[0].x,current.z-loop[0].z)<=tol*1.5) { closed=true; break; }
      loop.push(current);
    }
    if (closed && loop.length>=3) loops.push(loop);
  }
  return loops;
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
      .filter(p=>previewCandidateSafe(p,loops,safeRadius))
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
      const preferred = manualPegMode() ? (manualPegPositions.get(i) || null) : null;
      const points = choosePegPoints(solid, wasm, y, box, radiusMain, depth, clearance, span, preferred);
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
    const joints = !withPegs ? '' : parts.pegCuts ? ` with keyed alignment pegs on ${parts.pegCuts} cut${parts.pegCuts === 1 ? '' : 's'} (upper part pegs into lower sockets)` : ' with flat cuts (no safe peg position was found)';
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
window.__shrinkSplit = {
  updatePreview, partCount, cutFractions,
  resetManualPegPositions: clearManualPegPositions,
  getManualPegControls: currentPegControls,
  moveManualPegAxis: manualPegAxisMove,
  cutCount() { return previewCutData.length; },
  manualPegPoints() {
    const n=partCount(), out=[];
    for(let i=0;i<Math.max(0,n-1);i++) out.push((manualPegPositions.get(i)||[]).map(p=>({x:p.x,z:p.z})));
    return out;
  }
};
