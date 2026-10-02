const viewer = document.getElementById('viewer');

function paintingMode() {
  return viewer?.classList.contains('direct-paint') || viewer?.classList.contains('direct-sample');
}

function installRotationLock() {
  const canvas = viewer?.querySelector('canvas');
  if (!canvas) return requestAnimationFrame(installRotationLock);

  const block = (event) => {
    if (!paintingMode()) return;
    // Hold Cmd on Mac or Ctrl on Windows to temporarily use OrbitControls.
    if (event.metaKey || event.ctrlKey || viewer.classList.contains('modifier-rotate')) return;
    event.stopImmediatePropagation();
  };

  canvas.addEventListener('pointerdown', block, true);
  canvas.addEventListener('pointermove', block, true);
  canvas.addEventListener('pointerup', block, true);
  canvas.addEventListener('pointercancel', block, true);
  // Wheel is deliberately left alone so zoom continues to work in Paint mode.
}

installRotationLock();