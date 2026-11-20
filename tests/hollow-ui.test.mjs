// HOLLOW IT card on a jsdom page (real print-v2-ui.js, fuse-export.js, hollow-core.js, Manifold). Only shown with ?hollow=1 and after SHRINK.
import { makePage, models, ok, failures, wait } from './mt-harness.mjs';
const waitFor = async (fn, ms = 90000, step = 100) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await wait(step); } return !!(await fn()); };

{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/?hollow=0' }); await wait(300);
  const c = page.$('v2HollowCard'); ok(!c || c.hidden, 'HU1 with ?hollow=0 the HOLLOW IT card is hidden even after SHRINK'); w_mark(page); ok(!page.$('v2HollowCard') || page.$('v2HollowCard').hidden, 'HU1 still hidden after SHRINK'); }
function w_mark(page) { page.w.__shrinkMarkApplied('shrunk'); }

{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/?hollow=1' }); const w = page.w; await wait(300);
  ok(page.$('v2HollowCard')?.hidden === false, 'HU2 with ?hollow=1 the card is always in ADVANCED');
  w.__shrinkMarkApplied('shrunk'); await wait(50);
  ok(page.$('v2HollowCard')?.hidden === false, 'HU2 after SHRINK the card appears');
  ok(!page.$('v2HollowSlide') || page.$('v2HollowSlide').hidden === true, 'HU11 no vertical slider before hollowing');
  const before = w.__shrinkWorkingModel(); let tri0 = 0; before.traverse(o => { if (o.isMesh) tri0 += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
  page.$('v2HollowWall').value = '2'; page.$('v2HollowBtn').click();
  const done = await waitFor(() => /Hollowed|Could not/.test(page.$('v2HollowResult').textContent), 110000);
  ok(done && /Hollowed/.test(page.$('v2HollowResult').textContent), 'HU3 HOLLOW IT finishes: ' + page.$('v2HollowResult').textContent.slice(0, 160));
  const m = w.__shrinkWorkingModel(); let tri1 = 0; m.traverse(o => { if (o.isMesh) tri1 += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
  ok(m !== before && tri1 > tri0, `HU4 the hollow result is the new working model with an inner shell (${tri0} -> ${tri1} triangles)`);
  ok(/HOLLOW/.test(page.$('v2HealthChanges').textContent), 'HU5 a HOLLOW chip appears');
  ok(page.$('v2HollowCut')?.hidden === false, 'HU6 the cut-away slider appears');
  ok(page.$('v2HollowSlide')?.hidden === false, 'HU11 the vertical blue cut-away slider appears once the model is hollow');
  { const vs = page.$('v2HollowSlideRange'); vs.value = '40'; vs.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100);
    let c = 0; w.__shrinkWorkingModel().traverse(o => { if (o.isMesh && o.material?.clippingPlanes?.length) c++; });
    ok(c > 0 && Number(page.$('v2HollowCutRange').value) === 40 && /40/.test(page.$('v2HollowCutOut').textContent), 'HU11 the vertical slider cuts the model and the card slider follows');
    vs.value = '100'; vs.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100); }
  const r = page.$('v2HollowCutRange'); r.value = '50'; r.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100);
  let clipped = 0; w.__shrinkWorkingModel().traverse(o => { if (o.isMesh && o.material?.clippingPlanes?.length) clipped++; });
  ok(clipped > 0 && /50/.test(page.$('v2HollowCutOut').textContent), 'HU7 the cut-away slider clips the model');
  r.value = '100'; r.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100);
  let still = 0; w.__shrinkWorkingModel().traverse(o => { if (o.isMesh && o.material?.clippingPlanes?.length) still++; });
  ok(still === 0, 'HU8 100% turns the cut-away off');
  /* v2.294: changing the wall and pressing again starts from the solid, so a thicker wall really gives more resin and the same wall gives the same result */
  const after = () => Number((/→ ([\d.]+) ml/.exec(page.$('v2HollowResult').textContent) || [])[1]);
  const again = async wall => { const prev = page.$('v2HollowResult').textContent; page.$('v2HollowWall').value = String(wall); page.$('v2HollowBtn').click(); await wait(100); await waitFor(() => page.$('v2HollowResult').textContent !== prev && /Hollowed|Could not/.test(page.$('v2HollowResult').textContent), 110000); return after(); };
  const y1 = after(), y2 = await again(6), y3 = await again(2);
  ok(y1 > 0 && y2 > y1 * 1.3, `HU9 a thicker wall on a second press gives more resin (${y1} ml -> ${y2} ml)`);
  ok(Math.abs(y3 - y1) / y1 < 0.03, `HU9 the same wall again gives the same result (${y1} ml vs ${y3} ml)`);
}

