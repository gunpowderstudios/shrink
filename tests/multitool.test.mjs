// Regression tests for the 3D-print multitool: split into sections and Make watertight.
// They click the VISIBLE buttons (DOWNLOAD IT, FUSE IT, Make watertight) on a jsdom page that loads the real
// print-v2-ui / fuse-export / split-print / split-fallback / raw-split / print-export-safety modules and the real Manifold library.
import path from 'path';
import { mtBuild, prepareMultitool } from './mt-harness.mjs';
import { makePage, models, THREE, ok, failures, wait, unzipDownload, readStl, stlHealth, makeFigure, reduceModel, healthOf } from './mt-harness.mjs';

const FROM = Number(process.env.SHRINK_ONLY_FROM || 0);
const block = async (n, fn) => { if (n < FROM) return; try { await fn(); } catch (e) { ok(false, `group ${n} stopped with an error: ${String(e?.message || e).slice(0, 120)}`); } };
const waitFor = async (fn, ms = 25000, step = 100) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await wait(step); } return !!(await fn()); };
const zipOf = page => page.downloads.find(d => /\.zip$/.test(d.name));
const volume = stl => { let v = 0; const p = stl.positions; for (let t = 0; t < stl.triangles; t++) { const o = t * 9; v += p[o] * (p[o+4] * p[o+8] - p[o+5] * p[o+7]) - p[o+1] * (p[o+3] * p[o+8] - p[o+5] * p[o+6]) + p[o+2] * (p[o+3] * p[o+7] - p[o+4] * p[o+6]); } return Math.abs(v / 6); };
const sphereVol = r => 4 / 3 * Math.PI * r ** 3;
const bbox = model => new THREE.Box3().setFromObject(model);
const pick = async (page, mode) => { page.$('v2SplitMode').value = mode; page.$('v2SplitMode').dispatchEvent(new page.w.Event('change', { bubbles: true })); await wait(30); };
const joint = async (page, kind) => { page.$('v2Joint').value = kind; page.$('v2Joint').dispatchEvent(new page.w.Event('change', { bubbles: true })); await wait(20); };
async function readParts(page) {
  const zip = zipOf(page); if (!zip) return null;
  const files = await unzipDownload(zip); const names = Object.keys(files).sort();
  const parts = []; for (const n of names) parts.push({ name: n, stl: await readStl(files[n]) });
  return { zip, names, parts };
}

