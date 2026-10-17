const viewer = document.getElementById('viewer');
const brushSize = document.getElementById('brushSize');
const textureCanvas = document.getElementById('textureCanvas');

const ring = document.createElement('div');
ring.className = 'brush-ring-3d';
viewer?.appendChild(ring);

const style = document.createElement('style');
style.textContent = `
.brush-ring-3d{position:absolute;z-index:30;border:2px solid white;border-radius:50%;box-shadow:0 0 0 1px black;pointer-events:none;transform:translate(-50%,-50%);display:none}
.viewer.direct-paint .brush-ring-3d{display:block}
.viewer.direct-paint.modifier-rotate .brush-ring-3d{display:none}
`;
document.head.appendChild(style);

// The ring is exactly as wide, in screen pixels, as the Brush size slider says (the paint dab uses the same number: ringRadiusPx in paint3d.js).
function updateSize() {
  const px = Math.max(4, Number(brushSize?.value || 32));
  ring.style.width = `${px}px`;
  ring.style.height = `${px}px`;
}

function updatePosition(event) {
  if (!viewer?.classList.contains('direct-paint')) return;
  const rect = viewer.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  ring.style.display = inside && !viewer.classList.contains('modifier-rotate') ? 'block' : 'none';
  if (!inside) return;
  ring.style.left = `${event.clientX - rect.left}px`;
  ring.style.top = `${event.clientY - rect.top}px`;
}

// Listen at document capture level so the ring still tracks even when paint mode blocks OrbitControls events.
document.addEventListener('pointermove', updatePosition, true);
document.addEventListener('pointerleave', () => { ring.style.display = 'none'; }, true);
brushSize?.addEventListener('input', updateSize);
brushSize?.addEventListener('change', updateSize);
document.addEventListener('pointerdown', updateSize, true);
window.addEventListener('resize', updateSize);
updateSize();