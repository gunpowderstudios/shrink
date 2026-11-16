// HOLLOW IT card on a jsdom page (real print-v2-ui.js, fuse-export.js, hollow-core.js, Manifold). Only shown with ?hollow=1 and after SHRINK.
import { makePage, models, ok, failures, wait } from './mt-harness.mjs';
const waitFor = async (fn, ms = 90000, step = 100) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await wait(step); } return !!(await fn()); };

{ const page = await makePage({ model: models.single(), heightMm: 40 }); await wait(300);
  const c = page.$('v2HollowCard'); ok(!c || c.hidden, 'HU1 without ?hollow=1 the HOLLOW IT card is hidden even after SHRINK'); w_mark(page); ok(!page.$('v2HollowCard') || page.$('v2HollowCard').hidden, 'HU1 still hidden after SHRINK'); }
function w_mark(page) { page.w.__shrinkMarkApplied('shrunk'); }

{ const page = await makePage({ model: models.single(), heightMm: 40, url: 'https://example.test/?hollow=1' }); const w = page.w; await wait(300);
  ok(page.$('v2HollowCard')?.hidden === true, 'HU2 with ?hollow=1 the card waits for SHRINK');
  w.__shrinkMarkApplied('shrunk'); await wait(50);
  ok(page.$('v2HollowCard')?.hidden === false, 'HU2 after SHRINK the card appears');
  const before = w.__shrinkWorkingModel(); let tri0 = 0; before.traverse(o => { if (o.isMesh) tri0 += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
  page.$('v2HollowWall').value = '2'; page.$('v2HollowBtn').click();
  const done = await waitFor(() => /Hollowed|Could not/.test(page.$('v2HollowResult').textContent), 110000);
  ok(done && /Hollowed/.test(page.$('v2HollowResult').textContent), 'HU3 HOLLOW IT finishes: ' + page.$('v2HollowResult').textContent.slice(0, 160));
  const m = w.__shrinkWorkingModel(); let tri1 = 0; m.traverse(o => { if (o.isMesh) tri1 += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
  ok(m !== before && tri1 > tri0, `HU4 the hollow result is the new working model with an inner shell (${tri0} -> ${tri1} triangles)`);
  ok(/HOLLOW/.test(page.$('v2HealthChanges').textContent), 'HU5 a HOLLOW chip appears');
  ok(page.$('v2HollowCut')?.hidden === false, 'HU6 the cut-away slider appears');
  const r = page.$('v2HollowCutRange'); r.value = '50'; r.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100);
  let clipped = 0; w.__shrinkWorkingModel().traverse(o => { if (o.isMesh && o.material?.clippingPlanes?.length) clipped++; });
  ok(clipped > 0 && /50/.test(page.$('v2HollowCutOut').textContent), 'HU7 the cut-away slider clips the model');
  r.value = '100'; r.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(100);
  let still = 0; w.__shrinkWorkingModel().traverse(o => { if (o.isMesh && o.material?.clippingPlanes?.length) still++; });
  ok(still === 0, 'HU8 100% turns the cut-away off');
}
if (failures()) { console.log(failures() + ' FAILED'); process.exit(1); } console.log('hollow ui tests passed'); process.exit(0);
