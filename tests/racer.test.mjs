// Racer preset (racer-core.js): texture sizes, dropped textures, ORM packing, one-atlas merge, GPU memory figure.
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { apply, plan, imageSize, gpuMB, memoryStatus, mergeable } from '../racer-core.js';

// a fake "PNG": the real signature + IHDR width/height, then one colour byte. decode makes a flat colour image, encode keeps what it was given.
const png = (w, h, c) => { const b = new Uint8Array(25); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); b[24] = c; return b; };
const encoded = new Map();
const ops = {
  decode: async (bytes, mime, w, h) => { const c = bytes[24], d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = c; d[i + 1] = c; d[i + 2] = c; d[i + 3] = 255; } return d; },
  encode: async (rgba, w, h) => { const b = png(w, h, rgba[0]); encoded.set(b, rgba); return { bytes: b, mime: 'image/png' }; },
  prune: async doc => { const r = doc.getRoot(); for (const m of r.listMaterials()) if (m.listParents().every(p => p === r)) m.dispose(); for (const t of r.listTextures()) if (t.listParents().every(p => p === r)) t.dispose(); },
  enableWebP: () => {},
};
const O = { baseSize: 64, mrSize: 64, normalSize: 32 };
const tex = (doc, name, w, h, c) => doc.createTexture(name).setImage(png(w, h, c)).setMimeType('image/png');
const prim = (doc, buf, mat, uvs) => {
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf), uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buf);
  const ix = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buf);
  return doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(ix).setMaterial(mat);
};

// ---- a car: body with a full texture set (+ separate occlusion + emissive), wheels with their own set, one spare texture nobody uses
function car() {
  const doc = new Document(), buf = doc.createBuffer();
  const body = doc.createMaterial('body').setBaseColorTexture(tex(doc, 'body_base', 2048, 2048, 200)).setMetallicRoughnessTexture(tex(doc, 'body_mr', 2048, 2048, 100))
    .setNormalTexture(tex(doc, 'body_normal', 2048, 2048, 128)).setOcclusionTexture(tex(doc, 'body_ao', 2048, 2048, 60)).setEmissiveTexture(tex(doc, 'body_emissive', 1024, 1024, 255)).setEmissiveFactor([1, 1, 1]);
  const wheel = doc.createMaterial('wheel').setBaseColorTexture(tex(doc, 'wheel_base', 512, 512, 30)).setNormalTexture(tex(doc, 'wheel_normal', 512, 512, 128)).setRoughnessFactor(0.5).setMetallicFactor(0);
  tex(doc, 'spare_normal', 1024, 1024, 128);
  const bodyMesh = doc.createMesh('body').addPrimitive(prim(doc, buf, body, [0, 0, 1, 0, 0, 1]));
  const wheelMesh = doc.createMesh('wheel').addPrimitive(prim(doc, buf, wheel, [0, 0, 1, 0, 0, 1]));
  const scene = doc.createScene(); scene.addChild(doc.createNode('Body').setMesh(bodyMesh)); scene.addChild(doc.createNode('Wheel_FL').setMesh(wheelMesh));
  return { doc, body, wheel };
}

assert.deepEqual(imageSize(png(300, 200, 1)), { w: 300, h: 200 });
assert.ok(Math.abs(gpuMB(1024, 1024) - 5.32) < 0.01, '1024x1024 is about 5.3 MB on the GPU');
assert.equal(memoryStatus(11.9), 'ok'); assert.equal(memoryStatus(20), 'warn'); assert.equal(memoryStatus(46), 'fail'); assert.equal(memoryStatus(45.9), 'warn');

