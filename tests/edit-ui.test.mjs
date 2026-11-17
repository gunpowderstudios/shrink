// EDIT MODEL card on a jsdom page (real print-v2-ui.js, fuse-export.js, edit-core.js, Manifold): shape cut/join, slice off, undo.
import { makePage, models, ok, failures, wait } from './mt-harness.mjs';
const waitFor = async (fn, ms = 90000, step = 100) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await wait(step); } return !!(await fn()); };
const tris = m => { let n = 0; m.traverse(o => { if (o.isMesh) n += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; }); return n; };
const set = (page, id, v) => { const e = page.$(id); e.value = String(v); e.dispatchEvent(new page.w.Event('input', { bubbles: true })); e.dispatchEvent(new page.w.Event('change', { bubbles: true })); };
const orthoCam = (page, yLo, yHi) => {          // an orthographic camera in front of the model: the loop covers the model's height between yLo and yHi (fractions of its height), all across
  const THREE = page.w.__shrinkApp.THREE, b = new THREE.Box3().setFromObject(page.w.__shrinkWorkingModel(), true), c = b.getCenter(new THREE.Vector3()), H = Math.max(b.max.y - b.min.y, b.max.x - b.min.x, b.max.z - b.min.z), h = b.max.y - b.min.y;
  const ndcY = f => (b.min.y + h * f - c.y) / H;
  return { cam: { world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, c.x, c.y, c.z + H * 5, 1], persp: false, halfW: H, halfH: H }, pts: [[-1, ndcY(yLo)], [1, ndcY(yLo)], [1, ndcY(yHi)], [-1, ndcY(yHi)]] };
};
const height = (page, THREE = page.w.__shrinkApp?.THREE) => { const b = new THREE.Box3().setFromObject(page.w.__shrinkWorkingModel(), true); return b.max.y - b.min.y; };

