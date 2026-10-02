import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl } from './mesh-tools.js?v=2.09';

// SHRINK 3D v2.09 — safety layer around optional Fuse / Split helpers.
const VERSION = '2.09';
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
let fallbackBusy = false;
let lastAttempt = null;

function sourceModel(){ return app()?.optimizedModel || app()?.originalModel || null; }
function topologySummary(model){
  if(!model)return null;
  const edgeCounts=new Map(); let triangles=0,degenerate=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const q=v=>`${Math.round(v.x*1e6)},${Math.round(v.y*1e6)},${Math.round(v.z*1e6)}`;
  const addEdge=(u,v)=>{const ku=q(u),kv=q(v),key=ku<kv?`${ku}|${kv}`:`${kv}|${ku}`;edgeCounts.set(key,(edgeCounts.get(key)||0)+1);};
  model.updateMatrixWorld(true);
  model.traverse(o=>{if(!o.isMesh||!o.geometry?.attributes?.position)return;const g=o.geometry,pos=g.attributes.position,idx=g.index,count=idx?idx.count:pos.count;for(let i=0;i+2<count;i+=3){const i0=idx?idx.getX(i):i,i1=idx?idx.getX(i+1):i+1,i2=idx?idx.getX(i+2):i+2;a.fromBufferAttribute(pos,i0).applyMatrix4(o.matrixWorld);b.fromBufferAttribute(pos,i1).applyMatrix4(o.matrixWorld);c.fromBufferAttribute(pos,i2).applyMatrix4(o.matrixWorld);triangles++;const area2=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq();if(area2<1e-20)degenerate++;addEdge(a,b);addEdge(b,c);addEdge(c,a);}});
  let openEdges=0,pinchedEdges=0;for(const n of edgeCounts.values()){if(n===1)openEdges++;else if(n>2)pinchedEdges++;}
  return{triangles,openEdges,pinchedEdges,degenerateTriangles:degenerate};
}

function ensureDiagnosticPanel(){
  let panel=$('printDiagnosticPanel'); if(panel)return panel;
  const viewerPanel=document.querySelector('.viewer-panel'); if(!viewerPanel)return null;
  panel=document.createElement('div'); panel.id='printDiagnosticPanel'; panel.className='print-diagnostic-panel'; panel.hidden=true;
  panel.innerHTML=`
    <div class="print-diagnostic-title">⚠ This model isn't one clean printable solid</div>
    <div id="printDiagnosticMessage"></div>
    <div class="repair-actions">
      <label class="repair-quality"><span>Keep detail</span><select id="remeshQuality"><option value="high">High</option><option value="balanced" selected>Balanced</option><option value="fast">Fast</option></select></label>
      <button id="makeWatertightBtn" type="button">Make watertight</button>
    </div>
    <div class="repair-help">Rebuilds the sculpt as a new voxel-style closed outer skin. Best for overlapping or troublesome parts. Tiny details may soften slightly. Your original file is not changed.</div>
    <details class="repair-advanced"><summary>Advanced details</summary><div id="printDiagnosticStats" class="print-diagnostic-stats"></div></details>`;
  viewerPanel.appendChild(panel);
  const style=document.createElement('style'); style.id='printDiagnosticStyle';
  style.textContent=`.print-diagnostic-panel{margin:10px 0 0;padding:13px 14px;border:1px solid #ff5b62;border-radius:12px;background:rgba(120,18,24,.22);color:#ffd3d5;font-size:12px;line-height:1.45}.print-diagnostic-title{font-weight:800;color:#ff747a;font-size:14px;margin-bottom:5px}.repair-actions{display:flex;gap:8px;align-items:end;margin-top:10px;flex-wrap:wrap}.repair-quality{display:grid;gap:4px;min-width:130px}.repair-quality span{font-size:11px;font-weight:700;color:#ffc2c5}.repair-quality select{background:#20242c;color:#fff;border:1px solid #4a515d;border-radius:8px;padding:8px}.repair-actions button{border:0;border-radius:9px;padding:9px 14px;background:#ff4f57;color:#fff;font-weight:800;cursor:pointer}.repair-actions button:disabled{opacity:.55;cursor:wait}.repair-help{margin-top:7px;color:#e9b9bc}.repair-advanced{margin-top:8px}.repair-advanced summary{cursor:pointer;color:#ffb5b9;font-weight:700}.print-diagnostic-stats{margin-top:6px;color:#ffb5b9}.print-diagnostic-panel[hidden]{display:none!important}`;
  document.head.appendChild(style);
  $('makeWatertightBtn')?.addEventListener('click', makeWatertightCopy);
  return panel;
}