// plan (nothing changes in the document)
{
  const { doc } = car(), p = plan(doc, {});
  assert.equal(p.used, 2); assert.equal(p.sets, 2);
  assert.ok(p.warnings.some(w => /wheels use their own/i.test(w.text)), 'warns that the wheels have their own set');
  assert.ok(p.dropped.some(d => d.name === 'spare_normal'), 'unused texture is listed');
  assert.ok(p.dropped.some(d => d.name === 'body_emissive' && /emissive/.test(d.reason)));
  assert.ok(p.dropped.some(d => d.name === 'body_ao' && /ORM/.test(d.reason)), 'occlusion is packed into ORM');
  assert.equal(doc.getRoot().listTextures().length, 8, 'plan() does not touch the document');
  assert.ok(p.beforeMB > 90, 'the original is far over budget: ' + p.beforeMB.toFixed(0) + ' MB'); assert.equal(memoryStatus(p.beforeMB), 'fail');
  // at the real sizes the merged atlas is 1024 + 1024 + 1024
  const real = plan(doc, {}); assert.ok(Math.abs(real.afterMB - (3 * 5.3203)) < 0.05 && real.status === 'ok', 'merged atlas plan: ' + real.afterMB.toFixed(2));
}

// merge into one atlas
{
  const { doc, body, wheel } = car(); encoded.clear();
  const r = await apply(doc, { ...O }, ops);
  assert.equal(r.finalMaterials, 1, 'one material for the whole vehicle'); assert.equal(r.merged, 2);
  const root = doc.getRoot(), mats = root.listMaterials();
  assert.equal(mats.length, 1); assert.equal(mats[0].getName(), 'car', 'the one material is named car (the game looks it up by name)'); assert.equal(root.listTextures().length, 3, 'one base, one ORM, one normal');
  const m = mats[0], sizes = Object.fromEntries([['base', m.getBaseColorTexture()], ['mr', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]].map(([k, t]) => [k, imageSize(t.getImage())]));
  assert.deepEqual(sizes.base, { w: 64, h: 64 }); assert.deepEqual(sizes.mr, { w: 64, h: 64 }); assert.deepEqual(sizes.normal, { w: 32, h: 32 });
  assert.equal(m.getOcclusionTexture(), m.getMetallicRoughnessTexture(), 'occlusion shares the ORM map'); assert.equal(m.getEmissiveTexture(), null);
  assert.deepEqual(m.getEmissiveFactor(), [0, 0, 0]);
  // UVs: body in the left cell, wheel in the right cell (2 sets -> 2 columns, 1 row)
  const ps = root.listMeshes().flatMap(x => x.listPrimitives()), uvOf = p => Array.from(p.getAttribute('TEXCOORD_0').getArray());
  const bodyUV = uvOf(ps[0]), wheelUV = uvOf(ps[1]);
  assert.deepEqual(bodyUV, [0, 0, 0.5, 0, 0, 1], 'body UVs fill the left half'); assert.deepEqual(wheelUV, [0.5, 0, 1, 0, 0.5, 1], 'wheel UVs fill the right half');
  // pixels: the left half of the base atlas carries the body's colour, the right half the wheel's; the wheel's roughness factor 0.5 is baked into G
  const baseRGBA = encoded.get(m.getBaseColorTexture().getImage()), mrRGBA = encoded.get(m.getMetallicRoughnessTexture().getImage());
  const px = (a, W, x, y) => a[(y * W + x) * 4]; assert.equal(px(baseRGBA, 64, 5, 5), 200); assert.equal(px(baseRGBA, 64, 60, 5), 30);
  assert.equal(mrRGBA[(5 * 64 + 60) * 4 + 1], 128, 'wheel roughness 0.5 baked'); assert.equal(mrRGBA[(5 * 64 + 60) * 4 + 2], 0, 'wheel metallic 0 baked');
  assert.equal(px(mrRGBA, 64, 5, 5), 255 - (255 - 60) * 1, 'occlusion from the body ao map sits in the red channel');
  assert.equal(r.final.length, 3);
  assert.equal(body.isDisposed?.() ?? false, false);
}

