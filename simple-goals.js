// SHRINK 3D v2.19 — plain-English print goals layered over the proven v2.18 Simple engine.
(() => {
  const RELEASE = '2.19';
  const $ = id => document.getElementById(id);
  const storeKey = 'shrink-simple-goal';
  const valid = new Set(['smaller', 'solid', 'both']);
  const saved = (() => { try { return localStorage.getItem(storeKey); } catch { return null; } })();
  let goal = valid.has(saved) ? saved : 'both';
  let installed = false;
  let syncing = false;

  const GOALS = {
    smaller: {
      icon: '✂️', title: 'Make it smaller', note: 'Reduce the triangles. Leave the parts as they are.',
      button: '✨ SHRINK IT — make it smaller',
      help: '<b>Reduce only.</b> SHRINK makes the mesh lighter. It will not fuse parts during a normal one-piece download.'
    },
    solid: {
      icon: '🔗', title: 'Make it one solid', note: 'Join overlapping parts. Keep the original detail.',
      button: '🔗 FUSE IT — make one solid',
      help: '<b>Fuse only.</b> SHRINK keeps 100% of the triangles, checks the model, then repairs/fuses it where possible. A stronger rebuild is only offered if needed.'
    },
    both: {
      icon: '✨', title: 'Do both', note: 'One printable solid and a smaller file.',
      button: '✨ FUSE + SHRINK — make it print-ready',
      help: '<b>Recommended for sculpts.</b> SHRINK reduces first when that is safer for the browser, then checks/repairs the solid before download.'
    }
  };

  function api() { return window.__shrinkSimple; }
  function card() { return $('simpleCard'); }
  function text(el, value) { if (el && el.textContent !== value) el.textContent = value; }
  function html(el, value) { if (el && el.innerHTML !== value) el.innerHTML = value; }

  function addCss() {
    if (document.querySelector('link[data-shrink-simple-goals]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `./simple-goals.css?v=${RELEASE}`;
    link.dataset.shrinkSimpleGoals = 'true';
    document.head.appendChild(link);
  }

  function goalMarkup() {
    return `<section id="scGoalBlock" class="sc-goal-block" aria-label="What do you want SHRINK to do?">
      <div class="sc-goal-head"><h2>What do you want to do?</h2><small>You can change this any time.</small></div>
      <div class="sc-goals" role="group" aria-label="Print job">
        ${Object.entries(GOALS).map(([id, g]) => `<button type="button" class="sc-goal" data-goal="${id}" aria-pressed="false"><span class="sc-goal-ico" aria-hidden="true">${g.icon}</span><strong>${g.title}</strong><small>${g.note}</small></button>`).join('')}
      </div>
      <p id="scGoalHelp" class="sc-goal-help"></p>
    </section>`;
  }

  function saveGoal() { try { localStorage.setItem(storeKey, goal); } catch {} }

  function setGoal(next, fromUser = false) {
    if (!valid.has(next)) next = 'both';
    goal = next; saveGoal();
    const a = api();
    if (a?.state) a.state.goal = goal;
    if (fromUser && a?.state && !a.state.busy) {
      a.state.result = null;
      a.state.fitChoice = null;
      a.setLevel?.('simple');
    }
    sync();
  }

  function syncWorkingLabels() {
    const list = $('scSteps');
    if (!list) return;
    const spans = list.querySelectorAll('li > span:last-child');
    const labels = goal === 'solid'
      ? ['Keeping all original detail', 'Checking / fusing the solid', 'Checking it fits your printer']
      : goal === 'smaller'
        ? ['Making it smaller', 'Checking the mesh', 'Checking it fits your printer']
        : ['Making it smaller safely', 'Checking / fusing the solid', 'Checking it fits your printer'];
    spans.forEach((el, i) => { if (labels[i]) text(el, labels[i]); });
    const h = document.querySelector('#simpleCard .sc-working h2');
    text(h, goal === 'solid' ? 'Making it one solid' : goal === 'smaller' ? 'Making it smaller' : 'Making it print-ready');
    const note = $('scWorkNote');
    if (goal === 'solid' && /^Keeping 100% of the triangles/i.test(note?.textContent || '')) text(note, 'Keeping all original detail…');
  }

  function syncResultNotes() {
    const a = api(), rows = $('scRows');
    if (!rows || !a?.state?.result) return;
    let note = $('scGoalResultNote');
    const r = a.state.result.repair;
    let value = '';
    if (goal === 'smaller' && r && ['needs', 'repairFailed', 'pieces'].includes(r.state)) {
      value = 'You chose Make it smaller, so SHRINK will not automatically fuse or rebuild this model. The solid check above is just a warning unless you choose one of its repair buttons.';
    } else if ((goal === 'solid' || goal === 'both') && r?.state === 'pieces') {
      value = 'These pieces do not touch. SHRINK will not invent bridges between separate objects, so they stay separate unless you use a stronger rebuild that changes the surface.';
    }
    if (!value) { note?.remove(); return; }
    if (!note) {
      note = document.createElement('div'); note.id = 'scGoalResultNote'; note.className = 'sc-goal-note'; rows.appendChild(note);
    }
    text(note, value);
  }

  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const c = card(); if (!c) return;
      if (c.dataset.goal !== goal) c.dataset.goal = goal;
      c.querySelectorAll('[data-goal]').forEach(b => {
        const on = b.dataset.goal === goal;
        b.classList.toggle('on', on);
        if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      });
      const g = GOALS[goal];
      html($('scGoalHelp'), g.help);
      text($('scGo'), g.button);
      const fine = $('scGo')?.nextElementSibling;
      if (fine?.classList.contains('sc-fine')) {
        text(fine, goal === 'solid'
          ? 'Keeps the original triangle count, checks/fuses the mesh and checks it fits. Your original file is never changed.'
          : goal === 'smaller'
            ? 'Reduces the file and checks it fits. The mesh is not fused during a normal one-piece download.'
            : 'Makes the file smaller, checks/repairs the solid and checks it fits. Your original file is never changed.');
      }
      const loadedNext = $('scLoadedNext');
      html(loadedNext, `Now press <b>${goal === 'solid' ? 'FUSE IT' : goal === 'smaller' ? 'SHRINK IT' : 'FUSE + SHRINK'}</b> below to use them.`);
      syncWorkingLabels();
      syncResultNotes();
      text(document.querySelector('.version-badge'), `v${RELEASE}`);
    } finally { syncing = false; }
  }

  async function runSolidOnly(e) {
    const a = api();
    if (!a?.run || a.state?.busy) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const oldUse = a.state.usePercent;
    const oldSaved = a.state.savedReduction;
    a.state.usePercent = true;
    a.state.savedReduction = { keepPercent: 100, triangles: 0, ofTriangles: 0, tuned: false, _goalOnly: true };
    try { await a.run(); }
    finally {
      a.state.usePercent = oldUse;
      a.state.savedReduction = oldSaved;
      sync();
    }
  }

  function protectShrinkOnlyDownload(e) {
    if (goal !== 'smaller') return;
    const dl = e.target.closest?.('#scDownload'); if (!dl) return;
    const a = api(), r = a?.state?.result?.repair;
    const oldState = r?.state;
    // The v2.18 downloader fuses when repair.state === "ok". Temporarily make that false so
    // "Make it smaller" really is reduction-only for a normal one-piece export.
    if (r) r.state = 'goal-smaller';
    const fuse = $('fuseSolidToggle'); if (fuse) fuse.checked = false;
    setTimeout(() => { if (r && oldState) r.state = oldState; syncResultNotes(); }, 80);
  }

  function install() {
    const c = card(), a = api();
    if (!c || !a) return false;
    if (!$('scGoalBlock')) {
      const setup = c.querySelector('.sc-setup');
      if (!setup) return false;
      setup.insertAdjacentHTML('afterbegin', goalMarkup());
    }
    if (!installed) {
      installed = true;
      c.addEventListener('click', e => {
        const b = e.target.closest('[data-goal]');
        if (b && c.contains(b)) { e.preventDefault(); setGoal(b.dataset.goal, true); }
      });
      document.addEventListener('click', e => {
        if (goal === 'solid' && e.target.closest?.('#scGo')) runSolidOnly(e);
        protectShrinkOnlyDownload(e);
      }, true);
      const obs = new MutationObserver(() => requestAnimationFrame(sync));
      obs.observe(c, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-stage'] });
      window.addEventListener('shrink:model-opened', () => setTimeout(sync, 120));
      window.addEventListener('shrink:ui-level', () => setTimeout(sync, 60));
    }
    setGoal(goal, false);
    return true;
  }

  addCss();
  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 80);
  setTimeout(() => clearInterval(timer), 15000);
  if (document.readyState !== 'loading') install(); else document.addEventListener('DOMContentLoaded', install, { once: true });

  window.__shrinkGoals = { get goal() { return goal; }, setGoal, version: RELEASE };
})();
