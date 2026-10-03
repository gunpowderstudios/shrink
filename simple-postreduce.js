// SHRINK 3D v2.25 — lightweight post-reduction safety for Simple Print mode.
// The upload has already passed Repair. If reduction damages topology, keep more triangles.
// Do not send the user through another repair/rebuild loop after Stage 1.
(() => {
  const RELEASE = '2.25';
  const CORE = '2.18';
  const $ = id => document.getElementById(id);
  const body = document.body;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const attempted = new WeakSet();
  let running = false;
  let queued = false;
  let topologyMod = null;

  function active() {
    return body.classList.contains('app-mode-print') && body.classList.contains('ui-simple');
  }
  const api = () => window.__shrinkSimple;
  const app = () => window.__shrinkApp;

  async function topology(model) {
    if (!model) return null;
    topologyMod = topologyMod || await import(`./mesh-tools.js?v=${CORE}`);
    return topologyMod.analyzeTopology(app()?.THREE, model);
  }

  function isClean(t) {
    return !!t && t.openEdges === 0 && t.nonManifold === 0 && t.degenerate === 0;
  }

  function refreshNormals(model) {
    model?.traverse?.(o => {
      const g = o?.isMesh ? o.geometry : null;
      if (!g?.attributes?.position) return;
      try {
        g.computeVertexNormals();
        if (g.attributes.normal) g.attributes.normal.needsUpdate = true;
      } catch {}
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m && 'flatShading' in m && app()?.sourceKind === 'stl') { m.flatShading = true; m.needsUpdate = true; }
      }
    });
  }

  function countTris(model) {
    let n = 0;
    model?.traverse?.(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      n += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
    });
    return n;
  }

  function fmt(n) { return new Intl.NumberFormat().format(Math.round(Number(n) || 0)); }
  const stlMb = tris => (84 + 50 * Math.max(0, tris || 0)) / 1048576;
  const fmtMb = mb => mb >= 10 ? `${Math.round(mb)} MB` : mb >= 0.1 ? `${mb.toFixed(1)} MB` : '<0.1 MB';

  function ensureStyle() {
    if ($('simplePostReduceStyle')) return;
    const style = document.createElement('style');
    style.id = 'simplePostReduceStyle';
    style.textContent = `
      .sc-postguard{margin:0 0 12px;padding:10px 12px;border:1px solid rgba(57,229,140,.42);border-radius:10px;background:rgba(0,255,125,.055);color:#bfffdc;font-size:12.5px;font-weight:800;line-height:1.45}
      .sc-postguard[data-state="working"]{border-color:rgba(242,176,74,.55);background:rgba(78,53,10,.34);color:#ffe0ad}
      .sc-postguard[data-state="failed"]{border-color:rgba(255,91,98,.55);background:rgba(120,18,24,.2);color:#ffd3d5}
      .simple-postrepair-busy #scRows{opacity:.45;pointer-events:none}
      #scPostCleanRow{margin-top:10px}
    `;
    document.head.appendChild(style);
  }

  function banner(state, text) {
    const result = document.querySelector('#simpleCard .sc-result');
    if (!result) return null;
    let el = $('scPostGuard');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scPostGuard';
      el.className = 'sc-postguard';
      const rows = $('scRows');
      if (rows) result.insertBefore(el, rows); else result.prepend(el);
    }
    el.dataset.state = state;
    el.textContent = text;
    return el;
  }

  function clearBanner() { $('scPostGuard')?.remove(); $('scPostCleanRow')?.remove(); }

  function setSlider(ratio) {
    const pct = (ratio * 100).toFixed(1);
    if ($('geometry')) $('geometry').value = pct;
    if ($('scDetailRange')) $('scDetailRange').value = pct;
    if ($('scTuneVal')) $('scTuneVal').textContent = `${pct}%`;
  }

  function removeRepairRows() {
    document.querySelectorAll('#scRows .sc-row').forEach(row => {
      if (row.querySelector('[data-act="repair"], [data-act="rebuild"]')) row.remove();
    });
  }

  function updateResult(result, startPct, finalRatio, topologyInfo) {
    const model = app()?.optimizedModel || window.__shrinkLive?.root;
    const before = result?.shrink?.before || countTris(app()?.originalModel);
    const after = countTris(model);
    const pct = before ? (after / before) * 100 : finalRatio * 100;

    if (result?.shrink) {
      result.shrink.after = after;
      result.shrink.pct = pct;
      result.shrink.level = 'good';
      result.shrink.text = finalRatio >= 0.999
        ? 'Kept full detail because a smaller clean mesh was not safe'
        : 'Safe print reduction';
      result.shrink.nums = '';
    }
    result.repair = { state: 'ok', components: 0, message: '', topology: topologyInfo, postReductionBackoff: finalRatio > startPct / 100 + 0.005 };

    const title = $('scResultTitle');
    if (title) title.textContent = 'Ready to print';
    removeRepairRows();

    const shrinkRow = [...document.querySelectorAll('#scRows .sc-row')].find(r => /Made it smaller|Kept every detail/i.test(r.querySelector('strong')?.textContent || ''));
    const p = shrinkRow?.querySelector('p');
    if (p && before && after) {
      p.textContent = finalRatio >= 0.999
        ? `${fmt(before)} triangles. SHRINK kept the full repaired mesh because smaller versions stopped being clean.`
        : `${fmt(before)} triangles down to ${fmt(after)} (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%). File ≈ ${fmtMb(stlMb(before))} → ${fmtMb(stlMb(after))}. Safe print reduction.`;
    }

    let clean = $('scPostCleanRow');
    if (!clean) {
      clean = document.createElement('div');
      clean.id = 'scPostCleanRow';
      clean.className = 'sc-row sc-row-ok';
      clean.innerHTML = '<span style="font-size:22px;color:#39e58c">✓</span><div class="sc-row-main"><strong>Mesh stayed clean</strong><p></p></div>';
      $('scRows')?.appendChild(clean);
    }
    const cleanP = clean.querySelector('p');
    if (cleanP) cleanP.textContent = finalRatio >= 0.999
      ? 'The repaired source is clean, so SHRINK kept it rather than forcing an unsafe reduction.'
      : `The first ${Math.round(startPct)}% target was too aggressive structurally, so SHRINK kept ${Math.round(pct)}% instead.`;

    refreshNormals(model);
    app()?.show?.('optimized');
  }

  function candidates(startRatio) {
    const safer = Math.min(0.92, Math.max(startRatio + 0.20, startRatio * 1.7));
    const out = [];
    if (safer > startRatio + 0.01 && safer < 0.99) out.push(safer);
    out.push(1);
    return out;
  }

  async function tryRatio(result, ratio, startPct) {
    const live = window.__shrinkLive;
    if (!live?.runExact) throw new Error('The live reducer is not available.');
    const shown = Math.round(ratio * 100);
    banner('working', ratio >= 0.999
      ? 'The smaller version was not structurally safe. Keeping the full repaired mesh instead…'
      : `The first reduction was too aggressive. Trying a safer ${shown}%…`);

    const opts = { protectKeep: window.__shrinkPrint?.getReduceOptions?.().protectKeep ?? 1 };
    await live.runExact(ratio, opts);
    setSlider(ratio);
    await wait(20);
    const model = app()?.optimizedModel || live.root;
    refreshNormals(model);
    const t = await topology(model);
    if (!isClean(t)) return false;
    updateResult(result, startPct, ratio, t);
    banner('ok', ratio >= 0.999
      ? '✓ SHRINK kept the clean repaired mesh rather than forcing an unsafe reduction.'
      : `✓ Final mesh check passed at ${Math.round((result.shrink?.pct || ratio * 100))}% — small enough, clean and ready to slice.`);
    return true;
  }

  async function runGuard() {
    queued = false;
    if (running || !active()) return;
    const a = api();
    const result = a?.state?.result;
    if (!result || a.state?.stage !== 'result') return;

    refreshNormals(app()?.optimizedModel);

    const repair = result?.repair;
    if (repair?.state !== 'needs') return;
    if (attempted.has(result)) return;
    attempted.add(result);

    running = true;
    body.classList.add('simple-postrepair-busy');
    const startRatio = Math.max(0.01, Math.min(1, (result.shrink?.pct || Number($('geometry')?.value) || 100) / 100));
    const startPct = startRatio * 100;
    banner('working', 'The reduced shape looks fine, but the mesh structure went too far. Keeping a little more detail automatically…');

    let passed = false;
    try {
      for (const ratio of candidates(startRatio)) {
        if (!active() || a.state?.stage !== 'result') return;
        passed = await tryRatio(result, ratio, startPct);
        if (passed) break;
        await wait(20);
      }
      if (!passed) {
        const title = $('scResultTitle'); if (title) title.textContent = 'Needs attention';
        banner('failed', 'SHRINK could not confirm a clean reduced mesh. Open Tools if you want to inspect it manually.');
      }
    } catch (err) {
      console.warn(`[SHRINK 3D ${RELEASE}] Safe reduction fallback failed`, err);
      const title = $('scResultTitle'); if (title) title.textContent = 'Needs attention';
      banner('failed', 'The final clean-mesh check could not finish. Open Tools if you want to inspect it manually.');
    } finally {
      body.classList.remove('simple-postrepair-busy');
      running = false;
      window.__shrinkWizard?.sync?.();
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(runGuard);
  }

  function install() {
    ensureStyle();
    const card = $('simpleCard');
    if (!card) return false;
    new MutationObserver(schedule).observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-stage', 'disabled'] });
    window.addEventListener('shrink:model-opened', () => { clearBanner(); body.classList.remove('simple-postrepair-busy'); setTimeout(schedule, 100); });
    window.addEventListener('shrink:live-updated', () => { if (api()?.state?.stage === 'result') { refreshNormals(app()?.optimizedModel); schedule(); } });
    window.addEventListener('shrink:optimized', schedule);
    schedule();
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
  setTimeout(() => clearInterval(timer), 15000);
  if (document.readyState !== 'loading') install(); else document.addEventListener('DOMContentLoaded', install, { once: true });

  window.__shrinkPostReduce = { run: runGuard, refreshNormals, version: RELEASE };
})();