// no merge: warns, still sizes each texture for its role and packs the occlusion map
{
  const { doc } = car(); const r = await apply(doc, { ...O, merge: false }, ops);
  assert.equal(r.finalMaterials, 2);
  assert.ok(r.warnings.some(w => w.level === 'warn' && /multiplies the memory/.test(w.text)), 'warns when the sets are kept');
  const root = doc.getRoot(), body = root.listMaterials().find(m => m.getName() === 'body');
  assert.deepEqual(imageSize(body.getBaseColorTexture().getImage()), { w: 64, h: 64 }); assert.deepEqual(imageSize(body.getNormalTexture().getImage()), { w: 32, h: 32 });
  assert.equal(body.getOcclusionTexture(), body.getMetallicRoughnessTexture()); assert.equal(r.packed, 1);
  assert.equal(root.listTextures().length, 5, 'body base/orm/normal + wheel base/normal');
  const wheel = root.listMaterials().find(m => m.getName() === 'wheel'); assert.deepEqual(imageSize(wheel.getBaseColorTexture().getImage()), { w: 64, h: 64 }, 'a 512 texture is scaled to its cap only when bigger: 512 -> 64 here');
}

// High option: base colour 2048; a small texture is never scaled up
{
  const { doc } = car(); const p = plan(doc, { baseSize: 2048, merge: false });
  const base = p.textures.find(t => t.name === 'body_base'); assert.deepEqual(base.to, { w: 2048, h: 2048 });
  const wb = p.textures.find(t => t.name === 'wheel_base'); assert.deepEqual(wb.to, { w: 512, h: 512 }, 'not scaled up');
}

// not mergeable: transparent material, and tiling UVs
{
  const { doc, wheel } = car(); wheel.setAlphaMode('BLEND'); assert.equal(mergeable(doc).ok, false); assert.match(mergeable(doc).reason, /transparent/);
  const r = await apply(doc, { ...O }, ops); assert.equal(r.finalMaterials, 2); assert.ok(r.warnings.some(w => /Could not merge/.test(w.text)));
  const c2 = car(); c2.doc.getRoot().listMeshes()[1].listPrimitives()[0].getAttribute('TEXCOORD_0').setArray(new Float32Array([0, 0, 3, 0, 0, 3])); assert.match(mergeable(c2.doc).reason, /tile/);
}

