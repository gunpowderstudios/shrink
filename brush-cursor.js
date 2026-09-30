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
`;
document.head.appendChild(style);

function updateSize() {
  const viewWidth = viewer?.clientWidth || 700;
  const textureWidth = textureCanvas?.width || 2048;
  const size = Number(brushSize?.value || 32);
  const px = Math.max(8, Math.min(140, size * viewWidth / textureWidth));
  ring.style.width = `${px}px`;
  ring.style.height = `${px}px`;
}

viewer?.addEventListener('pointermove', (event) => {
  if (!viewer.classList.contains('direct-paint')) return;
  const rect = viewer.getBoundingClientRect();
  ring.style.left = `${event.clientX - rect.left}px`;
  ring.style.top = `${event.clientY - rect.top}px`;
});

brushSize?.addEventListener('input', updateSize);
updateSize();