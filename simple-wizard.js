// SHRINK 3D v2.33 — Simple Print wizard: Check/Repair -> Printer & size -> Reduce -> Prepare/Download.
(() => {
  const RELEASE = '2.33';
  const $ = id => document.getElementById(id);
  const app = () => window.__shrinkApp;
  const simple = () => window.__shrinkSimple;
  const body = document.body;
  let installed = false;
  let syncing = false;
  let reductionReady = false;

  import(`./simple-preflight.js?v=${RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${RELEASE}] Model preflight did not load`, err));
  import(`./simple-postreduce.js?v=${RELEASE}`).catch(err => console.warn(`[SHRINK 3D ${RELEASE}] Post-reduction mesh check did not load`, err));

  function addCss() {
    if (document.querySelector('link[data-shrink-simple-wizard]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `./simple-wizard.css?v=${RELEASE}`;
    link.dataset.shrinkSimpleWizard = 'true';
    document.head.appendChild(link);
  }

  function text(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function active() {
    return body.classList.contains('app-mode-print') && body.classList.contains('ui-simple');
  }

  function installStepper(card) {
    const stepper = card.querySelector('.sc-stepper');
    if (!stepper || stepper.dataset.wizard === RELEASE) return;
    stepper.dataset.wizard = RELEASE;

    const setup = stepper.querySelector('[data-act="goto-setup"]');
    const result = stepper.querySelector('[data-act="goto-result"]');
    if (!setup || !result) return;

    let check = stepper.querySelector('[data-wizard="check"]');
    if (!check) {
      check = document.createElement('span');
      check.className = 'sc-step sc-wizard-step done';
      check.dataset.wizard = 'check';
      check.innerHTML = '<b>1</b><span>Check / repair</span>';
      stepper.insertBefore(check, setup);
    }

    setup.querySelector('b').textContent = '2';
    setup.querySelector('span').textContent = 'Printer & size';

    let reduce = stepper.querySelector('[data-wizard="reduce"]');
    if (!reduce) {
      reduce = document.createElement('span');
      reduce.className = 'sc-step sc-wizard-step';
      reduce.dataset.wizard = 'reduce';
      reduce.innerHTML = '<b>3</b><span>Reduce</span>';
      stepper.insertBefore(reduce, result);
    }

    result.querySelector('b').textContent = '4';
    result.querySelector('span').textContent = 'Download';
  }

  function syncStepper(card) {
    const stage = simple()?.state?.stage || card.dataset.stage || 'setup';
    const reduce = card.querySelector('[data-wizard="reduce"]');
    if (reduce) {
      reduce.classList.toggle('on', stage === 'working');
      reduce.classList.toggle('done', stage === 'result');
    }
  }

  function syncSetupCopy(card) {
    const setup = card.querySelector('.sc-setup');
    if (!setup) return;
    const title = setup.querySelector(':scope > h2');
    const sub = setup.querySelector(':scope > .sc-sub');
    text(title, 'Choose your printer & finished size');
    text(sub, 'Now that the model is healthy, tell SHRINK how you want to print it.');

    const go = $('scGo');
    text(go, 'Make smaller');
    const fine = go?.nextElementSibling;
    if (fine?.classList.contains('sc-fine')) {
      text(fine, 'Makes a sensible smaller print mesh, checks it stays clean, then checks it fits.');
    }
    const loaded = $('scLoadedNext');
    if (loaded) loaded.innerHTML = 'Now press <b>Make smaller</b> below to use them.';
  }

  function syncWorkingCopy() {
    const card = $('simpleCard');
    if (!card) return;
    const h = card.querySelector('.sc-working h2');
    text(h, 'Reducing the model');
    const labels = card.querySelectorAll('#scSteps li > span:last-child');
    const wanted = ['Making a sensible smaller mesh', 'Keeping the mesh structurally clean', 'Checking it fits your printer'];
    labels.forEach((el, i) => { if (wanted[i]) text(el, wanted[i]); });
  }

  function refreshReducedShading() {
    if (!active() || simple()?.state?.stage !== 'result') return;
    window.__shrinkPostReduce?.refreshNormals?.(app()?.optimizedModel);
  }

  function syncLoadedClass() {
    body.classList.toggle('simple-has-model', active() && !!app()?.originalModel);
  }

  function syncViewer() {
    if (!active()) {
      body.classList.remove('simple-reduction-ready');
      reductionReady = false;
      return;
    }
    const stage = simple()?.state?.stage || 'setup';
    const reduced = !!app()?.optimizedModel;
    const ready = stage === 'result' && reduced;
    const working = stage === 'working' && reduced;
    body.classList.toggle('simple-reduction-ready', ready);
    if (ready) refreshReducedShading();
    if (ready || working) app()?.show?.('optimized');
    else if (app()?.originalModel && !body.classList.contains('simple-preflight-blocked')) app()?.show?.('original');
    reductionReady = ready;
  }

  function removeOldGoals() {
    $('scGoalBlock')?.remove();
  }

  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const card = $('simpleCard');
      if (!card) return;
      removeOldGoals();
      installStepper(card);
      syncStepper(card);
      syncSetupCopy(card);
      syncWorkingCopy();
      syncLoadedClass();
      syncViewer();
    } finally {
      syncing = false;
    }
  }

  function install() {
    const card = $('simpleCard');
    if (!card || !simple()) return false;
    if (!installed) {
      installed = true;
      const obs = new MutationObserver(() => requestAnimationFrame(sync));
      obs.observe(card, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-stage'] });
      window.addEventListener('shrink:model-opened', () => { reductionReady = false; setTimeout(sync, 120); });
      window.addEventListener('shrink:ui-level', () => setTimeout(sync, 70));
      window.addEventListener('shrink:ui-mode', () => setTimeout(sync, 70));
      window.addEventListener('shrink:preflight-ready', () => setTimeout(sync, 30));
      window.addEventListener('shrink:preflight-continued', () => { reductionReady = false; app()?.show?.('original'); setTimeout(sync, 30); });
      window.addEventListener('shrink:live-updated', () => {
        if (!active()) return;
        if (simple()?.state?.stage === 'result') refreshReducedShading();
        setTimeout(sync, 20);
      });
      window.addEventListener('shrink:optimized', () => { refreshReducedShading(); setTimeout(sync, 30); });
    }
    sync();
    return true;
  }

  addCss();
  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 80);
  setTimeout(() => clearInterval(timer), 15000);
  if (document.readyState !== 'loading') install(); else document.addEventListener('DOMContentLoaded', install, { once: true });

  window.__shrinkWizard = { version: RELEASE, sync };
})();
