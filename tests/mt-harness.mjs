// Multitool harness: loads the REAL print-v2-ui / fuse-export / split-print / split-fallback / raw-split /
// print-export-safety / watertight-remesh modules into a jsdom page with the real Manifold library,
// so a click on the visible DOWNLOAD IT / Make watertight buttons runs the same code path as the browser.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { root as repoRoot, ok, failures, wait } from './helpers.mjs';

export { THREE, ok, failures, wait };
export const mtBuild = path.join(repoRoot, 'tests', '.build', 'mt');

const sh = f => fs.readFileSync(path.join(repoRoot, f), 'utf8');

// pull a top-level function out of mesh-tools.js (it imports gltf-transform, which Node tests do not need)
function extractFn(src, name) {
  const i = src.search(new RegExp(`export (async )?function ${name}\\b`));
  if (i < 0) throw new Error('missing ' + name);
  const open = src.indexOf('{', src.indexOf(')', i)); let depth = 0;
  for (let k = open; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
}

function rewrite(src) {
  return src
    .replace(/'https:\/\/esm\.sh\/three@0\.180\.0'/g, "'three'")
    .replace(/'https:\/\/esm\.sh\/fflate@[0-9.]+'/g, "'fflate'")
    .replace(/\.\/([a-z0-9-]+)\.js\?v=\$\{[A-Za-z_]+\}/g, './$1.js')
    .replace(/\.\/([a-z0-9-]+)\.js\?v=[0-9.]+/g, './$1.js')
    // Manifold: use the npm build instead of the CDN
    .replace(/import\(MANIFOLD_JS\)/g, "import('manifold-3d')")
    .replace(/factory\(\{ locateFile:[^}]*\}\)/g, 'factory()')
    .replace(/mod\.default\(\{ locateFile:[^)]*\)\s*\}\)/g, 'mod.default()');
}

export function prepareMultitool() {
  fs.mkdirSync(mtBuild, { recursive: true });
  const mt = sh('mesh-tools.js');
  // the helper `collectTriangles` is not exported, so take it as a plain function too
  const helper = (() => { const i = mt.indexOf('function collectTriangles'); const open = mt.indexOf('{', mt.indexOf(')', i)); let d = 0; for (let k = open; k < mt.length; k++) { if (mt[k] === '{') d++; else if (mt[k] === '}' && --d === 0) return mt.slice(i, k + 1); } })();
  fs.writeFileSync(path.join(mtBuild, 'mesh-tools.js'), helper + '\n\n' + ['buildBinaryStl', 'buildObjBlob', 'analyzeTopology', 'modelHeight'].map(n => extractFn(mt, n)).join('\n\n') + '\n');
  for (const f of ['repair-core.js', 'solid-core.js', 'solid-rebuild.js', 'raw-split.js', 'split-print.js', 'split-fallback.js', 'fuse-export.js', 'watertight-remesh.js', 'print-export-safety.js', 'preview-material-fix.js']) {
    if (fs.existsSync(path.join(repoRoot, f))) fs.writeFileSync(path.join(mtBuild, f), rewrite(sh(f)));
  }
  fs.writeFileSync(path.join(mtBuild, 'package.json'), '{"type":"module"}\n');
  const link = path.join(mtBuild, 'node_modules');
  if (!fs.existsSync(link)) { try { fs.symlinkSync(path.join(repoRoot, 'tests', 'node_modules'), link, 'dir'); } catch {} }
}

