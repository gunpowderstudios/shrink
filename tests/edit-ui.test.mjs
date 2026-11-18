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
    ok([...picks].some(k => k.startsWith('arrow')) && [...picks].some(k => k.startsWith('ring')) && [...picks].some(k => k.startsWith('plane')), 'ED36/ED49 the piece has pickable arrows and rings: ' + [...picks].join(',')); }
  { const g = w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview'), gz = g.getObjectByName('shrinkPartGizmo'); let n = 0; gz.traverse(o => { if (o.isMesh) n++; }); ok(!!gz && n === 12, 'ED36 the gizmo draws 3 arrows (shaft + head), 3 rings and 3 plane squares: ' + n + ' meshes'); }
  { const ca = Math.cos(0.7), sa = Math.sin(0.7), W = L.cam.world, T = { ...L.cam, world: W.map((_, k) => { const col = Math.floor(k / 4), r = k % 4; if (r === 3) return W[k]; return r === 0 ? W[k] : r === 1 ? ca * W[col * 4 + 1] - sa * W[col * 4 + 2] : sa * W[col * 4 + 1] + ca * W[col * 4 + 2]; }) };   // camera tipped 40 degrees down
    const a = w.__shrinkEdit.partState(); ok(w.__shrinkEdit.gizmoDrag('plane', 1, [0, 0], [0.1, 0.1], T), 'ED49 horizontal plane drag runs'); const b = w.__shrinkEdit.partState(); ok(Math.abs(b.y - a.y) < 0.01 && (Math.abs(b.x - a.x) > 0.01 || Math.abs(b.z - a.z) > 0.01), `ED49 the flat square moves the part on the ground plane only (dx ${(b.x - a.x).toFixed(2)}, dy ${(b.y - a.y).toFixed(2)}, dz ${(b.z - a.z).toFixed(2)})`);
    const c0 = w.__shrinkEdit.partState(); w.__shrinkEdit.gizmoDrag('plane', 2, [0, 0], [0.1, 0.1], L.cam); const c1 = w.__shrinkEdit.partState(); ok(Math.abs(c1.z - c0.z) < 0.01 && Math.abs(c1.x - c0.x) > 0.5 && Math.abs(c1.y - c0.y) > 0.5, 'ED49 an upright square moves it up/down and sideways without changing depth'); }
  { const g = w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview'), m = g.getObjectByName('shrinkPartGhost'); ok(m && m.material.isMeshStandardMaterial && m.material.color.getHex() === 0xa9adb3 && g.getObjectByName('shrinkPartGlow').material.color.getHex() === 0x2f86ff, 'ED49 the part is resin grey with a blue outline'); }
  ok(!!w.document.getElementById('v2UpPart') && !!w.document.getElementById('v2UpPartFile'), 'ED49 UPLOAD A PART button is in the EDIT card');
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
  ok(!!page.$('v2ProjectSave') && !!page.$('v2ProjectLoad') && !page.$('v2PiecesSave') && !page.$('v2SavePiecesRow'), 'ED38 the pieces buttons and the tick box are gone: SAVE PROJECT / LOAD PROJECT take over');
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'a.stl'); await wait(50); set(page, 'v2EdPartX', 6); set(page, 'v2EdPartH', 12);
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'b.stl'); await wait(50); set(page, 'v2EdPartX', -4);
    const bytes = w.__shrinkEdit.piecesFile(); ok(bytes && bytes.length > 100, 'ED38 the pieces file is built (' + (bytes?.length) + ' bytes)');
  w.__shrinkBuildStl = (await import(new URL('./.build/mt/mesh-tools.js', import.meta.url).href)).buildBinaryStl;   // print-tools.js sets this in the real app
  let got = null; w.__shrinkCapture = (b, n) => { got = n; return true; }; await w.__shrinkEdit.saveProject(); ok(/-project\.shrinkproject$/.test(got || ''), 'ED45 SAVE PROJECT downloads as ' + got); w.__shrinkCapture = null;
  { const pf = await w.__shrinkEdit.projectFile(), pr = w.__shrinkEdit.parseProject(pf.buffer.slice(pf.byteOffset, pf.byteOffset + pf.byteLength));
    ok(pr.head.kind === 'project' && pr.head.stl > 84 && pr.stl.length === pr.head.stl && pr.pieces && pr.pieces.length === pr.head.pieces, 'ED45 the project holds the model STL (' + pr.head.stl + ' bytes) and both floating pieces (' + pr.head.pieces + ' bytes)');
    let opened = null; w.__shrinkApp.openFile = async f => { opened = f; w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); };
    w.__shrinkEdit.reset(); await wait(100); ok(w.__shrinkEdit.parked() === 0, 'ED45 pieces cleared before loading');
    const r = await w.__shrinkEdit.loadProject(pf.buffer.slice(pf.byteOffset, pf.byteOffset + pf.byteLength)); await wait(50);
    ok(opened && /\.stl$/.test(opened.name) && opened.size === pr.head.stl, 'ED45 LOAD PROJECT opens the saved model: ' + opened?.name + ' ' + opened?.size);
    ok(r.pieces === 2 && w.__shrinkEdit.parked() === 1 && w.__shrinkEdit.hasPart(), 'ED45 both floating pieces come back with the project');
    let bad2 = ''; try { w.__shrinkEdit.parseProject(new TextEncoder().encode('nonsense nonsense nonsense').buffer); } catch (e) { bad2 = String(e.message); } ok(/not a SHRINK project/.test(bad2), 'ED45 a wrong file is refused politely');
    w.__shrinkEdit.reset(); await wait(100); }
  w.__shrinkEdit.reset(); await wait(100); ok(w.__shrinkEdit.parked() === 0 && !w.__shrinkEdit.hasPart(), 'ED38 reset clears the floating pieces');
  const n = w.__shrinkEdit.loadPieces(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); await wait(50);
  ok(n === 2 && w.__shrinkEdit.parked() === 1 && w.__shrinkEdit.hasPart(), 'ED38 loading brings both pieces back');
  ok(Math.abs(w.__shrinkEdit.partState().x - -4) < 0.01, 'ED38 the selected piece is where it was saved (x -4)'); w.__shrinkEdit.select(0); ok(Math.abs(w.__shrinkEdit.partState().x - 6) < 0.01 && Math.abs(w.__shrinkEdit.partState().h - 12) < 0.01, 'ED38 the other piece kept its place and size (x 6, 12 mm)');
  let bad = ''; try { w.__shrinkEdit.loadPieces(new TextEncoder().encode('nonsense nonsense').buffer); } catch (e) { bad = String(e.message); } ok(/not a SHRINK/.test(bad), 'ED38 a wrong file is refused politely');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  w.__shrinkViewer = { scene: new w.__shrinkApp.THREE.Scene() }; page.$('v2TabEdit').click(); await wait(50);
  ok(!!page.$('v2EditCard').querySelector('[data-ed="tool"][data-value="select"]'), 'ED39 there is a Select tool button');
  set(page, 'v2EdTab', 'select'); await wait(50); ok(/Nothing is floating yet/.test(page.$('v2EdHint').textContent), 'ED39 with nothing floating the hint says how to get a piece');
  const cube = []; const P = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  for (const f of F) for (const i of f) cube.push(...P[i].map(v => v * 2));
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'a.stl'); await wait(50); set(page, 'v2EdPartX', 6);
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'b.stl'); await wait(50); set(page, 'v2EdTab', 'select'); await wait(50);
  const sc = () => w.__shrinkViewer.scene.getObjectByName('shrinkEditPreview');
  ok(w.__shrinkEdit.padVisible() && !!sc().getObjectByName('shrinkPartGlow') && !!sc().getObjectByName('shrinkParkedGhost') && !!sc().getObjectByName('shrinkPartGizmo') && w.__shrinkEdit.hudVisible(), 'ED39/ED50 Select shows the pad, the glow and the arrows / rings / squares / + - on the picked piece');
  ok(page.$('v2EdGo').hidden === true && page.$('v2EdModeRow').hidden === true, 'ED39 the shape / paste buttons are hidden');
  w.__shrinkEdit.select(0); ok(Math.abs(w.__shrinkEdit.partState().x - 6) < 0.01, 'ED39 picking a piece selects it');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); ok(w.__shrinkEdit.parked() === 2, 'ED39 Ctrl+C copies the picked piece');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); ok(w.__shrinkEdit.parked() === 1, 'ED39 Delete throws the picked piece away');
  page.$('v2EdResult').textContent = ''; page.$('v2PadPlace').click(); ok(await waitFor(() => /Joined|Cut|Could not/.test(page.$('v2EdResult').textContent), 60000) && !/Could not/.test(page.$('v2EdResult').textContent) && w.__shrinkEdit.parked() === 0, 'ED39 WELD IT works from the Select tool: ' + page.$('v2EdResult').textContent.slice(0, 80));
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  let asked = null, autoClicks = 0; page.$('autoBtn').addEventListener('click', () => { autoClicks++; });
  w.__shrinkApplyDetail = async v => { asked = v; setTimeout(() => { w.dispatchEvent(new w.CustomEvent('shrink:live-busy', { detail: { busy: true } })); setTimeout(() => w.dispatchEvent(new w.CustomEvent('shrink:live-busy', { detail: { busy: false } })), 60); }, 40); };
  w.__shrinkLive = { root: w.__shrinkWorkingModel() };
  page.$('v2ShrinkBtn').click(); await waitFor(() => asked !== null, 20000);
  ok(asked === 50 && autoClicks === 0, 'ED40 SHRINK keeps 50% through the Detail path and does not run the automatic search (asked ' + asked + ', auto clicks ' + autoClicks + ')');
  ok(await waitFor(() => /✓|Optimised|kept|%/.test(page.$('v2ShrinkResult').textContent) && !page.$('v2ShrinkBtn').disabled, 30000), 'ED40 it finishes after the reducer goes idle: ' + page.$('v2ShrinkResult').textContent.slice(0, 80));
  w.__shrinkShrinkTarget = 0; asked = null; page.$('v2ShrinkBtn').click(); await wait(600); ok(asked === null && autoClicks >= 1, 'ED40 window.__shrinkShrinkTarget = 0 brings back the automatic search');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(100);
  const tool = n => page.d.querySelector('.v2-icon-btn[data-ed="tool"][data-v="' + n + '"]') || [...page.d.querySelectorAll('.v2-icon-btn[data-ed="tool"]')].find(b => b.dataset.val === n || b.dataset.tool === n);
  set(page, 'v2EdTab', 'lasso'); await wait(60);
  const v = page.$('viewer'), fire = o => { const ev = new w.MouseEvent('pointerdown', Object.assign({ bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 50 }, o)); v.dispatchEvent(ev); return ev.defaultPrevented; };
  ok(fire({}) === true, 'ED41 a plain left press starts the lasso');
  w.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true })); await wait(30);
  ok(fire({ altKey: true }) === false, 'ED41 Alt + left press is left alone so the camera can orbit (lasso)');
  set(page, 'v2EdTab', 'sculpt'); await wait(60);
  ok(fire({ altKey: true }) === false, 'ED41 Alt + left press is left alone so the camera can orbit (sculpt)');
  set(page, 'v2EdTab', 'select'); await wait(60);
  ok(fire({ altKey: true }) === false, 'ED41 Alt + left press is left alone so the camera can orbit (select)');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  w.__shrinkPrint = { state: { modelHeightUnits: 12.4 } }; w.__shrinkApp.sourceKind = 'stl'; w.__shrinkFitHeight(); w.__shrinkWireTinyWarning();
  ok(w.__shrinkTiny().raw === 12.4, 'ED42 a model under 30 mm is remembered as tiny');
  let shrinks = 0; page.$('v2ShrinkBtn').addEventListener('click', () => { shrinks++; });
  page.$('v2ShrinkBtn').disabled = false; page.$('v2ShrinkBtn').click(); await wait(50);
  const box = page.d ? page.d.getElementById('v2TinyBox') : w.document.getElementById('v2TinyBox');
  ok(box && /only 12 mm high/.test(box.textContent) && /before shrinking/.test(box.textContent) && shrinks === 0, 'ED42 the first SHRINK press shows "This model is only 12 mm high" and does not shrink yet');
  w.document.getElementById('v2TinyGo').click(); await wait(50);
  ok(!w.document.getElementById('v2TinyBox') && shrinks === 1, 'ED42 SHRINK ANYWAY closes the pop-up and carries on');
  page.$('v2ShrinkBtn').click(); await wait(50); ok(!w.document.getElementById('v2TinyBox'), 'ED42 it only asks once');
  w.__shrinkPrint = { state: { modelHeightUnits: 45 } }; w.__shrinkFitHeight(); ok(w.__shrinkTiny().raw === 0, 'ED42 a 45 mm model gets no pop-up');
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  let shrinks = 0; page.$('v2ShrinkBtn').addEventListener('click', () => { shrinks++; });
  { let fn = w.document.getElementById('fileName'); if (!fn) { fn = w.document.createElement('span'); fn.id = 'fileName'; w.document.body.appendChild(fn); } fn.textContent = 'FREE-BOD-Dwarf-Model.stl'; } w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await wait(400);
  ok(w.document.body.hasAttribute('data-v2-preshrunk') && w.__shrinkPreShrunk(), 'ED43 the FREE model starts greyed (already shrunk)');
  ok(page.$('v2MagicDownload').disabled === false && page.$('v2DownloadBtn').disabled === false, 'ED43 DOWNLOAD is live on the already-shrunk FREE model');
  page.$('v2ShrinkBtn').disabled = false; page.$('v2ShrinkBtn').click(); await wait(30); ok(shrinks === 0, 'ED43 SHRINK does nothing while it is greyed');
  set(page, 'v2Height', '60'); await wait(60);
  ok(!w.document.body.hasAttribute('data-v2-preshrunk'), 'ED43 changing the size lifts the grey');
  page.$('v2ShrinkBtn').click(); await wait(30); ok(shrinks === 1, 'ED43 SHRINK works again after a size change');
  w.document.getElementById('fileName').textContent = 'other.stl'; w.dispatchEvent(new w.CustomEvent('shrink:model-opened')); await wait(400); ok(!w.document.body.hasAttribute('data-v2-preshrunk'), 'ED43 an ordinary model is never greyed');
}
/* v2.338: magic wand */
{ const page = await makePage({ model: models.multi(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'wand'); await wait(80);
  ok(page.$('v2EdLassoBox').hidden === false && page.$('v2EdLassoBox').dataset.tool === 'wand', 'ED44 the Wand shows the DELETE / COPY buttons');
  const tri0 = tris(w.__shrinkWorkingModel()); const n = w.__shrinkEdit.wand(0, 0);
  let red = 0; w.__shrinkViewer.scene.getObjectByName('shrinkLassoRed')?.traverse(o => { if (o.isMesh) red = o.geometry.attributes.position.count / 3; });
  ok(n > 0 && n < tri0 && red === n, `ED44 touching one piece selects just that piece (${n} of ${tri0}) and turns it red`);
  ok(page.$('v2LassoDelBtn').disabled === false, 'ED44 DELETE is enabled');
  page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Deleted|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Deleted/.test(page.$('v2EdResult').textContent), 'ED44 DELETE removes it: ' + page.$('v2EdResult').textContent.slice(0, 90));
  ok(Math.abs(tris(w.__shrinkWorkingModel()) - (tri0 - n)) < 2, `ED44 only the touched piece is gone (${tri0} -> ${tris(w.__shrinkWorkingModel())})`);
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() };
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'wand'); await wait(80);
  const tri0 = tris(w.__shrinkWorkingModel()), n = w.__shrinkEdit.wand(0, 0);
  ok(n === tri0 && /whole model/.test(page.$('v2EdResult').textContent), 'ED44 a piece that is attached to everything selects everything and says so');
  page.$('v2EdResult').textContent = ''; page.$('v2LassoDelBtn').click();
  ok(await waitFor(() => /Could not/.test(page.$('v2EdResult').textContent), 30000) && /attached/.test(page.$('v2EdResult').textContent) && tris(w.__shrinkWorkingModel()) === tri0, 'ED44 DELETE refuses and the model is untouched');
}
/* v2.342: piece library + COPY on an open (leaky) model */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() }; page.$('v2TabEdit').click(); await wait(80);
  ok(!!page.$('v2LibAdd') && !!page.$('v2LibOpen') && page.$('v2LibAdd').disabled === true, 'ED46 ADD TO LIBRARY and LIBRARY are there; adding waits for a floating piece');
  const cube = []; const P = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  for (const f of F) for (const i of f) cube.push(...P[i].map(v => v * 2));
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'dagger.stl'); await wait(60); set(page, 'v2EdPartH', 18); await wait(30);
  ok(page.$('v2LibAdd').disabled === false, 'ED46 with a piece floating, ADD TO LIBRARY is on');
  const rec = await w.__shrinkEdit.libAdd("Paul's dagger"); ok(rec.name === "Paul's dagger" && rec.hMm === 18 && rec.tris === 12, 'ED46 the piece is stored with its name and size: ' + rec.name + ' ' + rec.hMm + ' mm');
  ok((await w.__shrinkEdit.libList()).length === 1, 'ED46 the library lists it');
  w.__shrinkEdit.reset(); await wait(100); ok(!w.__shrinkEdit.hasPart(), 'ED46 nothing floats after a reset');
  await w.__shrinkEdit.libRender(); ok(page.w.document.querySelectorAll('.v2-lib-tile').length === 1 && /Paul/.test(page.w.document.querySelector('.v2-lib-name').textContent), 'ED46 the library grid shows one tile with the name');
  await w.__shrinkEdit.libUse(rec.id); await wait(80); ok(w.__shrinkEdit.hasPart() && Math.abs(w.__shrinkEdit.partState().h - 18) < 0.01 && w.__shrinkEdit.partState().x > 0, 'ED46 clicking it adds the piece back at 18 mm, beside the model (x ' + w.__shrinkEdit.partState().x + ')');
  await w.__shrinkEdit.libDelete(rec.id); ok((await w.__shrinkEdit.libList()).length === 0, 'ED46 deleting empties the library');
}
{ const page = await makePage({ model: models.holey(20), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(500);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() }; page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80);
  w.__shrinkFuse.editModel = async () => { throw new Error('No printable solid parts could be read from this model after detail-preserving repair. Manifold rejected a mesh part after repair: Not manifold Run FIX IT or FUSE IT first.'); };   // what the sword model gives
  const S = orthoCam(page, 0.55, 0.9); set(page, 'v2EdDepth', 'near'); w.__shrinkEdit.setSel(S.pts, S.cam); page.$('v2EdResult').textContent = ''; page.$('v2LassoKeepBtn').click();
  ok(await waitFor(() => /Copied|Could not/.test(page.$('v2EdResult').textContent), 90000) && /open shell/.test(page.$('v2EdResult').textContent) && w.__shrinkEdit.hasPart(), 'ED47 COPY on a leaky model still lifts out the surface as an open shell: ' + page.$('v2EdResult').textContent.slice(0, 120));
}
/* v2.343: DOWNLOAD PIECE (STL) */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  const THREE = w.__shrinkApp.THREE; w.__shrinkViewer = { scene: new THREE.Scene() }; w.__shrinkBuildStl = (await import(new URL('./.build/mt/mesh-tools.js', import.meta.url).href)).buildBinaryStl;
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'lasso'); await wait(80);
  ok(!!page.$('v2PieceStlBtn') && page.$('v2PieceStlBtn').disabled === true, 'ED48 DOWNLOAD PIECE (STL) is in the edit card and waits for a selection');
  const S = orthoCam(page, 0.55, 0.95); set(page, 'v2EdDepth', 'through'); w.__shrinkEdit.setSel(S.pts, S.cam); await wait(50); ok(page.$('v2PieceStlBtn').disabled === false, 'ED48 with a selection it is on');
  let got = null, size = 0; w.__shrinkCapture = (b, n) => { got = n; size = b.size; return true; };
  const t0 = tris(w.__shrinkWorkingModel()); const r = await w.__shrinkEdit.pieceStl('sel');
  ok(r && /-piece\.stl$/.test(got || '') && size === 84 + r.triangles * 50 && r.triangles > 0 && r.triangles < t0, `ED48 the selection downloads as ${got}: ${r?.triangles} of ${t0} triangles, ${size} bytes`);
  ok(tris(w.__shrinkWorkingModel()) === t0, 'ED48 the model itself is untouched');
  const cube = []; const P = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  for (const f of F) for (const i of f) cube.push(...P[i].map(v => v * 2));
  w.__shrinkEdit.setPart(new Float32Array(cube), false, 'c.stl'); await wait(60); got = null; const r2 = await w.__shrinkEdit.pieceStl('part');
  set(page, 'v2EdTab', 'part'); await wait(300); ok(r2 && r2.triangles === 12 && /-piece\.stl$/.test(got || '') && !!page.$('v2PadStl'), 'ED48 a floating piece downloads as its own STL (12 triangles), and the pad has the button too');
  w.__shrinkCapture = null;
}
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('edit-ui tests passed'); process.exit(0);
