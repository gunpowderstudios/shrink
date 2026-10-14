// SHRINK 3D v2.83 — keeps the navigation hint inside the 3D canvas area.
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

  // Drag handle on the bottom edge of the viewer panel: drag down to make the 3D view taller, double-click to reset.
  const panel = viewer.closest('.viewer-panel');
  if (panel && !panel.querySelector('.viewer-grip')) {
    const grip = document.createElement('div');
    grip.className = 'viewer-grip'; grip.title = 'Drag to make the 3D view taller or shorter · double-click to reset';
    panel.appendChild(grip);
    let startY = 0, startH = 0, drag = false;
    grip.addEventListener('pointerdown', e => { drag = true; startY = e.clientY; startH = panel.getBoundingClientRect().height; grip.classList.add('dragging'); try { grip.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      const h = Math.max(360, Math.min(window.innerHeight * 2.5, startH + (e.clientY - startY)));
      panel.style.setProperty('height', `${Math.round(h)}px`, 'important');
    });
    const end = () => { drag = false; grip.classList.remove('dragging'); };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => panel.style.removeProperty('height'));
  }
})();
