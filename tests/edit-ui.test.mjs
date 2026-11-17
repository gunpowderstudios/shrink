// EDIT MODEL card on a jsdom page (real print-v2-ui.js, fuse-export.js, edit-core.js, Manifold): shape cut/join, slice off, undo.
import { makePage, models, ok, failures, wait } from './mt-harness.mjs';
const waitFor = async (fn, ms = 90000, step = 100) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await wait(step); } return !!(await fn()); };
const tris = m => { let n = 0; m.traverse(o => { if (o.isMesh) n += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; }); return n; };
const set = (page, id, v) => { const e = page.$(id); e.value = String(v); e.dispatchEvent(new page.w.Event('input', { bubbles: true })); e.dispatchEvent(new page.w.Event('change', { bubbles: true })); };
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

  /* brush tool: the Brush card shows only for the Brush tool, and leaving the EDIT tab clears the previews */
  set(page, 'v2EdTab', 'brush'); await wait(50);
  ok(page.$('v2ClayCard').hidden === false && page.$('v2EdRun').hidden === true && page.$('v2EdShapeBox').hidden === true, 'ED10 the Brush tool shows the brush card and hides the shape controls');
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'), 'ED10 no shape preview while brushing');
  set(page, 'v2EdTab', 'shape'); await wait(50);
  ok(page.$('v2ClayCard').hidden === true && page.$('v2EdRun').hidden === false, 'ED10 going back to Shape hides the brush card');
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

/* brush: a carve stroke applied from the EDIT tab with APPLY BRUSH NOW */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); set(page, 'v2EdTab', 'brush'); await wait(100);
  const m0 = w.__shrinkWorkingModel(), b = new w.__shrinkApp.THREE.Box3().setFromObject(m0, true), top = b.max.y, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, r = (b.max.y - b.min.y) * 0.15;
  w.__shrinkClay.addStroke('cut', [{ x: cx, y: top, z: cz, r }, { x: cx + r, y: top, z: cz, r }]);
  await wait(50); ok(!page.$('v2ClayApply').disabled, 'ED13 APPLY BRUSH NOW is enabled once there is a stroke');
  page.$('v2ClayApply').click();
  ok(await waitFor(() => /Brush applied|could not/.test(page.$('v2ClayNote').textContent), 90000) && /Brush applied/.test(page.$('v2ClayNote').textContent), 'ED13 the brush applies: ' + page.$('v2ClayNote').textContent.slice(0, 120));
  ok(w.__shrinkWorkingModel() !== m0 && /BRUSH/.test(page.$('v2HealthChanges').textContent), 'ED13 the carved model is the working model and a BRUSH chip shows');
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
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="brush"]').click(); await wait(50);
  ok(page.$('v2ClayCard').hidden === false, 'ED14 clicking the Brush icon shows the brush card');
  w.__shrinkClay.setTool(true, 'add'); w.__shrinkClay.ring({ clientX: 100, clientY: 120 });
  const ring = page.$('v2BrushRing'); ok(!!ring && ring.hidden === false && /^6\.0 mm$/.test(ring.textContent), 'ED15 selecting the brush shows a tip ring labelled with its width: ' + ring?.textContent);
  set(page, 'v2ClaySize', 12); await wait(30);
  ok(/^12\.0 mm$/.test(page.$('v2BrushRing').textContent) && /12\.0 mm wide/.test(page.$('v2ClaySizeVal').textContent), 'ED15 the ring follows the size slider');
  w.__shrinkClay.setTool(true, 'cut'); w.__shrinkClay.ring({ clientX: 100, clientY: 120 }); ok(page.$('v2BrushRing').dataset.mode === 'cut', 'ED15 the ring turns orange for carve');
  w.__shrinkClay.setTool(false); ok(page.$('v2BrushRing').hidden === true, 'ED15 the ring goes when the brush is off');
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