/* ============ A. split a clean single solid (the "simple flat split first" case) ============ */
await block(1, async () => {
  const page = await makePage({ model: models.single(), heightMm: 40 });
  await joint(page, 'flat'); await pick(page, '2');
  ok(page.$('splitMode').value === '2' && page.$('splitJoint').value === 'flat', 'A: v2 controls drive the native split mode and joint');
  page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'A1 flat 2 parts: DOWNLOAD IT produced a ZIP');
  ok(page.$('fuseSolidToggle').checked === false, 'A1 DOWNLOAD IT did not switch Fuse on');
  const r = await readParts(page);
  ok(r.zip.name === 'dwarf-SHRINK-split-2-parts.zip' && r.names.join() === 'dwarf-SHRINK-part-1-of-2.stl,dwarf-SHRINK-part-2-of-2.stl', 'A1 file names: ' + r.zip.name + ' / ' + r.names.join(' '));
  const [p1, p2] = r.parts;
  ok(Math.abs(p1.stl.maxZ - 20) < 0.05 && Math.abs(p2.stl.minZ - 20) < 0.05, `A1 cut at 50% of the height (lower part tops out at ${p1.stl.maxZ.toFixed(2)}, upper starts at ${p2.stl.minZ.toFixed(2)})`);
  ok((await stlHealth(p1.stl)).clean && (await stlHealth(p2.stl)).clean, 'A1 both sections are watertight (no open, tangled or flipped edges)');
  ok(Math.abs((volume(p1.stl) + volume(p2.stl)) / (volume(p1.stl) + volume(p2.stl)) - 1) < 1e-9 && Math.abs(volume(p1.stl) - volume(p2.stl)) / volume(p1.stl) < 0.02, 'A1 the two halves have equal volume');
  ok(!page.statuses.some(s => /Split failed/.test(s.msg)) && page.statuses.some(s => /watertight STL sections/.test(s.msg)), 'A1 no failure message; success message shown');
});
await block(2, async () => {
  const page = await makePage({ model: models.single(), heightMm: 40 });
  await joint(page, 'flat'); await pick(page, '3'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'A2 flat 3 parts: ZIP produced');
  const r = await readParts(page); const total = r.parts.reduce((s, p) => s + volume(p.stl), 0);
  ok(r.parts.length === 3 && r.parts.every(p => p.stl.triangles > 0), 'A2 three sections');
  ok(Math.abs(total - volume({ positions: r.parts[0].stl.positions, triangles: 0 })) >= 0 && total > 0, 'A2 sections have volume');
  ok(r.parts.every(async p => (await stlHealth(p.stl)).clean) && (await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'A2 all three sections are watertight');
  const bands = r.parts.map(p => [p.stl.minZ, p.stl.maxZ]);
  ok(Math.abs(bands[0][1] - 40 / 3) < 0.05 && Math.abs(bands[1][1] - 80 / 3) < 0.05, 'A2 cuts at thirds: ' + bands.map(b => b.map(x => x.toFixed(1)).join('–')).join(' | '));
});
await block(3, async () => {
  // with keyed pegs (the default joint)
  const page = await makePage({ model: models.single(), heightMm: 40 });
  await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'A3 pegs: ZIP produced');
  const r = await readParts(page); const [p1, p2] = r.parts;
  ok(r.parts.length === 2 && (await stlHealth(p1.stl)).clean && (await stlHealth(p2.stl)).clean, 'A3 both sections watertight with pegs and sockets');
  ok(p2.stl.minZ < 20 - 1, `A3 the upper section carries pegs reaching below the cut (starts at ${p2.stl.minZ.toFixed(2)})`);
  ok(Math.abs((volume(p1.stl) + volume(p2.stl)) / sphereVol(20) - 1) < 0.06, 'A3 total volume is still about the original sphere');
  ok(!page.statuses.some(s => /Split failed/.test(s.msg)) && page.statuses.some(s => /keyed alignment pegs/.test(s.msg)), 'A3 solid split succeeded with pegs, no fallback needed');
});
await block(4, async () => {
  // auto by maximum height (the engine never makes a part shorter than 20 mm)
  const tall = models.single(); tall.scale.setScalar(1.5); tall.updateMatrixWorld(true);       // 60 mm tall
  const page = await makePage({ model: tall, heightMm: 60 });
  await joint(page, 'flat'); await pick(page, 'max');
  ok(page.$('v2MaxWrap') && !page.$('v2MaxWrap').hidden, 'A4 the maximum-height box appears for "Auto by maximum height"');
  page.$('v2MaxHeight').value = '20'; page.$('v2MaxHeight').dispatchEvent(new page.w.Event('input', { bubbles: true })); await wait(20);
  ok(page.$('splitMaxHeight').value === '20', 'A4 maximum height reaches the split engine');
  page.$('v2DownloadBtn').click(); ok(await waitFor(() => zipOf(page)), 'A4 ZIP produced');
  const r = await readParts(page); ok(r.parts.length === 3, `A4 60 mm model with a 20 mm limit gives 3 parts (got ${r.parts.length})`);
  ok(r.parts.every(p => p.stl.maxZ - p.stl.minZ <= 20.2), 'A4 no section is taller than the limit');
});
await block(5, async () => {
  // two-part cut slider
  const page = await makePage({ model: models.single(), heightMm: 40 });
  await joint(page, 'flat'); await pick(page, '2');
  page.$('v2Cut').value = '30'; page.$('v2Cut').dispatchEvent(new page.w.Event('input', { bubbles: true })); await wait(20);
  ok(page.$('splitCutHeight').value === '30', 'A5 the cut slider reaches the split engine');
  page.$('v2DownloadBtn').click(); ok(await waitFor(() => zipOf(page)), 'A5 ZIP produced');
  const r = await readParts(page); ok(Math.abs(r.parts[0].stl.maxZ - 12) < 0.05, `A5 cut at 30% of 40 mm = 12 mm (lower part tops out at ${r.parts[0].stl.maxZ.toFixed(2)})`);
});
await block(6, async () => {
  // choosing "2 parts" must not loop the page watcher
  const page = await makePage({ model: models.single(), heightMm: 40 });
  let records = 0; const mo = new page.w.MutationObserver(l => { records += l.length; }); mo.observe(page.$('v2CutWrap'), { childList: true, subtree: true, characterData: true });
  await pick(page, '2'); await wait(400); mo.disconnect();
  ok(records <= 4, `A6 selecting 2 parts does not make the page rewrite itself in a loop (${records} DOM changes)`);
});

