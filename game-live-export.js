import { GLTFExporter } from 'https://esm.sh/three@0.180.0/examples/jsm/exporters/GLTFExporter.js';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// SHRINK 3D v1.83 — game export uses the exact live reduced mesh shown in the viewer.
const VERSION = '1.83';
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;
let lastBytes = null;
let bypass = false;
let busy = false;

const io = new WebIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder
  });

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function stats(model) {
  let triangles = 0, vertices = 0;
  model?.traverse?.(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    vertices += g.attributes.position.count;
    triangles += g.index ? Math.floor(g.index.count / 3) : Math.floor(g.attributes.position.count / 3);
  });
  return { triangles, vertices };
}

function num(n) { return new Intl.NumberFormat().format(Math.round(n || 0)); }

function setProgress(percent, label) {
  const wrap = $('progressWrap'), bar = $('progressBar'), text = $('progressLabel');
  wrap?.classList.remove('hidden');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (text) text.textContent = label;
}

function canvasFor(width, height) {
  if ('OffscreenCanvas' in window) return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

async function toBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob(
    b => b ? resolve(b) : reject(new Error('Texture conversion failed.')),
    type,
    quality
  ));
}

async function convertTexturesToWebP(doc, maxSize, quality) {
  const textures = doc.getRoot().listTextures();
  if (!textures.length) return;
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i];
    const image = texture.getImage();
    if (!image?.byteLength) continue;
    const mime = texture.getMimeType() || 'image/png';
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([image], { type: mime }));
    } catch (err) {
      console.warn(`[SHRINK 3D ${VERSION}] Could not recompress texture ${i + 1}`, err);
      continue;
    }
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = canvasFor(width, height);
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await toBlob(canvas, 'image/webp', quality);
    texture.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType('image/webp');
    setProgress(45 + ((i + 1) / textures.length) * 25, `Compressing texture ${i + 1} of ${textures.length}…`);
  }
}

async function exportPreviewBinary(preview) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(preview, {
    binary: true,
    onlyVisible: false,
    truncateDrawRange: true
  });
  if (!(result instanceof ArrayBuffer)) throw new Error('The live preview could not be converted to GLB.');
  return new Uint8Array(result);
}

function download(bytes) {
  const name = app()?.baseName?.() || 'model';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  a.download = `${name}-shrink.glb`;
  document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function updateResult(bytes, s) {
  const originalBytes = app()?.sourceBytes?.byteLength || bytes.byteLength;
  const saving = 100 * (1 - bytes.byteLength / originalBytes);
  if ($('optimizedSize')) $('optimizedSize').textContent = formatBytes(bytes.byteLength);
  if ($('optimizedTriangleCount')) $('optimizedTriangleCount').textContent = num(s.triangles);
  if ($('optimizedVertexCount')) $('optimizedVertexCount').textContent = num(s.vertices);
  if ($('savingBadge')) $('savingBadge').textContent = saving >= 0 ? `${saving.toFixed(0)}% smaller` : `${Math.abs(saving).toFixed(0)}% larger`;
  $('resultCard')?.classList.remove('hidden');
  if ($('downloadBtn')) $('downloadBtn').disabled = false;
}

async function saveLiveGameGLB(event) {
  if (bypass || busy) return;
  const a = app();
  const gameMode = window.__shrinkUI?.getMode?.() !== 'print';
  if (!gameMode || !a?.optimizedModel || !a?.optimizedIsPreview) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  busy = true;
  const button = $('optimizeBtn');
  const oldLabel = button?.textContent || 'Save game GLB';
  if (button) { button.disabled = true; button.textContent = 'Building live GLB…'; }

  try {
    const preview = a.optimizedModel;
    const before = stats(preview);
    setProgress(8, `Capturing the live ${num(before.triangles)}-triangle mesh…`);
    a.setStatus?.(`Saving the live reduced mesh you are looking at (${num(before.triangles)} triangles)…`, false);

    const previewBytes = await exportPreviewBinary(preview);
    setProgress(28, 'Preparing game GLB…');
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    const doc = await io.readBinary(previewBytes);

    if ($('webpToggle')?.checked) {
      const size = Math.max(64, Number($('textureSize')?.value) || 2048);
      const quality = Math.max(.1, Math.min(1, (Number($('textureQuality')?.value) || 82) / 100));
      await convertTexturesToWebP(doc, size, quality);
    }

    setProgress(74, 'Removing unused data…');
    await doc.transform(prune());

    if ($('meshoptToggle')?.checked) {
      setProgress(84, 'Compressing mesh…');
      await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    } else if ($('quantizeToggle')?.checked) {
      setProgress(84, 'Shrinking mesh data…');
      await doc.transform(quantize());
    }

    setProgress(95, 'Writing GLB…');
    const bytes = await io.writeBinary(doc);
    lastBytes = bytes;
    updateResult(bytes, before);
    download(bytes);
    setProgress(100, 'Finished');
    a.setStatus?.(`Saved the live preview: ${num(before.triangles)} triangles · ${formatBytes(bytes.byteLength)}.`, false);
    window.dispatchEvent(new CustomEvent('shrink:optimized', { detail: { bytes: bytes.byteLength, triangles: before.triangles, liveExport: true } }));
    setTimeout(() => $('progressWrap')?.classList.add('hidden'), 1200);
  } catch (err) {
    console.error(`[SHRINK 3D ${VERSION}] Live game export failed`, err);
    a?.setStatus?.('Could not save the live preview. Falling back to the standard GLB save…', false);
    bypass = true;
    setTimeout(() => {
      try { button?.click(); }
      finally { setTimeout(() => { bypass = false; }, 0); }
    }, 0);
  } finally {
    busy = false;
    if (button) { button.disabled = false; button.textContent = button.dataset.label || oldLabel; }
  }
}

function install() {
  const button = $('optimizeBtn');
  if (button && !button.dataset.liveExport183) {
    button.dataset.liveExport183 = '1';
    button.addEventListener('click', saveLiveGameGLB, true);
  }
  const again = $('downloadBtn');
  if (again && !again.dataset.liveExport183) {
    again.dataset.liveExport183 = '1';
    again.addEventListener('click', e => {
      if (!lastBytes || window.__shrinkUI?.getMode?.() === 'print') return;
      e.preventDefault(); e.stopImmediatePropagation(); download(lastBytes);
    }, true);
  }
  const badge = document.querySelector('.version-badge');
  if (badge) badge.textContent = `v${VERSION}`;
}

install();
const observer = new MutationObserver(install);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('shrink:model-opened', () => { lastBytes = null; install(); });

window.__shrinkGameLiveExport = { version: VERSION };
