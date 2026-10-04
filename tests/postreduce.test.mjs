import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';
import { root, build, prepare, ok, failures, wait } from './helpers.mjs';
prepare();

const html = `<!doctype html><html><body class="app-mode-print ui-simple">
<section id="simpleCard"><div class="sc-result"><h2 id="scResultTitle">Almost ready to print</h2><div id="scRows">
 <div class="sc-row"><strong>Made it smaller</strong><p>x</p></div>
 <div class="sc-row"><strong>Needs a quick repair</strong><p>x</p><button data-act="repair">Repair</button></div></div></div></section>
<input id="geometry" value="30"><input id="scDetailRange"><span id="scTuneVal"></span></body></html>`;
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window; w.requestAnimationFrame = cb => setTimeout(cb, 0);

function sphere(tris, { holes = false, flips = false, empties = 0 } = {}) {
  const seg = Math.round(Math.sqrt(tris)), rings = Math.round(seg / 2), pos = [], idx = [];
  const P = (y, x) => { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI; return [10 * Math.sin(v) * Math.cos(u), 10 * Math.cos(v), 10 * Math.sin(v) * Math.sin(u)]; };
  const key = new Map(); const vid = p => { const k = p.map(c => Math.round(c * 1e5)).join(','); if (!key.has(k)) { key.set(k, pos.length / 3); pos.push(...p); } return key.get(k); };
  let t = 0;
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
    const a = P(y, x), b = P(y + 1, x), c = P(y, x + 1), d = P(y + 1, x + 1);
    for (const tri of [[a, b, c], [b, d, c]]) {
      t++; if (holes && t % 211 < 2) continue;
      let ids = tri.map(vid); if (flips && t % 17 === 0) ids = [ids[0], ids[2], ids[1]];
      if (new Set(ids).size < 3) continue; idx.push(...ids);
    }
  }
  for (let i = 0; i < empties; i++) { const v = vid([30 + i, 0, 0]); idx.push(v, v, v); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setIndex(idx);
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(g)); grp.updateMatrixWorld(true); return grp;
}
const tri = m => { let n = 0; m.traverse(o => { if (o.isMesh) n += o.geometry.index.count / 3; }); return n; };

let optimized = sphere(20000, { empties: 50 });
const full = sphere(40000);
const runs = [];
w.__shrinkApp = { THREE, originalModel: full, get optimizedModel() { return optimized; }, show() {} };
w.__shrinkPrint = { getReduceOptions: () => ({ protectKeep: 1 }) };
const result = { shrink: { before: 40000, pct: 50, level: 'good', text: '' }, repair: { state: 'needs' } };
w.__shrinkSimple = { state: { stage: 'result', result } };
w.__shrinkLive = { root: optimized, runExact: async (ratio) => { runs.push(ratio); optimized = ratio >= 0.999 ? full : sphere(30000); } };

w.__imp = spec => import(spec.includes('repair-core') ? path.join(build, 'repair-core.js') : spec);
const src = fs.readFileSync(path.join(root, 'simple-postreduce.js'), 'utf8').replace(/\bimport\(/g, '__imp(');
const $ = id => w.document.getElementById(id);
w.eval(src);

await wait(600);
ok(runs.length === 0, 'no extra reductions were run for a mesh that already passes (runExact calls: ' + runs.length + ')');
ok(result.repair.state === 'ok', 'the result is marked clean (repair.state = ' + result.repair.state + ')');
ok($('scResultTitle').textContent === 'Ready to print', 'headline says Ready to print: ' + $('scResultTitle').textContent);
ok(!w.document.querySelector('[data-act="repair"]'), 'the old "Needs a quick repair" row is gone');
ok(/passed the same health check/.test($('scPostCleanRow')?.textContent || ''), 'explains it passed the same check as the upload: ' + ($('scPostCleanRow')?.textContent || '').slice(0, 90));
ok($('scPostGuard')?.dataset.state === 'ok', 'banner is green');

const result2 = { shrink: { before: 40000, pct: 20, level: 'good', text: '' }, repair: { state: 'needs' } };
optimized = sphere(8000, { holes: true, flips: true });
w.__shrinkLive.root = optimized; w.__shrinkSimple.state.result = result2; runs.length = 0;
w.document.body.insertAdjacentHTML('beforeend', ''); w.__shrinkPostReduce.run();
await wait(600);
ok(runs.length === 1 && runs[0] > 0.2 && runs[0] < 0.99, 'a damaged reduction is retried once at a safer ratio (' + runs.map(r => r.toFixed(2)) + ')');
ok(result2.repair.state === 'ok' && $('scResultTitle').textContent === 'Ready to print', 'and then passes (repair.state = ' + result2.repair.state + ')');

const result3 = { shrink: { before: 40000, pct: 20, level: 'good', text: '' }, repair: { state: 'needs' } };
const broken = sphere(8000, { holes: true });
optimized = broken; w.__shrinkLive.root = broken; w.__shrinkLive.runExact = async ratio => { runs.push(ratio); optimized = sphere(9000, { holes: true }); };
w.__shrinkSimple.state.result = result3; runs.length = 0; w.__shrinkPostReduce.run();
await wait(600);
ok(runs.length === 2 && runs[1] >= 0.999, 'it tries one safer ratio and then the full mesh, and stops (' + runs.map(r => r.toFixed(2)) + ')');
ok($('scPostGuard')?.dataset.state === 'failed' && /could not confirm a clean reduced mesh/.test($('scPostGuard').textContent), 'it reports the failure once: ' + $('scPostGuard')?.textContent.slice(0, 70));
w.__shrinkPostReduce.run(); await wait(200);
ok(runs.length === 2, 'running the guard again does not start another loop');
console.log(failures() ? 'FAILED' : 'all passed');