function friendlyReason(kind,raw){const t=String(raw||'');if(/disconnected solids/i.test(t))return 'SHRINK found separate pieces that are not joined together.';if(/non-manifold|manifold rejected|no printable solid/i.test(t))return 'SHRINK found a mesh problem the quick repair cannot safely fix. Make watertight will try a voxel-style rebuild.';if(/boolean union/i.test(t))return 'Some overlapping parts could not be joined cleanly.';if(kind==='Split')return 'The clean-solid route failed, so SHRINK can still try the direct split fallback.';return 'SHRINK could not turn this into one reliable closed solid.';}

function showDiagnostic(kind,rawMessage){
  const panel=ensureDiagnosticPanel();if(!panel)return;const topo=topologySummary(sourceModel());
  const msg=$('printDiagnosticMessage'),stats=$('printDiagnosticStats');
  panel.querySelector('.print-diagnostic-title').textContent=`⚠ This model isn't one clean printable solid`;
  if(msg)msg.textContent=friendlyReason(kind,rawMessage);
  if(stats&&topo){const nf=new Intl.NumberFormat();stats.textContent=`Mesh check: ${nf.format(topo.openEdges)} open edges · ${nf.format(topo.pinchedEdges)} pinched/non-manifold edges · ${nf.format(topo.degenerateTriangles)} degenerate triangles. Exact engine message: ${rawMessage||'unknown'}`;}
  panel.hidden=false;
}
function clearDiagnostic(){const p=$('printDiagnosticPanel');if(p)p.hidden=true;}
function logFailure(kind,rawMessage){const topo=topologySummary(sourceModel());console.warn(`[SHRINK 3D ${VERSION}] ${kind} helper could not complete`,{libraryStatus:rawMessage,topology:topo});showDiagnostic(kind,rawMessage);}

function saveBlob(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}

async function makeWatertightCopy(){
  const btn=$('makeWatertightBtn'),model=sourceModel(); if(!btn||!model)return;
  const quality=$('remeshQuality')?.value||'balanced'; const old=btn.textContent; btn.disabled=true; btn.textContent='Checking…';
  try{
    const mod=await import(`./watertight-remesh.js?v=${VERSION}`);
    const pre=mod.remeshPreflight?.(model,quality);
    if(pre&&!pre.safe){
      const nf=new Intl.NumberFormat();
      const msg=$('printDiagnosticMessage'),stats=$('printDiagnosticStats'),help=ensureDiagnosticPanel()?.querySelector('.repair-help');
      if(msg)msg.textContent=`This model is too heavy to rebuild safely in your browser. SHRINK it first, then try Make watertight again.`;
      if(help)help.textContent='This safety limit prevents Chrome from running out of memory. Your original model is unchanged.';
      if(stats)stats.textContent=`Voxel safety check: ${nf.format(pre.triangles)} triangles · safe limit for ${quality} mode: about ${nf.format(pre.triangleLimit)} triangles · estimated voxel grid: ${nf.format(pre.approxGridSamples)} samples.`;
      app()?.setStatus?.('Watertight rebuild stopped safely — SHRINK the model first, then try again.',true);
      return;
    }
    btn.textContent='Voxelising…';
    app()?.setStatus?.('Rebuilding the sculpt as one watertight voxel skin. This can take a little while…',false);
    const result=await mod.makeWatertight(model,quality,msg=>app()?.setStatus?.(msg,false));
    const scale=window.__shrinkPrint?.mmPerUnit?.()||1; const zUp=$('zUpToggle')?.checked!==false;
    const out=buildBinaryStl({THREE,model:result.root,mmPerUnit:scale,zUp});
    const base=app()?.baseName?.()||'model';
    saveBlob(new Blob([out.buffer],{type:'model/stl'}),`${base}-watertight.stl`);
    result.root.traverse(o=>{if(o.isMesh){o.geometry?.dispose?.();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.dispose?.());}});
    const panel=ensureDiagnosticPanel();
    if(panel){panel.querySelector('.print-diagnostic-title').textContent='✓ Watertight voxel copy created';const msg=$('printDiagnosticMessage');if(msg)msg.textContent='The rebuilt STL has been downloaded. Drop that new file back into SHRINK, then use Fuse / Split as normal.';const help=panel.querySelector('.repair-help');if(help)help.textContent='Your original file was left untouched. Advanced: voxel parity union was used instead of triangle-normal signing.';}
    app()?.setStatus?.(`Saved ${base}-watertight.stl. Re-open that repaired file to fuse or split it.`,false);
  }catch(err){
    console.error(`[SHRINK 3D ${VERSION}] Watertight voxel rebuild failed`,err);
    const msg=$('printDiagnosticMessage'),stats=$('printDiagnosticStats'),help=ensureDiagnosticPanel()?.querySelector('.repair-help');
    if(err?.code==='REMESH_TOO_HEAVY'){
      if(msg)msg.textContent='This model is too heavy to rebuild safely in your browser. SHRINK it first, then try Make watertight again.';
      if(help)help.textContent='SHRINK stopped before the heavy voxel stage so your browser should stay responsive.';
      if(stats&&err.preflight){const nf=new Intl.NumberFormat();stats.textContent=`Voxel safety check: ${nf.format(err.preflight.triangles)} triangles · safe limit: about ${nf.format(err.preflight.triangleLimit)} triangles.`;}
      app()?.setStatus?.('Watertight rebuild stopped safely — reduce the model first.',true);
    } else if(err?.code==='REMESH_MESSY'){
      app()?.setStatus?.('Watertight rebuild stopped: the result would have been messy, so nothing was downloaded.',true);
      if(msg)msg.textContent=err.message;
      if(help)help.textContent='Models with big gaps cannot be rebuilt this way. Use your slicer\'s repair, or close the holes in your modelling software.';
    } else {
      app()?.setStatus?.(`Watertight repair failed: ${err.message}`,true);
      if(msg)msg.textContent='SHRINK could not rebuild this model automatically. Try Fast detail, or repair/remesh it in your modelling software.';
    }
  }
  finally{btn.disabled=false;btn.textContent=old;}
}