/* Copy / cut then paste: duplicate the top of the model, then cut it out and put it back elsewhere */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(50);
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="copy"]').click(); await wait(80);
  ok(page.$('v2EdCopyBox').hidden === false && page.$('v2EdGo').hidden === true && page.$('v2EdModeRow').hidden === true, 'ED19 the Copy / cut tool shows the blue box controls');
  ok(Number(page.$('v2EdCH').value) > 0, 'ED19 the box starts at half the model: ' + page.$('v2EdCW').value + ' x ' + page.$('v2EdCH').value + ' x ' + page.$('v2EdCD').value);
  set(page, 'v2EdCY', 10); set(page, 'v2EdCH', 20); set(page, 'v2EdCW', 80); set(page, 'v2EdCD', 80);          // the top half of a 40 mm model
  const m0 = w.__shrinkWorkingModel(), h0 = height(page);
  page.$('v2EdResult').textContent = ''; page.$('v2EdCopyBtn').click();
  ok(await waitFor(() => /Copied|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Copied/.test(page.$('v2EdResult').textContent), 'ED20 COPY works: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(w.__shrinkWorkingModel() === m0 && w.__shrinkEdit.depth() === 0, 'ED20 copying leaves the model alone');
  ok(page.$('v2EdTab').value === 'part' && w.__shrinkEdit.hasPart() && /Copied piece ready/.test(page.$('v2EdPartInfo').textContent) && /PASTE PART ON/.test(page.$('v2EdGo').textContent), 'ED20 the copied piece is ready to paste');
  page.$('v2EdResult').textContent = ''; set(page, 'v2EdPartY', 25); await wait(30);       // move it up by 25 mm
  page.$('v2EdGo').click();
  ok(await waitFor(() => /Joined|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Joined/.test(page.$('v2EdResult').textContent), 'ED21 PASTE joins it: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(height(page) > h0 + 10, `ED21 the pasted copy made the model taller (${h0.toFixed(1)} -> ${height(page).toFixed(1)})`);
  page.$('v2EdUndo').click(); await wait(200);
  page.$('v2EditCard').querySelector('.v2-icon-btn[data-ed="tool"][data-value="copy"]').click(); await wait(50);
  page.$('v2EdResult').textContent = ''; page.$('v2EdCutBtn').click();
  ok(await waitFor(() => /Cut out|Could not/.test(page.$('v2EdResult').textContent), 60000) && /Cut out/.test(page.$('v2EdResult').textContent), 'ED22 CUT OUT works: ' + page.$('v2EdResult').textContent.slice(0, 110));
  ok(height(page) < h0 * 0.7 && w.__shrinkEdit.depth() >= 1 && w.__shrinkEdit.hasPart(), `ED22 the piece is taken out of the model (${h0.toFixed(1)} -> ${height(page).toFixed(1)}) and held for pasting`);
}

/* put the tool down (click it again, or Esc) and RESET ALL EDITS */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(400);
  page.$('v2TabEdit').click(); await wait(50);
  const tool = v => page.$('v2EditCard').querySelector(`.v2-icon-btn[data-ed="tool"][data-value="${v}"]`);
  ok(page.$('v2EdTab').value === 'shape', 'ED23 starts on the Shape tool');
  tool('shape').click(); await wait(50);
  ok(page.$('v2EdTab').value === 'none' && tool('shape').getAttribute('aria-pressed') === 'false' && page.$('v2EdShapeBox').hidden === true && page.$('v2EdRun').hidden === true, 'ED23 clicking the pressed tool puts it down');
  ok(!w.__shrinkViewer?.scene?.getObjectByName?.('shrinkEditPreview'), 'ED23 and removes its preview');
  tool('brush').click(); await wait(50); ok(page.$('v2EdTab').value === 'brush' && page.$('v2ClayCard').hidden === false, 'ED23 a tool can be picked again');
  w.__shrinkClay.setTool(true, 'add'); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
  ok(page.$('v2EdTab').value === 'none' && w.__shrinkClay.state.on === false && page.$('v2ClayCard').hidden === true, 'ED24 Esc puts the brush down and deselects it');
  tool('shape').click(); await wait(50); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
  ok(page.$('v2EdTab').value === 'none', 'ED24 Esc also puts down the Shape tool');
  /* two edits, a brush stroke and a part, then reset */
  const m0 = w.__shrinkWorkingModel(), h0 = height(page);
  tool('slice').click(); set(page, 'v2EdPos', 50); set(page, 'v2EdSide', 'high'); page.$('v2EdResult').textContent = ''; page.$('v2EdGo').click();
  await waitFor(() => /Sliced|Could not/.test(page.$('v2EdResult').textContent), 60000);
  tool('shape').click(); set(page, 'v2EdKind', 'ball'); set(page, 'v2EdMode', 'cut'); page.$('v2EdResult').textContent = ''; page.$('v2EdGo').click();
  await waitFor(() => /Cut|Could not/.test(page.$('v2EdResult').textContent), 60000);
  w.__shrinkClay.addStroke('cut', [{ x: 0, y: 0, z: 0, r: 1 }]); w.__shrinkEdit.setPart(new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1, 1,0,0, 0,0,0]), false, 'x.stl');
  ok(w.__shrinkEdit.depth() === 2 && height(page) < h0 * 0.6 && w.__shrinkClay.hasClay() && w.__shrinkEdit.hasPart(), 'ED25 set up: two edits, a stroke and a part');
  page.$('v2EdReset').click(); await wait(300);
  ok(Math.abs(height(page) - h0) < 0.01 && w.__shrinkEdit.depth() === 0 && !/EDITED/.test(page.$('v2HealthChanges').textContent), `ED25 RESET brings the model back (height ${h0.toFixed(1)} -> ${height(page).toFixed(1)}) and clears the EDITED chip`);
  ok(!w.__shrinkClay.hasClay() && !w.__shrinkEdit.hasPart() && page.$('v2EdUndo').hidden === true && page.$('v2EdTab').value === 'none' && /Reset/.test(page.$('v2EdResult').textContent), 'ED25 and the brush strokes, the part and the tool are cleared');
  page.$('v2EdReset').click(); await wait(100); ok(/Nothing to reset/.test(page.$('v2EdResult').textContent), 'ED25 resetting again says there is nothing to reset');
  void m0;
}
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('edit-ui tests passed'); process.exit(0);
