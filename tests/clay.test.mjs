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

/* ---- RESET: back to the model exactly as it was opened ---- */
{
  const page = await makePage({ model: models.single(), heightMm: 40 }); const w = page.w; await wait(300);
  const rb = page.$('v2MagicReset');
  ok(!!rb && rb.previousElementSibling === page.$('v2MagicDownload'), 'R1 RESET sits beside DOWNLOAD at the top right');
  const opened = []; w.addEventListener('shrink:model-opened', e => opened.push(e.detail));
  const first = page.app.sourceBytes;
  w.dispatchEvent(new w.CustomEvent('shrink:model-opened', { detail: { kind: 'stl', triangles: 123, vertices: 60 } })); await wait(100);
  ok(!rb.disabled, 'R1 it switches on once a model is open');
  page.app.sourceBytes = new Uint8Array([9]);                                  // pretend something else changed the bytes afterwards
  rb.click(); await wait(300);
  ok(page.app.replaced === 1 && page.app.lastReplaced === first, 'R1 RESET puts the bytes from when the model was opened back');
  const last = opened[opened.length - 1];
  ok(opened.length === 2 && last.reset === true && last.kind === 'stl' && last.triangles === 123, 'R1 and reopens it so every tool starts fresh (model-opened with the original details)');
  ok(page.$('v2MagicDownload').disabled && !rb.disabled, 'R1 DOWNLOAD greys out again and RESET stays usable');
  w.__shrinkClay.addStroke('add', [{ x: 0, y: 0, z: 0, r: 1 }]); rb.click(); await wait(300);
  ok(!w.__shrinkClay.hasClay(), 'R1 RESET also throws away any clay');
}

console.log(failures() ? `\n${failures()} FAILED` : '\nall passed');
process.exit(failures() ? 1 : 0);
