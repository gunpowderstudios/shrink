// SHRINK 3D v1.86 — print protection must never affect Game model saves.
(() => {
  const VERSION = '2.07';
  let wrappedApi = null;

  function install() {
    const api = window.__shrinkPrint;
    if (!api?.getReduceOptions || api === wrappedApi || api.__gameProtectionFix186) return false;

    const nativeGetReduceOptions = api.getReduceOptions.bind(api);
    api.getReduceOptions = (...args) => {
      const mode = window.__shrinkUI?.getMode?.() || 'game';
      if (mode !== 'print') {
        return { dabs: [], protectKeep: 1 };
      }
      return nativeGetReduceOptions(...args) || { dabs: [], protectKeep: 1 };
    };

    api.__gameProtectionFix186 = true;
    wrappedApi = api;
    console.info(`[SHRINK 3D ${VERSION}] Game saves ignore Print Protect-detail masks.`);
    return true;
  }

  install();
  window.addEventListener('shrink:model-opened', install);
  window.addEventListener('shrink:ui-mode', install);

  const observer = new MutationObserver(() => install());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let tries = 0;
  const timer = setInterval(() => {
    if (install() || ++tries > 100) clearInterval(timer);
  }, 50);
})();
