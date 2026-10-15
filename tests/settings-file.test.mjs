// settings-file.js: save the left-panel controls to JSON and load them back (jsdom, real module).
import { JSDOM } from 'jsdom';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const dom = new JSDOM(`<body><div id="stepSave"></div><div id="flowNote"></div><div id="fileName">car.glb</div>
<aside class="control-panel">
 <button class="target-card active" data-target="pc"></button><button class="target-card" data-target="hero"></button>
 <input id="geometry" type="range" min="1" max="100" value="70"><input id="geometryNumber" value="70">
 <select id="textureSize"><option value="1024">1</option><option value="2048" selected>2</option><option value="4096">3</option></select>
 <input id="webpToggle" type="checkbox" checked><input id="wheelSplit" type="checkbox" checked>
 <input id="wheelFront" type="range" min="-100" max="100" value="0"><select id="wheelLayout"><option value="4" selected>4</option><option value="3">3</option></select>
 <input id="fileInput" type="file"><input id="brushSize" type="range" value="32">
 <div id="textureEditor"><input id="inEditor" type="range" value="5"></div>
</aside></body>`);
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Event: dom.window.Event });
const $ = id => document.getElementById(id);
const events = []; // what the page's own handlers would see
$('wheelFront').addEventListener('input', () => events.push('front'));
for (const b of document.querySelectorAll('.target-card')) b.addEventListener('click', () => { document.querySelector('.target-card.active')?.classList.remove('active'); b.classList.add('active'); $('textureSize').value = b.dataset.target === 'hero' ? '4096' : '2048'; $('geometry').value = '50'; });
await import('../settings-file.js');
const S = window.__shrinkSettings;
ok(!!$('settingsSave') && !!$('settingsLoad'), 'Save / Load buttons are added');

$('geometry').value = '33.5'; $('wheelFront').value = '-20'; $('wheelLayout').value = '3'; $('webpToggle').checked = false; $('wheelSplit').checked = false;
const saved = JSON.parse(JSON.stringify(S.collect()));
ok(saved.kind === 'shrink-settings' && saved.model === 'car.glb' && saved.target === 'pc', 'file header: kind, model name, target');
ok(saved.values.geometry === '33.5' && saved.values.wheelFront === '-20' && saved.values.wheelLayout === '3' && saved.values.webpToggle === false, 'values captured');
ok(!('fileInput' in saved.values) && !('brushSize' in saved.values) && !('geometryNumber' in saved.values) && !('inEditor' in saved.values), 'file pickers, mirrors and painting tools left out');

// reset everything, then load
$('geometry').value = '70'; $('wheelFront').value = '0'; $('wheelLayout').value = '4'; $('webpToggle').checked = true; $('wheelSplit').checked = true; events.length = 0;
const r = S.apply(saved);
ok($('geometry').value === '33.5' && $('wheelFront').value === '-20' && $('wheelLayout').value === '3' && !$('webpToggle').checked && !$('wheelSplit').checked, 'load restores every control');
ok(events.includes('front'), 'load fires the normal input event (so wheel adj / red button follow)');
ok(r.skipped.length === 0, 'nothing skipped');

// target card is applied first, then values override its defaults
const withHero = { ...saved, target: 'hero', values: { geometry: '12', textureSize: '1024' } };
S.apply(withHero);
ok($('geometry').value === '12' && $('textureSize').value === '1024' && document.querySelector('.target-card.active').dataset.target === 'hero', 'target first, saved values win');

// unknown ids and bad options are skipped, bad files refused
const r2 = S.apply({ ...saved, values: { nope: 1, textureSize: '9999', inEditor: '9' } });
ok(r2.skipped.includes('nope') && r2.skipped.includes('textureSize') && r2.skipped.includes('inEditor'), 'unknown / invalid entries skipped, not applied');
let msg = ''; try { S.apply({ hello: 1 }); } catch (e) { msg = e.message; }
ok(/not a SHRINK settings file/.test(msg), 'other JSON refused with a plain message');
msg = ''; try { S.apply({ ...saved, version: 99 }); } catch (e) { msg = e.message; }
ok(/newer/.test(msg), 'newer file version refused');
console.log(bad ? `\n${bad} FAILED` : '\nall passed'); process.exit(bad ? 1 : 0);
