// CLAY tool: clay-core maths, and the real FIX IT button with clay on a jsdom page (real clay.js, fuse-export, watertight rebuild, Manifold).
import { makePage, models, THREE, ok, failures, wait, healthOf } from './mt-harness.mjs';
import { icosphere, dabSoup, dabsAlong, thin, joinSoups } from '../clay-core.js';

const waitFor = async (fn, ms = 90000, step = 100) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await wait(step); } return !!(await fn()); };
const vol = soup => { let v = 0; const p = soup.positions, i = soup.indices; for (let t = 0; t < i.length; t += 3) { const a = i[t] * 3, b = i[t+1] * 3, c = i[t+2] * 3; v += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c])) / 6; } return v; };
const bbox = m => new THREE.Box3().setFromObject(m, true);
const bakedVolume = m => { let v = 0; m.updateMatrixWorld(true); m.traverse(o => { if (o.isMesh) { const g = o.geometry, p = g.attributes.position, ix = g.index; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); for (let t = 0; t < ix.count; t += 3) { A.fromBufferAttribute(p, ix.getX(t)); B.fromBufferAttribute(p, ix.getX(t+1)); C.fromBufferAttribute(p, ix.getX(t+2)); v += A.dot(B.clone().cross(C)) / 6; } } }); return v; };