/* ============ A7. inside-out meshes (some exported STLs are) ============ */
await block(7, async () => {
  const page = await makePage({ model: models.inside(), heightMm: 40 });
  await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'A7 inside-out model: solid split produced a ZIP');
  const r = await readParts(page); const [p1, p2] = r.parts;
  ok(p2.stl.minZ < 20 - 1, `A7 pegs are still added (upper section starts at ${p2.stl.minZ.toFixed(2)})`);
  ok((await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'A7 sections are watertight');
});
await block(8, async () => {
  const page = await makePage({ model: models.inside(), heightMm: 40 });
  page.w.__shrinkFuse.modelToSolid = async () => { throw new Error('forced Manifold failure'); };
  await joint(page, 'flat'); await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'A8 inside-out model: direct fallback produced a ZIP');
  const r = await readParts(page);
  ok((await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'A8 fallback sections are watertight even from an inside-out model');
});

/* ============ B. a valid model made of several separate closed pieces ============ */
await block(9, async () => {
  const page = await makePage({ model: models.multi(), heightMm: 50 });
  await pick(page, '3'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'B multi-piece model, 3 parts + pegs: ZIP produced');
  const r = await readParts(page);
  ok(r.parts.length === 3, 'B three sections');
  ok((await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'B every section is watertight (no stray floating pegs or open cuts)');
  ok(!page.statuses.some(s => /Split failed|disconnected/.test(s.msg)), 'B the solid split worked: no "disconnected solids" failure, no fallback');
  ok(page.$('fuseSolidToggle').checked === false, 'B Fuse stayed off');
});

/* ============ C. the direct capped fallback fires when the solid split fails ============ */
await block(10, async () => {
  const page = await makePage({ model: models.single(), heightMm: 40 });
  page.w.__shrinkFuse.modelToSolid = async () => { throw new Error('forced Manifold failure'); };
  await joint(page, 'flat'); await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'C fallback: ZIP produced after the solid split failed');
  const r = await readParts(page);
  ok(r.parts.length === 2 && Math.abs(r.parts[0].stl.maxZ - 20) < 0.1, 'C two sections cut at the right height');
  ok((await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'C fallback sections are capped and watertight');
  ok(page.statuses.some(s => /Saved 2 separate STL sections/.test(s.msg)) && !page.statuses.some(s => s.error && /Split failed/.test(s.msg)), 'C the person sees the success message, not "Split failed"');
});
await block(11, async () => {
  // fallback with pegs
  const page = await makePage({ model: models.single(), heightMm: 40 });
  page.w.__shrinkFuse.modelToSolid = async () => { throw new Error('forced Manifold failure'); };
  await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'C2 fallback with pegs: ZIP produced');
  const r = await readParts(page); ok(r.parts.length === 2 && r.parts[1].stl.minZ < 20 - 1, 'C2 the direct split adds peg/socket joints');
});

/* ============ D. tools are cumulative: split uses the CURRENT working model ============ */
await block(12, async () => {
  const page = await makePage({ model: models.single(), heightMm: 20 });       // original is 40 tall...
  const small = (() => { const m = models.single(); m.scale.setScalar(0.5); m.updateMatrixWorld(true); return m; })();   // ...working model is 20 tall
  page.w.__shrinkSetWorkingModel(small);
  await joint(page, 'flat'); await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'D split of the working model produced a ZIP');
  const r = await readParts(page); const top = Math.max(...r.parts.map(p => p.stl.maxZ));
  ok(Math.abs(top - 20) < 0.1 && Math.abs(r.parts[0].stl.maxZ - 10) < 0.1, `D parts come from the 20 mm working model, not the 40 mm original (top ${top.toFixed(1)}, cut ${r.parts[0].stl.maxZ.toFixed(1)})`);
});

