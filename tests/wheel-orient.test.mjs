// The wheel finder on a car that does not stand upright in the file (lying on its side, upside down, nose down, tilted at any angle).
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { splitWheels, detectWheelsInDoc } from '../wheel-split-core.js';

function box(x0,x1,y0,y1,z0,z1,P,I){const b=P.length/3;for(const x of[x0,x1])for(const y of[y0,y1])for(const z of[z0,z1])P.push(x,y,z);
 for(const f of[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]])I.push(b+f[0],b+f[1],b+f[2],b+f[0],b+f[2],b+f[3]);}
function cyl(cx,cy,cz,r,w,P,I){const b=P.length/3,N=32;for(let i=0;i<N;i++){const a=i/N*Math.PI*2;for(const z of[-w/2,w/2])P.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r,cz+z);}
 for(let i=0;i<N;i++){const j=(i+1)%N,a=b+i*2,c=b+j*2;I.push(a,c,a+1,c,c+1,a+1);}
 const ca=P.length/3;P.push(cx,cy,cz-w/2,cx,cy,cz+w/2);for(let i=0;i<N;i++){const j=(i+1)%N;I.push(ca,b+j*2,b+i*2,ca+1,b+i*2+1,b+j*2+1);}}
// a van-like body (tall box, a windscreen step at the front) on four tyres; the roof/cabin sits towards +x, so the front is at -x
function car(R){
  const P=[],I=[],r=0.35,w=0.25;
  box(-2.2,2.2,0.4,1.0,-0.9,0.9,P,I); box(-2.2,-1.6,0.4,0.8,-0.95,0.95,P,I); box(-0.6,1.4,1.0,1.9,-0.85,0.85,P,I);
  for(const x of[-1.3,1.4])for(const z of[-0.8,0.8])cyl(x,r,z,r,w,P,I);
  if(R)for(let i=0;i<P.length;i+=3){const x=P[i],y=P[i+1],z=P[i+2];P[i]=R[0][0]*x+R[0][1]*y+R[0][2]*z;P[i+1]=R[1][0]*x+R[1][1]*y+R[1][2]*z;P[i+2]=R[2][0]*x+R[2][1]*y+R[2][2]*z;}
  const doc=new Document(),buf=doc.createBuffer();
  const pos=doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf),idx=doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf);
  doc.createScene().addChild(doc.createNode('car').setMesh(doc.createMesh('m').addPrimitive(doc.createPrimitive().setAttribute('POSITION',pos).setIndices(idx).setMaterial(doc.createMaterial('paint')))));
  return doc;
}
const rx=a=>{const c=Math.cos(a),s=Math.sin(a);return[[1,0,0],[0,c,-s],[0,s,c]];},ry=a=>{const c=Math.cos(a),s=Math.sin(a);return[[c,0,s],[0,1,0],[-s,0,c]];},rz=a=>{const c=Math.cos(a),s=Math.sin(a);return[[c,-s,0],[s,c,0],[0,0,1]];};
const mul=(A,B)=>A.map((r,i)=>B[0].map((_,j)=>r[0]*B[0][j]+r[1]*B[1][j]+r[2]*B[2][j]));
const app=(R,v)=>R.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const deg=a=>a*Math.PI/180;

const upright=splitWheels(car(null)); assert.ok(upright.found&&!upright.partial,'upright car: '+JSON.stringify(upright).slice(0,150));
assert.equal(upright.upright,true,'an upright car is reported as upright');
const ref=Object.fromEntries(upright.wheels.map(w=>[w.name,w.centre]));
assert.deepEqual(Object.keys(ref).sort(),['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']);

const cases=[
  ['lying on its side (roll 90)',rx(deg(90))],
  ['upside down (roll 180)',rx(deg(180))],
  ['nose down (90 about Z)',rz(deg(90))],
  ['Z-up export (-90 about X)',rx(deg(-90))],
  ['rolled 97, pitched 20, yawed 35 (like the campervan)',mul(ry(deg(35)),mul(rz(deg(20)),rx(deg(97))))],
  ['tilted 30 about the length axis',rx(deg(30))],
];
for(const [label,R] of cases){
  const t0=Date.now(), doc=car(R), r=splitWheels(doc);
  assert.ok(r.found&&!r.partial,label+': found '+JSON.stringify(r).slice(0,160));
  assert.deepEqual(r.wheels.map(w=>w.name).sort(),['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'],label+' names');
  for(const w of r.wheels){const want=app(R,ref[w.name]),d=Math.hypot(w.centre[0]-want[0],w.centre[1]-want[1],w.centre[2]-want[2]);assert.ok(d<0.07,label+': '+w.name+' is '+d.toFixed(3)+' from where it should be');
    assert.ok(w.triangles>=100,label+': '+w.name+' keeps its triangles ('+w.triangles+')');}
  assert.ok(Math.abs(r.radius-0.35)<0.04,label+' radius '+r.radius);
  const tri=r.wheels.reduce((a,w)=>a+w.triangles,0), all=doc.getRoot().listNodes().find(n=>n.getName()==='car').getMesh().listPrimitives()[0].getIndices().getCount()/3;
  assert.equal(tri,upright.wheels.reduce((a,w)=>a+w.triangles,0),label+': the same triangles go to the wheels as when upright');
  assert.equal(r.upright,false,label+' reported as not upright');
  const wantTilt=Math.round(Math.acos(Math.max(-1,Math.min(1,R[1][1])))*180/Math.PI); assert.ok(Math.abs(r.tiltDeg-wantTilt)<=8,label+': tilt '+r.tiltDeg+' vs '+wantTilt);
  // every wheel's geometry is centred on its pivot, whatever the angle
  for(const w of r.wheels){const nd=doc.getRoot().listNodes().find(n=>n.getName()===w.name),a=nd.getMesh().listPrimitives()[0].getAttribute('POSITION'),mn=a.getMin([]),mx=a.getMax([]);
    const off=Math.hypot((mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2);assert.ok(off<0.06,label+': '+w.name+' pivot '+off.toFixed(3)+' from its middle');}
  console.log('ok',label,'tilt',r.tiltDeg,'axle',r.axle,(Date.now()-t0)+' ms');
}
// v2.208: detection can be done first (on the full mesh) and handed to the cut
{ const doc = car(null), det = detectWheelsInDoc(doc, {}); assert.ok(det.found, 'pre-detection finds the wheels');
  const r = splitWheels(doc, {}, det); assert.ok(r.found && !r.partial && r.wheels.length === 4, 'the cut uses the pre-detected wheels'); console.log('ok pre-detection handed to the cut'); }
console.log('wheel-orient tests passed');
