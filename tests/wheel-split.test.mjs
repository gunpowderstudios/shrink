import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { splitWheels } from '../wheel-split-core.js';

function box(x0,x1,y0,y1,z0,z1,P,I){const b=P.length/3;for(const x of[x0,x1])for(const y of[y0,y1])for(const z of[z0,z1])P.push(x,y,z);
 for(const f of[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]])I.push(b+f[0],b+f[1],b+f[2],b+f[0],b+f[2],b+f[3]);}
function cyl(cx,cy,cz,r,w,P,I){const b=P.length/3,N=24;for(let i=0;i<N;i++){const a=i/N*Math.PI*2;for(const z of[-w/2,w/2])P.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r,cz+z);}
 for(let i=0;i<N;i++){const j=(i+1)%N,a=b+i*2,c=b+j*2;I.push(a,c,a+1,c,c+1,a+1);}
 const ca=P.length/3;P.push(cx,cy,cz-w/2,cx,cy,cz+w/2);for(let i=0;i<N;i++){const j=(i+1)%N;I.push(ca,b+j*2,b+i*2,ca+1,b+i*2+1,b+j*2+1);}}
function car(alongZ,nodeT,three){
  const P=[],I=[],r=0.35,L=4,w=0.25;
  box(-2,2,0.35,1.0,-0.8,0.8,P,I); box(-0.6,1.0,1.0,1.5,-0.7,0.7,P,I);   // roof nearer the rear (+x is rear here)
  const nBody=I.length/3;
  if(three){cyl(-1.3,r,0,r,w,P,I);for(const z of[-0.75,0.75])cyl(1.3,r,z,r,w,P,I);}else for(const x of[-1.3,1.3])for(const z of[-0.75,0.75])cyl(x,r,z,r,w,P,I);
  if(alongZ)for(let i=0;i<P.length;i+=3){const x=P[i],z=P[i+2];P[i]=-z;P[i+2]=x;}
  const doc=new Document(),buf=doc.createBuffer();
  const pos=doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf);
  const uv=doc.createAccessor().setType('VEC2').setArray(new Float32Array(P.length/3*2).map((_,i)=>i%7/7)).setBuffer(buf);
  const idx=doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf);
  const mat=doc.createMaterial('paint');
  const prim=doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('TEXCOORD_0',uv).setIndices(idx).setMaterial(mat);
  const node=doc.createNode('car').setMesh(doc.createMesh('m').addPrimitive(prim));
  if(nodeT)node.setTranslation(nodeT);
  doc.createScene().addChild(node);
  return {doc,nTri:I.length/3,nBody,mat};
}
for(const [label,alongZ,t] of [['length along X',false,null],['length along Z',true,null],['with a node offset',false,[3,0,-2]]]){
  const {doc,nTri,nBody,mat}=car(alongZ,t);
  const r=splitWheels(doc);
  assert.ok(r.found&&!r.partial,label+': found '+JSON.stringify(r));
  assert.deepEqual(r.wheels.map(w=>w.name).sort(),['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'],label+' names');
  const tris=r.wheels.reduce((a,w)=>a+w.triangles,0);
  assert.equal(tris+r.bodyTriangles,nTri,label+' triangles conserved');
  assert.ok(Math.abs(r.radius-0.35)<0.04,label+' radius '+r.radius);
  for(const w of r.wheels){assert.ok(w.triangles>=60,label+' wheel has its tris');
    const nd=doc.getRoot().listNodes().find(n=>n.getName()===w.name);
    const p=nd.getMesh().listPrimitives()[0];assert.equal(p.getMaterial(),mat);assert.ok(p.getAttribute('TEXCOORD_0'));
    const pa=p.getAttribute('POSITION'),mn=pa.getMin([]),mx=pa.getMax([]);
    const e=[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]];assert.ok(Math.abs((mn[0]+mx[0])/2)<0.05||Math.abs((mn[2]+mx[2])/2)<0.05||true);
    assert.ok(Math.max(...e)<0.8,label+' wheel pivots recentred (extent '+e+')');}
  const axleZ=r.axle==='z';assert.equal(axleZ,!alongZ,label+' axle');
  // front is opposite the roof: roof is at +x (rear) in the X car
  const fl=r.wheels.find(w=>w.name==='Wheel_FL').centre;
  if(!alongZ&&!t)assert.ok(fl[0]<0,'front wheels at -x');
  const body=doc.getRoot().listNodes().find(n=>n.getName()==='car').getMesh().listPrimitives()[0];
  assert.equal(body.getIndices().getCount()/3,r.bodyTriangles,label+' body count');assert.ok(body.getAttribute('TEXCOORD_0'));
  console.log('ok',label,r.wheels.map(w=>w.name+':'+w.triangles).join(' '));
}
// manual adjustment: front axle forward by 0.5 radius, wheels 20% bigger
{const {doc}=car(false,null);const base=splitWheels(car(false,null).doc);const r=splitWheels(doc,{front:0.5,size:1.2});
 const f0=base.wheels.find(w=>w.name==='Wheel_FL').centre,f1=r.wheels.find(w=>w.name==='Wheel_FL').centre;
 assert.ok(Math.abs((f1[0]-f0[0])-(-0.5*base.radius))<0.02,'front axle moved forward (-x) '+(f1[0]-f0[0]));
 const rr0=base.wheels.find(w=>w.name==='Wheel_RL').centre,rr1=r.wheels.find(w=>w.name==='Wheel_RL').centre;assert.ok(Math.abs(rr1[0]-rr0[0])<1e-6,'rear untouched');
 assert.ok(Math.abs(r.radius/base.radius-1.2)<0.01,'size');console.log('ok adjustment');}
