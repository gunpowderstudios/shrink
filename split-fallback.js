import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl } from './mesh-tools.js?v=1.82';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';
import { splitModelFlat, disposeSplitParts } from './raw-split.js?v=1.82';

// SHRINK 3D v1.82 — intercept a failed solid split and try a direct capped triangle-mesh split.
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
let busy = false;

function sourceModel() { return app()?.optimizedModel || app()?.originalModel || null; }
function mmPerUnit() { return window.__shrinkPrint?.mmPerUnit?.() || 1; }
function partCount() { return window.__shrinkSplit?.partCount?.() || 1; }

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
  busy=true;
  let parts=[];
  try {
    console.warn('[SHRINK 3D v1.82] Solid split could not complete; trying direct capped split.', { reason: rawReason });
    app()?.setStatus?.('The solid split could not be made. Trying a direct flat-cut split instead…', false);
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    const out=splitModelFlat(model,n);
    parts=out.parts;
    const files={}, scale=mmPerUnit(), zUp=$('zUpToggle')?.checked!==false;
    const base=app()?.baseName?.()||'model';
    let total=0;
    for(let i=0;i<parts.length;i++){
      const stl=buildBinaryStl({THREE,model:parts[i],mmPerUnit:scale,zUp});
      total+=stl.triangles;
      files[`${base}-part-${i+1}-of-${parts.length}.stl`]=new Uint8Array(stl.buffer);
    }
    const zip=zipSync(files,{level:0});
    saveBlob(new Blob([zip],{type:'application/zip'}),`${base}-split-${parts.length}-parts-flat.zip`);
    app()?.setStatus?.(`Saved ${parts.length} separate STL sections with flat capped cuts. Pegs were skipped because this mesh could not use the solid split safely.`,false);
    return true;
  } catch(err){
    console.error('[SHRINK 3D v1.82] Direct split fallback also failed',err);
    return false;
  } finally {
    disposeSplitParts(parts);
    busy=false;
  }
}

function install(){
  const a=app();
  if(!a?.setStatus || a.__rawSplitFallbackWrapped) return false;
  const previous=a.setStatus.bind(a);
  a.setStatus=(msg,error=false)=>{
    const text=String(msg||'');
    if(!busy && text.startsWith('Split failed:')){
      const reason=text.slice('Split failed:'.length).trim();
      directSplit(reason).then(ok=>{
        if(!ok) previous(msg,error); // lets the v1.81 safety layer fall back to one normal STL
      });
      return;
    }
    return previous(msg,error);
  };
  a.__rawSplitFallbackWrapped=true;
  return true;
}

install();
const observer=new MutationObserver(()=>install());
observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('shrink:model-opened',install);
