// SHRINK 3D v2.23 — automatic post-reduction mesh tidy for Simple Print mode.
// If a clean/repaired source becomes non-manifold during reduction, quietly run the
// conservative repair on the reduced copy. Only show the stronger/manual warning if that fails.
(() => {
  const RELEASE = '2.23';
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

  function ensureStyle() {
    if ($('simplePostReduceStyle')) return;
    const style = document.createElement('style');
    style.id = 'simplePostReduceStyle';
    style.textContent = `
      .sc-postguard{margin:0 0 12px;padding:11px 13px;border:1px solid rgba(57,229,140,.42);border-radius:11px;background:rgba(0,255,125,.055);color:#bfffdc;font-size:12.5px;font-weight:800;line-height:1.45}
      .sc-postguard[data-state="working"]{border-color:rgba(242,176,74,.55);background:rgba(78,53,10,.34);color:#ffe0ad}
      .sc-postguard[data-state="failed"]{border-color:rgba(255,91,98,.55);background:rgba(120,18,24,.2);color:#ffd3d5}
      .simple-postrepair-busy #scRows{display:none!important}
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

  function clearBanner() { $('scPostGuard')?.remove(); }

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
    banner('working', 'Final mesh check: reduction left a few topology faults. SHRINK is tidying the reduced copy automatically…');

    try {
      let btn = null;
      for (let i = 0; i < 40; i++) {
        btn = document.querySelector('#simpleCard [data-act="repair"]');
        if (btn && !btn.disabled) break;
        await wait(50);
      }
      if (!btn || btn.disabled) throw new Error('The automatic tidy control was not available.');
      btn.click();

      for (let i = 0; i < 600; i++) {
        await wait(50);
        if (!a.state?.repairBusy && result.repair?.state !== 'needs') break;
      }

      const state = result.repair?.state;
      if (state === 'repaired' || state === 'ok' || state === 'pieces' || state === 'rebuilt') {
        banner('ok', '✓ Reduced model passed the final mesh check — tiny reduction faults were tidied automatically.');
      } else {
        banner('failed', 'The reduced mesh still needs attention. Automatic tidy could not fix it, so the stronger repair options are shown below.');
      }
    } catch (err) {
      console.warn(`[SHRINK 3D ${RELEASE}] Automatic post-reduction tidy failed`, err);
      banner('failed', 'The reduced mesh still needs attention. Automatic tidy could not finish, so the repair options are shown below.');
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

  window.__shrinkPostReduce = { run: runGuard, version: RELEASE };
})();