/* ---- the maths ---- */
{
  const s = dabSoup([{ x: 1, y: 2, z: 3, r: 2 }], 2);
  ok(Math.abs(vol(s) / (4 / 3 * Math.PI * 8) - 1) < 0.04 && vol(s) > 0, 'C1 a clay ball is a closed outward sphere of the right size');
  ok(dabsAlong({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 1).every((d, k, a) => k === 0 || Math.hypot(d.x - a[k-1].x, d.y - a[k-1].y) <= 0.41), 'C1 balls along a stroke overlap into a rope');
  ok(thin([{ x: 0, y: 0, z: 0, r: 1 }, { x: 0.01, y: 0, z: 0, r: 1 }, { x: 5, y: 0, z: 0, r: 1 }]).length === 2, 'C1 near-identical balls are thinned');
  const j = joinSoups(s, s); ok(j.indices.length === 2 * s.indices.length && Math.max(...j.indices) === 2 * s.positions.length / 3 - 1, 'C1 joined soups keep their numbering');
}

/* ---- clean model: exact route ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(300);
  ok(!!page.$('v2ClayApply') && !!w.__shrinkClay, 'C2 the CLAY card is on the page');
  const m0 = w.__shrinkWorkingModel(), b0 = bbox(m0), v0 = bakedVolume(m0);
  // a lump on the side of the sphere (sphere radius 20 centred at (0,20,0)... see models.single)
  const c0 = b0.getCenter(new THREE.Vector3());
  w.__shrinkClay.addStroke('add', [{ x: b0.max.x, y: c0.y, z: c0.z, r: 5 }]);
  ok(w.__shrinkClay.hasClay(), 'C2 a stroke is remembered');
  page.$('v2FixBigBtn').click();
  ok(await waitFor(() => w.__shrinkWorkingModel() !== m0), 'C2 FIX IT replaced the model with the clay joined');
  const m1 = w.__shrinkWorkingModel(), b1 = bbox(m1), v1 = bakedVolume(m1);
  ok(b1.max.x > b0.max.x + 2.5 && v1 > v0 * 1.004, `C2 the lump is part of the model now (x reach ${b0.max.x.toFixed(1)} → ${b1.max.x.toFixed(1)}, volume +${((v1 / v0 - 1) * 100).toFixed(1)}%)`);
  ok((await healthOf(m1)).clean && !w.__shrinkClay.hasClay(), 'C2 the result is clean and the clay is used up');
  ok(/CLAY/.test(page.$('v2HealthChanges').textContent), 'C2 the change list says CLAY');
  ok(await waitFor(() => !page.$('v2FixBigBtn').disabled), 'C2 FIX IT is usable again');
  // cut away the top
  const top = b1.max.y;
  w.__shrinkClay.addStroke('cut', [{ x: c0.x, y: top, z: c0.z, r: 8 }]);
  page.$('v2FixBigBtn').click();
  ok(await waitFor(() => w.__shrinkWorkingModel() !== m1), 'C3 a cut was applied');
  const m2 = w.__shrinkWorkingModel(), b2 = bbox(m2);
  ok(b2.max.y < top - 1 && (await healthOf(m2)).clean, `C3 the top is carved off and the model is still clean (height ${(top - b1.min.y).toFixed(1)} → ${(b2.max.y - b2.min.y).toFixed(1)})`);
}

/* ---- leaky model: clay joins the surface and the wrap seals it ---- */
{
  const holey = models.holey(20);
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; w.__shrinkSetWorkingModel(holey); await wait(300);
  const b = bbox(holey), c = b.getCenter(new THREE.Vector3());
  w.__shrinkClay.addStroke('add', [{ x: b.max.x - 1, y: c.y, z: c.z, r: 4 }]);
  page.$('v2FixBigBtn').click();
  ok(await waitFor(() => w.__shrinkWorkingModel() !== holey, 120000), 'C4 a leaky model with clay is sealed and replaced');
  const now = w.__shrinkWorkingModel();
  ok((await healthOf(now)).clean && bbox(now).max.x > b.max.x + 1, 'C4 the result is clean and carries the clay');
}

/* ---- failure leaves everything alone ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(300);
  const m0 = w.__shrinkWorkingModel(), b = bbox(m0), c = b.getCenter(new THREE.Vector3());
  w.__shrinkClay.addStroke('cut', [{ x: c.x, y: c.y, z: c.z, r: 500 }]);       // carves away everything
  page.$('v2FixBigBtn').click();
  ok(await waitFor(() => /Could not/.test(page.$('v2FixResult')?.textContent || ''), 60000), 'C5 a clay job that cannot work reports it');
  ok(w.__shrinkWorkingModel() === m0 && w.__shrinkClay.hasClay(), 'C5 the model and the clay are both kept');
}

/* ---- the QUICK-FIX report sits on the MODEL HEALTH card ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); await wait(300);
  const note = page.$('v2MagicNote');
  ok(!!note && note.closest('#v2HealthCard') && !note.closest('.v2-magic-wrap'), 'C6 the QUICK-FIX report lives inside the MODEL HEALTH card, not under the top button');
  note.hidden = false; note.click(); ok(note.hidden === true, 'C6 clicking the report closes it');
}

/* ---- Compare: the original must follow the working model when the print tools move it ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(300);
  const m = w.__shrinkWorkingModel();
  ok(w.__shrinkComparePose() === null, 'C7 nothing moved yet: no pose change for Compare');
  m.position.set(30, 17, -9); m.updateMatrixWorld(true);                       // the model starts somewhere else
  const before = bbox(m).getCenter(new THREE.Vector3());
  w.__shrinkCentre();                                                           // QUICK-FIX's centre-on-bed step
  const after = bbox(m).getCenter(new THREE.Vector3());
  const pose = w.__shrinkComparePose();
  ok(!!pose, 'C7 centring is remembered as a pose change');
  const moved = before.clone().applyMatrix4(pose);
  ok(moved.distanceTo(after) < 1e-4, `C7 applying the remembered change to the original's old spot lands on the working model (off by ${moved.distanceTo(after).toExponential(1)})`);
  w.__shrinkLevel();                                                            // turning is remembered too
  const pose2 = w.__shrinkComparePose(), c2 = bbox(m).getCenter(new THREE.Vector3());
  ok(before.clone().applyMatrix4(pose2).distanceTo(c2) < 1e-3, 'C7 and it stays right after levelling');
  w.dispatchEvent?.(new w.CustomEvent('shrink:model-opened')); await wait(50);
  ok(w.__shrinkComparePose() === null, 'C7 a newly opened model starts with no pose change');
}

/* ---- red DOWNLOAD next to QUICK-FIX ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); await wait(300);
  const dl = page.$('v2MagicDownload');
  ok(!!dl && dl.disabled && dl.nextElementSibling === page.$('v2MagicReset') && dl.previousElementSibling === page.$('v2MagicBtn'), 'C8 the DOWNLOAD button sits next to QUICK-FIX and starts greyed out');
  dl.disabled = false; page.w.dispatchEvent(new page.w.CustomEvent('shrink:model-opened')); await wait(50);
  ok(dl.disabled, 'C8 a newly opened model greys it out again');
  ok(!!page.$('v2AdvTools').querySelector('#v2ClayCard'), 'C8 the CLAY card is inside the ADVANCED drawer');
}

/* ---- RELOAD: opens the file chooser for a new model ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(300);
  const rb = page.$('v2MagicReset');
  ok(!!rb && rb.textContent === 'RELOAD' && rb.previousElementSibling === page.$('v2MagicDownload'), 'R1 RELOAD sits beside DOWNLOAD at the top right');
  let clicks = 0; const fi = page.$('fileInput'); if (fi) fi.addEventListener('click', e => { clicks++; e.preventDefault(); });
  rb.click(); await wait(50);
  ok(!fi || clicks === 1, 'R1 RELOAD opens the file chooser');
  const qb = page.$('v2MagicBtn');
  w.dispatchEvent(new w.CustomEvent('shrink:model-opened', { detail: { kind: 'stl', triangles: 12, vertices: 8 } })); await wait(110);
  ok(qb.dataset.state === 'checking' && qb.disabled, 'Q1 QUICK-FIX is grey (state checking) and unclickable while the health check runs');
  await wait(1500);
  ok(qb.dataset.state === 'ready' && !qb.disabled, 'Q1 and goes green once the check has finished');
}

/* ---- 16K quality ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(300);
  const u = w.document.querySelector('[data-quality="ultra"]');
  ok(!!u, 'U1 a 16K ultra quality button exists');
  u.click(); await wait(50);
  ok(Number(w.document.getElementById('printerDetailMm').value) === 0.018 && w.__shrinkStrict === 'p995', 'U1 16K sets the detail limit to 0.018 mm and the strict 99.5% surface check');
  w.document.querySelector('[data-quality="standard"]').click(); await wait(50);
  ok(Number(w.document.getElementById('printerDetailMm').value) === 0.05 && !w.__shrinkStrict, 'U1 Standard puts both back');
}

/* ---- BATCH ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(400);
  const B = w.__shrinkBatch;
  ok(!!B && !!page.$('v2BatchBtn'), 'B1 the BATCH button is added next to RELOAD');
  const GBn = 1024 ** 3;
  ok(B.estimate([10e6], 4 * GBn).level === 'green', 'B1 a 10 MB model on a 4 GB budget is green');
  ok(B.estimate([320e6], 4 * GBn).level === 'red', 'B1 a 320 MB model on a 4 GB budget is red');
  ok(B.estimate([100e6, 100e6], 4 * GBn).need > B.estimate([100e6], 4 * GBn).need, 'B1 more models need more memory');
  B.toggle(true);
  ok(page.$('v2BatchPanel').parentElement === page.$('v2HealthCard'), 'B1 with a model open the panel docks in the health card');
  const mk = (n, size) => ({ name: n, size });
  B.add([mk('a.stl', 5e6), mk('b.obj', 5e6), mk('c.txt', 10)]);
  ok(page.$('v2BatchList').querySelectorAll('.v2-batch-row').length === 2, 'B2 only STL/OBJ/PLY/GLB files are queued');
  ok(page.$('v2BatchMem').dataset.level !== 'red' && !page.$('v2BatchStart').disabled, 'B2 a small queue leaves START on');
  B.add([mk('huge.stl', 900e6)]);
  ok(page.$('v2BatchMem').dataset.level === 'red' && page.$('v2BatchStart').disabled && !page.$('v2BatchTryRow').hidden, 'B3 a huge file turns the memory bar red and blocks START');
  page.$('v2BatchTry').click(); await wait(20);
  ok(!page.$('v2BatchStart').disabled, 'B3 Try anyway lets START through');
  page.$('v2BatchTry').click(); page.$('v2BatchList').querySelectorAll('.x')[2].click(); await wait(20);
  ok(page.$('v2BatchList').querySelectorAll('.v2-batch-row').length === 2 && page.$('v2BatchMem').dataset.level !== 'red', 'B3 removing the big file clears the red');
  // a run with the real work swapped for fakes: one file works, one fails, the loop keeps going
  const opened = [];
  B.deps.openFile = async f => { opened.push(f.name); };
  B.deps.app = () => null;
  B.deps.quickFix = async () => { if (opened.length === 2) throw new Error('boom'); };
  B.deps.healthScore = () => '100';
  B.deps.capture = async () => [{ name: opened[opened.length - 1].replace(/\.\w+$/, '') + '-SHRINK.stl', blob: new w.Blob([new Uint8Array(10)]) }];
  B.start(); await wait(1500);
  const st = B.state.items.map(i => i.status).join();
  ok(st === 'done,failed', 'B4 a failing model is marked and the next one still runs (got ' + st + ')');
  ok(B.state.results.length === 1 && !page.$('v2BatchZip').disabled, 'B4 the finished model is kept and DOWNLOAD ZIP switches on');
  ok(!B.state.running, 'B4 the run ends');
}

console.log(failures() ? `\n${failures()} FAILED` : '\nall passed');
process.exit(failures() ? 1 : 0);