/* ----------------------------- test models (world space, Y up) ----------------------------- */
function sphereGeo(r, cx, cy, cz, seg = 36, rings = 24, holes = false) {
  const pos = [], idx = [];
  for (let y = 0; y <= rings; y++) for (let x = 0; x <= seg; x++) { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI; pos.push(cx + r * Math.sin(v) * Math.cos(u), cy + r * Math.cos(v), cz + r * Math.sin(v) * Math.sin(u)); }
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) { const a = y * (seg + 1) + x, b = a + seg + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }   // outward-facing
  return { pos, idx };
}
// weld seam/pole duplicates so the sphere is a proper closed mesh
function welded(g) {
  const map = new Map(), pos = [], remap = [];
  for (let i = 0; i < g.pos.length / 3; i++) { const k = [g.pos[i*3], g.pos[i*3+1], g.pos[i*3+2]].map(c => Math.round(c * 1e5)).join(','); if (!map.has(k)) { map.set(k, pos.length / 3); pos.push(g.pos[i*3], g.pos[i*3+1], g.pos[i*3+2]); } remap.push(map.get(k)); }
  const idx = []; for (let t = 0; t < g.idx.length; t += 3) { const a = remap[g.idx[t]], b = remap[g.idx[t+1]], c = remap[g.idx[t+2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  return { pos, idx };
}
function toModel(parts) {
  const grp = new THREE.Group();
  for (const g of parts) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3)); geo.setIndex(g.idx); geo.computeVertexNormals(); grp.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial())); }
  grp.updateMatrixWorld(true); return grp;
}
function merged(parts) { const pos = [], idx = []; for (const g of parts) { const o = pos.length / 3; pos.push(...g.pos); for (const i of g.idx) idx.push(i + o); } return { pos, idx }; }
// a tall "figure": body, head and hat as ONE connected solid (overlapping spheres are one mesh but welded per sphere => 3 closed shells)
export const models = {
  // one closed sphere, 40 units tall
  single: () => toModel([welded(sphereGeo(20, 0, 20, 0))]),
  // the same sphere with every triangle turned round (inside-out), as some exported STLs are
  inside: () => { const g = welded(sphereGeo(20, 0, 20, 0)); const idx = []; for (let t = 0; t < g.idx.length; t += 3) idx.push(g.idx[t], g.idx[t + 2], g.idx[t + 1]); return toModel([{ pos: g.pos, idx }]); },
  // three separate closed spheres stacked (a valid, watertight multi-part model, like the repaired dwarf's ~95 closed components)
  multi: () => toModel([welded(merged([welded(sphereGeo(10, 0, 10, 0)), welded(sphereGeo(10, 30, 10, 0)), welded(sphereGeo(10, 0, 40, 0))]))]),
  // a sphere with holes and flipped faces: not printable as it is
  // half a sphere is missing: a bowl, far too open for the voxel rebuild to close
  bowl: () => { const g = welded(sphereGeo(20, 0, 20, 0, 48, 32)); const idx = []; for (let t = 0; t < g.idx.length; t += 3) { const y = (g.pos[g.idx[t] * 3 + 1] + g.pos[g.idx[t+1] * 3 + 1] + g.pos[g.idx[t+2] * 3 + 1]) / 3; if (y > 20) continue; idx.push(g.idx[t], g.idx[t+1], g.idx[t+2]); } return toModel([{ pos: g.pos, idx }]); },
  holey: (r = 20) => { const g = welded(sphereGeo(r, 0, r, 0, 72, 48)); const idx = []; for (let t = 0; t < g.idx.length; t += 3) { if ((t / 3) % 211 < 2) continue; let a = g.idx[t], b = g.idx[t+1], c = g.idx[t+2]; if ((t / 3) % 17 === 0) [b, c] = [c, b]; idx.push(a, b, c); } return toModel([{ pos: g.pos, idx }]); }
};

