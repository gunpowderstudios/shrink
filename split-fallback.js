import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl, analyzeTopology } from './mesh-tools.js?v=2.18';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';
import { splitModelFlat, disposeSplitParts } from './raw-split.js?v=2.18';

// SHRINK 3D v1.90 — intercept a failed solid split and try a direct capped triangle-mesh split.
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
let busy = false;
function sourceModel() { return window.__shrinkWorkingModel?.() || app()?.optimizedModel || app()?.originalModel || null; }
function mmPerUnit() { return window.__shrinkPrint?.mmPerUnit?.() || 1; }
function partCount() { return window.__shrinkSplit?.partCount?.() || 1; }
function cutFractions() { return window.__shrinkSplit?.cutFractions?.(partCount()) || []; }

function saveBlob(blob, filename) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

async function directSplit(rawReason) {
  if (busy) return false;
  const model=sourceModel(), n=partCount();
  if (!model || n<=1) return false;
  busy=true; let parts=[];
  try {
    console.warn('[SHRINK 3D v1.90] Solid split could not complete; trying direct capped split.', { reason: rawReason });
    const scale=mmPerUnit(), wantsPegs=$('splitJoint')?.value !== 'flat';
    const pegRadius=Math.max(.5,Number($('pegDiameter')?.value||4)/2)/scale;
    const pegDepth=Math.max(2,Number($('pegDepth')?.value||6))/scale;
    const clearance=Math.max(.05,Number($('pegClearance')?.value||.2))/scale;
    app()?.setStatus?.(wantsPegs ? 'The solid split could not be made. Trying a direct split with safe peg/socket joints…' : 'The solid split could not be made. Trying a direct flat-cut split instead…', false);
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    const out=splitModelFlat(model,n,{withPegs:wantsPegs,pegRadius,pegDepth,clearance,cutFractions:cutFractions()});
    parts=out.parts;
    const files={}, zUp=$('zUpToggle')?.checked!==false, base=app()?.baseName?.()||'model';
    let total=0; const topology=[];
    for(let i=0;i<parts.length;i++){
      const topo=analyzeTopology(THREE,parts[i]); topology.push(topo);
      const stl=buildBinaryStl({THREE,model:parts[i],mmPerUnit:scale,zUp}); total+=stl.triangles;
      files[`${base}-part-${i+1}-of-${parts.length}.stl`]=new Uint8Array(stl.buffer);
    }
    const zip=zipSync(files,{level:0}); saveBlob(new Blob([zip],{type:'application/zip'}),`${base}-split-${parts.length}-parts-fallback.zip`);
    const pegCuts=out.joints?.filter(j=>j.pegsAdded).length||0;
    const unsafe=topology.map((t,i)=>({part:i+1,...t})).filter(t=>!t.watertight);
    console.info('[SHRINK 3D v1.90] Direct split result',{cuts:out.cuts,joints:out.joints,topology});
    let msg=`Saved ${parts.length} separate STL sections`;
    if(wantsPegs) msg += pegCuts ? ` with peg/socket joints on ${pegCuts} cut${pegCuts===1?'':'s'}` : ' with flat cuts — no safe peg position was found'; else msg += ' with flat cuts';
    if(n===2 && cutFractions()[0]) msg += ` · cut at ${(Math.max(1,Number($('figureHeightMm')?.value)||75)*cutFractions()[0]).toFixed(1)} mm`;
    msg += ` · ${new Intl.NumberFormat().format(total)} triangles total.`;
    if(unsafe.length){
      const detail=unsafe.map(t=>`Section ${t.part}: ${t.openEdges} open edge${t.openEdges===1?'':'s'}, ${t.nonManifold} pinched edge${t.nonManifold===1?'':'s'}`).join(' · ');
      app()?.setStatus?.(`${msg} Check before printing — ${detail}. Your slicer may need to repair it.`,true);
    } else app()?.setStatus?.(`${msg} Topology check found closed sections.`,false);
    return true;
  } catch(err){ console.error('[SHRINK 3D v1.90] Direct split fallback also failed',err); return false; }
  finally { disposeSplitParts(parts); busy=false; }
}

function install(){
  const a=app(); if(!a?.setStatus || a.__rawSplitFallbackWrapped) return false;
  const previous=a.setStatus.bind(a);
  a.setStatus=(msg,error=false)=>{
    const text=String(msg||'');
    if(!busy && text.startsWith('Split failed:')){
      const reason=text.slice('Split failed:'.length).trim();
      directSplit(reason).then(ok=>{ if(!ok) previous(msg,error); }); return;
    }
    return previous(msg,error);
  };
  a.__rawSplitFallbackWrapped=true; return true;
}

install();
const observer=new MutationObserver(()=>install()); observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('shrink:model-opened',install);