{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const card = page.$('v2EditCard'); ok(!!card && !!page.$('v2EditPane')?.contains(card), 'ED1 the Edit model card lives in the EDIT pane');
  ok(page.$('v2EditCard').closest('.v2-main-card').dataset.tab === 'finish' && page.$('v2TabEdit')?.getAttribute('aria-selected') === 'false', 'ED1 the page opens on SHRINK & FINISH, not EDIT');
  ok(!!page.$('v2EdGo') && /CUT SHAPE OUT/.test(page.$('v2EdGo').textContent), 'ED1 the button reads CUT SHAPE OUT for the default (cut a cube)');
  page.$('v2TabEdit').click(); await wait(100);
  ok(page.$('v2EditCard').closest('.v2-main-card').dataset.tab === 'edit' && page.$('v2TabFinish').getAttribute('aria-selected') === 'false', 'ED2 clicking EDIT switches the tab');
  ok(!!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview') || !w.__shrinkViewer, 'ED2 the EDIT tab shows the shape preview');

  const t0 = tris(w.__shrinkWorkingModel()), m0 = w.__shrinkWorkingModel();
  set(page, 'v2EdKind', 'ball'); set(page, 'v2EdW', 12); set(page, 'v2EdH', 12); set(page, 'v2EdD', 12);
  page.$('v2EdGo').click();
  ok(await waitFor(() => /Cut|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Cut/.test(page.$('v2EdResult').textContent), 'ED3 a ball cut finishes: ' + page.$('v2EdResult').textContent.slice(0, 140));
  ok(w.__shrinkWorkingModel() !== m0 && tris(w.__shrinkWorkingModel()) > t0, `ED3 the result is the new working model with more triangles (${t0} -> ${tris(w.__shrinkWorkingModel())})`);
  ok(/EDITED/.test(page.$('v2HealthChanges').textContent), 'ED4 an EDITED chip appears');
  ok(page.$('v2EdUndo').hidden === false && w.__shrinkEdit.depth() === 1, 'ED5 UNDO appears');
  page.$('v2EdUndo').click(); await wait(200);
  ok(Math.abs(tris(w.__shrinkWorkingModel()) - t0) < 2 && !/EDITED/.test(page.$('v2HealthChanges').textContent) && page.$('v2EdUndo').hidden, 'ED6 UNDO restores the model, chip and button');

  /* slice off the top half: the model gets shorter */
  const h0 = height(page);
  set(page, 'v2EdTab', 'slice'); await wait(50);
  ok(page.$('v2EdSliceBox').hidden === false && /SLICE OFF/.test(page.$('v2EdGo').textContent), 'ED7 the Slice tool shows its own controls');
  set(page, 'v2EdPos', 50); set(page, 'v2EdSide', 'high');
  page.$('v2EdGo').click();
  ok(await waitFor(() => /Sliced|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Sliced/.test(page.$('v2EdResult').textContent), 'ED8 slice finishes: ' + page.$('v2EdResult').textContent.slice(0, 140));
  const h1 = height(page); ok(h1 < h0 * 0.6 && h1 > h0 * 0.4, `ED8 the top half is gone (height ${h0.toFixed(2)} -> ${h1.toFixed(2)})`);
  /* a cut that removes everything is refused and nothing changes */
  set(page, 'v2EdPos', 0); set(page, 'v2EdSide', 'high'); const mKeep = w.__shrinkWorkingModel(); page.$('v2EdGo').click();
  ok(await waitFor(() => /Could not edit/.test(page.$('v2EdResult').textContent), 60000) && w.__shrinkWorkingModel() === mKeep, 'ED9 removing everything is refused and the model stays');

  /* lasso and razor tools: their own controls, no shape preview */
  set(page, 'v2EdTab', 'lasso'); await wait(50);
  ok(page.$('v2EdLassoBox').hidden === false && page.$('v2EdGo').hidden === true && page.$('v2EdShapeBox').hidden === true && page.$('v2EdDepth').value === 'front' && /DELETE/.test(page.$('v2LassoDelBtn').textContent) && /COPY/.test(page.$('v2LassoKeepBtn').textContent), 'ED10 the Lasso tool shows DELETE / COPY and hides the shape controls');
  ok(page.$('v2LassoDelBtn').disabled === true, 'ED10 DELETE waits until a loop is drawn');
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'), 'ED10 no shape preview while lassoing');
  set(page, 'v2EdTab', 'razor'); await wait(50);
  ok(page.$('v2EdDepth').value === 'through' && /CUT OFF$/.test(page.$('v2LassoDelBtn').textContent.trim()) && /CUT OFF & KEEP/.test(page.$('v2LassoKeepBtn').textContent), 'ED10 the Razor cuts right through and reads CUT OFF / CUT OFF & KEEP');
  set(page, 'v2EdTab', 'shape'); await wait(50);
  ok(page.$('v2EdLassoBox').hidden === true && page.$('v2EdRun').hidden === false, 'ED10 going back to Shape hides the lasso controls');
  page.$('v2TabFinish').click(); await wait(50);
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview') && page.$('v2EditCard').closest('.v2-main-card').dataset.tab === 'finish', 'ED11 SHRINK & FINISH removes the edit preview');
  /* an edit after hollowing is refused */
  w.__shrinkMarkApplied('shrunk'); page.$('v2HollowWall').value = '2'; page.$('v2HollowBtn').click();
  await waitFor(() => /Hollowed|Could not/.test(page.$('v2HollowResult').textContent), 110000);
  page.$('v2TabEdit').click(); await wait(100);
  ok(/already hollow/.test(page.$('v2EdHint').textContent) && page.$('v2EdHint').hidden === false, 'ED12 the EDIT tab warns when the model is already hollow');
  set(page, 'v2EdTab', 'shape'); const mHol = w.__shrinkWorkingModel(); page.$('v2EdGo').click();
  ok(await waitFor(() => /Could not edit/.test(page.$('v2EdResult').textContent), 60000) && w.__shrinkWorkingModel() === mHol, 'ED12 editing a hollow model is refused and nothing changes');
}

/* lasso DELETE: loop round the top 30 %, the hole is capped, undo brings it back */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(100); set(page, 'v2EdDepth', 'through');
  const m0 = w.__shrinkWorkingModel(), h0 = height(page), L = orthoCam(page, 0.7, 1.3);
  w.__shrinkEdit.setSel(L.pts, L.cam); await wait(30); ok(page.$('v2LassoDelBtn').disabled === false, 'ED13 DELETE is enabled once a loop exists');
  page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 90000) && /Deleted/.test(page.$('v2EdResult').textContent), 'ED13 the lasso deletes: ' + page.$('v2EdResult').textContent.slice(0, 140));
  ok(w.__shrinkWorkingModel() !== m0 && Math.abs(height(page) - h0 * 0.7) < h0 * 0.05 && /EDITED/.test(page.$('v2HealthChanges').textContent) && !w.__shrinkEdit.hasSel(), `ED13 the top 30 % is gone (${h0.toFixed(1)} -> ${height(page).toFixed(1)}), the chip shows and the loop is cleared`);
  page.$('v2EdUndo').click(); await wait(200); ok(Math.abs(height(page) - h0) < 0.01, 'ED13 UNDO brings it back');
  page.$('v2EdResult').textContent = ''; w.__shrinkEdit.setSel(orthoCam(page, 3, 4).pts, orthoCam(page, 3, 4).cam); page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Could not/.test(page.$('v2EdResult').textContent), 60000) && /did not catch/.test(page.$('v2EdResult').textContent), 'ED13 a loop beside the model is refused: ' + page.$('v2EdResult').textContent.slice(0, 90));
}

