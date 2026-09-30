// Shrink multi-step 3D paint undo history.
// Captures the full texture snapshot already requested by paint3d.js at the start of each stroke,
// then compresses it so multiple undo levels do not keep huge raw ImageData buffers alive.
(() => {
  const MAX_UNDOS = 20;
  const viewer = document.getElementById('viewer');
  const textureCanvas = document.getElementById('textureCanvas');
  const textureSelect = document.getElementById('textureSelect');
  const applyBtn = document.getElementById('applyTextureBtn');
  const status = document.getElementById('status');
  const history = [];
  let restoring = false;
  let undoBtn = null;

  function say(message, error = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function updateButton() {
    if (!undoBtn) return;
    undoBtn.disabled = history.length === 0 || restoring;
    undoBtn.textContent = history.length ? `Undo (${history.length})` : 'Undo';
    undoBtn.title = history.length
      ? `${history.length} paint ${history.length === 1 ? 'stroke' : 'strokes'} available to undo (maximum ${MAX_UNDOS})`
      : `Undo up to ${MAX_UNDOS} paint strokes`;
  }

  function clearHistory() {
    history.length = 0;
    updateButton();
  }

  function imageDataToBlob(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    if ('OffscreenCanvas' in window) {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);
      return canvas.convertToBlob({ type: 'image/png' });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create undo snapshot.')), 'image/png');
    });
  }

  const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh, ...rest) {
    const imageData = nativeGetImageData.call(this, sx, sy, sw, sh, ...rest);
    if (!restoring &&
        viewer?.classList.contains('direct-paint') &&
        this.canvas === textureCanvas &&
        sx === 0 && sy === 0 &&
        sw === textureCanvas.width && sh === textureCanvas.height &&
        sw > 1 && sh > 1) {
      history.push({
        textureIndex: Number(textureSelect?.value ?? 0),
        width: sw,
        height: sh,
        blobPromise: imageDataToBlob(imageData)
      });
      while (history.length > MAX_UNDOS) history.shift();
      updateButton();
    }
    return imageData;
  };

  async function undo() {
    if (!history.length || restoring) return;
    const entry = history.pop();
    restoring = true;
    updateButton();
    try {
      if (Number(textureSelect?.value ?? 0) !== entry.textureIndex) {
        throw new Error('Undo history belongs to a different texture.');
      }
      const blob = await entry.blobPromise;
      const bitmap = await createImageBitmap(blob);
      const ctx = textureCanvas.getContext('2d', { willReadFrequently: true });
      if (textureCanvas.width !== entry.width || textureCanvas.height !== entry.height) {
        textureCanvas.width = entry.width;
        textureCanvas.height = entry.height;
      }
      ctx.clearRect(0, 0, entry.width, entry.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      window.dispatchEvent(new CustomEvent('shrink:undo-restored', { detail: { textureIndex: entry.textureIndex } }));
      say(`Undo complete · ${history.length} ${history.length === 1 ? 'undo' : 'undos'} remaining.`);
    } catch (err) {
      console.warn('Multi-step undo failed:', err);
      say(`Could not undo: ${err.message}`, true);
    } finally {
      restoring = false;
      updateButton();
    }
  }

  function installUndoButton() {
    const button = document.getElementById('undo3DBtn');
    if (!button) return false;
    undoBtn = button;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      undo();
    }, true);
    updateButton();
    return true;
  }

  if (!installUndoButton()) {
    const observer = new MutationObserver(() => {
      if (installUndoButton()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  textureSelect?.addEventListener('change', clearHistory);
  applyBtn?.addEventListener('click', clearHistory);
  document.getElementById('newFileBtn')?.addEventListener('click', clearHistory);

  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' &&
        viewer?.classList.contains('direct-paint') && history.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      undo();
    }
  }, true);
})();