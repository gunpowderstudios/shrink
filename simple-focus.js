// SHRINK 3D v2.25 — keep Simple Print simple and responsive.
// Simple mode uses a sensible print target instead of the exhaustive "absolute smallest" search.
// The exhaustive/manual controls still exist in Tools (Advanced) mode.
(() => {
  const RELEASE = '2.25';
  const $ = id => document.getElementById(id);
  const body = document.body;
  const simple = () => window.__shrinkSimple;
  const app = () => window.__shrinkApp;

  const TARGETS = {
    max:      { target: 450000, floor: 0.42 },
    best:     { target: 320000, floor: 0.30 },
    balanced: { target: 240000, floor: 0.22 },
    small:    { target: 170000, floor: 0.16 }
  };

  function active() {
    return body.classList.contains('app-mode-print') && body.classList.contains('ui-simple');
  }

  function setNative(id, value, event = 'change') {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  }

  function suggestedKeep(triangles) {
    const s = simple()?.state;
    if (!(triangles > 0)) return 100;
    let key = s?.detail || 'best';
    if (key === 'custom') {
      const mm = Number(s?.customMm) || 0.05;
      key = mm <= 0.03 ? 'max' : mm <= 0.075 ? 'best' : mm <= 0.15 ? 'balanced' : 'small';
    }
    const p = TARGETS[key] || TARGETS.best;
    if (triangles <= p.target * 1.12) return 100;
    let ratio = Math.max(p.floor, p.target / triangles);
    if (ratio > 0.86) return 100;
    ratio = Math.min(0.86, Math.max(0.08, ratio));
    return Math.round(ratio * 1000) / 10;
  }

  function renameTools() {
    const adv = document.querySelector('#uiLevelToggle [data-level="advanced"]');
    if (adv && adv.textContent !== 'Tools') adv.textContent = 'Tools';
    document.querySelectorAll('#simpleCard [data-act="advanced"]').forEach(btn => {
      if (/advanced/i.test(btn.textContent || '')) btn.textContent = 'Open Tools ›';
    });
  }

  function markLoaded() {
    body.classList.toggle('simple-has-model', !!app()?.originalModel && active());
    renameTools();
  }

  function normalizeWorkingText() {
    const n = $('scWorkNote');
    if (!n) return;
    const t = n.textContent || '';
    if (/saved settings/i.test(t)) n.textContent = 'Using a sensible print target first — fast, safe and usually more than small enough.';
    else if (/smallest version/i.test(t)) n.textContent = 'Making a sensible smaller version without overworking the browser…';
  }

  async function runSimpleFast(e) {
    if (!active() || e.target?.id !== 'scGo') return;
    const api = simple();
    const s = api?.state;
    const live = window.__shrinkLiveUI;
    if (!api?.run || !s || s.busy) return;

    // If the user explicitly loaded settings and ticked "use the same amount", honour that.
    const manualSame = !!(s.usePercent && s.savedReduction?.keepPercent > 0);
    if (manualSame) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const tris = Number(live?.state?.tris) || 0;
    const keep = suggestedKeep(tris);
    const oldUse = s.usePercent;
    const oldSaved = s.savedReduction;
    s.usePercent = true;
    s.savedReduction = { keepPercent: keep, triangles: 0, ofTriangles: tris, tuned: false, autoSimple: true };

    requestAnimationFrame(() => {
      const n = $('scWorkNote');
      if (n) n.textContent = keep >= 99.5
        ? 'This model is already a sensible size for the selected print quality. Keeping the full mesh.'
        : `Starting with ${keep}% of the triangles — enough for the selected print quality without an exhaustive search.`;
    });

    try { await api.run(); }
    finally {
      s.usePercent = oldUse;
      s.savedReduction = oldSaved;
      normalizeWorkingText();
    }
  }

  function downloadSimple(e) {
    if (!active() || e.target?.id !== 'scDownload') return;
    const s = simple()?.state;
    if (!s?.result) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const f = s.result.fit;
    const splitting = s.fitChoice === 'split' && f?.state === 'tall';
    if (splitting) {
      setNative('splitMode', 'max');
      setNative('splitMaxHeight', f.maxPart, 'input');
      setNative('splitJoint', 'pegs');
    } else setNative('splitMode', 'off');

    // Simple mode does not Boolean-fuse by default. A mesh that passed Repair can go straight to a slicer;
    // Fuse remains available in Tools for people who deliberately want one unioned shell.
    const fuse = $('fuseSolidToggle');
    if (fuse) { fuse.checked = false; fuse.dispatchEvent(new Event('change', { bubbles: true })); }
    setNative('zUpToggle', true);
    $('saveStlBtn')?.click();
  }

  function install() {
    document.addEventListener('click', runSimpleFast, true);
    document.addEventListener('click', downloadSimple, true);
    window.addEventListener('shrink:model-opened', () => setTimeout(markLoaded, 80));
    window.addEventListener('shrink:ui-mode', () => setTimeout(markLoaded, 50));
    window.addEventListener('shrink:ui-level', () => setTimeout(markLoaded, 50));
    const note = $('scWorkNote');
    if (note) new MutationObserver(normalizeWorkingText).observe(note, { childList: true, characterData: true, subtree: true });
    new MutationObserver(renameTools).observe(document.body, { childList: true, subtree: true });
    markLoaded();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.__shrinkSimpleFocus = { suggestedKeep, version: RELEASE };
})();
