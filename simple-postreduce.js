// SHRINK 3D v2.24 — topology-aware post-reduction safety for Simple Print mode.
// A model that passed the upload repair gate should not be repaired over and over.
// If an aggressive reduction stops being a valid solid, progressively keep more triangles
// until the reduced copy is clean again. Only then fall back to the stronger repair UI.
(() => {
  const RELEASE = '2.24';
  const $ = id => document.getElementById(id);
  const body = document.body;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let running = false;
  let queued = false;
  const attempted = new WeakSet();

  function active() {
    return body.classList.contains('app-mode-print') && body.classList.contains('ui-simple');
  }

  function api() { return window.__shrinkSimple; }
  function app() { return window.__shrinkApp; }

  function ensureStyle() {
    if ($('simplePostReduceStyle')) return;
    const style = document.createElement('style');
    style.id = 'simplePostReduceStyle';
    style.textContent = `
      .sc-postguard{margin:0 0 12px;padding:11px 13px;border:1px solid rgba(57,229,140,.42);border-radius:11px;background:rgba(0,255,125,.055);color:#bfffdc;font-size:12.5px;font-weight:800;line-height:1.45}
      .sc-postguard[data-state="working"]{border-color:rgba(242,176,74,.55);background:rgba(78,53,10,.34);color:#ffe0ad}
      .sc-postguard[data-state="failed"]{border-color:rgba(255,91,98,.55);background:rgba(120,18,24,.2);color:#ffd3d5}
      .simple-postrepair-busy #scRows{opacity:.42;pointer-events:none}
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

  function countTris(model) {
    let n = 0;
    model?.traverse?.(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      n += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
    });
    return n;
  }

  function fmt(n) { return new Intl.NumberFormat().format(Math.round(Number(n) || 0)); }
  function stlMb(tris) { return (84 + 50 * Math.max(0, tris || 0)) / 1048576; }
  function fmtMb(mb) { return mb >= 10 ? `${Math.round(mb)} MB` : mb >= 0.1 ? `${mb.toFixed(1)} MB` : '<0.1 MB'; }

  // Meshopt changes triangle connectivity. Recalculate preview normals once the candidate is settled;
  // otherwise a heavily reduced print preview can look unnaturally dark even though the shape is fine.
  function refreshNormals(model) {
    model?.traverse?.(o => {
      const g = o?.isMesh ? o.geometry : null;
      if (!g?.attributes?.position) return;
      try {
        g.computeVertexNormals();
        if (g.attributes.normal) g.attributes.normal.needsUpdate = true;
      } catch (err) { console.warn(`[SHRINK 3D ${RELEASE}] Could not refresh preview normals`, err); }
    });
  }

  async function solidCheck(model) {
    const fuse = window.__shrinkFuse?.modelToSolid;
    if (!fuse || !model) return { ok: false, components: 0, message: 'Solid checker is not available.' };
    let built = null;
    try {
      built = await fuse(model);
      return { ok: (built?.components || 0) >= 1, components: built?.components || 0, message: '' };
    } catch (err) {
      return { ok: false, components: 0, message: err?.message || String(err) };
    } finally {
      try { built?.solid?.delete?.(); } catch {}
    }
  }

  function candidateRatios(start) {
    const out = [];
    let r = Math.max(0.01, Math.min(0.99, start));
    while (r < 0.999 && out.length < 7) {
      r = Math.min(1, Math.max(r + 0.05, r * 1.5));
      if (!out.length || Math.abs(r - out[out.length - 1]) > 0.01) out.push(r);
      if (r >= 0.999) break;
    }
    if (!out.some(x => x >= 0.999)) out.push(1);
    return out;
  }

  function setSliderOnly(ratio) {
    const pct = (ratio * 100).toFixed(1);
    if ($('geometry')) $('geometry').value = pct;
    if ($('scDetailRange')) $('scDetailRange').value = pct;
    if ($('scTuneVal')) $('scTuneVal').textContent = `${pct}%`;
  }

  function removeOldRepairWarning() {
    document.querySelectorAll('#scRows .sc-row').forEach(row => {
      if (row.querySelector('[data-act="repair"], [data-act="rebuild"]')) row.remove();
    });
  }

  function updateVisibleResult(result, startPct, passed) {
    const title = $('scResultTitle');
    if (title) title.textContent = passed ? 'Ready to print' : 'Needs attention';
    if (!passed) return;

    removeOldRepairWarning();
    const before = result?.shrink?.before || 0;
    const after = result?.shrink?.after || 0;
    const pct = result?.shrink?.pct || 100;
    const shrinkRow = [...document.querySelectorAll('#scRows .sc-row')].find(r => /Made it smaller|Kept every detail/i.test(r.querySelector('strong')?.textContent || ''));
    const p = shrinkRow?.querySelector('p');
    if (p && before && after) {
      p.textContent = `${fmt(before)} triangles down to ${fmt(after)} (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%). File ≈ ${fmtMb(stlMb(before))} → ${fmtMb(stlMb(after))}. Looks the same when printed.`;
    }

    let clean = $('scPostCleanRow');
    if (!clean) {
      clean = document.createElement('div');
      clean.id = 'scPostCleanRow';
      clean.className = 'sc-row sc-row-ok';
      clean.innerHTML = '<span style="font-size:22px;color:#39e58c">✓</span><div class="sc-row-main"><strong>Reduced mesh is clean</strong><p></p></div>';
      $('scRows')?.appendChild(clean);
    }
    const cleanP = clean.querySelector('p');
    if (cleanP) cleanP.textContent = `The first ${Math.round(startPct)}% reduction was too aggressive structurally, so SHRINK kept ${Math.round(pct)}% instead. This version passed the final solid check.`;
  }

  async function trySaferReduction(result, ratio, startPct) {
    const live = window.__shrinkLive;
    if (!live?.runExact) throw new Error('The live reducer is not available.');
    const opts = { protectKeep: window.__shrinkPrint?.getReduceOptions?.().protectKeep ?? 1 };
    const shown = Math.round(ratio * 100);
    banner('working', `Final mesh check: ${Math.round(startPct)}% was too aggressive. Trying a safer ${shown}%…`);
    await live.runExact(ratio, opts);
    setSliderOnly(ratio);
    await wait(30);

    const model = app()?.optimizedModel || live.root;
    refreshNormals(model);
    const check = await solidCheck(model);
    if (!check.ok) return false;

    const after = countTris(model);
    const before = result?.shrink?.before || after;
    if (result?.shrink) {
      result.shrink.after = after;
      result.shrink.pct = before ? (after / before) * 100 : ratio * 100;
      result.shrink.text = 'Looks the same when printed';
    }
    result.repair = {
      state: check.components === 1 ? 'ok' : 'pieces',
      components: check.components,
      message: '',
      postReductionBackoff: true
    };
    app()?.show?.('optimized');
    updateVisibleResult(result, startPct, true);
    banner('ok', `✓ Final mesh check passed. SHRINK kept ${Math.round(result.shrink.pct)}% instead of ${Math.round(startPct)}% so the reduced model stays clean.`);
    return true;
  }

  async function runGuard() {
    queued = false;
    if (running || !active()) return;
    const a = api();
    const result = a?.state?.result;
    const repair = result?.repair;
    if (!result || a.state?.stage !== 'result' || repair?.state !== 'needs' || a.state?.repairBusy) return;
    if (attempted.has(result)) return;
    attempted.add(result);
    running = true;
    body.classList.add('simple-postrepair-busy');

    const startRatio = Math.max(0.01, Math.min(1, (result.shrink?.pct || Number($('geometry')?.value) || 100) / 100));
    const startPct = startRatio * 100;
    refreshNormals(app()?.optimizedModel);
    banner('working', 'Final mesh check: the smallest visual reduction was too aggressive structurally. Finding the smallest clean version automatically…');

    let passed = false;
    let lastMessage = repair?.message || '';
    try {
      for (const ratio of candidateRatios(startRatio)) {
        if (!active() || a.state?.stage !== 'result') return;
        passed = await trySaferReduction(result, ratio, startPct);
        if (passed) break;
        const check = await solidCheck(app()?.optimizedModel || window.__shrinkLive?.root);
        lastMessage = check.message || lastMessage;
        await wait(20);
      }

      if (!passed) {
        updateVisibleResult(result, startPct, false);
        banner('failed', 'This model still needs attention even at a safer reduction. The stronger repair option is available below.');
        if (result?.repair) {
          result.repair.state = 'repairFailed';
          result.repair.repairNote = lastMessage || 'The reduced model did not pass the final solid check.';
        }
      }
    } catch (err) {
      console.warn(`[SHRINK 3D ${RELEASE}] Topology-aware reduction backoff failed`, err);
      updateVisibleResult(result, startPct, false);
      banner('failed', 'The final clean-mesh search could not finish. The stronger repair option is available below.');
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
    window.addEventListener('shrink:live-updated', schedule);
    window.addEventListener('shrink:optimized', schedule);
    schedule();
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
  setTimeout(() => clearInterval(timer), 15000);
  if (document.readyState !== 'loading') install(); else document.addEventListener('DOMContentLoaded', install, { once: true });

  window.__shrinkPostReduce = { run: runGuard, refreshNormals, version: RELEASE };
})();