/* icons and the brush tip ring */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(100);
  const pressed = (g, v) => page.$('v2EditCard').querySelector(`.v2-icon-btn[data-ed="${g}"][data-value="${v}"]`)?.getAttribute('aria-pressed');
  ok(page.$('v2EditCard').querySelectorAll('.v2-icon-btn svg').length >= 9, 'ED14 the tool, shape and join/cut choices are icon buttons');
  ok(pressed('tool', 'shape') === 'true' && pressed('kind', 'cube') === 'true' && pressed('mode', 'cut') === 'true', 'ED14 the defaults are highlighted');
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="kind"][data-value="ball"]').click(); await wait(50);
  ok(page.$('v2EdKind').value === 'ball' && pressed('kind', 'ball') === 'true' && pressed('kind', 'cube') === 'false', 'ED14 clicking the Ball icon picks ball');
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="slice"]').click(); await wait(50);
  ok(page.$('v2EdTab').value === 'slice' && page.$('v2EdSliceBox').hidden === false && pressed('tool', 'slice') === 'true', 'ED14 clicking the Slice icon opens the slice controls');
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="razor"]').click(); await wait(50);
  ok(page.$('v2EdTab').value === 'razor' && pressed('tool', 'razor') === 'true' && !page.$('v2EditCard').querySelector('.v2-icon-btn[data-value="brush"]'), 'ED14 the Razor icon is there and the pink/orange Brush icon is gone');
}