/* v2.302: a tick box under AUTO-SHRINK (off by default) makes the automatic run hollow the model as its last step */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(300);
  const box = page.$('v2AutoHollow'), qb = page.$('v2MagicBtn');
  ok(!!box && box.checked === false, 'HU10 the Hollow tick box exists and is off by default');
  ok(!!box && !!box.closest('.v2-main-extras'), 'HU10 it sits in the ADVANCED left column (v2.383)');
  box.checked = true; qb.click();
  const done = await waitFor(() => !qb.dataset.busy && /Hollowed/.test(page.$('v2HollowResult').textContent), 200000);
  ok(done, 'HU10 AUTO-SHRINK with the box ticked ends with the model hollowed: ' + page.$('v2HollowResult').textContent.slice(0, 120));
  ok(/HOLLOW/.test(page.$('v2HealthChanges').textContent), 'HU10 the HOLLOW chip shows after the automatic run');
}

/* v2.305: letting go of the wall slider on a hollow model rebuilds it by itself and keeps the cut-away where it was */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(300);
  w.__shrinkMarkApplied('shrunk'); await wait(50);
  page.$('v2HollowWall').value = '2'; page.$('v2HollowBtn').click();
  await waitFor(() => /Hollowed/.test(page.$('v2HollowResult').textContent), 110000);
  const after = () => Number((/→ ([\d.]+) ml/.exec(page.$('v2HollowResult').textContent) || [])[1]);
  const y1 = after(); const vs = page.$('v2HollowSlideRange'); vs.value = '60'; vs.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100);
  const prev = page.$('v2HollowResult').textContent; page.$('v2HollowWall').value = '6'; page.$('v2HollowWall').dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(() => page.$('v2HollowResult').textContent !== prev && /Hollowed/.test(page.$('v2HollowResult').textContent), 110000);
  const y2 = after(); let c = 0; w.__shrinkWorkingModel().traverse(o => { if (o.isMesh && o.material?.clippingPlanes?.length) c++; });
  ok(y2 > y1 * 1.3, `HU12 changing the wall rebuilds the hollow model by itself (${y1} ml -> ${y2} ml)`);
  ok(c > 0 && Number(page.$('v2HollowSlideRange').value) === 60, 'HU12 the cut-away stays where it was after the rebuild');
}

/* v2.306: the drain hole size is adjustable and rebuilds the hollow model when released */
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); const w = page.w; await wait(300);
  w.__shrinkMarkApplied('shrunk'); await wait(50);
  page.$('v2HollowBtn').click();
  await waitFor(() => /about 3 mm wide/.test(page.$('v2HollowResult').textContent), 110000);
  ok(/about 3 mm wide/.test(page.$('v2HollowResult').textContent), 'HU13 the default drain hole is about 3 mm wide');
  const prev = page.$('v2HollowResult').textContent; page.$('v2HollowHoleSize').value = '5'; page.$('v2HollowHoleSize').dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(() => page.$('v2HollowResult').textContent !== prev && /Hollowed/.test(page.$('v2HollowResult').textContent), 110000);
  ok(/about 5 mm wide/.test(page.$('v2HollowResult').textContent), 'HU13 a 5 mm hole size rebuilds with 5 mm holes: ' + page.$('v2HollowResult').textContent.slice(0, 200));
}
{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/' }); await wait(300);
  const h = page.$('v2Height'), st = page.$('v2SideStack');
  ok(!!h && !!h.closest('.v2-main-size'), 'HU14 the Finished height box is back in the ADVANCED size card (v2.383)');
  ok(!!page.$('v2ResizeBtn')?.closest('.v2-main-size'), 'HU15 RESIZE is back in ADVANCED (v2.382)');
  ok(!!page.$('v2HollowHoleX') && !!page.$('v2HollowHoleZ'), 'HU16 hole left/right and forward/back sliders exist'); }
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('hollow ui tests passed'); process.exit(0);