/* ============ E. DOWNLOAD IT with no split ============ */
await block(13, async () => {
  const page = await makePage({ model: models.multi(), heightMm: 50 });
  page.$('v2DownloadBtn').click(); await wait(800);
  ok(page.$('fuseSolidToggle').checked === false && !zipOf(page) && !page.downloads.some(d => /SHRINK\.stl$/.test(d.name)), 'E one-STL download does not fuse or split by itself (it is left to the normal export)');
});

/* ============ F. the legacy Fuse toggle ============ */
await block(14, async () => {
  const page = await makePage({ model: models.single(), heightMm: 40 });
  page.$('fuseSolidToggle').checked = true;                                     // someone left the old toggle on
  await joint(page, 'flat'); await pick(page, '2');
  page.$('saveStlBtn').click();
  ok(await waitFor(() => zipOf(page)), 'F split wins over a stale Fuse toggle');
  ok(!page.downloads.some(d => /SHRINK\.stl$/.test(d.name)), 'F no fused STL was exported instead');
});
await block(15, async () => {
  const page = await makePage({ model: models.multi(), heightMm: 50 });
  page.$('fuseSolidToggle').checked = true; page.$('saveStlBtn').click();
  ok(await waitFor(() => page.downloads.some(d => /SHRINK\.stl$/.test(d.name))), 'F Fuse export of a multi-piece model succeeds (separate closed pieces are valid)');
  ok(page.statuses.some(s => /3 separate watertight pieces/.test(s.msg)) && !page.statuses.some(s => /Fuse failed/.test(s.msg)), 'F it reports the pieces instead of failing');
});

/* ============ G. FUSE IT, then split the fused working model ============ */
await block(16, async () => {
  const page = await makePage({ model: models.multi(), heightMm: 50 });
  const before = window.__shrinkWorkingModel();
  page.$('v2FuseBtn').click();
  ok(await waitFor(() => window.__shrinkWorkingModel() !== before, 20000), 'G FUSE IT advanced the working model');
  await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'G the fused model can then be split');
  const r = await readParts(page); ok(r.parts.length === 2 && (await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'G both sections are watertight');
});

/* ============ H. Make watertight replaces the working model ============ */
await block(17, async () => {
  const original = (() => { const m = models.single(); m.scale.setScalar(1.5); m.updateMatrixWorld(true); return m; })();   // a different, healthy 60 mm sphere
  const holey = models.holey(15);                                                                                         // the CURRENT working model: broken, 30 mm
  const page = await makePage({ model: original, heightMm: 30 });
  page.w.__shrinkSetWorkingModel(holey);
  const centreBefore = bbox(holey).getCenter(new THREE.Vector3()), sizeBefore = bbox(holey).getSize(new THREE.Vector3());
  page.w.__shrinkPrintSafety.showDiagnostic('Fuse', 'non-manifold');
  ok(!page.$('printDiagnosticPanel').hidden, 'H the red warning panel is showing');
  page.$('remeshQuality').value = 'fast';
  page.$('makeWatertightBtn').click();
  ok(await waitFor(() => window.__shrinkWorkingModel() !== holey, 60000), 'H Make watertight replaced the working model');
  const now = window.__shrinkWorkingModel();
  ok(page.calls.setPreview === 1 && page.app.optimizedModel === now && page.calls.show.includes('optimized'), 'H the rebuilt model was installed in the viewer');
  ok(page.calls.restore === 1, 'H the camera view was restored');
  ok(page.downloads.length === 0, 'H nothing was downloaded');
  const sizeAfter = bbox(now).getSize(new THREE.Vector3()), centreAfter = bbox(now).getCenter(new THREE.Vector3());
  ok(Math.abs(sizeAfter.y - sizeBefore.y) < 1.2 && Math.abs(sizeAfter.x - sizeBefore.x) < 1.2, `H it rebuilt the WORKING model (30 mm), not the 60 mm original (height ${sizeAfter.y.toFixed(1)} mm)`);
  ok(centreAfter.distanceTo(centreBefore) < 0.6, 'H position, orientation and scale are preserved (' + centreAfter.distanceTo(centreBefore).toFixed(2) + ' units drift)');
  const core = await import('../repair-core.js'); const h = core.healthOfModel(THREE, now);
  ok(h.clean && h.triangles > 0, `H the rebuilt model is healthy (open ${h.openEdges}, pinched ${h.pinchedEdges}, flipped ${h.flippedEdges})`);
  ok(page.$('printDiagnosticPanel').hidden === true, 'H the red warning panel was cleared');
  ok(await waitFor(() => page.$('v2HealthScore')?.textContent === '100', 4000), 'H the MODEL HEALTH card refreshed to 100');
  ok(/REBUILT/.test(page.$('v2HealthChanges').textContent), 'H the CHANGES list shows REBUILT');
  ok(page.statuses.slice(-1)[0].msg.startsWith('Rebuilt as one watertight solid') && !page.statuses.slice(-1)[0].error, 'H success message');
  // and the tools keep chaining: split the rebuilt model
  await joint(page, 'flat'); await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'H the rebuilt model can be split straight away');
  const r = await readParts(page); ok(r.parts.length === 2 && Math.abs(r.parts[0].stl.maxZ - sizeAfter.y / 2) < 0.8 + 0, 'H split halves of the rebuilt model');
});