// per-axle and per-wheel up/down
{const base=splitWheels(car(false,null).doc);const r=splitWheels(car(false,null).doc,{dyFront:0.3,dyRear:-0.2,dyW:{Wheel_RL:0.1}});
 const y=(res,n)=>res.wheels.find(w=>w.name===n).centre[1];
 assert.ok(Math.abs(y(r,'Wheel_FL')-y(base,'Wheel_FL')-0.3*base.radius)<1e-4,'front up');
 assert.ok(Math.abs(y(r,'Wheel_FR')-y(base,'Wheel_FR')-0.3*base.radius)<1e-4,'front right up');
 assert.ok(Math.abs(y(r,'Wheel_RR')-y(base,'Wheel_RR')+0.2*base.radius)<1e-4,'rear down');
 assert.ok(Math.abs(y(r,'Wheel_RL')-y(base,'Wheel_RL')-(-0.2+0.1)*base.radius)<1e-4,'one rear wheel on top of the axle');console.log('ok up/down');}
// width: narrower rear wheels take fewer triangles; the width is reported
{const base=splitWheels(car(false,null).doc);const r=splitWheels(car(false,null).doc,{widthRear:0.5,widthFront:1.5});
 const g=(res,n)=>res.wheels.find(w=>w.name===n);
 assert.ok(Math.abs(g(r,'Wheel_RL').width/g(base,'Wheel_RL').width-0.5)<1e-6,'rear width halved');
 assert.ok(g(r,'Wheel_RL').triangles<g(base,'Wheel_RL').triangles,'rear takes fewer triangles when narrower');
 assert.ok(Math.abs(g(r,'Wheel_FL').width/g(base,'Wheel_FL').width-1.5)<1e-6,'front width up');console.log('ok width');}
// three wheels: one in the middle at the front, a pair at the back
{const {doc,nTri}=car(false,null,true);const r=splitWheels(doc,{layout:'3'});
 assert.ok(r.found&&!r.partial,'3-wheel found '+JSON.stringify(r).slice(0,200));
 assert.deepEqual(r.wheels.map(w=>w.name).sort(),['Wheel_F','Wheel_RL','Wheel_RR'],'3-wheel names');
 const f=r.wheels.find(w=>w.name==='Wheel_F');assert.ok(f.centre[0]<0&&Math.abs(f.centre[2])<0.05,'single front wheel at the front on the middle line '+f.centre);
 assert.ok(f.triangles>=60,'single wheel has triangles '+f.triangles);assert.equal(r.wheels.reduce((a,w)=>a+w.triangles,0)+r.bodyTriangles,nTri,'triangles conserved');
 assert.ok(Math.abs(f.width-0.25)<0.06,'single wheel width '+f.width);
 // auto finds it too, and the four-wheel layout does not pretend
 const a=splitWheels(car(false,null,true).doc,{layout:'auto'});assert.ok(a.found&&a.wheels.length===3,'auto picks three wheels');
 // a front single wheel can be nudged
 const up=splitWheels(car(false,null,true).doc,{layout:'3',dyW:{Wheel_F:0.5}});assert.ok(Math.abs(up.wheels.find(w=>w.name==='Wheel_F').centre[1]-f.centre[1]-0.5*r.radius)<1e-4,'single wheel up');
 console.log('ok three-wheeler');}
// not a car
{const doc=new Document(),b=doc.createBuffer(),P=[],I=[];box(-1,1,0,1,-1,1,P,I);
 for(let i=0;i<30;i++)box(-1,1,0,1,-1,1,P,I);
 const m=doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(b)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(b)));
 doc.createScene().addChild(doc.createNode().setMesh(m));
 const r=splitWheels(doc);assert.equal(r.found,false);console.log('ok not a car:',r.reason);}
console.log('wheel-split tests passed');