function normalExport(kind,message){if(fallbackBusy)return;fallbackBusy=true;const fuse=$('fuseSolidToggle'),split=$('splitMode'),prevFuse=fuse?.checked,prevSplit=split?.value;if(fuse)fuse.checked=false;if(split)split.value='off';setTimeout(()=>{const btn=kind==='obj'?$('saveObjBtn'):$('saveStlBtn');btn?.click();setTimeout(()=>{app()?.setStatus?.(message,false);if(fuse&&prevFuse!=null)fuse.checked=prevFuse;if(split&&prevSplit!=null){split.value=prevSplit;split.dispatchEvent(new Event('change',{bubbles:true}));}fallbackBusy=false;},60);},0);}
function wrapStatus(){const a=app();if(!a?.setStatus||a.__safeExportWrapped)return false;const native=a.setStatus.bind(a);a.setStatus=(msg,error=false)=>{const text=String(msg||'');if(!fallbackBusy&&text.startsWith('Fuse failed:')){const reason=text.slice('Fuse failed:'.length).trim();logFailure('Fuse',reason);const kind=lastAttempt?.kind==='obj'?'obj':'stl',noun=kind.toUpperCase();native(`Couldn't merge this model into one solid. Saving the normal ${noun} instead…`,false);normalExport(kind,`Couldn't merge this model into one solid. Saved the normal ${noun} instead.`);return;}if(!fallbackBusy&&text.startsWith('Split failed:')){const reason=text.slice('Split failed:'.length).trim();logFailure('Split',reason);native("Couldn't split this model safely. Trying the fallback route…",false);return native(msg,error);}if(text.startsWith('Saved fused ')||/Saved \d+ watertight STL sections/i.test(text))clearDiagnostic();return native(msg,error);};a.__safeExportWrapped=true;return true;}
function enforcePriority(){const fuse=$('fuseSolidToggle'),split=$('splitMode');if(fuse&&!fuse.dataset.safeDefaultApplied){fuse.checked=false;fuse.dataset.safeDefaultApplied='1';}const sync=()=>{if(split?.value&&split.value!=='off'&&fuse?.checked)fuse.checked=false;};if(split&&!split.dataset.safePriority){split.dataset.safePriority='1';split.addEventListener('change',sync);split.addEventListener('input',sync);}if(fuse&&!fuse.dataset.safePriority){fuse.dataset.safePriority='1';fuse.addEventListener('change',sync);}sync();}
function trackAttempts(){const stl=$('saveStlBtn'),obj=$('saveObjBtn');if(stl&&!stl.dataset.safeTrack){stl.dataset.safeTrack='1';stl.addEventListener('click',()=>{lastAttempt={kind:'stl',time:Date.now()};},true);}if(obj&&!obj.dataset.safeTrack){obj.dataset.safeTrack='1';obj.addEventListener('click',()=>{lastAttempt={kind:'obj',time:Date.now()};},true);}}
function maintain(){ensureDiagnosticPanel();wrapStatus();enforcePriority();trackAttempts();}
maintain();const observer=new MutationObserver(maintain);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('shrink:model-opened',()=>{clearDiagnostic();maintain();});window.addEventListener('shrink:reduced',clearDiagnostic);
Promise.allSettled([import(`./preview-material-fix.js?v=${VERSION}`),import(`./fuse-export.js?v=${VERSION}`),import(`./split-print.js?v=${VERSION}`),import(`./split-fallback.js?v=${VERSION}`)]).then(results=>{results.forEach((r,i)=>{if(r.status==='rejected')console.warn(`[SHRINK 3D ${VERSION}] Optional print helper ${i+1} did not load`,r.reason);});maintain();});
window.__shrinkPrintSafety={topologySummary,maintain,showDiagnostic,clearDiagnostic};