// plain-colour materials (no textures) are baked into the atlas too
{
  const doc = new Document(), buf = doc.createBuffer();
  const a = doc.createMaterial('a').setBaseColorTexture(tex(doc, 'a_base', 256, 256, 90)), b = doc.createMaterial('tyre').setBaseColorFactor([0.1, 0.1, 0.1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const m1 = doc.createMesh('a').addPrimitive(prim(doc, buf, a, [0, 0, 1, 0, 0, 1])), m2 = doc.createMesh('b').addPrimitive(prim(doc, buf, b, [0, 0, 1, 0, 0, 1]));
  const sc = doc.createScene(); sc.addChild(doc.createNode('A').setMesh(m1)); sc.addChild(doc.createNode('Tyre').setMesh(m2));
  encoded.clear(); const r = await apply(doc, { ...O }, ops); assert.equal(r.finalMaterials, 1);
  const bm = doc.getRoot().listMaterials()[0], rgba = encoded.get(bm.getBaseColorTexture().getImage());
  assert.ok(rgba[(5 * 64 + 60) * 4] >= 85 && rgba[(5 * 64 + 60) * 4] <= 92, 'dark rubber colour baked (sRGB of 0.1 is about 89)');
}
// a plain-colour part with no UVs and a different double-sided flag still merges (UVs point at its colour tile)
{
  const doc = new Document(), buf = doc.createBuffer();
  const a = doc.createMaterial('a').setBaseColorTexture(tex(doc, 'a_base', 256, 256, 90)), b = doc.createMaterial('plain').setBaseColorFactor([0.5, 0.2, 0.2, 1]).setDoubleSided(true);
  const m1 = doc.createMesh('a').addPrimitive(prim(doc, buf, a, [0, 0, 1, 0, 0, 1])), pb = prim(doc, buf, b, [0, 0, 1, 0, 0, 1]); pb.setAttribute('TEXCOORD_0', null);
  const m2 = doc.createMesh('b').addPrimitive(pb);
  const sc = doc.createScene(); sc.addChild(doc.createNode('A').setMesh(m1)); sc.addChild(doc.createNode('P').setMesh(m2));
  assert.equal(mergeable(doc).ok, true, 'no UVs on a plain-colour part is fine');
  const r = await apply(doc, { ...O }, ops); assert.equal(r.finalMaterials, 1);
  const uv = pb.getAttribute('TEXCOORD_0'); assert.ok(uv, 'UVs were created'); const e = uv.getElement(0, [0, 0]);
  assert.ok(e[0] > 0 && e[0] < 1 && e[1] > 0 && e[1] < 1, 'inside the atlas');
  assert.equal(doc.getRoot().listMaterials()[0].getDoubleSided(), true, 'double-sided if any part needed it');
}
// v2.209: textures keep their layout (single material: UVs untouched), normal map to 1024 cap, quality chosen by comparison
{
  const { psnr, renormalise, encodeChosen, DEFAULTS } = await import('../racer-core.js?v=2.210');
  assert.equal(DEFAULTS.normalSize, 1024);
  const a = new Uint8ClampedArray(16).fill(100), b = new Uint8ClampedArray(16).fill(100); assert.equal(psnr(a, b), 99); b[0] = 110; assert.ok(psnr(a, b) < 99);
  const n = new Uint8ClampedArray([200, 128, 128, 255]); renormalise(n); assert.ok(n[0] > 230 && n[1] >= 127 && n[1] <= 129, 'short normal made unit length');
  const px = new Uint8ClampedArray(64 * 4).fill(120), tried = [];
  const fake = { encode: async (p, w, h, q) => { tried.push(q); return { bytes: new Uint8Array([q * 100]), mime: 'image/webp' }; }, decode: async (bytes) => { const d = new Uint8ClampedArray(64 * 4).fill(120); if (bytes[0] < 60) d.fill(60); return d; } };
  const ch = await encodeChosen(px, 8, 8, 'base', { quality: 0.9 }, fake);
  assert.equal(ch.q, 0.7, 'lowest quality that still matches the original'); assert.deepEqual(tried, [0.7]);
}
// the single-material texture path never touches the UVs
{
  const doc = new Document(), buf = doc.createBuffer();
  const a = doc.createMaterial('').setBaseColorTexture(tex(doc, 'a_base', 256, 256, 90));
  const pr = prim(doc, buf, a, [0, 0, 1, 0, 0, 1]), before = Array.from(pr.getAttribute('TEXCOORD_0').getArray());
  const sc = doc.createScene(); sc.addChild(doc.createNode('Car').setMesh(doc.createMesh('c').addPrimitive(pr)));
  const r = await apply(doc, { ...O }, ops);
  assert.deepEqual(Array.from(pr.getAttribute('TEXCOORD_0').getArray()), before, 'UVs unchanged'); assert.equal(r.merged, 0); assert.equal(doc.getRoot().listMaterials()[0].getName(), 'car');
}
// v2.210: a flat normal map is never exported quietly
{
  const { normalSd, FLAT_SD } = await import('../racer-core.js?v=2.210');
  const flat = new Uint8ClampedArray(64 * 4); for (let i = 0; i < flat.length; i += 4) { flat[i] = 128; flat[i + 1] = 128; flat[i + 2] = 255; flat[i + 3] = 255; }
  const rough = flat.slice(); for (let i = 0; i < rough.length; i += 8) rough[i] = 200;
  assert.ok(normalSd(flat) < FLAT_SD && normalSd(rough) > 10);
  const doc = new Document(), buf = doc.createBuffer(), m = doc.createMaterial('').setBaseColorTexture(tex(doc, 'b', 256, 256, 90)).setNormalTexture(tex(doc, 'n', 256, 256, 90));
  const pr = prim(doc, buf, m, [0, 0, 1, 0, 0, 1]); doc.createScene().addChild(doc.createNode('Car').setMesh(doc.createMesh('c').addPrimitive(pr)));
  const ops2 = { ...ops, decode: async (bytes, mime, w, h) => { const d = new Uint8ClampedArray(w * h * 4), fl = encoded.has(bytes); for (let k = 0; k < d.length; k += 4) { d[k] = fl ? 128 : (k % 8 ? 90 : 200); d[k + 1] = 128; d[k + 2] = 255; d[k + 3] = 255; } return d; } };
  await assert.rejects(() => apply(doc, { ...O }, ops2), /flat/);
}
console.log('racer tests passed');
