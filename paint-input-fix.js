const viewer = document.getElementById('viewer');

function paintingMode() {
  return viewer?.classList.contains('direct-paint') || viewer?.classList.contains('direct-sample');
}

function installRotationLock() {
  const canvas = viewer?.querySelector('canvas');
  if (!canvas) return requestAnimationFrame(installRotationLock);

  const block = (event) => {
    if (!paintingMode()) return;
    event.stopImmediatePropagation();
  };

  canvas.addEventListener('pointerdown', block, true);
  canvas.addEventListener('pointermove', block, true);
  canvas.addEventListener('pointerup', block, true);
  canvas.addEventListener('pointercancel', block, true);
  canvas.addEventListener('wheel', block, true);
}

installRotationLock();