/* ============ I. pegs are a bonus: a peg that cannot be built never fails the split ============ */
await block(18, async () => {
  const page = await makePage({ model: models.single(), heightMm: 40 });
  const built = await page.w.__shrinkFuse.modelToSolid(models.single());          // grab this page's Manifold class and break subtract()
  Object.getPrototypeOf(built.solid).subtract = () => { throw new Error('forced peg failure'); };    // Manifold objects are instances of an embind class; patch that prototype
  built.solid.delete();
  await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page)), 'I split still produced a ZIP when the pegs could not be built');
  const r = await readParts(page);
  ok(r.parts.length === 2 && (await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(h => h.clean), 'I sections are watertight (flat cut)');
  ok(page.statuses.some(s => /flat cuts \(no safe peg position was found\)/.test(s.msg)) && !page.statuses.some(s => /keyed alignment pegs/.test(s.msg)), 'I the message does not claim pegs that were not added');
});

/* ============ J. Make watertight: transforms, refusals and the unchanged working model ============ */
await block(19, async () => {
  // a model that sits inside a transformed parent (scaled, rotated about Y, moved): the rebuild must land in the same place
  const inner = models.holey(10);
  const holder = new THREE.Group(); holder.add(inner); holder.scale.setScalar(2); holder.rotation.y = 0.7; holder.position.set(15, 3, -8); holder.updateMatrixWorld(true);
  const page = await makePage({ model: models.single(), heightMm: 40 });
  page.w.__shrinkSetWorkingModel(holder);
  const box = bbox(holder), c0 = box.getCenter(new THREE.Vector3()), s0 = box.getSize(new THREE.Vector3());
  page.$('remeshQuality').value = 'fast'; page.$('makeWatertightBtn').click();
  ok(await waitFor(() => window.__shrinkWorkingModel() !== holder, 60000), 'J rebuild of a transformed model finished');
  const now = window.__shrinkWorkingModel(), b = bbox(now);
  ok(b.getCenter(new THREE.Vector3()).distanceTo(c0) < 1.0 && Math.abs(b.getSize(new THREE.Vector3()).y - s0.y) < 1.2, `J position and scale match the transformed source (drift ${b.getCenter(new THREE.Vector3()).distanceTo(c0).toFixed(2)})`);
});
await block(20, async () => {
  // too open to rebuild: refused, and the working model plus the warning stay as they were
  const bowl = models.bowl();
  const page = await makePage({ model: models.single(), heightMm: 40 });
  page.w.__shrinkSetWorkingModel(bowl);
  page.w.__shrinkPrintSafety.showDiagnostic('Fuse', 'non-manifold');
  page.$('remeshQuality').value = 'fast'; page.$('makeWatertightBtn').click();
  ok(await waitFor(() => page.statuses.some(s => s.error && /gaps that are too big|Watertight/.test(s.msg)), 60000), 'J a bowl that is far too open is refused with an error message');
  ok(window.__shrinkWorkingModel() === bowl && page.calls.setPreview === 0, 'J the working model was left exactly as it was');
  ok(page.$('printDiagnosticPanel').hidden === false && page.downloads.length === 0, 'J the warning stays and nothing was downloaded');
  ok(page.$('makeWatertightBtn').disabled === false, 'J the button is usable again');
});

