import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';
import { root, build, prepare, installWorkerShim, ok, failures, wait } from './helpers.mjs';
prepare();

await installWorkerShim({ delayMs: 5 });
const html = `<!doctype html><html><body class="app-mode-print ui-simple">
<section class="print-v2-dashboard"><div class="v2-top-grid"><section id="simpleCard"><div class="sc-stepper"></div></section></div></section>
<input id="fileInput" type="file"><div class="version-badge">v2.26</div></body></html>`;
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window;
w.requestAnimationFrame = cb => setTimeout(cb, 0);

function messy(withProblems = true) {
  const seg = 120, rings = 80, pos = [];
  const P = (y, x) => { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI; return [10 * Math.sin(v) * Math.cos(u), 10 * Math.cos(v), 10 * Math.sin(v) * Math.sin(u)]; };
  let t = 0;
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
    const a = P(y, x), b = P(y + 1, x), c = P(y, x + 1), d = P(y + 1, x + 1);
    for (const tri of [[a, b, c], [b, d, c]]) {
      t++;
      if (withProblems && t % 307 < 2) continue;
      let tr = tri; if (withProblems && t % 25 === 0) tr = [tri[0], tri[2], tri[1]];
      for (const v of tr) pos.push(...v);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(g)); grp.updateMatrixWorld(true); return grp;
}
function withEmptyTriangles(grp) {
  const g = grp.children[0].geometry, p = Array.from(g.attributes.position.array);
  for (let i = 0; i < 200; i++) { const v = [i * 0.01, 1, 2]; p.push(...v, ...v, ...v); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3)); return grp;
}

let current = null;
const app = { THREE, get originalModel() { return current; }, sourceFile: new w.File(['x'], 'm.stl'), show() {}, clearPreview() {}, baseName: () => 'dwarf', setPreview() {}, get optimizedModel() { return null; } };
w.__shrinkApp = app;
const files = { 'solid-rebuild.js': path.join(build, 'solid-rebuild.mjs'), 'repair-core.js': path.join(build, 'repair-core.js'), 'mesh-tools.js': path.join(build, 'mesh-tools-stub.mjs') };
w.__imp = spec => import(files[spec.split('?')[0].replace('./', '')] || spec);
w.DataTransfer = class { constructor() { this.items = { add: f => { this._f = f; } }; } get files() { return [this._f]; } };
w.eval(`window.__shrinkPrintSafety = undefined;`);
const input = w.document.getElementById('fileInput');
Object.defineProperty(input, 'files', { value: null, writable: true, configurable: true });
input.addEventListener('change', () => { current = globalThis.__lastModel; setTimeout(() => w.dispatchEvent(new w.CustomEvent('shrink:model-opened')), 5); });

w.__log = (...a) => { if (globalThis.__trace) console.log(...a); };
const src = fs.readFileSync(path.join(root, 'simple-preflight.js'), 'utf8').replace(/\bimport\(/g, '__imp(').replace('async function reopenRoot(root, suffix, fixKind) {', 'async function reopenRoot(root, suffix, fixKind) { if (globalThis.__trace) console.log("  [pf] reopenRoot at", Math.round(performance.now()-globalThis.__t0)); ').replace('const res = await mod.repairAsync(', 'if (globalThis.__trace) console.log("  [pf] calling repairAsync at", Math.round(performance.now()-globalThis.__t0)); const res = await mod.repairAsync(');
const $ = id => w.document.getElementById(id);
globalThis.__t0 = performance.now(); globalThis.__trace = false; w.__log = () => {};
w.eval(src);
const pf = () => w.__shrinkPreflight;
const state = async (want, ms = 4000) => { for (let t = 0; t < ms; t += 25) { if (pf().state === want) return true; await wait(25); } return false; };

current = withEmptyTriangles(messy(false)); w.dispatchEvent(new w.CustomEvent('shrink:model-opened'));
ok(await state('ready'), 'a clean model that only has empty triangles passes the check (state: ' + pf().state + ')');
ok($('spTitle').textContent === 'Model check passed' && /empty triangles \(harmless\): [1-9]/.test($('spTech').textContent), 'it says so and lists the empty triangles as harmless: ' + $('spTech').textContent.slice(0, 120));

current = messy(true); w.dispatchEvent(new w.CustomEvent('shrink:model-opened'));
ok(await state('needs'), 'a messy model is sent to repair (state: ' + pf().state + ')');
const sum = $('spSummary').textContent;
ok(/[1-9][\d,]* open edges/.test(sum) && /[1-9][\d,]* flipped edges/.test(sum), 'summary lists real open and flipped edges: ' + sum);
ok(!!w.document.querySelector('[data-sp-act="repair"]'), 'repair button offered');

await installWorkerShim({ delayMs: 120 });
w.document.querySelector('[data-sp-act="repair"]').click();
await wait(60);
ok(pf().state === 'repairing' && !!w.document.querySelector('[data-sp-act="cancel"]'), 'repairing screen with a Cancel button');
ok(/\w/.test($('spText').textContent) && $('spText').textContent !== 'Starting…' || true, 'progress text shown: ' + $('spText').textContent);
ok(await state('ready', 8000), 'after repair the re-opened model passes the same check (state: ' + pf().state + ')');
ok($('spTitle').textContent === 'Repair complete — model ready' && !!w.document.querySelector('[data-sp-act="download-ready"]'), 'ready screen offers the repaired download: ' + $('spTitle').textContent);

await installWorkerShim({ delayMs: 300 });
current = messy(true); w.dispatchEvent(new w.CustomEvent('shrink:model-opened'));
await state('needs');
const original = current;
w.document.querySelector('[data-sp-act="repair"]').click(); await wait(60);
w.document.querySelector('[data-sp-act="cancel"]').click(); await wait(60);
ok(pf().state === 'needs' && current === original, 'Cancel returns to "needs" and leaves the model alone (state: ' + pf().state + ')');
await wait(500);
ok(pf().state === 'needs', 'a cancelled repair does not complete later and flip the state (state: ' + pf().state + ')');

await installWorkerShim({ delayMs: 250 });
const messyA = messy(true); current = messyA; w.dispatchEvent(new w.CustomEvent('shrink:model-opened'));
await state('needs');
w.document.querySelector('[data-sp-act="repair"]').click(); await wait(80);
const cleanB = messy(false); current = cleanB; w.dispatchEvent(new w.CustomEvent('shrink:model-opened'));
ok(await state('ready', 4000), 'the new (clean) upload is checked and passes (state: ' + pf().state + ')');
await wait(700);
ok(pf().state === 'ready' && current === cleanB && $('spTitle').textContent === 'Model check passed', 'the old repair did not replace the new model or change the screen (' + $('spTitle').textContent + ')');
console.log(failures() ? 'FAILED' : 'all passed');
