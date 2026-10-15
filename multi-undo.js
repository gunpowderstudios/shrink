// Shrink multi-step 3D paint undo history.
// Captures the full texture snapshot already requested by paint3d.js at the start of each stroke,
// then compresses it so multiple undo levels do not keep huge raw ImageData buffers alive.
(() => {
  const MAX_UNDOS = 20;      // and the same number of redos
  const viewer = document.getElementById('viewer');
  const textureCanvas = document.getElementById('textureCanvas');
  const textureSelect = document.getElementById('textureSelect');
  const applyBtn = document.getElementById('applyTextureBtn');
  const status = document.getElementById('status');
  const history = [];
  const redoStack = [];     // strokes that were undone; any new stroke empties it
  let redoBtn = null;
  let restoring = false;
  let serialCounter = 0;      // every undo step gets a number so other tools (the bumps layer in paint3d.js) can keep their own part of it
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

  function updateRedo() {
    if (!redoBtn) return;
    redoBtn.disabled = redoStack.length === 0 || restoring;
    redoBtn.textContent = redoStack.length ? `Redo (${redoStack.length})` : 'Redo';
    redoBtn.title = redoStack.length ? `${redoStack.length} undone ${redoStack.length === 1 ? 'stroke' : 'strokes'} can be redone (Ctrl/Cmd+Shift+Z)` : 'Nothing to redo';
  }

  function clearHistory() {
    history.length = 0;
    redoStack.length = 0;
    updateButton(); updateRedo();
    window.dispatchEvent(new CustomEvent('shrink:paint-redo-cleared'));
    window.dispatchEvent(new CustomEvent('shrink:paint-undo-cleared'));
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

  // paint3d.js already calls getImageData(0, 0, fullWidth, fullHeight) immediately
  // before each 3D stroke. Hook that exact capture so the undo image is guaranteed to
  // belong to the texture that is actually being painted, even when direct paint auto-selects it.
  const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh, ...rest) {
    const imageData = nativeGetImageData.call(this, sx, sy, sw, sh, ...rest);

    if (!restoring &&
        viewer?.classList.contains('direct-paint') &&
        this.canvas === textureCanvas &&
        sx === 0 && sy === 0 &&
        sw === textureCanvas.width && sh === textureCanvas.height &&
        sw > 1 && sh > 1) {
      const entry = {
        textureIndex: Number(textureSelect?.value ?? 0),
        width: sw,
        height: sh,
        blobPromise: imageDataToBlob(imageData),
        serial: ++serialCounter
      };
      window.__shrinkUndoSerial = entry.serial;
      history.push(entry);
      while (history.length > MAX_UNDOS) history.shift();
      if (redoStack.length) { redoStack.length = 0; window.dispatchEvent(new CustomEvent('shrink:paint-redo-cleared')); }
      updateButton(); updateRedo();
    }

    return imageData;
  };

  function refreshLiveTexture() {
    const scene = window.__shrinkViewer?.scene;
    if (!scene) return;
    scene.traverse(object => {
      if (!object?.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (material?.map?.image === textureCanvas) {
          material.map.needsUpdate = true;
          material.needsUpdate = true;
        }
      });
    });
  }

  // Put a saved picture back on the texture. The picture that is there NOW is kept on the opposite stack first, so the step can be reversed.
  async function step(from, to, eventName, word) {
    if (!from.length || restoring) return;
    const entry = from.pop();
    restoring = true;
    updateButton(); updateRedo();

    try {
      // History is intentionally per texture. A texture change clears the history, so this
      // should normally already match, but keep the guard for safety.
      if (Number(textureSelect?.value ?? 0) !== entry.textureIndex) {
        throw new Error(`${word} history belongs to a different texture.`);
      }
      const ctx = textureCanvas.getContext('2d', { willReadFrequently: true });
      const nowData = nativeGetImageData.call(ctx, 0, 0, textureCanvas.width, textureCanvas.height);
      const counterpart = { textureIndex: entry.textureIndex, width: nowData.width, height: nowData.height, blobPromise: imageDataToBlob(nowData), serial: entry.serial };

      const blob = await entry.blobPromise;
      const bitmap = await createImageBitmap(blob);
      if (textureCanvas.width !== entry.width || textureCanvas.height !== entry.height) {
        textureCanvas.width = entry.width;
        textureCanvas.height = entry.height;
      }
      ctx.clearRect(0, 0, entry.width, entry.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      to.push(counterpart);
      while (to.length > MAX_UNDOS) to.shift();
      refreshLiveTexture();
      window.dispatchEvent(new CustomEvent(eventName, { detail: { serial: entry.serial } }));
      say(`${word} complete · ${history.length} ${history.length === 1 ? 'undo' : 'undos'}, ${redoStack.length} ${redoStack.length === 1 ? 'redo' : 'redos'} available.`);
    } catch (err) {
      console.warn(`Multi-step ${word.toLowerCase()} failed:`, err);
      say(`Could not ${word.toLowerCase()}: ${err.message}`, true);
    } finally {
      restoring = false;
      updateButton(); updateRedo();
    }
  }
  const undo = () => step(history, redoStack, 'shrink:paint-undo', 'Undo');
  const redo = () => step(redoStack, history, 'shrink:paint-redo', 'Redo');

  function installUndoButton() {
    const button = document.getElementById('undo3DBtn');
    if (!button) return false;
    undoBtn = button;

    // Capture phase replaces paint3d.js's original one-level Undo click handler.
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      undo();
    }, true);
    if (!redoBtn) {
      redoBtn = document.createElement('button');
      redoBtn.id = 'redo3DBtn'; redoBtn.type = 'button'; redoBtn.className = button.className; redoBtn.textContent = 'Redo'; redoBtn.disabled = true;
      button.insertAdjacentElement('afterend', redoBtn);
      redoBtn.addEventListener('click', () => redo());
    }
    updateButton(); updateRedo();
    return true;
  }

  if (!installUndoButton()) {
    const observer = new MutationObserver(() => {
      if (installUndoButton()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Keep history coherent: each texture gets its own sequence, and applying commits it.
  textureSelect?.addEventListener('change', clearHistory);
  applyBtn?.addEventListener('click', clearHistory);
  document.getElementById('newFileBtn')?.addEventListener('click', clearHistory);

  window.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const t = event.target, typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|color)$/.test(t.type)));
    if (typing) return;
    const k = event.key.toLowerCase();
    const wantRedo = (k === 'z' && event.shiftKey) || k === 'y';
    const wantUndo = k === 'z' && !event.shiftKey;
    if (wantUndo && history.length) { event.preventDefault(); event.stopImmediatePropagation(); undo(); }
    else if (wantRedo && redoStack.length) { event.preventDefault(); event.stopImmediatePropagation(); redo(); }
  }, true);
})();