/* ============ K. SHRINK IT: a clean model must not come back "Needs attention" ============ */
// The simplifier does not promise to keep a mesh manifold. Reducing this clean model of ~90 small pieces to 20% leaves 13 edges shared by three triangles.
const shrinkWith = async (page, reduced) => {              // stand in for the live reducer: the click on the hidden Auto button installs the reduced preview
  page.w.__shrinkLiveUI = { rebaseWorking: async () => {} };
  page.$('autoBtn').addEventListener('click', () => { page.w.__shrinkLive = { root: reduced }; page.app.optimizedModel = reduced; });
  page.$('v2ShrinkBtn').click();
};
await block(21, async () => {
  const figure = await makeFigure(), reduced = await reduceModel(figure, 0.2);
  const hBefore = await healthOf(figure), hReduced = await healthOf(reduced);
  ok(hBefore.clean && !hReduced.clean && hReduced.pinchedEdges > 0, `K setup: the figure is clean (${hBefore.triangles} tris) and its 20% reduction is not (${hReduced.pinchedEdges} non-manifold edges)`);
  const page = await makePage({ model: figure, heightMm: 40 });
  page.w.__shrinkSetWorkingModel(figure);
  await waitFor(() => page.$('v2HealthScore')?.textContent === '100', 6000);
  ok(page.$('v2HealthScore').textContent === '100', 'K the figure shows 100 before SHRINK');
  const previews = page.calls.setPreview;
  await shrinkWith(page, reduced);
  ok(await waitFor(() => window.__shrinkWorkingModel() !== reduced && window.__shrinkWorkingModel() !== figure, 30000), 'K SHRINK replaced the reduced model with a tidied one');
  const now = window.__shrinkWorkingModel(), h = await healthOf(now);
  ok(h.clean && h.pinchedEdges === 0 && h.openEdges === 0, `K the working model is clean again (open ${h.openEdges}, non-manifold ${h.pinchedEdges}, flipped ${h.flippedEdges})`);
  ok(Math.abs(h.triangles - hReduced.triangles) / hReduced.triangles < 0.01, `K almost nothing was changed (${hReduced.triangles} -> ${h.triangles} triangles)`);
  ok(await waitFor(() => page.$('v2HealthScore')?.textContent === '100', 6000), 'K MODEL HEALTH is 100 after SHRINK, not "Needs attention"');
  ok(/Tidied \d+ edges? the reduction disturbed/.test(page.$('v2ShrinkResult').textContent), 'K the SHRINK result says what it tidied: ' + page.$('v2ShrinkResult').textContent.replace(/\s+/g, ' ').slice(0, 110));
  ok(/SHRUNK/.test(page.$('v2HealthChanges').textContent) && /FIXED/.test(page.$('v2HealthChanges').textContent), 'K chips show SHRUNK and FIXED');
  ok(page.calls.setPreview === previews + 1 && page.app.optimizedModel === now, 'K the tidied model is the one in the viewer');
  // and it can be split straight away
  await joint(page, 'flat'); await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page), 30000), 'K the tidied model can be split');
  const r = await readParts(page); ok((await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(x => x.clean), 'K and the sections are watertight');
});
await block(22, async () => {
  // a reduction that happens to stay clean is left alone: no extra repair, same model
  const figure = await makeFigure(), reduced = await reduceModel(figure, 0.1);
  ok((await healthOf(reduced)).clean, 'K2 setup: the 10% reduction is clean');
  const page = await makePage({ model: figure, heightMm: 40 });
  page.w.__shrinkSetWorkingModel(figure); await waitFor(() => page.$('v2HealthScore')?.textContent === '100', 6000);
  await shrinkWith(page, reduced);
  ok(await waitFor(() => window.__shrinkWorkingModel() === reduced, 30000), 'K2 a clean reduction is used as it is');
  await wait(300);
  ok(window.__shrinkWorkingModel() === reduced && !/Tidied/.test(page.$('v2ShrinkResult').textContent), 'K2 nothing was tidied');
});
await block(23, async () => {
  // a model the person left unhealthy is NOT silently repaired by SHRINK: FIX IT stays their decision
  const figure = await makeFigure({ holes: true }), reduced = await reduceModel(figure, 0.2);
  const page = await makePage({ model: figure, heightMm: 40 });
  page.w.__shrinkSetWorkingModel(figure); await waitFor(() => page.$('v2HealthScore')?.textContent && page.$('v2HealthScore').textContent !== '—', 6000);
  ok(page.$('v2HealthScore').textContent !== '100', 'K3 setup: this figure is not healthy before SHRINK');
  await shrinkWith(page, reduced);
  ok(await waitFor(() => window.__shrinkWorkingModel() === reduced, 30000), 'K3 SHRINK used the reduction as it is');
  await wait(300);
  ok(window.__shrinkWorkingModel() === reduced && !/Tidied/.test(page.$('v2ShrinkResult').textContent) && page.$('v2HealthFixBtn').hidden === false, 'K3 nothing was repaired behind the person\'s back; FIX IT is still offered');
});

