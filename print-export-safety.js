import * as THREE from 'https://esm.sh/three@0.180.0';
import { buildBinaryStl } from './mesh-tools.js?v=2.18';
import { healthOfModel } from './repair-core.js?v=2.196';

// SHRINK 3D v2.63 — safety layer; loads current print helpers including draggable split pegs.
const VERSION = '2.63';
// Helper modules are loaded under the page release (v2.188). They used to use the fixed key above, so a browser kept serving old copies of fuse-export.js etc. after a fix.
const REL = (() => { try { return new URL(import.meta.url).searchParams.get('v') || VERSION; } catch { return VERSION; } })();
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
let fallbackBusy = false;
let lastAttempt = null;

function sourceModel(){ return window.__shrinkWorkingModel?.() || app()?.optimizedModel || app()?.originalModel || null; }
function topologySummary(model){
  if(!model)return null;
  const h=healthOfModel(THREE,model);
  return{
    triangles:h.triangles,
    openEdges:h.openEdges,
    pinchedEdges:h.pinchedEdges,
    flippedEdges:h.flippedEdges,
    degenerateTriangles:h.degenerateTriangles,
    clean:h.clean
  };
}

function ensureDiagnosticPanel(){
  let panel=$('printDiagnosticPanel'); if(panel)return panel;
  const viewerPanel=document.querySelector('.viewer-panel'); if(!viewerPanel)return null;
  panel=document.createElement('div'); panel.id='printDiagnosticPanel'; panel.className='print-diagnostic-panel'; panel.hidden=true;
  panel.innerHTML=`
    <div class="print-diagnostic-title">⚠ This model isn't one clean printable solid</div>
    <div id="printDiagnosticMessage"></div>
    <details class="repair-advanced"><summary>Technical details</summary><div id="printDiagnosticStats" class="print-diagnostic-stats"></div></details>`;
  viewerPanel.appendChild(panel);
  const style=document.createElement('style'); style.id='printDiagnosticStyle';
  style.textContent=`.print-diagnostic-panel{box-sizing:border-box;position:absolute;right:14px;top:14px;z-index:69;width:min(400px,calc(100vw - 32px));max-height:calc(100% - 28px);overflow:auto;padding:12px 14px;border:1px solid #ff5b62;border-radius:14px;background:#2a1216;color:#ffd3d5;font-size:12px;line-height:1.45;box-shadow:0 18px 50px rgba(0,0,0,.55)}.print-diagnostic-panel.in-batch{position:static;width:auto;max-height:none;margin:0 0 10px;box-shadow:none}.print-diagnostic-title{margin:0 0 6px;font-weight:800;color:#ff747a;font-size:14px;line-height:1.3}#printDiagnosticMessage{margin:0}.repair-actions{display:flex;gap:10px;align-items:end;margin:12px 0 0;flex-wrap:wrap}.repair-quality[hidden]{display:none}.repair-quality{display:grid;gap:5px;min-width:134px}.repair-quality span{font-size:11px;font-weight:700;color:#ffc2c5}.repair-quality select{box-sizing:border-box;width:100%;min-height:38px;background:#20242c;color:#fff;border:1px solid #4a515d;border-radius:10px;padding:8px 10px}.repair-actions button{min-height:38px;border:0;border-radius:10px;padding:9px 14px;background:#ff4f57;color:#fff;font-weight:800;cursor:pointer}.repair-actions button:disabled{opacity:.55;cursor:wait}.repair-help{margin:10px 0 0;color:#e9b9bc}.repair-advanced{margin:12px 0 0;border:1px solid rgba(255,181,185,.24);border-radius:10px;background:rgba(255,255,255,.02);overflow:hidden}.repair-advanced summary{cursor:pointer;list-style:none;padding:9px 11px;color:#ffb5b9;font-weight:700}.repair-advanced summary::-webkit-details-marker{display:none}.repair-advanced summary::after{content:'⌄';float:right}.repair-advanced[open] summary::after{content:'⌃'}.print-diagnostic-stats{margin:0;padding:0 11px 11px;color:#ffb5b9;overflow-wrap:anywhere}.print-diagnostic-panel[hidden]{display:none!important}@media(max-width:900px){.print-diagnostic-panel{right:94px}}`;
  document.head.appendChild(style);
  return panel;
}

function friendlyReason(kind,raw){const t=String(raw||'');if(/disconnected solids/i.test(t))return 'SHRINK found separate pieces that are not joined together.';if(/non-manifold|manifold rejected|no printable solid/i.test(t))return 'SHRINK found a mesh problem the quick repair cannot safely fix. Make watertight will try a voxel-style rebuild.';if(/boolean union/i.test(t))return 'Some overlapping parts could not be joined cleanly.';if(kind==='Split')return 'The clean-solid route failed, so SHRINK can still try the direct split fallback.';return 'SHRINK could not turn this into one reliable closed solid.';}