/* ----------------------------- the page ----------------------------- */
// Several pages share one Node process (and its globals). A timer scheduled by an earlier page must not fire into a later page's
// DOM, so every timer remembers which page scheduled it and is dropped once a newer page exists.
let pageCounter = 0, currentRun = 0;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => { const run = currentRun; return realSetTimeout(() => { if (run === currentRun) fn(...args); }, ms); };
export async function makePage({ model, heightMm = 52, splitMax = 80 } = {}) {
  const run = ++pageCounter; currentRun = run;
  prepareMultitool();
  const html = `<!doctype html><html><body class="app-mode-print">
  <div class="mode-chooser"></div>
  <main id="workspace" class="workspace">
    <section class="viewer-panel"><div id="viewer" class="viewer"><div class="viewer-help">help</div></div></section>
    <section id="stepSave"><div class="export-row"><button id="saveStlBtn">Save STL</button><button id="saveObjBtn">Save OBJ</button></div>
      <label><input id="zUpToggle" type="checkbox" checked></label></section>
    <input id="figureHeightMm" value="${heightMm}"><select id="printerPreset"><option value="0.05">r</option><option value="0.2">f</option><option value="custom">c</option></select>
    <input id="printerDetailMm" value="0.05"><input id="geometry" value="70"><button id="autoBtn">auto</button><div id="liveLine"></div><div id="verdictText"></div>
    <button id="protectBtn"></button><button id="protectClearBtn"></button><input id="protectRadius" value="3">
  </main></body></html>`;
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://example.test/' });
  const w = dom.window;
  const g = globalThis;
  // expose the browser globals the modules expect
  Object.assign(g, { window: w, document: w.document, Event: w.Event, CustomEvent: w.CustomEvent, MutationObserver: w.MutationObserver, HTMLElement: w.HTMLElement, Node: w.Node });
  g.requestAnimationFrame = cb => setTimeout(cb, 0); w.requestAnimationFrame = g.requestAnimationFrame;
  g.__downloads = []; const blobs = new Map(); let n = 0;
  g.URL.createObjectURL = blob => { const id = `blob:test/${++n}`; blobs.set(id, blob); return id; };
  g.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { g.__downloads.push({ name: this.download, blob: blobs.get(this.href) }); };

  const statuses = [], calls = { setPreview: 0, show: [], notify: [], restore: 0 };
  const app = {
    THREE, originalModel: model, optimizedModel: null,
    setStatus(msg, error = false) { statuses.push({ msg: String(msg), error }); },
    baseName: () => 'dwarf',
    setPreview(root) { calls.setPreview++; this.optimizedModel = root; },
    show(which) { calls.show.push(which); },
    getViewState: () => ({ cam: 'saved' }), restoreViewState: () => { calls.restore++; },
    notifyReduced(meta) { calls.notify.push(meta); w.dispatchEvent(new w.CustomEvent('shrink:reduced', { detail: meta })); },
    clearPreview() {}
  };
  w.__shrinkApp = app;
  w.__shrinkPrint = { mmPerUnit: () => 1, detailMM: () => 0.05, state: { dabs: [] }, getReduceOptions: () => ({ protectKeep: 1 }) };
  w.__shrinkViewer = { scene: new THREE.Scene() };
  // the Worker class does not exist in Node: the rebuild/repair code falls back to the main thread, as it does in old browsers
  delete g.Worker;

  const imp = f => import(path.join(mtBuild, f) + '?run=' + run);   // fresh module state for every page
  const mods = {};
  const loadPrintModules = async () => {
    mods.fuse = await imp('fuse-export.js');
    mods.split = await imp('split-print.js');
    mods.fallback = await imp('split-fallback.js');
    mods.safety = await imp('print-export-safety.js');
    await wait(50);
  };
  // print-v2-ui.js is a classic script (an IIFE): run it in the page's globals
  const loadMultitoolUi = () => { vm.runInThisContext(fs.readFileSync(path.join(repoRoot, 'print-v2-ui.js'), 'utf8').replace(/\bwindow\./g, 'window.')); };
  document.body.classList.add('app-mode-print');
  await loadPrintModules();
  loadMultitoolUi();
  w.dispatchEvent(new w.CustomEvent('shrink:ui-mode'));
  await wait(150);
  return { w, document: w.document, app, statuses, calls, downloads: g.__downloads, mods, $: id => w.document.getElementById(id), blobs };
}

/* ----------------------------- inspecting downloads ----------------------------- */
export async function readStl(blobOrBytes) {
  const buf = blobOrBytes instanceof Uint8Array ? blobOrBytes : new Uint8Array(await blobOrBytes.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9); let o = 84, minZ = Infinity, maxZ = -Infinity;
  for (let t = 0; t < n; t++) { o += 12; for (let k = 0; k < 9; k++) { pos[t * 9 + k] = dv.getFloat32(o, true); o += 4; } o += 2; }
  for (let i = 2; i < pos.length; i += 3) { minZ = Math.min(minZ, pos[i]); maxZ = Math.max(maxZ, pos[i]); }
  return { triangles: n, positions: pos, minZ, maxZ };
}
export async function unzipDownload(d) { return unzipSync(new Uint8Array(await d.blob.arrayBuffer())); }
export async function stlHealth(stl) {
  const core = await import(path.join(repoRoot, 'repair-core.js'));
  return core.meshHealth(stl.positions, Uint32Array.from({ length: stl.triangles * 3 }, (_, i) => i));
}