/* Part tool: slice the top off, then sit an uploaded part on top and join it */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(50);
  set(page, 'v2EdTab', 'slice'); set(page, 'v2EdPos', 50); set(page, 'v2EdSide', 'high'); page.$('v2EdGo').click();
  await waitFor(() => /Sliced|Could not/.test(page.$('v2EdResult').textContent), 60000);
  const h0 = height(page);
  set(page, 'v2EdTab', 'part'); await wait(50);
  ok(page.$('v2EdPartBox').hidden === false && page.$('v2EdModeRow').hidden === false && page.$('v2EdShapeBox').hidden === true, 'ED16 the Part tool shows the file chooser and Join / Cut');
  ok(page.$('v2EdGo').dataset.needPart === 'true', 'ED16 the button waits for a part file');
  page.$('v2EdGo').click(); await wait(100); ok(/Choose a part file/.test(page.$('v2EdResult').textContent), 'ED16 pressing it with no part says so');
  const cube = []; const P = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  for (const f of F) for (const i of f) cube.push(...P[i].map(v => v * 5));
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'head.stl'); await wait(100);
  ok(w.__shrinkEdit.hasPart() && /head.stl: loaded/.test(page.$('v2EdPartInfo').textContent) && page.$('v2EdGo').dataset.needPart === 'false', 'ED17 a loaded part is announced');
  ok(!!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview') || !w.__shrinkViewer, 'ED17 the part ghost is previewed');
  set(page, 'v2EdMode', 'join'); await wait(30); ok(/JOIN PART ON/.test(page.$('v2EdGo').textContent), 'ED17 the button reads JOIN PART ON');
  page.$('v2EdPartTop').click(); await wait(50); page.$('v2EdResult').textContent = '';
  page.$('v2EdGo').click();
  ok(await waitFor(() => /Joined|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Joined/.test(page.$('v2EdResult').textContent), 'ED18 the part joins: ' + page.$('v2EdResult').textContent.slice(0, 140));
  const h1 = height(page), want = h0 + Number(page.$('v2EdPartH').value) - 1;
  ok(Math.abs(h1 - want) < 1.2 && /in 1 piece/.test(page.$('v2EdResult').textContent), `ED18 it sits on top as one piece (height ${h0.toFixed(1)} -> ${h1.toFixed(1)}, expected about ${want.toFixed(1)})`);
  ok(!w.__shrinkEdit.hasPart() && w.__shrinkEdit.depth() === 2, 'ED18 the part is used up and the edit can be undone');
}

/* Lasso COPY then the arrow pad and PLACE IT; razor CUT OFF & KEEP */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(50);
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="lasso"]').click(); await wait(80); set(page, 'v2EdDepth', 'through');
  const m0 = w.__shrinkWorkingModel(), h0 = height(page), L = orthoCam(page, 0.5, 1.3);
  w.__shrinkEdit.setSel(L.pts, L.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoKeepBtn').click();
  ok(await waitFor(() => /Copied|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Copied/.test(page.$('v2EdResult').textContent), 'ED20 COPY works: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(w.__shrinkWorkingModel() === m0 && w.__shrinkEdit.depth() === 0, 'ED20 copying leaves the model alone');
  ok(page.$('v2EdTab').value === 'part' && w.__shrinkEdit.hasPart() && /Copied piece ready/.test(page.$('v2EdPartInfo').textContent) && /PASTE PART ON/.test(page.$('v2EdGo').textContent) && page.$('v2EdMode').value === 'join', 'ED20 the copied piece is ready to paste (join)');
  if (w.document.getElementById('viewer')) ok(w.__shrinkEdit.padVisible(), 'ED20 the arrow pad pops up'); 
  /* the pad: up, bigger, tilt */
  const y0 = Number(page.$('v2EdPartY').value), hh = Number(page.$('v2EdPartH').value);
  w.__shrinkEdit.pad('up'); w.__shrinkEdit.pad('up'); ok(Number(page.$('v2EdPartY').value) > y0 + 1, `ED21 the up arrow moves the part up (${y0} -> ${page.$('v2EdPartY').value})`);
  w.__shrinkEdit.pad('right'); ok(Math.abs(Number(page.$('v2EdPartX').value)) > 0.5, 'ED21 the right arrow moves it sideways');
  w.__shrinkEdit.pad('bigger'); ok(Number(page.$('v2EdPartH').value) > hh, 'ED21 BIGGER enlarges it'); w.__shrinkEdit.pad('smaller'); w.__shrinkEdit.pad('smaller'); ok(Number(page.$('v2EdPartH').value) < hh, 'ED21 SMALLER reduces it');
  w.__shrinkEdit.pad('tiltL'); w.__shrinkEdit.pad('tiltD'); ok(w.__shrinkEdit.hasPart(), 'ED21 tilting does not lose the part');
  w.__shrinkEdit.pad('tiltR'); w.__shrinkEdit.pad('tiltU'); w.__shrinkEdit.pad('smaller'); w.__shrinkEdit.pad('bigger'); w.__shrinkEdit.pad('bigger');
  Array.from({ length: 12 }).forEach(() => w.__shrinkEdit.pad('up'));
  page.$('v2EdResult').textContent = ''; page.$('v2EdGo').click();
  ok(await waitFor(() => /Joined|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Joined/.test(page.$('v2EdResult').textContent), 'ED21 PLACE IT joins it: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(height(page) > h0 + 5, `ED21 the pasted copy made the model taller (${h0.toFixed(1)} -> ${height(page).toFixed(1)})`);
  if (w.document.getElementById('viewer')) ok(!w.__shrinkEdit.padVisible(), 'ED21 the pad goes away once the part is placed');
  page.$('v2EdUndo').click(); await wait(200);
  /* razor: cut off and keep */
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="razor"]').click(); await wait(50);
  const h1 = height(page), R = orthoCam(page, 0.5, 1.3); w.__shrinkEdit.setSel(R.pts, R.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoKeepBtn').click();
  ok(await waitFor(() => /Cut off|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Cut off/.test(page.$('v2EdResult').textContent), 'ED22 CUT OFF & KEEP works: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(height(page) < h1 * 0.7 && w.__shrinkEdit.depth() >= 1 && w.__shrinkEdit.hasPart(), `ED22 the piece is off the model (${h1.toFixed(1)} -> ${height(page).toFixed(1)}) and held for pasting`);
  page.$('v2PartPad')?.querySelector('#v2PadCancel')?.click(); if (w.document.getElementById('viewer')) { await wait(50); ok(!w.__shrinkEdit.hasPart() && page.$('v2EdTab').value === 'none', 'ED22 CANCEL puts the part away'); }
}

/* put the tool down (click it again, or Esc) and RESET ALL EDITS */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(50);
  const tool = v => page.$('v2EditCard').querySelector(`.v2-icon-btn[data-ed="tool"][data-value="${v}"]`);
  ok(page.$('v2EdTab').value === 'shape', 'ED23 starts on the Shape tool');
  tool('shape').click(); await wait(50);
  ok(page.$('v2EdTab').value === 'none' && tool('shape').getAttribute('aria-pressed') === 'false' && page.$('v2EdShapeBox').hidden === true && page.$('v2EdRun').hidden === true, 'ED23 clicking the pressed tool puts it down');
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'), 'ED23 and removes its preview');
  tool('lasso').click(); await wait(50); ok(page.$('v2EdTab').value === 'lasso' && page.$('v2EdLassoBox').hidden === false, 'ED23 a tool can be picked again');
  const Lc = orthoCam(page, 0.5, 1); w.__shrinkEdit.setSel(Lc.pts, Lc.cam); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
  ok(page.$('v2EdTab').value === 'lasso' && !w.__shrinkEdit.hasSel(), 'ED24 the first Esc only clears the loop');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
  ok(page.$('v2EdTab').value === 'none', 'ED24 the next Esc puts the lasso down');
  { const h = height(page); w.__shrinkEdit.setSel(Lc.pts, Lc.cam); tool('lasso').click(); await wait(30); set(page, 'v2EdDepth', 'through'); w.__shrinkEdit.setSel(Lc.pts, Lc.cam); page.$('v2EdResult').textContent = ''; w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); 
    ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && height(page) < h * 0.8, 'ED24 the Delete key deletes the loop'); page.$('v2EdUndo').click(); await wait(200); }
  tool('shape').click(); await wait(50); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
  ok(page.$('v2EdTab').value === 'none', 'ED24 Esc also puts down the Shape tool');
  /* two edits, a brush stroke and a part, then reset */
  const m0 = w.__shrinkWorkingModel(), h0 = height(page);
  tool('slice').click(); set(page, 'v2EdPos', 50); set(page, 'v2EdSide', 'high'); page.$('v2EdResult').textContent = ''; page.$('v2EdGo').click();
  await waitFor(() => /Sliced|Could not/.test(page.$('v2EdResult').textContent), 60000);
  tool('shape').click(); set(page, 'v2EdKind', 'ball'); set(page, 'v2EdMode', 'cut'); page.$('v2EdResult').textContent = ''; page.$('v2EdGo').click();
  await waitFor(() => /Cut|Could not/.test(page.$('v2EdResult').textContent), 60000);
  w.__shrinkEdit.setPart(new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1, 1,0,0, 0,0,0]), false, 'x.stl');
  ok(w.__shrinkEdit.depth() === 2 && height(page) < h0 * 0.6 && w.__shrinkEdit.hasPart(), 'ED25 set up: two edits and a part');
  page.$('v2EdReset').click(); await wait(300);
  ok(Math.abs(height(page) - h0) < 0.01 && w.__shrinkEdit.depth() === 0 && !/EDITED/.test(page.$('v2HealthChanges').textContent), `ED25 RESET brings the model back (height ${h0.toFixed(1)} -> ${height(page).toFixed(1)}) and clears the EDITED chip`);
  ok(!w.__shrinkEdit.hasPart() && page.$('v2EdUndo').hidden === true && page.$('v2EdTab').value === 'none' && /Reset/.test(page.$('v2EdResult').textContent), 'ED25 and the part and the tool are cleared');
  page.$('v2EdReset').click(); await wait(100); ok(/Nothing to reset/.test(page.$('v2EdResult').textContent), 'ED25 resetting again says there is nothing to reset');
  void m0;
}
/* v2.314: the red preview of what the loop will take */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80);
  const red = () => w.__shrinkViewer.scene.getObjectByName('shrinkLassoRed'), L = orthoCam(page, 0.5, 1.3);
  set(page, 'v2EdDepth', 'through'); const nAll = w.__shrinkEdit.setSel(L.pts, L.cam);
  ok(nAll > 0 && !!red(), `ED26 a loop marks the triangles inside it red (${nAll})`);
  set(page, 'v2EdDepth', 'front'); await wait(30); const g = red(); let nFront = 0; g?.traverse(o => { if (o.isMesh) nFront = o.geometry.attributes.position.count / 3; });
  ok(nFront > 0 && nFront < nAll, `ED26 "front half only" marks fewer (${nFront} < ${nAll})`);
  const none = orthoCam(page, 3, 4); ok(w.__shrinkEdit.setSel(none.pts, none.cam) === 0 && !red(), 'ED26 a loop beside the model marks nothing');
  w.__shrinkEdit.setSel(L.pts, L.cam); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30);
  ok(!red(), 'ED26 Esc clears the red');
  set(page, 'v2EdDepth', 'through'); w.__shrinkEdit.setSel(L.pts, L.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Deleted/.test(page.$('v2EdResult').textContent) && !red(), 'ED26 DELETE removes the part and the red');
}
/* v2.315: grab the whole loose piece (separate shells) */
{ const page = await makePage({ model: models.multi(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80); set(page, 'v2EdDepth', 'through');
  const tri0 = tris(w.__shrinkWorkingModel()), h0 = height(page), L = orthoCam(page, 0.85, 1.3), chk = page.$('v2EdWhole');
  const nLoop = w.__shrinkEdit.setSel(L.pts, L.cam);
  chk.checked = true; chk.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(50);
  let nRed = 0; w.__shrinkViewer.scene.getObjectByName('shrinkLassoRed')?.traverse(o => { if (o.isMesh) nRed = o.geometry.attributes.position.count / 3; });
  ok(nLoop > 0 && nRed > nLoop && Math.abs(nRed - tri0 / 3) < tri0 * 0.06, `ED27 the whole top sphere turns red, not just the loop (${nLoop} -> ${nRed} of ${tri0})`);
  page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /1 loose piece/.test(page.$('v2EdResult').textContent), 'ED27 DELETE removes it: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(Math.abs(tris(w.__shrinkWorkingModel()) - (tri0 - nRed)) < 2 && height(page) < h0 * 0.8 && /EDITED/.test(page.$('v2HealthChanges').textContent), `ED27 two spheres are left (${tris(w.__shrinkWorkingModel())} triangles, height ${h0.toFixed(1)} -> ${height(page).toFixed(1)})`);
  page.$('v2EdUndo').click(); await wait(200); ok(tris(w.__shrinkWorkingModel()) === tri0, 'ED27 UNDO brings the sphere back');
  /* copy: the piece goes to the paste pad */
  const L2 = orthoCam(page, 0.85, 1.3); w.__shrinkEdit.setSel(L2.pts, L2.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoKeepBtn').click();
  ok(await waitFor(() => /Copied|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Copied/.test(page.$('v2EdResult').textContent) && w.__shrinkEdit.hasPart() && page.$('v2EdTab').value === 'part', 'ED27 COPY hands the loose piece to the paste tool');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80); set(page, 'v2EdDepth', 'through'); page.$('v2EdWhole').checked = true;
  const L = orthoCam(page, 0.6, 1.3); w.__shrinkEdit.setSel(L.pts, L.cam); page.$('v2EdResult').textContent = ''; const m0 = w.__shrinkWorkingModel(); page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Could not/.test(page.$('v2EdResult').textContent), 60000) && /one connected piece/.test(page.$('v2EdResult').textContent) && w.__shrinkWorkingModel() === m0, 'ED27 on a one-piece model it says so and changes nothing');
}
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('edit-ui tests passed'); process.exit(0);
