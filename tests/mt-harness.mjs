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
import { MeshoptSimplifier } from 'meshoptimizer';

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
  for (const f of ['live-reduce.js', 'crease-normals.js', 'reduce-core.js', 'repair-core.js', 'solid-core.js', 'solid-rebuild.js', 'raw-split.js', 'split-print.js', 'split-fallback.js', 'fuse-export.js', 'watertight-remesh.js', 'print-export-safety.js', 'preview-material-fix.js']) {
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
// a closed box (outward-facing), used for thin "arms", axes and capes that a cut should avoid
function boxGeo(x0, x1, y0, y1, z0, z1) {
  const pos = [], idx = [];
  for (let iz = 0; iz < 2; iz++) for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) pos.push(ix ? x1 : x0, iy ? y1 : y0, iz ? z1 : z0);
  const q = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  q(0, 2, 3, 1); q(4, 5, 7, 6); q(0, 1, 5, 4); q(2, 6, 7, 3); q(0, 4, 6, 2); q(1, 3, 7, 5);
  let v = 0; for (let t = 0; t < idx.length; t += 3) { const [a, b, c] = [idx[t], idx[t+1], idx[t+2]].map(i => pos.slice(i*3, i*3+3)); v += a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]); }
  if (v < 0) for (let t = 0; t < idx.length; t += 3) [idx[t+1], idx[t+2]] = [idx[t+2], idx[t+1]];
  return { pos, idx };
}
export const models = {
  // one closed sphere, 40 units tall
  single: () => toModel([welded(sphereGeo(20, 0, 20, 0))]),
  // the sphere plus a thin plank (an "axe") standing out sideways at mid height: a cut at 50% crosses both
  axe: () => toModel([welded(sphereGeo(20, 0, 20, 0)), boxGeo(24, 44, 18, 22, -2, 2)]),
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
export async function makePage({ model, heightMm = 52, splitMax = 80, live = null } = {}) {
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
  let engine = null;
  if (live) {
    // the REAL live reducer (real simplifier, main-thread fallback) wired the way live-ui.js wires it
    const { createLiveReducer } = await imp('live-reduce.js');
    engine = createLiveReducer(app);
    w.__shrinkLive = engine;
    w.__shrinkLiveUI = { rebaseWorking: async model => { await engine.prepare(model); w.__shrinkSetWorkingModel?.(engine.root); w.document.getElementById('geometry').value = '100'; return true; } };
    const auto = w.document.getElementById('autoBtn');
    auto.addEventListener('click', async () => { auto.disabled = true; try { await engine.runExact(live.ratio ?? 0.2); } finally { auto.disabled = false; } });
    w.document.getElementById('geometry').addEventListener('input', () => engine.request(Number(w.document.getElementById('geometry').value) / 100, {}, 10));
  }
  w.dispatchEvent(new w.CustomEvent('shrink:ui-mode'));
  await wait(150);
  return { w, document: w.document, app, statuses, calls, downloads: g.__downloads, mods, engine, $: id => w.document.getElementById(id), blobs };
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


/* ----------------------------- a clean "miniature" made of many small closed pieces, and a real reduction of it ----------------------------- */
// ~90 small separate spheres, a body, a head and a noisy base disc. After FIX IT it is clean, like the repaired dwarf; reducing it with the
// app's own reducer settings leaves a few edges shared by three triangles (the "Needs attention" after SHRINK).
export async function makeFigure({ holes = false } = {}) {
  const core = await import(path.join(repoRoot, 'repair-core.js'));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pos = [], idx = [];
  const sphere = (cx, cy, cz, r, seg = 18, rings = 12, noise = 0) => { const o = pos.length / 3; for (let y = 0; y <= rings; y++) for (let x = 0; x <= seg; x++) { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI, rr = r * (1 + noise * Math.sin(u * 7) * Math.sin(v * 9)); pos.push(cx + rr * Math.sin(v) * Math.cos(u), cy + rr * Math.cos(v), cz + rr * Math.sin(v) * Math.sin(u)); } for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) { const a = o + y * (seg + 1) + x, b = a + seg + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); } };
  const disc = (r, h, seg = 160, rings = 40) => { const P = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; }; const rowsIdx = []; for (let k = 0; k <= rings; k++) { const rr = r * k / rings, row = []; for (let s2 = 0; s2 < seg; s2++) { const a = s2 / seg * 2 * Math.PI; row.push(P(rr * Math.cos(a), h + (k > 2 ? 0.25 * Math.sin(a * 11) * Math.sin(rr * 1.7) : 0), rr * Math.sin(a))); } rowsIdx.push(row); } for (let k = 0; k < rings; k++) for (let s2 = 0; s2 < seg; s2++) { const a = rowsIdx[k][s2], b = rowsIdx[k][(s2 + 1) % seg], c = rowsIdx[k + 1][s2], d = rowsIdx[k + 1][(s2 + 1) % seg]; if (k === 0) idx.push(a, d, c); else idx.push(a, b, c, b, d, c); } const rim = rowsIdx[rings], bot = []; for (let s2 = 0; s2 < seg; s2++) { const a = s2 / seg * 2 * Math.PI; bot.push(P(r * Math.cos(a), 0, r * Math.sin(a))); } for (let s2 = 0; s2 < seg; s2++) { const a = rim[s2], b = rim[(s2 + 1) % seg], c = bot[s2], d = bot[(s2 + 1) % seg]; idx.push(a, c, b, b, c, d); } const ctr = P(0, 0, 0); for (let s2 = 0; s2 < seg; s2++) idx.push(ctr, bot[(s2 + 1) % seg], bot[s2]); };
  disc(20, 3); sphere(0, 14, 0, 8, 40, 28, 0.08); sphere(0, 26, 0, 5, 36, 24, 0.06);
  for (let i = 0; i < 90; i++) { const a = rnd() * 6.28, r = 2 + rnd() * 9, y = 6 + rnd() * 22; sphere(r * Math.cos(a) * 1.1, y, r * Math.sin(a) * 1.1, 0.5 + rnd() * 1.2, 12, 8, 0.1); }
  const fixed = core.repairMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) });      // = FIX IT: now clean
  let indices = fixed.indices;
  if (holes) { const keep = []; for (let t = 0; t < indices.length; t += 3) { if ((t / 3) % 997 < 2) continue; keep.push(indices[t], indices[t + 1], indices[t + 2]); } indices = Uint32Array.from(keep); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(fixed.positions, 3)); geo.setIndex(new THREE.BufferAttribute(indices, 1)); geo.computeVertexNormals();
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial())); grp.updateMatrixWorld(true); return grp;
}
// Reduce a model with the app's own reducer (reduce-core.js + the same meshoptimizer) and wrap the result like the live preview does.
export async function reduceModel(model, ratio) {
  await MeshoptSimplifier.ready;
  const { reduceIndices } = await import(path.join(repoRoot, 'reduce-core.js'));
  const src = model.children[0].geometry, positions = src.attributes.position.array, indices = src.index.array;
  const out = reduceIndices({ simplifier: MeshoptSimplifier, positions, indices, lock: null, ratio, error: 0.05 }).indices;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setIndex(new THREE.BufferAttribute(out, 1)); geo.computeVertexNormals();
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial())); grp.updateMatrixWorld(true); return grp;
}
export async function healthOf(model) { const core = await import(path.join(repoRoot, 'repair-core.js')); return core.healthOfModel(THREE, model); }
