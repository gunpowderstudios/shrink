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
  ok(page.$('v2EditPanel').hidden === true && page.$('v2TabEdit')?.getAttribute('aria-pressed') === 'false' && !page.$('v2EditCard').closest('.v2-main-card') && !page.$('v2TabFinish'), 'ED1 the EDIT tools start folded away in their own panel, with an EDIT button of their own');
  ok(!!page.$('v2EdGo') && /CUT SHAPE OUT/.test(page.$('v2EdGo').textContent), 'ED1 the button reads CUT SHAPE OUT for the default (cut a cube)');
  page.$('v2TabEdit').click(); await wait(100);
  ok(page.$('v2EditPanel').hidden === false && page.$('v2TabEdit').getAttribute('aria-pressed') === 'true', 'ED2 clicking EDIT drops the panel down');
  ok(page.$('v2EdTab').value === 'lasso' && page.$('v2EdLassoBox').hidden === false, 'ED2 the first time EDIT opens the Lasso is already selected');
  set(page, 'v2EdTab', 'shape'); await wait(60);
  ok(!!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview') || !w.__shrinkViewer, 'ED2 the Shape tool shows its preview');

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
  ok(page.$('v2EdLassoBox').hidden === false && page.$('v2EdGo').hidden === true && page.$('v2EdShapeBox').hidden === true && page.$('v2EdDepth').value === 'near' && /DELETE/.test(page.$('v2LassoDelBtn').textContent) && /COPY/.test(page.$('v2LassoKeepBtn').textContent), 'ED10 the Lasso tool shows DELETE / COPY and hides the shape controls');
  ok(page.$('v2LassoDelBtn').disabled === true, 'ED10 DELETE waits until a loop is drawn');
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'), 'ED10 no shape preview while lassoing');
  set(page, 'v2EdTab', 'razor'); await wait(50);
  ok(page.$('v2EdDepth').value === 'through' && /CUT OFF$/.test(page.$('v2LassoDelBtn').textContent.trim()) && /CUT OFF & KEEP/.test(page.$('v2LassoKeepBtn').textContent), 'ED10 the Razor cuts right through and reads CUT OFF / CUT OFF & KEEP');
  set(page, 'v2EdTab', 'shape'); await wait(50);
  ok(page.$('v2EdLassoBox').hidden === true && page.$('v2EdRun').hidden === false, 'ED10 going back to Shape hides the lasso controls');
  page.$('v2TabEdit').click(); await wait(50);
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview') && page.$('v2EditPanel').hidden === true, 'ED11 pressing EDIT again folds the panel away and removes the edit preview');
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
  ok(pressed('tool', 'lasso') === 'true', 'ED14 the Lasso icon is highlighted when EDIT first opens'); set(page, 'v2EdTab', 'shape'); await wait(50);
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
  ok(page.$('v2EdTab').value === 'lasso', 'ED23 EDIT opens on the Lasso'); tool('shape').click(); await wait(50);
  ok(page.$('v2EdTab').value === 'shape', 'ED23 the Shape tool can be picked');
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
/* v2.316: the Sculpt brush (smooth / pull / push) */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(50);
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="sculpt"]').click(); await wait(80);
  ok(page.$('v2EdSculptBox').hidden === false && page.$('v2EdGo').hidden === true && page.$('v2EdSculptMode').value === 'smooth', 'ED28 the Sculpt tool shows its controls (Smooth first)');
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="smode"][data-value="pull"]').click(); await wait(30); ok(page.$('v2EdSculptMode').value === 'pull', 'ED28 the Pull icon picks pull');
  const top = [0, 40, 0], centre = [0, 20, 0];
  const rad = () => { const out = []; w.__shrinkWorkingModel().traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (y > 33) out.push(Math.hypot(x - centre[0], y - centre[1], z - centre[2])); } }); return out; };
  const radCol = () => { const out = []; w.__shrinkWorkingModel().traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (Math.abs(x) < 8 && Math.abs(z) < 8 && y > 20) out.push(Math.hypot(x, y - 20, z)); } }); return out; };
  const sd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); }, mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  { let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;          // roughen the model first
    w.__shrinkWorkingModel().traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i) - 20, z = p.getZ(i), r = Math.hypot(x, y, z) || 1, k = 1 + (rnd() - 0.5) * 0.08; p.setXYZ(i, x * k, y * k + 20, z * k); } p.needsUpdate = true; }); }
  const m0 = w.__shrinkWorkingModel(), t0 = tris(m0), r0 = rad(), s0 = sd(r0);
  ok(w.__shrinkEdit.sculpt(top, 44, 10, 'smooth', [0, 1, 0], 14), 'ED28 a smooth stroke runs');
  const m1 = w.__shrinkWorkingModel(), r1 = rad(), s1 = sd(r1);
  ok(m1 !== m0 && tris(m1) === t0 && s1 < s0 * 0.7 && w.__shrinkEdit.depth() === 1 && /EDITED/.test(page.$('v2HealthChanges').textContent), `ED28 smoothing calms the roughness (${s0.toFixed(3)} -> ${s1.toFixed(3)}), keeps the triangles, adds one undo step and the chip`);
  const mean1 = mean(radCol()); w.__shrinkEdit.sculpt(top, 44, 10, 'pull', [0, 1, 0], 3);
  ok(w.__shrinkWorkingModel() === m1 && mean(radCol()) > mean1 + 0.1, `ED28 PULL raises the surface (${mean1.toFixed(2)} -> ${mean(radCol()).toFixed(2)})`);
  const mean2 = mean(radCol()); w.__shrinkEdit.sculpt(top, 44, 10, 'push', [0, 1, 0], 6);
  ok(mean(radCol()) < mean2 - 0.1, `ED28 PUSH presses it in (${mean2.toFixed(2)} -> ${mean(radCol()).toFixed(2)})`);
  const far = (() => { let n = 0; w.__shrinkWorkingModel().traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 5) n++; }); return n; })();
  ok(far > 0, 'ED28 the far side of the model is still there');
  for (let i = 0; i < 4; i++) { page.$('v2EdUndo').click(); await wait(120); }
  ok(Math.abs(sd(rad()) - s0) < 1e-6 && w.__shrinkEdit.depth() === 0, 'ED28 UNDO steps all the way back to the rough model');
}
/* v2.317: the "too many triangles" warning depends on the tool */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  w.__shrinkFuseTriLimit = 100; page.$('v2TabEdit').click(); await wait(80); set(page, 'v2EdTab', 'shape'); await wait(40);
  const hint = () => page.$('v2EdHint'), tool = v => page.$('v2EditCard').querySelector(`.v2-icon-btn[data-ed="tool"][data-value="${v}"]`);
  ok(!hint().hidden && /Shapes needs under 100/.test(hint().textContent), 'ED29 Shape warns when the model is over the Manifold limit: ' + hint().textContent.slice(0, 90));
  tool('slice').click(); await wait(40); ok(/Slicing needs under/.test(hint().textContent) && /Sculpt tool works on bigger/.test(hint().textContent), 'ED29 Slice names itself and points to Sculpt');
  tool('sculpt').click(); await wait(40); ok(hint().hidden === true, 'ED29 Sculpt shows no warning on a model Manifold would refuse');
  tool('lasso').click(); await wait(40); ok(hint().hidden === false && /DELETE works on the triangles directly/.test(hint().textContent), 'ED29 the plain lasso says DELETE still works on a big model');
  page.$('v2EdWhole').checked = true; page.$('v2EdWhole').dispatchEvent(new w.Event('change', { bubbles: true })); await wait(40); ok(hint().hidden === true, 'ED29 ticking "Grab the whole loose piece" clears it');
  tool('lasso').click(); await wait(40); ok(hint().hidden === true, 'ED29 no tool selected: no warning');
}
/* v2.318: nearest part (auto) and DELETE on a model too big for Manifold */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80);
  ok(page.$('v2EdDepth').value === 'near' && /Nearest part/.test(page.$('v2EdDepth').options[0].textContent) && /Everything under the loop/.test(page.$('v2EdDepth').options[1].textContent), 'ED30 the depth choice is "Nearest part (auto)" by default, with plain-English alternatives');
  const small = () => { const L = orthoCam(page, 0.4, 0.6); return { cam: L.cam, pts: L.pts.map(([x, y]) => [x * 0.12, y]) }; };
  const red = () => { let n = 0; w.__shrinkViewer.scene.getObjectByName('shrinkLassoRed')?.traverse(o => { if (o.isMesh) n = o.geometry.attributes.position.count / 3; }); return n; };
  const S = small(); set(page, 'v2EdDepth', 'through'); const nAll = w.__shrinkEdit.setSel(S.pts, S.cam); set(page, 'v2EdDepth', 'near'); await wait(30); const nNear = red();
  ok(nNear > 0 && nNear < nAll * 0.7, `ED30 "nearest part" marks only the front layer (${nNear} of ${nAll})`);
  const minZ = () => new THREE.Box3().setFromObject(w.__shrinkWorkingModel(), true).min.z, z0 = minZ();
  page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Deleted/.test(page.$('v2EdResult').textContent) && Math.abs(minZ() - z0) < 0.05, `ED30 deleting the nearest part leaves the back of the model alone (back at ${z0.toFixed(2)} -> ${minZ().toFixed(2)})`);
  page.$('v2EdUndo').click(); await wait(200);
  set(page, 'v2EdDepth', 'through'); w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && minZ() > z0 + 0.3, `ED30 "everything under the loop" goes right through (back ${z0.toFixed(2)} -> ${minZ().toFixed(2)})`);
  page.$('v2EdUndo').click(); await wait(200);
  /* too big for Manifold: DELETE works on the triangles and says the hole is open; COPY refuses and the error shows in the viewer */
  w.__shrinkFuseTriLimit = 100; set(page, 'v2EdDepth', 'near'); const t0 = tris(w.__shrinkWorkingModel()); w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /triangles removed/.test(page.$('v2EdResult').textContent) && /FIX IT/.test(page.$('v2EdResult').textContent) && tris(w.__shrinkWorkingModel()) < t0, `ED30 on a model over the limit DELETE removes the triangles directly (${t0} -> ${tris(w.__shrinkWorkingModel())}): ` + page.$('v2EdResult').textContent.slice(0, 90));
  w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoKeepBtn').click();
  ok(await waitFor(() => /Could not/.test(page.$('v2EdResult').textContent), 60000) && /DELETE still works/.test(page.$('v2EdResult').textContent), 'ED30 COPY on a model over the limit explains why');
  ok(!!page.$('v2EdToast') && page.$('v2EdToast').hidden === false && /Could not copy/.test(page.$('v2EdToast').textContent), 'ED30 the failure also shows in the viewer');
}
/* v2.319: grab the pasted part with the mouse (move / turn / size) and see it */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80); set(page, 'v2EdDepth', 'through');
  const L = orthoCam(page, 0.6, 1.3), S = { cam: L.cam, pts: L.pts.map(([x, y]) => [x * 0.3, y]) };
  w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoKeepBtn').click();
  ok(await waitFor(() => /Copied|Could not/.test(page.$('v2EdResult').textContent), 60000) && w.__shrinkEdit.hasPart() && page.$('v2EdTab').value === 'part', 'ED31 COPY hands the piece to the paste tool');
  const st0 = w.__shrinkEdit.partState(); ok(Math.abs(st0.x) > 1, `ED31 a copy starts beside its source, not hidden inside it (x ${st0.x.toFixed(1)} mm)`);
  ok(w.__shrinkEdit.ghosts() === 4 && !!w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview').getObjectByName('shrinkPartGhostSee'), 'ED31 the ghost is drawn twice: solid in front and see-through behind the model');
  ok(!!page.$('v2PartPad') && page.$('v2PartPad').querySelectorAll('[data-pmode]').length === 0, 'ED31 the MOVE / TURN / SIZE mode buttons are gone from the pad');
  ok(page.$('v2EditPanel').contains(page.$('v2PartPad')) && page.$('v2PartPad').nextElementSibling?.id === 'v2EditPane' && w.__shrinkEdit.padVisible(), 'ED31 the pad sits at the top of the EDIT panel, where it is always in view');
  /* MOVE: dragging right by 0.2 of the screen half-width moves the part right by that much in the view plane */
  const ex = L.cam.halfW * 0.2 * st0.h / st0.h; const mm = w.__shrinkPrint.mmPerUnit();
  ok(w.__shrinkEdit.drag('move', [0, 0], [0.2, 0.1], false, L.cam), 'ED31 MOVE drag runs');
  const st1 = w.__shrinkEdit.partState(); ok(Math.abs((st1.x - st0.x) - L.cam.halfW * 0.2 * mm) < 0.05 && Math.abs((st1.y - st0.y) - L.cam.halfH * 0.1 * mm) < 0.05 && Math.abs(st1.z - st0.z) < 0.01, `ED31 MOVE follows the mouse in the screen plane (dx ${(st1.x - st0.x).toFixed(2)} mm, dy ${(st1.y - st0.y).toFixed(2)} mm, dz ${(st1.z - st0.z).toFixed(2)})`);
  w.__shrinkEdit.drag('move', [0, 0], [0, 0.1], true, L.cam); const st2 = w.__shrinkEdit.partState(); ok(Math.abs(st2.z - st1.z) > 0.5 && Math.abs(st2.x - st1.x) < 0.01, 'ED31 Shift+drag moves it nearer / farther');
  w.__shrinkEdit.drag('turn', [0, 0], [0.25, 0], false, L.cam); const st3 = w.__shrinkEdit.partState(); ok(st3.rot && Math.abs(st3.rot[3]) < 0.95 && Math.abs(st3.rot[1]) > 0.2, 'ED31 TURN spins it about the screen-up axis');
  w.__shrinkEdit.drag('size', [0, 0], [0, 0.2], false, L.cam); const st4 = w.__shrinkEdit.partState(); ok(st4.h > st3.h * 1.3, `ED31 SIZE: dragging up enlarges it (${st3.h} -> ${st4.h} mm)`);
  w.__shrinkEdit.drag('size', [0, 0.2], [0, 0], false, L.cam); ok(Math.abs(w.__shrinkEdit.partState().h - st3.h) < 0.05, 'ED31 and dragging back down reduces it to the same size');
  { const cam = L.cam, picks = new Set(), TH = w.__shrinkApp.THREE, bb = new TH.Box3().setFromObject(w.__shrinkWorkingModel(), true).getCenter(new TH.Vector3()), q = w.__shrinkEdit.partState(), mmu = w.__shrinkPrint.mmPerUnit();
    const cx = (bb.x + q.x / mmu - cam.world[12]) / cam.halfW, cy = (bb.y + q.y / mmu - cam.world[13]) / cam.halfH;
    for (let x = cx - 0.3; x <= cx + 0.3; x += 0.004) for (let y = cy - 0.3; y <= cy + 0.3; y += 0.004) { const k = w.__shrinkEdit.gizmoPick([x, y], cam); if (k) picks.add(k.kind + k.axis); }
    ok([...picks].some(k => k.startsWith('arrow')) && [...picks].some(k => k.startsWith('ring')), 'ED36 the green piece has pickable arrows and rings: ' + [...picks].join(',')); }
  { const g = w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview'), gz = g.getObjectByName('shrinkPartGizmo'); let n = 0; gz.traverse(o => { if (o.isMesh) n++; }); ok(!!gz && n === 9, 'ED36 the gizmo draws 3 arrows (shaft + head) and 3 rings: ' + n + ' meshes'); }
  { const a = w.__shrinkEdit.partState(); ok(w.__shrinkEdit.gizmoDrag('arrow', 0, [0, 0], [0.15, 0], L.cam), 'ED36 arrow drag runs'); const b = w.__shrinkEdit.partState(); ok(Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) < 0.01 && Math.abs(b.z - a.z) < 0.01, `ED36 the X arrow moves the part along X only (${(b.x - a.x).toFixed(2)} mm)`); }
  { const a = w.__shrinkEdit.partState(); ok(w.__shrinkEdit.gizmoDrag('ring', 2, [0.2, 0.0], [0.2, 0.15], L.cam) || w.__shrinkEdit.gizmoDrag('ring', 2, [0.3, 0.0], [0.3, 0.2], L.cam), 'ED36 ring drag runs'); const b = w.__shrinkEdit.partState(); ok(b.rot && a.rot && b.rot.some((v, i) => Math.abs(v - a.rot[i]) > 0.02), 'ED36 the roll ring turns the part'); }
  { const h0 = w.__shrinkEdit.partState().h; page.$('v2PartHud').querySelector('[data-hud="bigger"]').click(); const h1 = w.__shrinkEdit.partState().h; page.$('v2PartHud').querySelector('[data-hud="smaller"]').click(); const h2 = w.__shrinkEdit.partState().h;
    ok(w.__shrinkEdit.hudVisible() && Math.abs(h1 / h0 - 1.1) < 0.01 && Math.abs(h2 - h0) < 0.05, `ED36 the + / − on the piece enlarge and reduce it (${h0} -> ${h1} -> ${h2} mm)`);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: '+', bubbles: true })); ok(w.__shrinkEdit.partState().h > h2 * 1.05, 'ED36 the + key enlarges it too'); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: '-', bubbles: true })); }
  const t0 = tris(w.__shrinkWorkingModel()); page.$('v2EdResult').textContent = ''; page.$('v2PadPlace').click();
  ok(await waitFor(() => /Joined|Pasted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Joined/.test(page.$('v2EdResult').textContent), 'ED31 PLACE IT still pastes the moved part: ' + page.$('v2EdResult').textContent.slice(0, 100));
}
/* v2.320: keyboard shortcuts */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  const key = (k, o = {}) => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80); set(page, 'v2EdDepth', 'through');
  const L = orthoCam(page, 0.6, 1.3), S = { cam: L.cam, pts: L.pts.map(([x, y]) => [x * 0.3, y]) }, t0 = tris(w.__shrinkWorkingModel());
  w.__shrinkEdit.setSel(S.pts, S.cam); key('c', { ctrlKey: true });
  ok(await waitFor(() => w.__shrinkEdit.hasPart(), 60000) && page.$('v2EdTab').value === 'part', 'ED32 Ctrl+C copies the red part');
  const r0 = w.__shrinkEdit.partState().rot; key('x'); const r1 = w.__shrinkEdit.partState().rot; key('X'); const r2 = w.__shrinkEdit.partState().rot;
  ok(r1 && Math.abs(r1[0]) > 0.1 && (!r2 || Math.abs(r2[0]) < 0.01), 'ED32 X turns the floating part about X, Shift+X turns it back');
  key('y'); const r3 = w.__shrinkEdit.partState().rot; ok(r3 && Math.abs(r3[1]) > 0.1, 'ED32 Y turns it about Y'); key('z'); ok(Math.abs(w.__shrinkEdit.partState().rot[2]) > 0.05, 'ED32 Z turns it about Z');
  page.$('v2EdResult').textContent = ''; key('v', { ctrlKey: true });
  ok(await waitFor(() => /Joined|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Joined/.test(page.$('v2EdResult').textContent), 'ED32 Ctrl+V places the part');
  key('z', { ctrlKey: true }); await wait(250); ok(Math.abs(tris(w.__shrinkWorkingModel()) - t0) < 2 && w.__shrinkEdit.depth() === 0, 'ED32 Ctrl+Z undoes it');
  page.$('v2EdTab').value = 'sculpt'; page.$('v2EdTab').dispatchEvent(new w.Event('change', { bubbles: true })); await wait(40);
  const s0 = Number(page.$('v2SculptSize').value); key('+'); const s1 = Number(page.$('v2SculptSize').value); key('-'); key('-'); const s2 = Number(page.$('v2SculptSize').value);
  ok(s1 > s0 && s2 < s1, `ED32 + and - change the Sculpt tip size (${s0} -> ${s1} -> ${s2})`);
  set(page, 'v2EdTab', 'lasso'); w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2EdResult').textContent = ''; key('Delete');
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Deleted/.test(page.$('v2EdResult').textContent), 'ED32 Delete removes the red part');
}
/* v2.321: EDIT has its own button and panel, independent of ADVANCED */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const dash = page.$('v2LeftToggle').closest('.print-v2-dashboard') || w.document.querySelector('.print-v2-dashboard');
  ok(dash.dataset.left === 'closed' && page.$('v2EditPanel').hidden === true, 'ED33 ADVANCED and the edit panel both start closed');
  const adv = page.$('v2LeftToggle'), ed = page.$('v2TabEdit'); ok(!!ed && adv.parentElement === ed.parentElement && adv.nextElementSibling === ed, 'ED33 the EDIT button sits right next to ADVANCED');
  ed.click(); await wait(80);
  ok(page.$('v2EditPanel').hidden === false && dash.dataset.left === 'closed' && !page.$('v2EditPanel').closest('.v2-left-stack') && page.$('v2EditPanel').contains(page.$('v2EditCard')), 'ED33 EDIT opens its own panel while ADVANCED stays closed');
  page.$('v2EditPanel').querySelector('.v2-edit-close').click(); await wait(50);
  ok(page.$('v2EditPanel').hidden === true && ed.getAttribute('aria-pressed') === 'false', 'ED33 the close button folds it away');
  adv.click(); await wait(50); ed.click(); await wait(50); ok(dash.dataset.left === 'open' && page.$('v2EditPanel').hidden === false, 'ED33 both can be open together');
}
/* v2.323: the overlap with the model turns red */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80); set(page, 'v2EdDepth', 'through');
  const L = orthoCam(page, 0.6, 1.3), S = { cam: L.cam, pts: L.pts.map(([x, y]) => [x * 0.3, y]) };
  w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2LassoKeepBtn').click(); await waitFor(() => w.__shrinkEdit.hasPart(), 60000);
  const red = () => { let n = 0; w.__shrinkViewer.scene.getObjectByName('shrinkPartOverlap')?.traverse(o => { if (o.isMesh) n = o.geometry.attributes.position.count / 3; }); return n; };
  set(page, 'v2EdPartX', 500); const apart = w.__shrinkEdit.overlap();
  ok(apart === 0 && red() === 0 && /Not touching/.test(page.$('v2PadJoin').textContent), 'ED34 far from the model: nothing red, and it says it is not touching');
  w.__shrinkEdit.place('centre'); const inside = w.__shrinkEdit.overlap(), nAll = (() => { const g = w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview'); let n = 0; g?.getObjectByName('shrinkPartGhost')?.geometry && (n = g.getObjectByName('shrinkPartGhost').geometry.attributes.position.count / 3); return n; })();
  ok(inside > 0 && red() === inside && page.$('v2PadJoin').dataset.state === 'joined' && /Red = where it overlaps/.test(page.$('v2PadJoin').textContent), `ED34 sunk into the model: the overlap turns red (${inside} of ${nAll} triangles) and the note says it will join`);
  ok(inside >= nAll * 0.9, 'ED34 a part sitting wholly inside the model is red all over');
  /* straddling the surface: only part of it is red */
  w.__shrinkEdit.place('centre'); const st = w.__shrinkEdit.partState(); let part = -1, shift = 0; for (const dy of [6, 8, 10, 11, 12, 13, 14]) { set(page, 'v2EdPartY', st.y + dy); const n = w.__shrinkEdit.overlap(); if (n > 0 && n < nAll) { part = n; shift = dy; break; } }
  ok(part > 0 && part < nAll, `ED34 half in, half out: only the buried part is red (${part} of ${nAll}, raised ${shift} mm)`);
  set(page, 'v2EdPartX', 500); w.__shrinkEdit.overlap(); ok(red() === 0, 'ED34 moving it away clears the red');
}
/* v2.324: the right-hand modules step aside while EDIT is open */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const b = w.document.body; ok(!b.classList.contains('v2-editing'), 'ED35 the side modules show while EDIT is closed');
  page.$('v2TabEdit').click(); await wait(50); ok(b.classList.contains('v2-editing'), 'ED35 opening EDIT hides the health box, SHRINK and DOWNLOAD (body.v2-editing)');
  page.$('v2EditPanel').querySelector('.v2-edit-close').click(); await wait(50); ok(!b.classList.contains('v2-editing'), 'ED35 closing EDIT brings them back');
  const css = (await import('node:fs')).readFileSync(new URL('../print-v2-ui.css', import.meta.url), 'utf8'); ok(/body\.v2-editing #v2HealthCard,body\.v2-editing #v2SideStack\{display:none!important\}/.test(css), 'ED35 the stylesheet hides both modules');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  w.__shrinkViewer = { scene: new w.__shrinkApp.THREE.Scene() }; page.$('v2TabEdit').click(); await wait(50); set(page, 'v2EdTab', 'part'); await wait(50);
  const cube = []; const P = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  for (const f of F) for (const i of f) cube.push(...P[i].map(v => v * 2));
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'a.stl'); await wait(50); set(page, 'v2EdPartX', 6); w.__shrinkEdit.preview?.();
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'b.stl'); await wait(50);
  ok(w.__shrinkEdit.parked() === 1 && w.__shrinkEdit.hasPart(), 'ED37 a second piece does not replace the first: it floats beside it');
  const sc = w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview'); ok(!!sc.getObjectByName('shrinkParkedGhost') && !!sc.getObjectByName('shrinkPartGlow') && !!sc.getObjectByName('shrinkPartGhost'), 'ED37 both pieces are drawn green and the selected one glows');
  w.__shrinkEdit.dup(); ok(w.__shrinkEdit.parked() === 2, 'ED37 COPY PIECE makes another floating piece');
  ok(w.__shrinkEdit.select(0) && w.__shrinkEdit.parked() === 2 && Math.abs(w.__shrinkEdit.partState().x - 6) < 0.01, 'ED37 selecting a waiting piece brings it back with its own position (x 6)');
  ok(/3 floating/.test(page.$('v2PartPad').querySelector('.v2-pad-title').textContent) && page.$('v2PadAll').hidden === false, 'ED37 the pad counts the floating pieces and offers WELD ALL');
  w.__shrinkEdit.setSel(null); set(page, 'v2EdTab', 'lasso'); await wait(50); ok(!!w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview')?.getObjectByName('shrinkParkedGhost'), 'ED37 the pieces stay on screen while another tool is used'); set(page, 'v2EdTab', 'part'); await wait(50);
  page.$('v2EdResult').textContent = ''; page.$('v2PadAll').click(); ok(await waitFor(() => !w.__shrinkEdit.hasPart() && w.__shrinkEdit.parked() === 0, 90000), 'ED37 WELD ALL joins every floating piece: ' + page.$('v2EdResult').textContent.slice(0, 100));
  ok(!w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview')?.getObjectByName('shrinkPartGhost'), 'ED37 nothing is left floating afterwards');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  w.__shrinkViewer = { scene: new w.__shrinkApp.THREE.Scene() }; page.$('v2TabEdit').click(); await wait(50); set(page, 'v2EdTab', 'part'); await wait(50);
  const cube = []; const P = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  for (const f of F) for (const i of f) cube.push(...P[i].map(v => v * 2));
  ok(page.$('v2PiecesSave')?.disabled === true && !!page.$('v2PiecesLoad'), 'ED38 SAVE PIECES waits until there is a piece; LOAD PIECES is always there');
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'a.stl'); await wait(50); set(page, 'v2EdPartX', 6); set(page, 'v2EdPartH', 12);
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'b.stl'); await wait(50); set(page, 'v2EdPartX', -4);
  ok(page.$('v2PiecesSave').disabled === false && page.$('v2SavePiecesRow')?.hidden === false, 'ED38 with pieces floating, SAVE PIECES is on and DOWNLOAD IT offers to save them too');
  const bytes = w.__shrinkEdit.piecesFile(); ok(bytes && bytes.length > 100, 'ED38 the pieces file is built (' + (bytes?.length) + ' bytes)');
  let got = null; w.__shrinkCapture = (b, n) => { got = n; return true; }; w.__shrinkEdit.savePieces(); ok(/-pieces\.shrinkparts$/.test(got || ''), 'ED38 it downloads as ' + got); w.__shrinkCapture = null;
  w.__shrinkEdit.reset(); await wait(100); ok(w.__shrinkEdit.parked() === 0 && !w.__shrinkEdit.hasPart(), 'ED38 reset clears the floating pieces');
  const n = w.__shrinkEdit.loadPieces(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); await wait(50);
  ok(n === 2 && w.__shrinkEdit.parked() === 1 && w.__shrinkEdit.hasPart(), 'ED38 loading brings both pieces back');
  ok(Math.abs(w.__shrinkEdit.partState().x - -4) < 0.01, 'ED38 the selected piece is where it was saved (x -4)'); w.__shrinkEdit.select(0); ok(Math.abs(w.__shrinkEdit.partState().x - 6) < 0.01 && Math.abs(w.__shrinkEdit.partState().h - 12) < 0.01, 'ED38 the other piece kept its place and size (x 6, 12 mm)');
  let bad = ''; try { w.__shrinkEdit.loadPieces(new TextEncoder().encode('nonsense nonsense').buffer); } catch (e) { bad = String(e.message); } ok(/not a SHRINK/.test(bad), 'ED38 a wrong file is refused politely');
}
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('edit-ui tests passed'); process.exit(0);
