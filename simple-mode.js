// SHRINK 3D v2.31 — Simple mode: a one-button, plain-English print workflow for home printers.
// It is a thin layer over the existing engine (live reducer, Fuse/Manifold check, Make watertight, STL/split export),
// so Advanced mode keeps working exactly as before. Flow: shrink first -> check it is a solid -> check it fits -> download.
(() => {
  const VERSION = '2.31';
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const nf = new Intl.NumberFormat();
  const body = document.body;

  const store = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };

  // Two kinds of printer. The printer's biggest printable size is optional and typed in by the user.
  const PRINTERS = [
    { id: 'fdm', name: 'FDM printer', short: 'FDM printer', note: 'Filament · standard 0.4 mm nozzle', type: 'fdm', icon: '🧱' },
    { id: 'resin', name: 'Resin printer', short: 'resin printer', note: 'Very fine detail', type: 'resin', icon: '💧' }
  ];

  const S = {
    level: store.get('shrink-ui-level', 'simple') === 'advanced' ? 'advanced' : 'simple',
    printer: PRINTERS.some(p => p.id === store.get('shrink-simple-printer')) ? store.get('shrink-simple-printer') : 'fdm',
    bed: Number(store.get('shrink-simple-bed', 0)) || 0,
    customMm: Number(store.get('shrink-simple-detail-mm', 0)) || 0,
    detail: 'best',
    tuned: false, savedReduction: null, usePercent: false,
    stage: 'setup',
    busy: false,
    repairBusy: false,
    runToken: 0, abort: null, pending: null, tuneTimer: 0, dragging: false,
    result: null,
    fitChoice: null,
    steps: { shrink: 'pending', repair: 'pending', fit: 'pending' }
  };

  // How much detail to keep. "Best detail" matches the strict setting the resin preset always used.
  const DETAILS = [
    { id: 'max', name: 'Maximum detail', note: 'Every strand, big file', mm: 0.02, strict: 'p995' },
    { id: 'best', name: 'Best detail', note: 'Keeps faces and fine detail', mm: 0.05, strict: 'p995' },
    { id: 'balanced', name: 'Balanced', note: 'Good for most prints', mm: 0.1, strict: 'p99' },
    { id: 'small', name: 'Smallest file', note: 'Softer detail', mm: 0.2, strict: 'p95' }
  ];

  S.detail = (() => { const v = store.get('shrink-simple-detail'); return ['max', 'best', 'balanced', 'small'].includes(v) || (v === 'custom' && S.customMm > 0) ? v : 'best'; })();
  const detailMm = () => S.detail === 'custom' ? S.customMm : (DETAILS.find(x => x.id === S.detail) || DETAILS[0]).mm;

  let card = null;
  const printer = () => PRINTERS.find(p => p.id === S.printer) || PRINTERS[0];
  const bedSize = () => S.bed || 0;

  /* ------------------------------ small helpers ------------------------------ */
  function setNative(id, value, event = 'change') {
    const el = $(id);
    if (!el) return false;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
    return true;
  }
  const heightMm = () => Math.max(1, Number($('figureHeightMm')?.value) || 75);

  function countTris(model) {
    let t = 0;
    model?.traverse?.(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const g = o.geometry;
      t += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    });
    return t;
  }
  const stlMb = tris => (84 + 50 * tris) / 1048576;
  const fmtMbNum = mb => mb >= 10 ? `${Math.round(mb)} MB` : mb >= 0.1 ? `${mb.toFixed(1)} MB` : '<0.1 MB';
  const fmtSize = tris => fmtMbNum(stlMb(tris));
  async function waitFor(test, ms = 8000, step = 100) {
    for (let t = 0; t < ms; t += step) { const v = test(); if (v) return v; await wait(step); }
    return test() || null;
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ------------------------------ size / fit maths ------------------------------ */
  function extents() {
    const a = app(), model = a?.originalModel, T = a?.THREE;
    if (!model || !T) return null;
    model.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(model);
    if (box.isEmpty()) return null;
    const s = box.getSize(new T.Vector3());
    if (!(s.y > 0)) return null;
    const k = heightMm() / s.y;                       // viewer Y is the vertical axis; STL export maps it to Z
    return { w: s.x * k, d: s.z * k, h: s.y * k };
  }

  // How fine can the voxel rebuild be on this model? (it uses a grid of about 30 million cells)
  function predictVoxelMm() {
    const e = extents(); if (!e) return 0;
    return Math.max(detailMm() / 3, Math.cbrt((e.w * e.d * e.h) / 30e6));
  }
  const fmtMm = v => (v < 0.1 ? v.toFixed(2) : v.toPrecision(2)).replace(/\.?0+$/, '');

  function fitInfo() {
    const e = extents();
    if (!e) return null;
    const dims = `${Math.round(e.w)} × ${Math.round(e.d)} × ${Math.round(e.h)} mm`;
    const B = bedSize();
    if (!B) return { state: 'unknown', dims, e };
    const foot = Math.max(e.w, e.d);
    const scaleH = Math.max(1, Math.floor(e.h * B / Math.max(e.h, foot)));
    if (foot <= B && e.h <= B) return { state: 'fits', dims, e, B };
    if (foot <= B && e.h > B) {
      const maxPart = Math.max(20, B - 10);           // leave room for the alignment pegs
      const parts = Math.ceil(e.h / maxPart);
      return parts <= 6 ? { state: 'tall', dims, e, B, parts, maxPart, scaleH } : { state: 'toobig', dims, e, B, scaleH };
    }
    return { state: 'wide', dims, e, B, scaleH };
  }

  /* ------------------------------ engine drivers ------------------------------ */
  function applyPrinter() {
    const p = printer();
    // the dashboard's own printer button (never our own chip, which shares the attribute)
    const v2 = [...document.querySelectorAll(`.print-v2-dashboard [data-printer="${p.type}"]`)].find(el => !card?.contains(el));
    if (v2) v2.click(); else setNative('printerPreset', p.type === 'fdm' ? '0.2' : '0.05', 'change');
    applyDetail();
  }

  function applyDetail() {
    const mm = detailMm();
    // how much of the surface has to stay within that detail: the stricter, the more the faces and hands are protected
    window.__shrinkStrict = (DETAILS.find(x => x.id === S.detail) || {}).strict || 'p99';
    setNative('printerPreset', 'custom', 'change');
    setNative('printerDetailMm', mm, 'input');
    const v2 = $('v2PrinterDetail'); if (v2) v2.value = String(mm);
  }

  function applyHeight(v) {
    const mm = Math.max(1, Math.min(500, Math.round(Number(v) || 75)));
    const v2 = $('v2Height');
    if (v2) { v2.value = String(mm); v2.dispatchEvent(new Event('input', { bubbles: true })); }
    else setNative('figureHeightMm', mm, 'input');
    return mm;
  }

  async function doShrink(result) {
    const live = window.__shrinkLiveUI;
    const engine = window.__shrinkLive;
    if (!live?.autoFind || !engine?.runExact) throw new Error('The shrink engine is still loading. Give it a moment and try again.');
    await waitFor(() => live.state?.tris > 0 && engine.ready, 12000);
    if (!(live.state?.tris > 0) || !engine.ready) throw new Error('Your model is still being prepared. Give it a moment and try again.');

    let applied = null;
    if (S.usePercent && S.savedReduction?.keepPercent > 0) {
      const pct = Math.max(1, Math.min(100, S.savedReduction.keepPercent));
      note(`Keeping ${pct}% of the triangles for the selected print quality…`);
      live.setRatio?.(pct / 100, { notify: false });
      applied = await engine.runExact(pct / 100, { protectKeep: window.__shrinkPrint?.getReduceOptions?.().protectKeep ?? 1 });
    } else {
      note('Looking for a sensible smaller version…');
      S.pending = live.autoFind();
      try { await S.pending; } finally { S.pending = null; }
      applied = engine.last;
    }

    const reduced = app()?.optimizedModel || engine.root;
    if (!reduced) throw new Error('The reduced preview is not ready. Reload the page and try again.');
    const before = live.state.tris, after = applied?.triangles || countTris(reduced);
    result.shrink = {
      before, after, pct: before ? (after / before) * 100 : 100,
      level: 'good',
      text: after < before ? 'Reduced for the selected print quality' : 'Full detail kept',
      nums: ''
    };
  }

  async function doSolidCheck(result) {
    const r = result.repair = { state: 'skipped', message: '', components: 0 };
    note('Checking the reduced mesh…');
    const model = app()?.optimizedModel || app()?.originalModel;
    if (!model) { r.message = 'There is no model to check.'; return; }
    try {
      const mod = await import('./solid-rebuild.js?v=2.27');
      const h = await mod.healthAsync(model, { signal: S.abort?.signal });
      r.topology = { ...h, openEdges: h.open, pinchedEdges: h.tangled, flippedEdges: h.flipped, degenerateTriangles: h.degenerate };
      r.state = h.clean ? 'ok' : 'needs';
      if (!h.clean) r.message = `${nf.format(h.open)} open edges · ${nf.format(h.tangled)} pinched edges · ${nf.format(h.flipped)} flipped edges`;
    } catch (err) {
      if (err?.code === 'CANCELLED') throw err;
      r.state = 'needs';
      r.message = err?.message || String(err);
    }
  }

  function protectOff() { const b = $('protectBtn'); if (b?.classList.contains('active')) b.click(); }

  async function run() {
    if (S.busy) return;
    const a = app();
    if (!a?.originalModel) { showSetupError('Load a model first.'); return; }
    showSetupError('');
    protectOff();
    if (app()?.isCompare?.()) app().setCompare?.(false);
    S.tuned = false;
    const token = ++S.runToken;
    S.busy = true; S.stage = 'working'; S.result = {}; S.fitChoice = null;
    S.steps = { shrink: 'running', repair: 'pending', fit: 'pending' };
    note('Starting…'); render();
    try {
      if (S.pending) { note('Finishing the previous search…'); await S.pending.catch(() => {}); if (token !== S.runToken) return; }
      await doShrink(S.result);
      if (token !== S.runToken) return;
      S.steps.shrink = S.result.shrink.level === 'bad' || S.result.shrink.level === 'warn' ? 'warn' : 'done';
      S.steps.repair = 'running'; render();
      await doSolidCheck(S.result);
      if (token !== S.runToken) return;
      S.steps.repair = S.result.repair.state === 'needs' ? 'warn' : 'done';
      S.steps.fit = 'running'; note('Checking it fits your printer…'); render();
      await wait(250);
      if (token !== S.runToken) return;
      S.result.fit = fitInfo();
      S.fitChoice = S.result.fit?.state === 'tall' ? 'split' : null;
      S.steps.fit = !S.result.fit || S.result.fit.state === 'fits' || S.result.fit.state === 'unknown' ? 'done' : 'warn';
      S.stage = 'result';
    } catch (err) {
      if (token !== S.runToken) return;
      console.error(`[SHRINK 3D ${VERSION}] Simple run stopped`, err);
      S.stage = 'setup'; S.result = null;
      showSetupError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      if (token === S.runToken) { S.busy = false; render(); renderTune(); }
    }
  }

  // Leave whatever is running and go back to step 1 (the search may finish quietly in the background).
  function cancelRun() {
    S.runToken++; S.abort?.abort?.(); S.abort = null;
    S.busy = false; S.repairBusy = false; S.stage = 'setup'; S.result = null; S.fitChoice = null;
    goSetupView(); syncInputs(); render();
  }

  function goSetupView() {
    if (app()?.isCompare?.()) app().setCompare?.(false);
    app()?.show?.('original');
  }
  function goSetup() {
    if (S.busy) return;
    S.stage = 'setup'; goSetupView(); syncInputs(); render();
  }
  function goResult() {
    if (S.busy || !S.result) return;
    S.stage = 'result'; app()?.show?.('optimized'); render(); renderTune();
  }

  async function loadRepairModules() {
    if (window.__shrinkRepairModules) return window.__shrinkRepairModules;
    const [rebuildMod, repairMod] = await Promise.all([import('./solid-rebuild.js?v=2.27'), import('./repair-core.js?v=2.27')]);
    return { gatherWorldMesh: rebuildMod.gatherWorldMesh, buildRoot: rebuildMod.buildRoot, repairMesh: repairMod.repairMesh };
  }

  // Detail-preserving repair: weld, de-duplicate, orient, close holes. The surface is not rebuilt, so nothing is softened.
  async function repair() {
    if (S.repairBusy || !S.result?.repair) return;
    const r = S.result.repair;
    S.repairBusy = true; r.repairNote = ''; r.progress = 'Repairing…';
    render();
    try {
      const { gatherWorldMesh, buildRoot, repairMesh } = await loadRepairModules();
      await wait(40);                                   // let the button repaint before the work starts
      const source = app()?.optimizedModel || app()?.originalModel;
      const mesh = gatherWorldMesh(source);
      const res = repairMesh({ positions: mesh.positions, indices: mesh.indices });
      const root = buildRoot(res.positions, res.indices, {});
      // only swap the model in if it really is a clean solid now
      let built = null, components = 0, failure = '';
      try { built = await window.__shrinkFuse.modelToSolid(root); components = built.components; }
      catch (err) { failure = err?.message || String(err); }
      finally { try { built?.solid?.delete?.(); } catch {} }
      if (failure || components < 1) {
        r.state = 'repairFailed'; r.fixed = res.stats;
        r.repairNote = failure || 'The repaired surface still was not a clean solid.';
      } else {
        app().setPreview(root); app().show('optimized');
        const after = countTris(root), before = S.result.shrink?.before || after;
        if (S.result.shrink) Object.assign(S.result.shrink, { after, pct: before ? (after / before) * 100 : 100, text: '', repaired: true });
        r.state = 'repaired'; r.components = components; r.fixed = res.stats; r.message = '';
      }
    } catch (err) {
      console.warn(`[SHRINK 3D ${VERSION}] Repair did not work`, err);
      r.state = 'repairFailed'; r.repairNote = err?.message || 'The repair could not finish.';
    } finally {
      S.repairBusy = false; render(); renderTune();
    }
  }

  async function rebuild() {
    if (S.repairBusy || !S.result?.repair) return;
    const r = S.result.repair, prevState = r.state;
    S.repairBusy = true; r.repairNote = ''; r.progress = 'Starting…';
    S.abort = new AbortController();                  // set before the first paint so the Cancel button shows straight away
    render();
    try {
      const { rebuildSolid } = window.__shrinkRebuildSolid ? { rebuildSolid: window.__shrinkRebuildSolid } : await import('./solid-rebuild.js?v=2.27');   // the override exists for tests
      // Rebuild from the ORIGINAL file when it is not huge: it still has all the fine detail that shrinking trims away.
      const original = app()?.originalModel, shrunk = app()?.optimizedModel;
      const source = original && countTris(original) <= 1500000 ? original : (shrunk || original);
      const P = window.__shrinkPrint;
      const mmPerUnit = P?.mmPerUnit?.() || 1;
      const detailUnits = (P?.detailMM?.() || 0) / mmPerUnit;
      const res = await rebuildSolid(source, {
        detailUnits, maxCells: 30e6, maxTris: 300000, signal: S.abort.signal,
        onStatus: (text, pct) => { r.progress = `${text}${pct ? ` ${Math.round(pct)}%` : ''}`; const b = card?.querySelector('[data-act="rebuild"]'); if (b) b.textContent = r.progress; }
      });
      // show it in the viewer; it becomes the model that gets exported
      app().setPreview(res.root);
      app().show('optimized');
      const after = countTris(res.root), before = S.result.shrink?.before || after;
      if (S.result.shrink) Object.assign(S.result.shrink, { after, pct: before ? (after / before) * 100 : 100, text: '', rebuilt: true });
      await doSolidCheck(S.result);
      const fresh = S.result.repair;
      fresh.rebuilt = { ...res.stats, mm: res.stats.voxel * mmPerUnit };
      if (fresh.state === 'ok' || fresh.state === 'pieces') fresh.state = 'rebuilt';
    } catch (err) {
      if (err?.code === 'CANCELLED') { r.state = prevState; r.repairNote = r.repairNote || ''; }
      else {
        console.warn(`[SHRINK 3D ${VERSION}] Solid rebuild did not work`, err);
        r.state = 'failed';
        r.repairNote = err?.message || 'The rebuild could not finish.';
      }
    } finally {
      S.abort = null; S.repairBusy = false; render(); renderTune();
    }
  }

  function download() {
    const f = S.result?.fit;
    const splitting = S.fitChoice === 'split' && f?.state === 'tall';
    if (splitting) { setNative('splitMode', 'max', 'change'); setNative('splitMaxHeight', f.maxPart, 'input'); setNative('splitJoint', 'pegs', 'change'); }
    else setNative('splitMode', 'off', 'change');
    setNative('zUpToggle', true, 'change');
    const fuse = $('fuseSolidToggle');
    if (fuse) { fuse.checked = S.result?.repair?.state === 'ok' && !splitting; fuse.dispatchEvent(new Event('change', { bubbles: true })); }   // a rebuilt solid is already clean, so it is exported as is
    setStatusLine('Building your file…', false);
    $('saveStlBtn')?.click();
  }

  /* ------------------------------ rendering ------------------------------ */
  function icon(kind) {
    const paths = {
      ok: '<polyline points="4 12.5 9.5 18 20 6.5"></polyline>',
      warn: '<path d="M12 3.5 22 20.5H2Z"></path><line x1="12" y1="10" x2="12" y2="15"></line><line x1="12" y1="18" x2="12" y2="18.2"></line>',
      info: '<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16.5"></line><line x1="12" y1="7.6" x2="12" y2="7.8"></line>'
    };
    return `<svg class="sc-ico sc-ico-${kind}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
  }

  function row(kind, title, bodyHtml, actionsHtml = '') {
    return `<div class="sc-row sc-row-${kind}">${icon(kind)}<div class="sc-row-main"><strong>${title}</strong><p>${bodyHtml}</p>${actionsHtml}</div></div>`;
  }

  function shrinkRow() {
    const s = S.result?.shrink; if (!s) return '';
    const bad = s.level === 'warn' || s.level === 'bad';
    if (s.pct >= 99.5) return row(bad ? 'warn' : 'ok', 'Kept every detail', `Nothing could be removed without a visible change at this printer's detail, so the file stays full size (${nf.format(s.before)} triangles).`);
    return row(bad ? 'warn' : 'ok', 'Made it smaller',
      `${nf.format(s.before)} triangles down to ${nf.format(s.after)} (${s.pct < 10 ? s.pct.toFixed(1) : Math.round(s.pct)}%). File ≈ ${fmtSize(s.before)} → ${fmtSize(s.after)}. ${esc(s.text || '')}${s.text ? '.' : ''}`);
  }

  function solidRow() {
    const r = S.result?.repair; if (!r) return '';
    if (r.state === 'ok') return row('ok', 'It\u2019s one clean solid', 'Closed and watertight, so any slicer can read it without complaints.');
    if (r.state === 'rebuilt') {
      const b = r.rebuilt || {};
      const bits = [`${nf.format(b.trisOut || countTris(app()?.optimizedModel))} triangles`];
      if (b.mm) bits.push(`detail finer than about ${b.mm < 0.1 ? b.mm.toFixed(2) : b.mm.toFixed(1)} mm is softened`);
      if (b.droppedSpecks) bits.push(`${b.droppedSpecks} tiny stray specks removed`);
      if (b.simplified === false) bits.push('the file is larger than usual because it could not be simplified');
      return row('ok', 'Rebuilt as one solid',
        `${bits.join(' · ')}. <b>Have a look in the viewer</b> (try Compare) before you download. If it looks wrong, undo it and download the original instead.`,
        '<div class="sc-actions"><button type="button" class="sc-small-btn" data-act="undo">Undo rebuild</button></div>');
    }
    if (r.state === 'repaired') {
      const f = r.fixed || {}, bits = [];
      if (f.weldedPoints) bits.push(`joined ${nf.format(f.weldedPoints)} loose points`);
      if (f.flipped) bits.push(`turned ${nf.format(f.flipped)} flipped triangles round`);
      if (f.holeLoops) bits.push(`closed ${nf.format(f.holeLoops)} hole${f.holeLoops === 1 ? '' : 's'}`);
      if (f.tangledRemoved) bits.push(`removed ${nf.format(f.tangledRemoved)} tangled triangles`);
      if (f.duplicateRemoved || f.degenerateRemoved) bits.push(`cleared ${nf.format((f.duplicateRemoved || 0) + (f.degenerateRemoved || 0))} duplicate or empty triangles`);
      if (f.shellsTurned) bits.push(`turned ${f.shellsTurned} inside-out part${f.shellsTurned === 1 ? '' : 's'} the right way`);
      return row('ok', 'Repaired. Detail untouched',
        `${bits.length ? bits.join(', ') : 'Small fixes only'}. The rest of the surface is exactly as it was. <b>Have a look in the viewer</b> before you download.`,
        '<div class="sc-actions"><button type="button" class="sc-small-btn" data-act="undo">Undo repair</button></div>');
    }
    if (r.state === 'pieces') return row('info', `Made of ${r.components} separate pieces`, 'That\u2019s fine for printing. Pieces that don\u2019t touch will print as separate objects.');
    if (r.state === 'failed') return row('warn', 'We couldn\u2019t rebuild this model', `${esc(r.repairNote || '')} You can still download it as it is. Most slicers can repair it, or you can close the holes in your modelling software.`);
    if (r.state === 'needs' || r.state === 'repairFailed') {
      const busy = S.repairBusy, vox = predictVoxelMm(), coarse = vox > 0.25;
      const title = r.state === 'repairFailed' ? 'Repair could not make it fully clean' : 'Needs a quick repair';
      const intro = r.state === 'repairFailed'
        ? `${esc(r.repairNote || '')} Nothing was changed. Most slicers can still fix this when you import the file, or you can try the stronger fix below.`
        : 'We found small holes, flipped triangles or tangled edges. <b>Repair</b> closes them and leaves the rest of the surface exactly as it is, so no detail is lost. Most slicers can also do this when you import the file.';
      const repairBtn = r.state === 'repairFailed' ? '' : `<button type="button" class="sc-small-btn" data-act="repair"${busy ? ' disabled' : ''}>${busy && !S.abort ? 'Repairing…' : 'Repair it (keeps all detail)'}</button>`;
      const strong = `<button type="button" class="sc-small-btn sc-quiet" data-act="rebuild"${busy ? ' disabled' : ''}>${busy && S.abort ? esc(r.progress || 'Rebuilding…') : 'Stronger fix: rebuild as one solid'}</button>${busy && S.abort ? '<button type="button" class="sc-small-btn on" data-act="cancel-rebuild">Cancel</button>' : ''}`;
      const warn = `<p class="sc-warn-note">The stronger fix rebuilds the whole surface on a grid, so it softens detail finer than about <b>${fmtMm(vox)} mm</b>${coarse ? ' on a model this big. It will look rounded, so try Repair first' : ''}. It takes about 10 seconds and you preview it before downloading.</p>`;
      return row('warn', title, intro, `<div class="sc-actions">${repairBtn}</div>${warn}<div class="sc-actions">${strong}</div>`);
    }
    return row('info', 'Solid check skipped', esc(r.message || 'We couldn\u2019t check this one. You can still download.'));
  }

  function fitRow() {
    const f = S.result?.fit, p = printer();
    if (!f) return row('info', 'Size check skipped', 'We couldn\u2019t measure the model.');
    if (f.state === 'fits') return row('ok', `Fits your ${esc(p.short)}`, `It will print about ${f.dims}. Your printer fits up to ${f.B} mm.`);
    if (f.state === 'unknown') return row('info', `It will print about ${f.dims}`, 'Add your printer\u2019s biggest size (under Change printer or size) and we\u2019ll check it fits.');
    const scaleBtn = `<button type="button" class="sc-small-btn${S.fitChoice === 'scale' ? ' on' : ''}" data-act="scale" aria-pressed="${S.fitChoice === 'scale'}">Scale to ${f.scaleH} mm tall</button>`;
    if (f.state === 'tall') {
      const splitBtn = `<button type="button" class="sc-small-btn${S.fitChoice === 'split' ? ' on' : ''}" data-act="split" aria-pressed="${S.fitChoice === 'split'}">Split into ${f.parts} parts</button>`;
      return row('warn', 'Taller than your printer', `It\u2019s ${Math.round(f.e.h)} mm tall and your printer fits ${f.B} mm. Splitting adds little pegs so the parts line up when you glue them.`, `<div class="sc-actions">${splitBtn}${scaleBtn}</div>`);
    }
    if (f.state === 'wide') return row('warn', 'Too wide for your printer', `It would be about ${f.dims}, and your printer fits ${f.B} mm. Scaling it down keeps the whole model in one piece.`, `<div class="sc-actions">${scaleBtn}</div>`);
    return row('warn', 'Much bigger than your printer', `It would be about ${f.dims}, and your printer fits ${f.B} mm. Scaling it down is the easy fix.`, `<div class="sc-actions">${scaleBtn}</div>`);
  }

  function renderPrinters() {
    const wrap = $('scPrinters'); if (!wrap) return;
    wrap.innerHTML = PRINTERS.map(p => `<button type="button" class="sc-chip${p.id === S.printer ? ' on' : ''}" data-printer="${p.id}" aria-pressed="${p.id === S.printer}"><span class="sc-chip-ico" aria-hidden="true">${p.icon}</span><strong>${esc(p.name)}</strong><small>${esc(p.note)}</small></button>`).join('');
    $('scBedField').hidden = false;
  }

  function renderFitLine() {
    const el = $('scFitLine'); if (!el) return;
    const f = fitInfo(), p = printer();
    if (!f) { el.textContent = ''; el.dataset.level = ''; return; }
    if (f.state === 'fits') { el.dataset.level = 'ok'; el.textContent = `✓ Fits your ${p.short} — about ${f.dims}.`; }
    else if (f.state === 'unknown') { el.dataset.level = 'info'; el.textContent = `It will print about ${f.dims}.`; }
    else { el.dataset.level = 'warn'; el.textContent = `⚠ About ${f.dims} is bigger than your printer fits (${f.B} mm). We\u2019ll offer a fix after shrinking.`; }
  }

  /* ---- save / load settings (JSON) ---- */
  const SETTINGS_TYPE = 'shrink-3d-settings';

  function settingsSnapshot() {
    const g = Number($('geometry')?.value) || 0;
    const live = window.__shrinkLiveUI?.state;
    const reduced = app()?.optimizedModel;
    return {
      type: SETTINGS_TYPE, schema: 1, appVersion: VERSION, savedAt: new Date().toISOString(),
      printer: { kind: printer().type, ...(S.bed > 0 ? { biggestSizeMm: S.bed } : {}) },
      print: { heightMm: Math.round(heightMm() * 100) / 100 },
      detail: { level: S.detail, mm: detailMm() },
      reduction: {
        keepPercent: g || null,
        triangles: reduced ? countTris(reduced) : null,
        ofTriangles: live?.tris || null,
        tuned: !!S.tuned
      },
      notes: 'Detail (mm) is the size of change SHRINK may not exceed, so it carries over to any model. print.heightMm is how tall the model was printed. keepPercent is the share of triangles kept on the model it was saved from.'
    };
  }

  function saveSettings() {
    const data = settingsSnapshot();
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = `shrink-settings-${data.printer.kind}-${data.detail.mm}mm.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setStatusLine(`Saved ${a.download}`, false);
  }

  function applySettings(data) {
    if (!data || typeof data !== 'object' || data.type !== SETTINGS_TYPE) throw new Error('That does not look like a SHRINK 3D settings file.');
    const kind = data.printer?.kind === 'resin' ? 'resin' : data.printer?.kind === 'fdm' ? 'fdm' : null;
    if (!kind) throw new Error('The settings file does not say which kind of printer it is for.');
    const mm = Number(data.detail?.mm);
    if (!(mm >= 0.005 && mm <= 5)) throw new Error('The settings file has no usable detail size.');
    S.printer = kind; store.set('shrink-simple-printer', kind);
    const bed = Number(data.printer?.biggestSizeMm);
    S.bed = bed >= 20 && bed <= 1000 ? Math.round(bed) : 0; store.set('shrink-simple-bed', S.bed);
    const known = DETAILS.find(d => d.id === data.detail?.level && Math.abs(d.mm - mm) < 1e-9);
    if (known) { S.detail = known.id; }
    else { S.detail = 'custom'; S.customMm = Math.round(mm * 1000) / 1000; store.set('shrink-simple-detail-mm', S.customMm); }
    store.set('shrink-simple-detail', S.detail);
    const kp = Number(data.reduction?.keepPercent);
    S.savedReduction = kp >= 1 && kp <= 100 ? { keepPercent: Math.round(kp * 10) / 10, triangles: Number(data.reduction?.triangles) || 0, ofTriangles: Number(data.reduction?.ofTriangles) || 0, tuned: !!data.reduction?.tuned } : null;
    S.usePercent = false; S.loadedFromFile = true;
    const ph = Number(data.print?.heightMm);
    S.loadedHeight = ph >= 1 && ph <= 500 ? ph : 0;
    S.result = null; S.fitChoice = null;
    applyPrinter();
    if (S.loadedHeight) applyHeight(S.loadedHeight);
    S.stage = 'setup'; goSetupView(); syncInputs(); render(); renderLoaded(); celebrateLoaded();
  }

  function loadSettingsFile(file) {
    if (!file) return;
    showSetupError('');
    const reader = new FileReader();
    reader.onload = () => {
      try { applySettings(JSON.parse(String(reader.result))); }
      catch (err) { showSetupError(err instanceof SyntaxError ? 'That file is not valid JSON.' : (err?.message || 'Could not read that settings file.')); }
    };
    reader.onerror = () => showSetupError('Could not read that file.');
    reader.readAsText(file);
  }

  function detailLabel() {
    if (S.detail === 'custom') return `Saved detail ${S.customMm} mm`;
    const d = DETAILS.find(x => x.id === S.detail) || DETAILS[0];
    return `${d.name} (${d.mm} mm)`;
  }

  function renderLoaded() {
    const box = $('scLoaded'); if (!box) return;
    const sr = S.savedReduction, p = printer(), fresh = !!S.loadedFromFile;
    box.hidden = !fresh && !sr;
    if (box.hidden) return;
    for (const id of ['scLoadedTitle', 'scLoadedText', 'scLoadedNext']) $(id).hidden = !fresh;
    $('scLoadedText').textContent = `${p.type === 'resin' ? 'Resin' : 'FDM'} printer · ${detailLabel()}${S.loadedHeight ? ` · ${S.loadedHeight} mm tall` : ''}${S.bed ? ` · bed ${S.bed} mm` : ''}`;
    const row = $('scPercentRow');
    row.hidden = !sr;
    if (sr) { $('scLoadedPct').textContent = `${sr.keepPercent}%`; $('scUsePercent').checked = S.usePercent; }
  }

  // Tell the person clearly that loading worked and what to do next.
  function celebrateLoaded() {
    const box = $('scLoaded'); box?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    const go = $('scGo'); if (!go) return;
    go.classList.remove('sc-pulse'); void go.offsetWidth; go.classList.add('sc-pulse');
    setTimeout(() => go.classList.remove('sc-pulse'), 5000);
  }

  /* ---- protect fine detail (paint areas the reducer must not touch) ---- */
  const protectHtml = () => `
    <div class="sc-protect">
      <div class="sc-protect-row">
        <button type="button" class="sc-small-btn" data-protect="toggle" aria-pressed="false">🖌 Protect fine detail <em>(optional)</em></button>
        <button type="button" class="sc-link-btn" data-protect="clear" disabled>Clear</button>
      </div>
      <p class="sc-fine sc-protect-hint">Paint over faces, hands or ornaments so shrinking leaves them alone.</p>
      <div class="sc-protect-tools" hidden><label>Brush size <input type="range" min="0.5" max="20" step="0.5" value="3" data-protect="radius" aria-label="Brush size in millimetres"><output>3.0 mm</output></label></div>
    </div>`;

  function renderProtect() {
    const active = !!$('protectBtn')?.classList.contains('active');
    const dabs = window.__shrinkPrint?.state?.dabs?.length || 0;
    document.querySelectorAll('.sc-protect').forEach(box => {
      const t = box.querySelector('[data-protect="toggle"]'); t.setAttribute('aria-pressed', String(active)); t.classList.toggle('on', active);
      box.querySelector('.sc-protect-tools').hidden = !active;
      box.querySelector('[data-protect="clear"]').disabled = !dabs;
      box.querySelector('.sc-protect-hint').textContent = active
        ? 'Painting is on: drag on the model to paint red. Hold Cmd/Ctrl and drag to rotate. Click the button again when you are done.'
        : dabs ? 'Painted areas are kept sharp. Everything else is reduced first.' : 'Paint over faces, hands or ornaments so shrinking leaves them alone.';
    });
  }

  function onProtectClick(e) {
    const el = e.target.closest('[data-protect]'); if (!el) return;
    const act = el.dataset.protect;
    if (act === 'toggle') { $('protectBtn')?.click(); setTimeout(renderProtect, 60); setTimeout(renderProtect, 400); }
    else if (act === 'clear') { $('protectClearBtn')?.click(); setTimeout(renderProtect, 60); }
  }
  function onProtectInput(e) {
    const el = e.target.closest('[data-protect="radius"]'); if (!el) return;
    const n = $('protectRadius'); if (n) { n.value = el.value; n.dispatchEvent(new Event('input', { bubbles: true })); }
    document.querySelectorAll('.sc-protect [data-protect="radius"]').forEach(x => { x.value = el.value; x.nextElementSibling.textContent = `${Number(el.value).toFixed(1)} mm`; });
  }

  /* ---- detail level chips ---- */
  function renderDetails() {
    const wrap = $('scDetails'); if (!wrap) return;
    const list = S.customMm > 0 && S.detail === 'custom' ? [...DETAILS, { id: 'custom', name: `Saved: ${S.customMm} mm`, note: 'From your settings file' }] : DETAILS;
    wrap.dataset.count = String(list.length);
    wrap.innerHTML = list.map(d => `<button type="button" class="sc-chip sc-mini${d.id === S.detail ? ' on' : ''}" data-detail="${d.id}" aria-pressed="${d.id === S.detail}"><strong>${esc(d.name)}</strong><small>${esc(d.note)}</small></button>`).join('');
  }

  /* ---- fine-tune slider shown with the result ---- */
  const liveText = el => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Triangles on the model the person is looking at right now (live estimate while the slider moves).
  function tuneTriangles() {
    const live = window.__shrinkLiveUI?.state?.tris || S.result?.shrink?.before || 0;
    if (['rebuilt', 'repaired'].includes(S.result?.repair?.state) && app()?.optimizedModel) return { orig: live, now: countTris(app().optimizedModel) };
    // once the slider has settled, report what is really on screen (the reducer can stop above its target on open or locked edges)
    if (!S.dragging && $('verdict')?.dataset.level !== 'busy' && app()?.optimizedModel) { const n = countTris(app().optimizedModel); if (n > 0) return { orig: live, now: n }; }
    const pct = Number($('geometry')?.value) || 0;
    return { orig: live, now: live ? Math.max(1, Math.round(live * pct / 100)) : 0 };
  }

  function renderDownloadLabel() {
    const btn = $('scDownload'); if (!btn || !S.result) return;
    const f = S.result.fit, splitting = S.fitChoice === 'split' && f?.state === 'tall', dl = tuneTriangles();
    btn.innerHTML = `<span aria-hidden="true">⬇</span> ${splitting ? `Download ${f.parts} parts (ZIP)` : `Download STL${dl.now ? ` · ${fmtSize(dl.now)}` : ''}`}`;
  }

  function renderSize() {
    const strip = $('scSize'); if (!strip) return;
    const { orig, now } = tuneTriangles();
    strip.hidden = !(orig > 0 && now > 0);
    if (strip.hidden) return;
    const a = stlMb(orig), b = stlMb(now), saved = Math.max(0, a - b), smaller = a > 0 ? Math.max(0, Math.min(100, (1 - b / a) * 100)) : 0;
    $('scSizeOrig').textContent = fmtMbNum(a); $('scSizeNow').textContent = fmtMbNum(b); $('scSizeSaved').textContent = fmtMbNum(saved);
    $('scSizePct').textContent = `${smaller >= 99.5 ? '99+' : Math.round(smaller)}% smaller`;
    $('scSizeFill').style.width = `${Math.max(1.5, 100 - smaller)}%`;
    strip.setAttribute('aria-label', `Original about ${fmtMbNum(a)}, now about ${fmtMbNum(b)}, saving ${fmtMbNum(saved)}`);
  }

  function renderTune() {
    const g = $('geometry'); if (!g || !$('scTuneLine')) return;
    const range = $('scDetailRange');
    if (range && document.activeElement !== range) range.value = g.value;
    $('scTuneVal').textContent = `${Number(g.value).toFixed(1)}%`;
    const verdict = $('verdictText')?.textContent || '';
    const t = tuneTriangles();
    const line = $('scTuneLine'); line.textContent = [t.now ? `${nf.format(t.now)} of ${nf.format(t.orig)} triangles (${t.orig ? (100 * t.now / t.orig).toFixed(t.now / t.orig < 0.1 ? 1 : 0) : 0}%)` : liveText($('liveLine')), verdict].filter(Boolean).join(' · ');
    renderSize(); renderDownloadLabel();
    line.dataset.level = $('verdict')?.dataset.level || '';
    const nums = $('scTuneNums'); if (nums) nums.textContent = $('verdictNums')?.textContent || '';
    const cmp = card?.querySelector('[data-act="compare"]'); if (cmp) cmp.textContent = app()?.isCompare?.() ? 'Stop comparing' : 'Compare with original';
  }

  function scheduleTuneRefresh() {
    clearTimeout(S.tuneTimer);
    S.tuneTimer = setTimeout(async () => {
      if (S.stage !== 'result' || S.busy || !S.result) { S.dragging = false; return; }
      await waitFor(() => $('verdict')?.dataset.level !== 'busy', 15000, 150);
      S.dragging = false;
      if (S.stage !== 'result' || S.busy) return;
      const reduced = app()?.optimizedModel; if (!reduced) return;
      const before = window.__shrinkLiveUI?.state?.tris || S.result.shrink?.before || 0, after = countTris(reduced);
      S.result.shrink = { before, after, pct: before ? (after / before) * 100 : 100, level: $('verdict')?.dataset.level || 'none', text: $('verdictText')?.textContent || '', nums: $('verdictNums')?.textContent || '' };
      await doSolidCheck(S.result);
      S.result.fit = fitInfo();
      render(); renderTune();
    }, 900);
  }

  function renderSteps() {
    const labels = { shrink: 'Making it smaller', repair: 'Checking it\u2019s a solid', fit: 'Checking it fits your printer' };
    const list = $('scSteps'); if (!list) return;
    list.innerHTML = Object.keys(labels).map(k => `<li data-state="${S.steps[k]}"><span class="sc-tag" aria-hidden="true"></span><span>${labels[k]}</span></li>`).join('');
  }

  function renderResult() {
    if (S.stage !== 'result' || !S.result) return;
    const p = printer();
    const warn = S.result.repair?.state === 'needs' || (S.result.fit && !['fits', 'unknown'].includes(S.result.fit.state)) || ['warn', 'bad'].includes(S.result.shrink?.level);
    $('scResultTitle').textContent = warn ? 'Almost ready to print' : 'Ready to print';
    $('scResultSub').textContent = `Here\u2019s what we did for your ${p.type === 'resin' ? 'resin printer' : p.short}:`;
    $('scRows').innerHTML = shrinkRow() + solidRow() + fitRow();
    const f = S.result.fit;
    const splitting = S.fitChoice === 'split' && f?.state === 'tall';
    renderDownloadLabel();
    $('scDlNote').textContent = p.type === 'resin' ? 'Opens in Lychee, Chitubox and most slicers.' : 'Opens in Cura, PrusaSlicer, OrcaSlicer and most slicers.';
  }

  function render() {
    if (!card) return;
    card.dataset.stage = S.stage;
    card.dataset.busy = String(S.busy);
    renderSteps();
    renderResult();
    const st = card.querySelector('.sc-stepper');
    if (st) {
      const one = st.querySelector('[data-act="goto-setup"]'), two = st.querySelector('[data-act="goto-result"]');
      one.classList.toggle('on', S.stage === 'setup'); two.classList.toggle('on', S.stage === 'result');
      one.disabled = S.busy; two.disabled = S.busy || !S.result;
      one.setAttribute('aria-current', S.stage === 'setup' ? 'step' : 'false'); two.setAttribute('aria-current', S.stage === 'result' ? 'step' : 'false');
    }
    renderDetails(); renderProtect(); renderLoaded();
  }

  function showSetupError(msg) {
    const el = $('scError'); if (!el) return;
    el.textContent = msg || ''; el.hidden = !msg;
  }
  function note(msg) { const el = $('scWorkNote'); if (el) el.textContent = msg; }
  function setStatusLine(msg, error) {
    const el = $('scStatus'); if (!el) return;
    el.textContent = msg || ''; el.dataset.error = error ? 'true' : 'false';
  }

  function fillTechnical() {
    const el = $('scTechBody'); if (!el) return;
    const s = S.result?.shrink, f = S.result?.fit, r = S.result?.repair;
    const lines = [];
    if (s) {
      lines.push(`Triangles: ${nf.format(s.before)} → ${nf.format(s.after)} (${s.pct.toFixed(1)}%)`);
      lines.push(`Estimated STL size: ${fmtSize(s.before)} → ${fmtSize(s.after)}`);
      if (s.nums) lines.push(`Quality check: ${s.nums}`);
    }
    if (f?.dims) lines.push(`Print size: ${f.dims}`);
    if (r) {
      lines.push(`Solid check: ${r.state}${r.components ? ` (${r.components} part${r.components === 1 ? '' : 's'})` : ''}`);
      if (r.message) lines.push(`Engine message: ${r.message}`);
      if (r.fixed) lines.push(`Repair: ${r.fixed.weldedPoints} points joined · ${r.fixed.flipped} flipped · ${r.fixed.holeLoops} holes closed (${r.fixed.holeTriangles} triangles) · ${r.fixed.tangledRemoved} tangled removed · open edges ${r.fixed.before?.open}→${r.fixed.after?.open}`);
      if (r.rebuilt) lines.push(`Rebuild: voxel ${r.rebuilt.voxel?.toPrecision(3)} units · grid ${r.rebuilt.dims?.join('×')} · gap sealing ${r.rebuilt.radius} voxels · ${nf.format(r.rebuilt.trisRaw || 0)} → ${nf.format(r.rebuilt.trisOut || 0)} triangles`);
    }
    try {
      const topo = window.__shrinkPrintSafety?.topologySummary?.(app()?.optimizedModel);
      if (topo) lines.push(`Mesh check: ${nf.format(topo.openEdges)} open edges · ${nf.format(topo.pinchedEdges)} pinched edges · ${nf.format(topo.degenerateTriangles)} degenerate triangles`);
    } catch {}
    el.innerHTML = lines.map(l => `<div>${esc(l)}</div>`).join('') + '<button type="button" class="sc-small-btn" data-act="advanced">Open Tools</button>';
  }

  /* ------------------------------ building the card ------------------------------ */
  function buildCard() {
    const el = document.createElement('section');
    el.id = 'simpleCard'; el.className = 'simple-card'; el.dataset.stage = 'setup';
    el.setAttribute('aria-label', 'Simple print-ready workflow');
    el.innerHTML = `
      <nav class="sc-stepper" aria-label="Steps">
        <button type="button" class="sc-step on" data-act="goto-setup"><b>1</b><span>Printer &amp; detail</span></button>
        <button type="button" class="sc-step" data-act="goto-result" disabled><b>2</b><span>Result</span></button>
      </nav>
      <div class="sc-stage sc-setup">
        <h2>Which printer will you use?</h2>
        <p class="sc-sub">Pick the closest one. We\u2019ll choose sensible settings for it.</p>
        <div id="scPrinters" class="sc-printers" role="group" aria-label="Printer"></div>
        <div class="sc-field"><label for="scHeight">How tall should it print?</label><div class="sc-input"><input id="scHeight" type="number" inputmode="decimal" min="1" max="500" step="1"><span>mm</span></div></div>
        <div id="scBedField" class="sc-field" hidden><label for="scBed">Biggest size your printer can print <em>(optional)</em></label><div class="sc-input"><input id="scBed" type="number" inputmode="decimal" min="20" max="1000" step="5" placeholder="e.g. 220" list="scBedList"><datalist id="scBedList"><option value="180"></option><option value="220"></option><option value="256"></option><option value="300"></option><option value="350"></option></datalist><span>mm</span></div></div>
        <div id="scFitLine" class="sc-fit" aria-live="polite"></div>
        <div class="sc-group-title">How much detail should we keep?</div>
        <div id="scDetails" class="sc-details" role="group" aria-label="Detail level"></div>
        ${protectHtml()}
        <div id="scLoaded" class="sc-loaded" role="status" hidden>
          <div id="scLoadedTitle" class="sc-loaded-title">✓ Settings loaded!</div>
          <div id="scLoadedText" class="sc-loaded-sub"></div>
          <div id="scLoadedNext" class="sc-loaded-next">Now press <b>Make smaller</b> below to use them.</div>
          <details id="scPercentRow" class="sc-more" hidden>
            <summary>Reduce by the same amount instead</summary>
            <p class="sc-more-text">Normally SHRINK works out the best amount for each new model. Your saved file kept <b id="scLoadedPct"></b> of the triangles on the model it came from. Tick the box to keep that same share of this model's triangles instead. Only worth it for models very like the one you saved from.</p>
            <label class="sc-check"><input id="scUsePercent" type="checkbox"><span>Use the same amount</span></label>
          </details>
        </div>
        <div id="scError" class="sc-error" role="alert" hidden></div>
        <button id="scGo" class="sc-go" type="button">Make smaller</button>
        <p class="sc-fine">Shrinks the file, checks it\u2019s a solid and checks it fits. Your original file is never changed.</p>
        <div class="sc-setup-tools">
          <button type="button" class="sc-link-btn" data-act="load-settings">📂 Load saved settings</button>
          <button type="button" class="sc-link-btn" data-act="advanced">Tools ›</button>
          <input id="scSettingsFile" type="file" accept="application/json,.json" hidden>
        </div>
      </div>
      <div class="sc-stage sc-working">
        <div class="sc-eyebrow">&gt;_ WORKING…</div>
        <h2>Making it print-ready</h2>
        <ol id="scSteps" class="sc-steps"></ol>
        <p id="scWorkNote" class="sc-fine" aria-live="polite">Starting…</p>
        <button type="button" class="sc-link-btn" data-act="cancel-run">Cancel and go back</button>
      </div>
      <div class="sc-stage sc-result">
        <h2 id="scResultTitle">Ready to print</h2>
        <p id="scResultSub" class="sc-sub"></p>
        <div id="scRows" class="sc-rows"></div>
        <div id="scTune" class="sc-tune">
          <div id="scSize" class="sc-size" role="img" aria-live="polite" hidden>
            <div class="sc-size-nums">
              <div><small>Original</small><strong id="scSizeOrig">—</strong></div>
              <span class="sc-size-arrow" aria-hidden="true">→</span>
              <div><small>Now</small><strong id="scSizeNow">—</strong></div>
              <div class="sc-size-saved"><small>You save</small><strong id="scSizeSaved">—</strong></div>
            </div>
            <div class="sc-size-bar" aria-hidden="true"><span id="scSizeFill"></span></div>
            <div id="scSizePct" class="sc-size-pct"></div>
          </div>
          <div class="sc-tune-head"><label for="scDetailRange">Fine-tune the detail</label><output id="scTuneVal">—</output></div>
          <input id="scDetailRange" type="range" min="1" max="100" step="0.1" value="50">
          <div class="sc-tune-ends"><span>Smaller file</span><span>More detail</span></div>
          <p id="scTuneLine" class="sc-tune-line" aria-live="polite"></p>
          <p id="scTuneNums" class="sc-tune-nums"></p>
          <div class="sc-actions"><button type="button" class="sc-small-btn" data-act="compare">Compare with original</button><button type="button" class="sc-small-btn" data-act="best">✨ Find the best again</button><button type="button" class="sc-small-btn" data-act="save-settings">💾 Save these settings</button></div>
        </div>
        <button id="scDownload" class="sc-go sc-download" type="button"></button>
        <p id="scDlNote" class="sc-fine"></p>
        <p id="scStatus" class="sc-status" aria-live="polite" data-error="false"></p>
        <button type="button" class="sc-small-btn sc-back" data-act="goto-setup">← Back to step 1</button>
        <details id="scTech" class="sc-tech"><summary>Technical details</summary><div id="scTechBody" class="sc-tech-body"></div></details>
      </div>`;
    return el;
  }

  function wireCard() {
    card.addEventListener('click', e => {
      const chip = e.target.closest('[data-printer]');
      if (chip && card.contains(chip)) {
        S.printer = chip.dataset.printer; store.set('shrink-simple-printer', S.printer);
        S.loadedFromFile = false; S.result = null; applyPrinter(); renderPrinters(); renderFitLine(); render(); return;
      }
      const dchip = e.target.closest('[data-detail]');
      if (dchip && card.contains(dchip)) { S.detail = dchip.dataset.detail; store.set('shrink-simple-detail', S.detail); S.result = null; S.loadedFromFile = false; applyDetail(); renderDetails(); render(); return; }
      onProtectClick(e);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'advanced') setLevel('advanced');
      else if (act === 'goto-setup' || act === 'back') goSetup();
      else if (act === 'goto-result') goResult();
      else if (act === 'cancel-run') cancelRun();
      else if (act === 'cancel-rebuild') S.abort?.abort?.();
      else if (act === 'compare') { $('compareBtn')?.click(); setTimeout(renderTune, 80); }
      else if (act === 'best') run();
      else if (act === 'save-settings') saveSettings();
      else if (act === 'load-settings') $('scSettingsFile')?.click();
      else if (act === 'repair') repair();
      else if (act === 'rebuild') rebuild();
      else if (act === 'undo') run();
      else if (act === 'split') { S.fitChoice = 'split'; render(); }
      else if (act === 'scale') {
        const f = S.result?.fit; if (!f) return;
        const mm = applyHeight(f.scaleH);
        $('scHeight').value = String(mm);
        S.result.fit = fitInfo(); S.fitChoice = null; render(); renderFitLine();
      }
    });
    card.addEventListener('input', onProtectInput);
    $('scSettingsFile').addEventListener('change', () => { const f = $('scSettingsFile').files?.[0]; loadSettingsFile(f); $('scSettingsFile').value = ''; });
    $('scUsePercent').addEventListener('change', () => { S.usePercent = $('scUsePercent').checked; });
    $('scDetailRange').addEventListener('input', () => { S.tuned = true; S.dragging = true; setNative('geometry', $('scDetailRange').value, 'input'); renderTune(); scheduleTuneRefresh(); });
    ['liveLine', 'verdictText', 'verdict'].forEach(id => { const n = $(id); if (n) new MutationObserver(renderTune).observe(n, { childList: true, characterData: true, subtree: true, attributes: true }); });
    window.addEventListener('shrink:compare', renderTune);
    window.addEventListener('shrink:protect-changed', renderProtect);
    const pb = $('protectBtn'); if (pb) new MutationObserver(renderProtect).observe(pb, { attributes: true, attributeFilter: ['class'] });
    $('scGo').addEventListener('click', run);
    $('scDownload').addEventListener('click', download);
    $('scHeight').addEventListener('input', () => {
      const v = Number($('scHeight').value); if (!(v >= 1)) return;
      applyHeight(v); S.loadedHeight = 0; S.result = null; renderFitLine(); render();
    });
    $('scBed').addEventListener('input', () => {
      S.bed = Math.max(0, Number($('scBed').value) || 0); store.set('shrink-simple-bed', S.bed);
      S.result = null; renderFitLine(); render();
    });
    $('scTech').addEventListener('toggle', () => { if ($('scTech').open) fillTechnical(); });
  }

  function syncInputs() {
    const h = $('scHeight'); if (h) h.value = String(Math.round(heightMm()));
    const b = $('scBed'); if (b) b.value = S.bed ? String(S.bed) : '';
    renderPrinters(); renderFitLine();
  }

  /* ------------------------------ Simple / Tools switch ------------------------------ */
  function installToggle() {
    if ($('uiLevelToggle')) return;
    const header = document.querySelector('.topbar'); if (!header) return;
    const pill = header.querySelector('.privacy-pill');
    const right = document.createElement('div'); right.className = 'topbar-right';
    const toggle = document.createElement('div'); toggle.id = 'uiLevelToggle'; toggle.className = 'ui-level-toggle';
    toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', 'Interface level');
    toggle.innerHTML = '<button type="button" data-level="simple">Simple</button><button type="button" data-level="advanced">Tools</button>';
    toggle.addEventListener('click', e => { const b = e.target.closest('[data-level]'); if (b) setLevel(b.dataset.level); });
    header.appendChild(right); right.append(toggle); if (pill) right.append(pill);
  }

  function setLevel(level) {
    S.level = level === 'advanced' ? 'advanced' : 'simple';
    store.set('shrink-ui-level', S.level);
    body.classList.toggle('ui-simple', S.level === 'simple');
    body.classList.toggle('ui-advanced', S.level === 'advanced');
    window.__shrinkSkipMeasure = S.level === 'simple';
    document.querySelectorAll('#uiLevelToggle [data-level]').forEach(b => { const on = b.dataset.level === S.level; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    if (S.level === 'simple' && card) { applyPrinter(); syncInputs(); S.result = null; if (S.stage !== 'working') S.stage = 'setup'; render(); }
    window.dispatchEvent(new CustomEvent('shrink:ui-level', { detail: { level: S.level } }));
  }

  /* ------------------------------ lifecycle ------------------------------ */
  function installAdvancedProtect() {
    const body = document.querySelector('#v2ShrinkCard .v2-advanced-body');
    if (!body || body.querySelector('.sc-protect')) return;
    const holder = document.createElement('div'); holder.className = 'sc-protect-holder'; holder.innerHTML = protectHtml();
    body.appendChild(holder);
    holder.addEventListener('click', onProtectClick); holder.addEventListener('input', onProtectInput);
  }

  function ensureCard() {
    const grid = document.querySelector('.print-v2-dashboard .v2-top-grid');
    if (!grid) return;
    if (card?.isConnected) return;
    card = buildCard(); grid.appendChild(card); wireCard();
    applyPrinter(); applyDetail(); applyHeight($('scHeight')?.value || heightMm() || 75);
    installAdvancedProtect();
    syncInputs(); render();
  }

  function onModelOpened() {
    S.runToken++; S.abort?.abort?.(); S.abort = null;
    S.stage = 'setup'; S.busy = false; S.repairBusy = false; S.result = null; S.fitChoice = null;
    S.steps = { shrink: 'pending', repair: 'pending', fit: 'pending' };
    setTimeout(() => { ensureCard(); applyDetail(); showSetupError(''); setStatusLine('', false); syncInputs(); render(); }, 80);
  }

  function mirrorStatus() {
    const status = $('status'); if (!status) return;
    new MutationObserver(() => {
      const text = status.textContent || '', error = status.classList.contains('error');
      if (S.busy) { note(text); return; }
      if (card && S.stage === 'result') setStatusLine(text === 'Ready.' ? '' : text, error);
    }).observe(status, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `./simple-mode.css?v=${VERSION}`; css.dataset.shrinkSimple = 'true';
  document.head.appendChild(css);

  installToggle();
  setLevel(S.level);
  mirrorStatus();
  window.addEventListener('shrink:model-opened', onModelOpened);
  window.addEventListener('shrink:ui-mode', () => setTimeout(ensureCard, 80));
  new MutationObserver(() => { if (!card?.isConnected && document.querySelector('.print-v2-dashboard .v2-top-grid')) ensureCard(); })
    .observe(document.body, { childList: true, subtree: true });
  ensureCard();

  window.__shrinkSimple = { run, setLevel, state: S, fitInfo };
})();
