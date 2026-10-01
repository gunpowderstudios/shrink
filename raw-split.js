import * as THREE from 'https://esm.sh/three@0.180.0';

// SHRINK 3D v1.82 — direct triangle-mesh splitter used when solid/Boolean splitting cannot read the source.
// Clips the visible triangle soup into horizontal slabs and caps each cut plane. This path deliberately
// does not require a watertight/manifold source mesh.

const EPS = 1e-7;

function worldTriangles(model) {
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      const area2 = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq();
      if (area2 < 1e-20) continue;
      out.push([
        {x:a.x,y:a.y,z:a.z}, {x:b.x,y:b.y,z:b.z}, {x:c.x,y:c.y,z:c.z}
      ]);
    }
  });
  return out;
}

function intersectY(a, b, y) {
  const dy = b.y - a.y;
  const t = Math.abs(dy) < EPS ? 0 : (y - a.y) / dy;
  return { x: a.x + (b.x-a.x)*t, y, z: a.z + (b.z-a.z)*t };
}

function clipPolygonY(poly, y, keepAbove) {
  if (!Number.isFinite(y)) return poly.slice();
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const s = poly[i], e = poly[(i+1)%poly.length];
    const sIn = keepAbove ? s.y >= y-EPS : s.y <= y+EPS;
    const eIn = keepAbove ? e.y >= y-EPS : e.y <= y+EPS;
    if (sIn && eIn) out.push(e);
    else if (sIn && !eIn) out.push(intersectY(s,e,y));
    else if (!sIn && eIn) { out.push(intersectY(s,e,y)); out.push(e); }
  }
  return out;
}

function planeSegment(tri, y) {
  const pts = [];
  for (let i=0;i<3;i++) {
    const a=tri[i], b=tri[(i+1)%3];
    const da=a.y-y, db=b.y-y;
    if (Math.abs(da) <= EPS && Math.abs(db) <= EPS) continue;
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) pts.push(intersectY(a,b,y));
    else if (Math.abs(da) <= EPS) pts.push({x:a.x,y,z:a.z});
  }
  const unique=[];
  for (const p of pts) if (!unique.some(q => (p.x-q.x)**2+(p.z-q.z)**2 < 1e-14)) unique.push(p);
  return unique.length >= 2 ? [unique[0],unique[1]] : null;
}

function pushTri(arr,a,b,c) {
  arr.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
}

function triangulateFan(arr, poly) {
  if (poly.length < 3) return;
  for (let i=1;i+1<poly.length;i++) pushTri(arr,poly[0],poly[i],poly[i+1]);
}

function key2(p, scale) { return `${Math.round(p.x*scale)},${Math.round(p.z*scale)}`; }

function stitchLoops(segments, tolerance) {
  const scale = 1 / Math.max(tolerance, 1e-9);
  const unused = segments.map((s,i)=>({i,a:s[0],b:s[1],used:false}));
  const byKey = new Map();
  const add=(k,i)=>{ let a=byKey.get(k); if(!a) byKey.set(k,a=[]); a.push(i); };
  unused.forEach((s,i)=>{ add(key2(s.a,scale),i); add(key2(s.b,scale),i); });
  const loops=[];
  for (let seed=0;seed<unused.length;seed++) {
    if (unused[seed].used) continue;
    const s=unused[seed]; s.used=true;
    const loop=[s.a,s.b];
    let current=s.b, guard=0;
    while (guard++ < unused.length+4) {
      const k=key2(current,scale), candidates=byKey.get(k)||[];
      let next=null;
      for (const ci of candidates) if (!unused[ci].used) { next=unused[ci]; break; }
      if (!next) break;
      next.used=true;
      const ka=key2(next.a,scale);
      current = ka===k ? next.b : next.a;
      if ((current.x-loop[0].x)**2+(current.z-loop[0].z)**2 <= tolerance*tolerance) break;
      loop.push(current);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function capLoop(arr, loop, y, normalY) {
  const pts2 = loop.map(p => new THREE.Vector2(p.x,p.z));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(pts2, []); } catch { return; }
  const verts = loop.map(p => ({x:p.x,y,z:p.z}));
  for (const f of faces) {
    let a=verts[f[0]], b=verts[f[1]], c=verts[f[2]];
    const ux=b.x-a.x, uz=b.z-a.z, vx=c.x-a.x, vz=c.z-a.z;
    const ny = uz*vx - ux*vz;
    if ((normalY > 0 && ny < 0) || (normalY < 0 && ny > 0)) [b,c]=[c,b];
    pushTri(arr,a,b,c);
  }
}

function geometryFromPositions(values) {
  if (!values.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(values,3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function splitModelFlat(model, sections=2) {
  const tris = worldTriangles(model);
  if (!tris.length) throw new Error('No triangles were found in this model.');
  let minY=Infinity,maxY=-Infinity,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const t of tris) for (const p of t) {
    minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
    minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minZ=Math.min(minZ,p.z); maxZ=Math.max(maxZ,p.z);
  }
  const span=Math.max(maxY-minY,EPS);
  const diag=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ);
  const tol=Math.max(diag*1e-6,1e-7);
  const cuts=Array.from({length:sections-1},(_,i)=>minY+span*(i+1)/sections);
  const result=[];

  for (let part=0;part<sections;part++) {
    const low = part===0 ? -Infinity : cuts[part-1];
    const high = part===sections-1 ? Infinity : cuts[part];
    const positions=[];
    const lowerSegs=[], upperSegs=[];
    for (const tri of tris) {
      let poly=tri;
      if (Number.isFinite(low)) poly=clipPolygonY(poly,low,true);
      if (poly.length && Number.isFinite(high)) poly=clipPolygonY(poly,high,false);
      if (poly.length>=3) triangulateFan(positions,poly);
      if (Number.isFinite(low)) { const s=planeSegment(tri,low); if(s) lowerSegs.push(s); }
      if (Number.isFinite(high)) { const s=planeSegment(tri,high); if(s) upperSegs.push(s); }
    }
    if (Number.isFinite(low)) for (const loop of stitchLoops(lowerSegs,tol)) capLoop(positions,loop,low,-1);
    if (Number.isFinite(high)) for (const loop of stitchLoops(upperSegs,tol)) capLoop(positions,loop,high,1);
    const geometry=geometryFromPositions(positions);
    if (!geometry) throw new Error(`Section ${part+1} is empty.`);
    const root=new THREE.Group();
    root.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xe8ebef,roughness:.72,metalness:0})));
    root.updateMatrixWorld(true);
    result.push(root);
  }
  return { parts:result, cuts, mode:'flat-fallback' };
}

export function disposeSplitParts(parts=[]) {
  for (const root of parts) root?.traverse?.(o=>{ if(o.isMesh){ o.geometry?.dispose?.(); const ms=Array.isArray(o.material)?o.material:[o.material]; ms.forEach(m=>m?.dispose?.()); }});
}