function showDiagnostic(kind,rawMessage){
  const panel=ensureDiagnosticPanel();if(!panel)return;const topo=topologySummary(sourceModel());
  // v2.198: no red box while a BATCH runs (the rows carry the verdict), and none for a model with no holes and only a handful of stray edges: slicers cope with those
  if(window.__shrinkBatchRunning||(topo&&topo.openEdges===0&&(topo.pinchedEdges+(topo.flippedEdges||0))>0&&(topo.pinchedEdges+(topo.flippedEdges||0))<=250)){panel.hidden=true;return;}
  const msg=$('printDiagnosticMessage'),stats=$('printDiagnosticStats');
  panel.querySelector('.print-diagnostic-title').textContent=`⚠ This model isn't one clean printable solid`;
  if(msg)msg.textContent=friendlyReason(kind,rawMessage);
  if(stats&&topo){const nf=new Intl.NumberFormat();stats.textContent=`Mesh check: ${nf.format(topo.openEdges)} open edges · ${nf.format(topo.pinchedEdges)} pinched/non-manifold edges · ${nf.format(topo.flippedEdges||0)} flipped edges · ${nf.format(topo.degenerateTriangles)} degenerate triangles. Exact engine message: ${rawMessage||'unknown'}`;}
  panel.hidden=false;
}
function clearDiagnostic(){const p=$('printDiagnosticPanel');if(p)p.hidden=true;}
function logFailure(kind,rawMessage){const topo=topologySummary(sourceModel());console.warn(`[SHRINK 3D ${VERSION}] ${kind} helper could not complete`,{libraryStatus:rawMessage,topology:topo});showDiagnostic(kind,rawMessage);}

function saveBlob(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}



function normalExport(kind,message){if(fallbackBusy)return;fallbackBusy=true;const fuse=$('fuseSolidToggle'),split=$('splitMode'),prevFuse=fuse?.checked,prevSplit=split?.value;if(fuse)fuse.checked=false;if(split)split.value='off';setTimeout(()=>{const btn=kind==='obj'?$('saveObjBtn'):$('saveStlBtn');btn?.click();setTimeout(()=>{app()?.setStatus?.(message,false);if(fuse&&prevFuse!=null)fuse.checked=prevFuse;if(split&&prevSplit!=null){split.value=prevSplit;split.dispatchEvent(new Event('change',{bubbles:true}));}fallbackBusy=false;},60);},0);}
function wrapStatus(){const a=app();if(!a?.setStatus||a.__safeExportWrapped)return false;const native=a.setStatus.bind(a);a.setStatus=(msg,error=false)=>{const text=String(msg||'');if(!fallbackBusy&&text.startsWith('Fuse failed:')){const reason=text.slice('Fuse failed:'.length).trim();logFailure('Fuse',reason);const kind=lastAttempt?.kind==='obj'?'obj':'stl',noun=kind.toUpperCase();native(`Couldn't merge this model into one solid. Saving the normal ${noun} instead…`,false);normalExport(kind,`Couldn't merge this model into one solid. Saved the normal ${noun} instead.`);return;}if(!fallbackBusy&&text.startsWith('Split failed:')){const reason=text.slice('Split failed:'.length).trim();logFailure('Split',reason);native("Couldn't split this model safely. Trying the fallback route…",false);return native(msg,error);}if(text.startsWith('Saved fused ')||/Saved \d+ watertight STL sections/i.test(text))clearDiagnostic();return native(msg,error);};a.__safeExportWrapped=true;return true;}
function enforcePriority(){const fuse=$('fuseSolidToggle'),split=$('splitMode');if(fuse&&!fuse.dataset.safeDefaultApplied){fuse.checked=false;fuse.dataset.safeDefaultApplied='1';}const sync=()=>{if(split?.value&&split.value!=='off'&&fuse?.checked)fuse.checked=false;};if(split&&!split.dataset.safePriority){split.dataset.safePriority='1';split.addEventListener('change',sync);split.addEventListener('input',sync);}if(fuse&&!fuse.dataset.safePriority){fuse.dataset.safePriority='1';fuse.addEventListener('change',sync);}sync();}
function trackAttempts(){const stl=$('saveStlBtn'),obj=$('saveObjBtn');if(stl&&!stl.dataset.safeTrack){stl.dataset.safeTrack='1';stl.addEventListener('click',()=>{lastAttempt={kind:'stl',time:Date.now()};},true);}if(obj&&!obj.dataset.safeTrack){obj.dataset.safeTrack='1';obj.addEventListener('click',()=>{lastAttempt={kind:'obj',time:Date.now()};},true);}}
// v2.193: the watertight box lives in the same top-right slot as the BATCH window; while BATCH is open it sits inside it, at the top.
function placeDiagnostic(){const p=$('printDiagnosticPanel');if(!p)return;const b=$('v2BatchPanel');const inBatch=!!(b&&!b.hidden&&!b.classList.contains('folded'));
  if(inBatch){const head=b.querySelector('.v2-batch-head');if(p.parentElement!==b){b.insertBefore(p,head?head.nextSibling:b.firstChild);}p.classList.add('in-batch');}
  else{const vp=document.querySelector('.viewer-panel');if(vp&&p.parentElement!==vp)vp.appendChild(p);p.classList.remove('in-batch');}}
function maintain(){ensureDiagnosticPanel();placeDiagnostic();wrapStatus();enforcePriority();trackAttempts();}
maintain();const observer=new MutationObserver(maintain);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('shrink:model-opened',()=>{clearDiagnostic();maintain();});window.addEventListener('shrink:reduced',clearDiagnostic);
Promise.allSettled([import(`./preview-material-fix.js?v=${REL}`),import(`./fuse-export.js?v=${REL}`),import(`./split-print.js?v=${REL}`),import(`./split-fallback.js?v=${REL}`)]).then(results=>{results.forEach((r,i)=>{if(r.status==='rejected')console.warn(`[SHRINK 3D ${VERSION}] Optional print helper ${i+1} did not load`,r.reason);});maintain();});
window.__shrinkPrintSafety={topologySummary,maintain,showDiagnostic,clearDiagnostic};