/* ============ L. a model whose display geometry has crease-split vertices behaves exactly like any other ============ */
await block(24, async () => {
  prepareMultitool();
  const { creaseSplit } = await import('../crease-normals.js');
  const { buildBinaryStl } = await import(path.join(mtBuild, 'mesh-tools.js'));
  const figure = await makeFigure(), reduced = await reduceModel(figure, 0.1);                    // a clean 10% reduction
  const g = reduced.children[0].geometry, cs = creaseSplit(g.attributes.position.array, g.index.array, { creaseDeg: 55 });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(cs.positions, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(cs.normals, 3)); geo.setIndex(new THREE.BufferAttribute(cs.indices, 1));
  const creased = new THREE.Group(); creased.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial())); creased.updateMatrixWorld(true);
  ok(cs.splitVertices > 0, `L setup: ${cs.splitVertices} vertices were split at hard edges`);
  const h = await healthOf(creased), h0 = await healthOf(reduced);
  ok(h.clean === h0.clean && h.triangles === h0.triangles && h.points === h0.points, `L health is identical to the plain reduction (clean ${h.clean}, ${h.triangles} triangles, ${h.points} points)`);
  const stl = buildBinaryStl({ THREE, model: creased, mmPerUnit: 1, zUp: true }), stl0 = buildBinaryStl({ THREE, model: reduced, mmPerUnit: 1, zUp: true });
  ok(stl.triangles === stl0.triangles && stl.buffer.byteLength === stl0.buffer.byteLength, `L the STL export is the same size as without the shading split (${stl.triangles} triangles)`);
  const parsed = await readStl(new Uint8Array(stl.buffer)); ok((await stlHealth(parsed)).clean, 'L the exported STL is watertight');
  const page = await makePage({ model: figure, heightMm: 40 });
  page.w.__shrinkSetWorkingModel(creased);
  page.$('v2FuseBtn').click();
  ok(await waitFor(() => window.__shrinkWorkingModel() !== creased, 30000), 'L FUSE IT works on a creased model');
  ok((await healthOf(window.__shrinkWorkingModel())).clean, 'L and the fused result is clean');
  await joint(page, 'flat'); await pick(page, '2'); page.$('v2DownloadBtn').click();
  ok(await waitFor(() => zipOf(page), 30000), 'L it can then be split');
  const r = await readParts(page); ok(r.parts.length === 2 && (await Promise.all(r.parts.map(p => stlHealth(p.stl)))).every(x => x.clean), 'L both sections are watertight');
});

console.log(failures() ? `\n${failures()} FAILED` : '\nall passed');
process.exit(failures() ? 1 : 0);
