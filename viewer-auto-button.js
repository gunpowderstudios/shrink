// SHRINK 3D v2.26 — prominent duplicate of the game auto-reduce action beneath the 3D viewer.
// Keep the viewer-help pill inside the actual canvas area so it can never overlap the large action button.
(() => {
  const source = document.getElementById('autoBtn');
  const viewerHelp = document.querySelector('.viewer-help');
  const viewer = document.getElementById('viewer');
  if (!source || !viewerHelp || !viewer) return;

  // The base HTML places viewer-help after #viewer. Move it into the viewer so its absolute
  // bottom position is relative to the canvas area, not the whole panel/button stack.
  if (viewerHelp.parentElement !== viewer) viewer.appendChild(viewerHelp);

  let wrap = document.querySelector('.viewer-auto-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'viewer-auto-wrap';
    wrap.innerHTML = '<button id="viewerAutoBtn" class="viewer-auto-btn" type="button">✨ Find the smallest that still looks the same</button>';
    viewer.insertAdjacentElement('afterend', wrap);
  }

  if (!document.getElementById('viewerAutoStyle')) {
    const style = document.createElement('style');
    style.id = 'viewerAutoStyle';
    style.textContent = `
      .viewer-auto-wrap{flex:0 0 auto;padding:12px 0 0;margin:0}
      .viewer-auto-btn{width:100%;min-height:64px;border:2px solid #ff4e55;border-radius:16px;background:linear-gradient(180deg,rgba(255,78,85,.16),rgba(255,78,85,.08));color:#fff;font:800 20px/1.2 inherit;letter-spacing:-.2px;cursor:pointer;box-shadow:0 0 0 1px rgba(255,78,85,.06) inset;transition:transform .12s ease,background .12s ease,border-color .12s ease,opacity .12s ease}
      .viewer-auto-btn:hover:not(:disabled){background:linear-gradient(180deg,rgba(255,78,85,.26),rgba(255,78,85,.12));transform:translateY(-1px)}
      .viewer-auto-btn:active:not(:disabled){transform:translateY(0)}
      .viewer-auto-btn:disabled{opacity:.48;cursor:wait}
      .viewer>.viewer-help{z-index:25;bottom:14px}
      @media(max-width:760px){.viewer-auto-btn{min-height:56px;font-size:17px}.viewer-auto-wrap{padding-top:9px}.viewer>.viewer-help{bottom:10px}}
    `;
    document.head.appendChild(style);
  }

  const button = document.getElementById('viewerAutoBtn');
  if (!button || button.dataset.shrinkWired === 'true') return;
  button.dataset.shrinkWired = 'true';

  const sync = () => {
    button.disabled = !!source.disabled;
    button.setAttribute('aria-busy', source.disabled ? 'true' : 'false');
  };
  sync();
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['disabled'] });
  button.addEventListener('click', () => {
    if (!source.disabled) source.click();
  });
})();
