// SHRINK 3D v2.80 — keeps the navigation hint inside the 3D canvas area.
// The big red "Find the smallest…" button that used to sit under the viewer was removed in v2.80: the same button lives in the
// left panel, and the viewer now uses the full height of the window. (The file name is kept so the page's script tag stays valid.)
(() => {
  const viewerHelp = document.querySelector('.viewer-help');
  const viewer = document.getElementById('viewer');
  if (!viewerHelp || !viewer) return;
  if (viewerHelp.parentElement !== viewer) viewer.appendChild(viewerHelp);
  document.querySelectorAll('.viewer-auto-wrap').forEach(w => w.remove());
  if (!document.getElementById('viewerAutoStyle')) {
    const style = document.createElement('style');
    style.id = 'viewerAutoStyle';
    style.textContent = '.viewer>.viewer-help{z-index:25;bottom:14px}@media(max-width:760px){.viewer>.viewer-help{bottom:10px}}';
    document.head.appendChild(style);
  }
})();
