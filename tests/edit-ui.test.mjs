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
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('edit-ui tests passed'); process.exit(0);
