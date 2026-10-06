// SHRINK 3D v2.18 — mode chooser + plain-language wording for each destination (Game / 3D Print).
(() => {
  const VERSION = '2.18';
  const PRINT_RELEASE = '2.59';
  const APP_NAME = 'SHRINK 3D';
  const body = document.body;
  const $ = id => document.getElementById(id);
  const header = document.querySelector('.topbar');
  const dropZone = $('dropZone'), fileInput = $('fileInput'), subtitle = document.querySelector('.subtitle');

  import(`./print-export-safety.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Optional print tools did not load`, err));
  import(`./game-save-guard.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Game save verification did not load`, err));
  import(`./game-protection-fix.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Game/print protection isolation did not load`, err));
  import(`./print-v2-ui.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Friendly print workflow did not load`, err));
  import(`./print-upload.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Print upload control did not load`, err));
  import(`./mobile-warning.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Mobile warning did not load`, err));

  if (!document.querySelector('link[data-shrink-matrix-theme]')) {
    const theme = document.createElement('link'); theme.rel = 'stylesheet'; theme.href = `./matrix-theme.css?v=${VERSION}`; theme.dataset.shrinkMatrixTheme = 'true'; document.head.appendChild(theme);
  }
  if (!document.querySelector('link[data-shrink-print-v2]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `./print-v2-ui.css?v=${PRINT_RELEASE}`; css.dataset.shrinkPrintV2 = 'true'; document.head.appendChild(css);
  }

  const h1 = document.querySelector('.title-row h1'); if (h1) h1.textContent = APP_NAME;
  document.title = `${APP_NAME} — Free 3D Model Optimizer for Games & 3D Printing`;
  const setMeta = (selector, value) => { const el = document.querySelector(selector); if (el) el.setAttribute('content', value); };
  setMeta('meta[name="application-name"]', APP_NAME);
  setMeta('meta[name="apple-mobile-web-app-title"]', APP_NAME);
  setMeta('meta[property="og:site_name"]', APP_NAME);
  setMeta('meta[property="og:title"]', `${APP_NAME} — 3D Model Optimizer for Games & 3D Printing`);
  setMeta('meta[name="twitter:title"]', `${APP_NAME} — 3D Model Optimizer`);
  const schema = document.querySelector('script[type="application/ld+json"]');
  if (schema) { try { const data = JSON.parse(schema.textContent); data.name = APP_NAME; schema.textContent = JSON.stringify(data); } catch {} }

  const chooser = document.createElement('section'); chooser.className = 'mode-chooser';
  chooser.innerHTML = `
    <button type="button" class="mode-card" data-mode="game" aria-pressed="false"><span class="mode-icon">🎮</span><span><strong>Game model</strong><small>Keep textures, make the GLB light enough for a game.</small></span></button>
    <button type="button" class="mode-card" data-mode="print" aria-pressed="false"><span class="mode-icon">🖨</span><span><strong>3D print / modelling</strong><small>Make it printable, shrink it, split it and export.</small></span></button>`;
  header?.insertAdjacentElement('afterend', chooser);
  const steps = document.createElement('div'); steps.className = 'workflow-strip'; chooser.insertAdjacentElement('afterend', steps);

  const TEXT = {
    game: { subtitle:'Make a model light enough for a game — and see exactly what you gave up.', steps:'<b>Game model</b><span>1&nbsp; Target</span><i>→</i><span>2&nbsp; Detail</span><i>→</i><span>3&nbsp; Touch up</span><i>→</i><span>4&nbsp; Save</span>', setupTitle:'Where will it be used?', setupSub:'Pick one — it sets sensible limits for you.', detailSub:'Drag the slider — the model on the right updates live.', extraNum:'3', extraTitle:'Touch up (optional)', extraSub:'Paint out stickers, plates or marks on the textures.', saveNum:'4', saveTitle:'Save', saveSub:'Builds the final GLB (resized textures, compressed mesh) and downloads it.', btn:'Save game GLB', drop:['Drop a model here','GLB for games · STL, OBJ or PLY also work'], accept:'.glb,.stl,.obj,.ply,model/gltf-binary' },
    print: { subtitle:'Make big 3D models printable without needing to know the technical stuff.', steps:'<b>3D print</b><span>1&nbsp; Set up</span><i>→</i><span>Use any tool you need</span>', setupTitle:'Choose your printer & size', setupSub:'Tell us what kind of printer you have and how tall the finished model should be.', detailSub:'SHRINK can find the smallest version that still looks the same.', extraNum:'3', extraTitle:'Protect key details (optional)', extraSub:'Paint faces or fine ornament you want to keep sharp. Everything else is reduced first.', saveNum:'4', saveTitle:'Download', saveSub:'Save one STL or split it into sections with pegs.', btn:'Also save GLB (keeps colours)', drop:['Drop a sculpt here','STL, OBJ, PLY or GLB — from ShapeLab, Cinema 4D, Blender…'], accept:'.stl,.obj,.ply,.glb,model/gltf-binary' }
  };

  const setText = (id,v) => { const el=$(id); if(el) el.textContent=v; };
  function currentMode(){ return body.classList.contains('app-mode-print') ? 'print' : 'game'; }
  function setMode(mode, announce=false){
    mode = mode === 'print' ? 'print' : 'game'; const t=TEXT[mode];
    body.classList.toggle('app-mode-game',mode==='game'); body.classList.toggle('app-mode-print',mode==='print');
    chooser.querySelectorAll('.mode-card').forEach(btn=>{const on=btn.dataset.mode===mode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
    if(subtitle) subtitle.textContent=t.subtitle; steps.innerHTML=t.steps;
    ['setupTitle','setupSub','detailSub','extraNum','extraTitle','extraSub','saveNum','saveTitle','saveSub'].forEach(k=>setText(k,t[k]));
    const btn=$('optimizeBtn'); if(btn){btn.dataset.label=t.btn;if(!btn.disabled)btn.textContent=t.btn;}
    const s=dropZone?.querySelector('strong'),sp=dropZone?.querySelector('span'); if(s)s.textContent=t.drop[0];if(sp)sp.textContent=t.drop[1];if(fileInput)fileInput.accept=t.accept;
    try{localStorage.setItem('shrink-mode',mode);}catch{}
    window.dispatchEvent(new CustomEvent('shrink:ui-mode',{detail:{mode}}));
    if(announce) window.__shrinkApp?.setStatus?.(mode==='print'?'Print mode — load a sculpt, choose your printer and size, then use Fuse, SHRINK or Download in any combination.':'Game mode — pick where it will be used, then drag the detail slider.');
  }
  chooser.addEventListener('click',e=>{const b=e.target.closest('.mode-card');if(b)setMode(b.dataset.mode,true);});
  const sniff=name=>{if(/\.(stl|obj|ply)$/i.test(name||''))setMode('print');};
  fileInput?.addEventListener('change',()=>sniff(fileInput.files?.[0]?.name));
  dropZone?.addEventListener('drop',e=>sniff(e.dataTransfer?.files?.[0]?.name),true);
  window.addEventListener('shrink:model-opened',()=>{const k=window.__shrinkApp?.sourceKind;if(k&&k!=='glb')setMode('print');});
  window.__shrinkUI={setMode,getMode:currentMode};
  let saved='game';try{saved=localStorage.getItem('shrink-mode')||'game';}catch{} setMode(saved);
})();
