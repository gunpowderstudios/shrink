// SHRINK 3D v2.18 — mode chooser + plain-language wording for each destination (Game / 3D Print).
(() => {
  const VERSION = '2.18';
  const PRINT_RELEASE = '2.270';
  const APP_NAME = 'SHRINK 3D';
  const body = document.body;
  const $ = id => document.getElementById(id);
  const header = document.querySelector('.topbar');
  const dropZone = $('dropZone'), fileInput = $('fileInput'), subtitle = document.querySelector('.subtitle');

  import(`./print-export-safety.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Optional print tools did not load`, err));
  import(`./material-look.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Material look did not load`, err));
  import(`./game-flow.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Game flow did not load`, err));
  import(`./settings-file.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Settings file did not load`, err));
  import(`./add-part.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Add part did not load`, err));
  import(`./remove-part.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Remove brush did not load`, err));
  import(`./wheel-split.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Wheel splitter did not load`, err));
  import(`./game-save-guard.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Game save verification did not load`, err));
  import(`./game-protection-fix.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Game/print protection isolation did not load`, err));
  import(`./batch.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Batch tool did not load`, err));
  const CLAY_ENABLED = false;      // v2.173: the Clay tool is switched off for now (clay.js and clay-core.js stay in the repo); set true to bring it back
  if (CLAY_ENABLED) import(`./clay.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Clay tool did not load`, err));
  import(`./print-v2-ui.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Friendly print workflow did not load`, err));
  import(`./print-upload.js?v=${VERSION}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Print upload control did not load`, err));
  import(`./mobile-warning.js?v=${PRINT_RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${VERSION}] Mobile warning did not load`, err));

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
    <h2 class="mode-start-title">What are you making?</h2>
    <button type="button" class="mode-card" data-mode="game" aria-pressed="false"><span class="mode-icon">🎮</span><span><strong>Gaming</strong><small>Keep textures, make the GLB light enough for a game.</small></span></button>
    <button type="button" class="mode-card" data-mode="print" aria-pressed="false"><span class="mode-icon mode-icon-svg"><svg viewBox="0 0 48 56" width="100%" height="100%" aria-hidden="true" focusable="false"><defs><linearGradient id="rpBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde2"/><stop offset="1" stop-color="#8b9198"/></linearGradient><linearGradient id="rpHood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7be04f"/><stop offset="1" stop-color="#3fae27"/></linearGradient></defs><rect x="11" y="51" width="7" height="3.5" rx="1.2" fill="#222a33"/><rect x="30" y="51" width="7" height="3.5" rx="1.2" fill="#222a33"/><rect x="5" y="35" width="38" height="17" rx="3" fill="url(#rpBase)"/><rect x="24.5" y="39.5" width="12" height="9" rx="1.6" fill="#18212b"/><rect x="27" y="42" width="3" height="3" rx=".6" fill="#46d796"/><rect x="31.5" y="42" width="3" height="3" rx=".6" fill="#8fb4d8"/><path d="M6 35V10q0-5 5-5h26q5 0 5 5v25z" fill="url(#rpHood)" opacity=".92" stroke="#2c8a1a" stroke-width="1.2"/><rect x="14" y="9" width="3.2" height="24" rx="1" fill="#1f6a14" opacity=".75"/><rect x="10" y="12" width="15" height="3.2" rx="1" fill="#1b5a11" opacity=".85"/><rect x="8" y="30" width="32" height="4" fill="#2c8a1a" opacity=".8"/><rect x="27" y="9" width="11" height="24" rx="1.5" fill="none" stroke="#c8f5b4" stroke-width=".9" opacity=".6"/><path d="M9 8l3-2" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".45"/></svg></span><span><strong>3D Printing</strong><small>Make it printable, shrink it, split it and export.</small></span></button>`;
  header?.insertAdjacentElement('afterend', chooser);
  const steps = document.createElement('div'); steps.className = 'workflow-strip'; chooser.insertAdjacentElement('afterend', steps);

  /* v2.270: tabs in the top bar (Home / 3D Printing / Gaming) replace the small "switch" link; hidden once a model is open */
  const tabs = document.createElement('nav'); tabs.className = 'mode-tabs'; tabs.setAttribute('aria-label', 'Mode');
  tabs.innerHTML = '<button type="button" data-tab="home">Home</button><button type="button" data-tab="print">3D Printing</button><button type="button" data-tab="game">Gaming</button>';
  header?.appendChild(tabs);
  const syncTabs = () => { const cur = body.classList.contains('start-screen') ? 'home' : (body.classList.contains('app-mode-print') ? 'print' : 'game'); tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.tab === cur; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    const h = '#' + HASH[cur]; if (location.hash !== h) { try { history.replaceState(null, '', h); } catch {} } };   /* v2.270: the address bar follows the tab, so a tab can be shared as a link */
  const HASH = { home: 'home', print: '3d-printing', game: 'gaming' }, FROM_HASH = { '#home': 'home', '#3d-printing': 'print', '#gaming': 'game' };
  const TEXT = {
    game: { subtitle:'Make a model light enough for a game — and see exactly what you gave up.', steps:'<b>Gaming</b><span>1&nbsp; Target</span><i>→</i><span>2&nbsp; Detail</span><i>→</i><span>3&nbsp; Touch up</span><i>→</i><span>4&nbsp; Save</span>', setupTitle:'Where will it be used?', setupSub:'Pick one — it sets sensible limits for you.', detailSub:'Drag the slider — the model on the right updates live.', extraNum:'3', extraTitle:'Touch up (optional)', extraSub:'Paint out stickers, plates or marks on the textures.', saveNum:'4', saveTitle:'Save', saveSub:'Builds the final GLB (resized textures, compressed mesh) and downloads it.', btn:'Save game GLB', drop:['Drop a model here','GLB for games · STL, OBJ or PLY for 3D printing'], accept:'.glb,.stl,.obj,.ply,model/gltf-binary' },
    print: { subtitle:'Make big 3D models printable without needing to know the technical stuff.', steps:'<b>3D Printing</b><span>1&nbsp; Set up</span><i>→</i><span>Use any tool you need</span>', setupTitle:'Choose your printer & size', setupSub:'Tell us what kind of printer you have and how tall the finished model should be.', detailSub:'SHRINK can find the smallest version that still looks the same.', extraNum:'3', extraTitle:'Protect key details (optional)', extraSub:'Paint faces or fine ornament you want to keep sharp. Everything else is reduced first.', saveNum:'4', saveTitle:'Download', saveSub:'Save one STL or split it into sections with pegs.', btn:'Also save GLB (keeps colours)', drop:['Drop a model here','GLB for games · STL, OBJ or PLY for 3D printing'], accept:'.stl,.obj,.ply,.glb,model/gltf-binary' }
  };

  const setText = (id,v) => { const el=$(id); if(el) el.textContent=v; };
  function currentMode(){ return body.classList.contains('app-mode-print') ? 'print' : 'game'; }
  function setMode(mode, announce=false){
    mode = mode === 'print' ? 'print' : 'game'; const t=TEXT[mode];
    body.classList.toggle('app-mode-game',mode==='game'); body.classList.toggle('app-mode-print',mode==='print');
    chooser.querySelectorAll('.mode-card').forEach(btn=>{const on=btn.dataset.mode===mode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
    steps.innerHTML=t.steps;   /* the header line is fixed text (v2.89) */
    body.classList.remove('start-screen'); syncTabs();
    ['setupTitle','setupSub','detailSub','extraNum','extraTitle','extraSub','saveNum','saveTitle','saveSub'].forEach(k=>setText(k,t[k]));
    const btn=$('optimizeBtn'); if(btn){btn.dataset.label=t.btn;if(!btn.disabled)btn.textContent=t.btn;}
    const s=dropZone?.querySelector('strong'),sp=dropZone?.querySelector('span'); if(s)s.textContent=t.drop[0];if(sp)sp.textContent=t.drop[1];if(fileInput)fileInput.accept=t.accept;
    window.dispatchEvent(new CustomEvent('shrink:ui-mode',{detail:{mode}}));
    if(announce) window.__shrinkApp?.setStatus?.(mode==='print'?'3D Printing — load a sculpt, choose your printer and size, then use Fuse, SHRINK or Download in any combination.':'Gaming mode — pick where it will be used, then drag the detail slider.');
  }
  const GO_KEY='shrink-go';   /* v2.270: set only so a tab/logo switch with a model open survives its own reload; a plain reload always lands on Home */
  chooser.addEventListener('click',e=>{const b=e.target.closest('.mode-card');if(!b)return;setMode(b.dataset.mode,true);});
  const goTab=t=>{
    const h='#'+HASH[t];
    if(!$('workspace')?.classList.contains('hidden')){   /* v2.270: tabs stay at the top with a model open; another tab starts afresh, so ask first */
      const cur=body.classList.contains('app-mode-print')?'print':'game'; if(t===cur)return;
      if(!window.confirm('Switch tab? The model that is open now will be closed (anything not downloaded is lost).'))return;
      try{sessionStorage.setItem(GO_KEY,t);}catch{}
      location.hash=h; location.reload(); return;
    }
    if(location.hash!==h){try{history.pushState(null,'',h);}catch{}}
    if(t==='home'){body.classList.add('start-screen');syncTabs();} else chooser.querySelector(`.mode-card[data-mode="${t}"]`)?.click();};
  tabs.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)goTab(b.dataset.tab);});
  /* v2.270: the SHRINK 3D logo is a Home link */
  const logo=document.querySelector('.title-row h1');
  if(logo){logo.classList.add('logo-home');logo.setAttribute('role','link');logo.tabIndex=0;logo.title='Home';
    logo.addEventListener('click',()=>goTab('home'));
    logo.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goTab('home');}});}
  /* v2.270: #home, #3d-printing and #gaming open that tab (a shared link, or Back / Forward). Ignored once a model is open. */
  const applyHash=(hash=location.hash)=>{const t=FROM_HASH[hash]; if(!t||!$('workspace')?.classList.contains('hidden'))return;
    if(t==='home'){body.classList.add('start-screen');syncTabs();}
    else if(body.classList.contains('start-screen')||currentMode()!==t)setMode(t);};
  window.addEventListener('hashchange',()=>applyHash());
  const sniff=name=>{if(/\.(stl|obj|ply)$/i.test(name||''))setMode('print');};
  fileInput?.addEventListener('change',()=>sniff(fileInput.files?.[0]?.name));
  dropZone?.addEventListener('drop',e=>sniff(e.dataTransfer?.files?.[0]?.name),true);
  /* v2.200: the file type picks the tools. STL/OBJ/PLY = print, GLB = game; a small link lets a GLB be treated as a print model. */
  const override=document.createElement('p');override.className='mode-override';
  override.innerHTML='Gaming tools. <button type="button" id="modeUsePrint">Use as a print model</button>';
  steps.insertAdjacentElement('afterend',override);
  override.querySelector('button').addEventListener('click',()=>{setMode('print',true);body.classList.remove('has-glb-model');});
  window.addEventListener('shrink:model-opened',()=>{const k=window.__shrinkApp?.sourceKind;
    if(k&&k!=='glb'){body.classList.remove('has-glb-model');setMode('print');}
    else if(k==='glb'){body.classList.add('has-glb-model');setMode('game');}});
  window.__shrinkUI={setMode,getMode:currentMode};
  const startHash=location.hash;   /* read before setMode() rewrites the address */
  /* v2.270: a reload (or any visit without a #tab link) opens Home; only a shared #tab link on a fresh visit, or our own switch-with-model reload, opens a tab */
  let go=null; try{go=sessionStorage.getItem(GO_KEY);sessionStorage.removeItem(GO_KEY);}catch{}
  const reloaded=performance.getEntriesByType?.('navigation')?.[0]?.type==='reload';
  const want=(go==='home'||go==='game'||go==='print')?go:(reloaded?'home':(FROM_HASH[startHash]||'home'));
  setMode(want==='home'?'game':want);
  if(want==='home') body.classList.add('start-screen');
  syncTabs();
  /* v2.270: a small "Diagnostics" link in the footer (single model and batch). Shows one text box with everything and copies it. */
  { const foot=document.querySelector('.site-footer');
    if(foot&&!$('shrinkDiagLink')){
      const a=document.createElement('a');a.id='shrinkDiagLink';a.href='#';a.textContent='Diagnostics';a.style.cssText='margin-left:14px;font-weight:400;opacity:.75;font-size:12px';a.title='Copy a technical report to send to support';
      foot.append(a);
      a.addEventListener('click',async e=>{e.preventDefault();
        const L=[];
        try{L.push('=== SINGLE MODEL ===',await window.__shrinkDiagReport?.()||'(no model open)');}catch(err){L.push('(report failed: '+(err?.message||err)+')');}
        try{L.push('',JSON.stringify(window.__shrinkSnap?.()||null,null,1));}catch{}
        try{const b=window.__shrinkBatch; if(b?.state?.items?.some(i=>i.diag)) L.push('','=== BATCH ===',b.report());}catch{}
        let ov=$('shrinkDiagBox'); if(!ov){ov=document.createElement('div');ov.id='shrinkDiagBox';ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
          ov.innerHTML='<div style="width:min(900px,92vw);background:#121a24;border:1px solid #35455a;border-radius:12px;padding:14px;color:#cfe"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Diagnostics <small style="font-weight:400;opacity:.7">(already copied: paste it to Claude)</small></strong><button type="button" id="shrinkDiagClose" style="cursor:pointer">Close</button></div><textarea readonly style="width:100%;height:60vh;box-sizing:border-box;font:11px/1.3 monospace;background:#0e141c;color:#cfe;border:1px solid #35455a;border-radius:8px;padding:8px"></textarea></div>';
          document.body.appendChild(ov); ov.addEventListener('click',ev=>{if(ev.target===ov||ev.target.id==='shrinkDiagClose')ov.hidden=true;});}
        const ta=ov.querySelector('textarea'); ta.value=L.join('\n'); ov.hidden=false; ta.focus(); ta.select(); try{await navigator.clipboard?.writeText(ta.value);}catch{}
      });}}
})();
