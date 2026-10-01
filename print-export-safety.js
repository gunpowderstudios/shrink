import * as THREE from 'https://esm.sh/three@0.180.0';

// SHRINK 3D v1.84 — safety layer around optional Fuse / Split helpers.
const VERSION = '1.84';
const $ = id => document.getElementById(id);
const app = () => window.__shrinkApp;

let fallbackBusy = false;
let lastAttempt = null;

function sourceModel() {
  return app()?.optimizedModel || app()?.originalModel || null;
}

function topologySummary(model) {
  if (!model) return null;
  const edgeCounts = new Map();
  let triangles = 0, degenerate = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const q = v => `${Math.round(v.x * 1e6)},${Math.round(v.y * 1e6)},${Math.round(v.z * 1e6)}`;
  const addEdge = (u, v) => {
    const ku = q(u), kv = q(v), key = ku < kv ? `${ku}|${kv}` : `${kv}|${ku}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  };
  model.updateMatrixWorld(true);
  model.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      triangles++;
      const area2 = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq();
      if (area2 < 1e-20) degenerate++;
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }
  });
  let openEdges = 0, pinchedEdges = 0;
  for (const n of edgeCounts.values()) {
    if (n === 1) openEdges++;
    else if (n > 2) pinchedEdges++;
  }
  return { triangles, openEdges, pinchedEdges, degenerateTriangles: degenerate };
}

function logFailure(kind, rawMessage) {
  const topo = topologySummary(sourceModel());
  console.warn(`[SHRINK 3D ${VERSION}] ${kind} helper could not complete`, {
    libraryStatus: rawMessage,
    topology: topo
  });
}

function normalExport(kind, message) {
  if (fallbackBusy) return;
  fallbackBusy = true;
  const fuse = $('fuseSolidToggle');
  const split = $('splitMode');
  const prevFuse = fuse?.checked;
  const prevSplit = split?.value;
  if (fuse) fuse.checked = false;
  if (split) split.value = 'off';

  setTimeout(() => {
    const btn = kind === 'obj' ? $('saveObjBtn') : $('saveStlBtn');
    btn?.click();
    setTimeout(() => {
      app()?.setStatus?.(message, false);
      if (fuse && prevFuse != null) fuse.checked = prevFuse;
      if (split && prevSplit != null) {
        split.value = prevSplit;
        split.dispatchEvent(new Event('change', { bubbles: true }));
      }
      fallbackBusy = false;
    }, 60);
  }, 0);
}

function wrapStatus() {
  const a = app();
  if (!a?.setStatus || a.__safeExportWrapped) return false;
  const native = a.setStatus.bind(a);
  a.setStatus = (msg, error = false) => {
    const text = String(msg || '');
    if (!fallbackBusy && text.startsWith('Fuse failed:')) {
      logFailure('Fuse', text.slice('Fuse failed:'.length).trim());
      const kind = lastAttempt?.kind === 'obj' ? 'obj' : 'stl';
      const noun = kind.toUpperCase();
      native(`Couldn't merge this model into one solid. Saving the normal ${noun} instead…`, false);
      normalExport(kind, `Couldn't merge this model into one solid. Saved the normal ${noun} instead.`);
      return;
    }
    if (!fallbackBusy && text.startsWith('Split failed:')) {
      logFailure('Split', text.slice('Split failed:'.length).trim());
      native("Couldn't split this model safely. Saving one normal STL instead…", false);
      normalExport('stl', "Couldn't split this model safely. Saved one normal STL instead.");
      return;
    }
    return native(msg, error);
  };
  a.__safeExportWrapped = true;
  return true;
}

function enforcePriority() {
  const fuse = $('fuseSolidToggle');
  const split = $('splitMode');
  if (fuse && !fuse.dataset.safeDefaultApplied) {
    fuse.checked = false;
    fuse.dataset.safeDefaultApplied = '1';
  }
  const sync = () => {
    if (split?.value && split.value !== 'off' && fuse?.checked) fuse.checked = false;
  };
  if (split && !split.dataset.safePriority) {
    split.dataset.safePriority = '1';
    split.addEventListener('change', sync);
    split.addEventListener('input', sync);
  }
  if (fuse && !fuse.dataset.safePriority) {
    fuse.dataset.safePriority = '1';
    fuse.addEventListener('change', sync);
  }
  sync();
}

function trackAttempts() {
  const stl = $('saveStlBtn'), obj = $('saveObjBtn');
  if (stl && !stl.dataset.safeTrack) {
    stl.dataset.safeTrack = '1';
    stl.addEventListener('click', () => { lastAttempt = { kind: 'stl', time: Date.now() }; }, true);
  }
  if (obj && !obj.dataset.safeTrack) {
    obj.dataset.safeTrack = '1';
    obj.addEventListener('click', () => { lastAttempt = { kind: 'obj', time: Date.now() }; }, true);
  }
}

function maintain() {
  wrapStatus();
  enforcePriority();
  trackAttempts();
}

maintain();
const observer = new MutationObserver(maintain);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('shrink:model-opened', maintain);

// Optional features: a failed helper must never prevent the core app from running.
Promise.allSettled([
  import(`./preview-material-fix.js?v=${VERSION}`),
  import(`./fuse-export.js?v=${VERSION}`),
  import(`./split-print.js?v=${VERSION}`),
  import(`./split-fallback.js?v=${VERSION}`)
]).then(results => {
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[SHRINK 3D ${VERSION}] Optional print helper ${i + 1} did not load`, r.reason);
  });
  maintain();
});

window.__shrinkPrintSafety = { topologySummary, maintain };
