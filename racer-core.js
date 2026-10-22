// SHRINK 3D v2.134 — "Racer" export preset, the document side. No imports and no DOM: the page (racer.js) and the tests (racer.test.mjs) both use it.
//
// The Racer preset prepares a vehicle GLB for a browser racing game on phones. Memory comes from the UNPACKED texture size, not the file size, so:
//   base colour and the metal/rough (ORM) map -> 1024 (base colour 2048 with the "High" option), normal map -> 512, all WebP;
//   textures no drawn material uses are dropped (emissive maps too) and reported; the occlusion map is packed into the red channel of the metal/rough map (ORM);
//   several materials / texture sets (wheels with their own) are merged into ONE atlas when that is safe, otherwise reported as a warning;
//   an estimate of GPU memory (width x height x 4 x 1.33 over all textures) is given, with a target of about 12 MB and a fail from 46 MB.
// Pixel work is done through `ops` (decode / encode / prune / enableWebP) so this file stays free of the browser.

export const MB = 1048576;
export const TARGET_MB = 12;        // about this much per vehicle is the aim
export const FAIL_MB = 46;          // at or above this a phone is likely to run out of memory
export const gpuBytes = (w, h) => w * h * 4 * 1.33;
export const gpuMB = (w, h) => gpuBytes(w, h) / MB;
export function memoryStatus(mb) { return mb >= FAIL_MB ? 'fail' : mb > TARGET_MB * 1.04 ? 'warn' : 'ok'; }

export const DEFAULTS = { baseSize: 1024, mrSize: 1024, normalSize: 512, quality: 0.85, merge: true };
const SLOT_CAP = (o) => ({ base: o.baseSize, mr: o.mrSize, occ: o.mrSize, normal: o.normalSize, emissive: 0, other: o.mrSize });

/* ---------- image size without decoding (PNG, JPEG, WebP) ---------- */
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  const be16 = i => (b[i] << 8) | b[i + 1], le16 = i => b[i] | (b[i + 1] << 8), le24 = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: be16(i + 5), w: be16(i + 7) };
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + be16(i + 2);
    }
    return null;
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (tag === 'VP8L') return { w: 1 + (b[21] | ((b[22] & 0x3f) << 8)), h: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
    if (tag === 'VP8X') return { w: 1 + le24(24), h: 1 + le24(27) };
  }
  return null;
}

/* ---------- reading the document ---------- */
const SLOTS = ['base', 'mr', 'normal', 'occ', 'emissive'];
export function slotTextures(m) { return { base: m.getBaseColorTexture(), mr: m.getMetallicRoughnessTexture(), normal: m.getNormalTexture(), occ: m.getOcclusionTexture(), emissive: m.getEmissiveTexture() }; }
function texInfo(m, slot) { return { base: m.getBaseColorTextureInfo, mr: m.getMetallicRoughnessTextureInfo, normal: m.getNormalTextureInfo, occ: m.getOcclusionTextureInfo, emissive: m.getEmissiveTextureInfo }[slot].call(m); }

// materials that primitives draw, biggest (most triangles) first
export function usedMaterials(doc) {
  const tri = new Map(); let bare = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const n = (p.getIndices() ? p.getIndices().getCount() : (p.getAttribute('POSITION')?.getCount() || 0)) / 3, m = p.getMaterial();
    if (m) tri.set(m, (tri.get(m) || 0) + n); else bare++;
  }
  return { list: [...tri.keys()].sort((a, b) => tri.get(b) - tri.get(a)), tri, bare };
}

function sizeOf(tex) { const s = imageSize(tex.getImage()); return s ? { w: s.w, h: s.h } : null; }
function fitTo(size, cap) { if (!size) return cap ? { w: cap, h: cap } : null; if (!cap) return null; const sc = Math.min(1, cap / Math.max(size.w, size.h)); return { w: Math.max(1, Math.round(size.w * sc)), h: Math.max(1, Math.round(size.h * sc)) }; }
const texName = (t, i) => t.getName() || t.getURI() || `texture ${i + 1}`;

const ROLE_LABEL = { base: 'base colour', mr: 'metal/rough', occ: 'occlusion', normal: 'normal', emissive: 'emissive' };

// the materials/texture sets, and what the preset will do with every texture
export function plan(doc, options = {}) {
  const o = { ...DEFAULTS, ...options }, caps = SLOT_CAP(o), root = doc.getRoot(), { list: used, tri, bare } = usedMaterials(doc);
  const all = root.listTextures(), roles = new Map();
  for (const m of used) { const st = slotTextures(m); for (const s of SLOTS) if (st[s]) { if (!roles.has(st[s])) roles.set(st[s], new Set()); roles.get(st[s]).add(s); } }
  const dropped = [], textures = [];
  all.forEach((t, i) => {
    const r = roles.get(t), size = sizeOf(t), name = texName(t, i);
    if (!r) { dropped.push({ name, w: size?.w, h: size?.h, reason: 'not used by any material that is drawn' }); return; }
    if ([...r].every(x => x === 'emissive')) { dropped.push({ name, w: size?.w, h: size?.h, reason: 'emissive map' }); return; }
    const rr = new Set([...r].filter(x => x !== 'emissive'));
    const cap = Math.max(...[...rr].map(x => caps[x] || caps.other));
    textures.push({ tex: t, name, roles: [...rr], from: size, to: fitTo(size, cap) });
  });
  // occlusion packed into the metal/rough map: the separate occlusion texture goes away
  const packs = [];
  for (const m of used) { const st = slotTextures(m); if (st.mr && st.occ && st.mr !== st.occ) packs.push({ material: m, mr: st.mr, occ: st.occ }); }
  for (const p of packs) {
    const e = textures.find(t => t.tex === p.occ);
    if (e && !e.roles.some(x => x !== 'occ')) { textures.splice(textures.indexOf(e), 1); dropped.push({ name: e.name, w: e.from?.w, h: e.from?.h, reason: 'occlusion map packed into the metal/rough map (ORM)' }); }
  }
  const sets = new Map();
  for (const m of used) { const st = slotTextures(m); const key = [st.base, st.mr, st.normal].map(t => (t ? all.indexOf(t) : '-')).join('/'); if (!sets.has(key)) sets.set(key, []); sets.get(key).push(m); }
  const textured = [...sets.keys()].filter(k => k !== '-/-/-');
  const mergeInfo = mergeable(doc, used);
  const before = all.reduce((a, t) => { const s = sizeOf(t); return a + (s ? gpuMB(s.w, s.h) : 0); }, 0);
  let after;
  if (o.merge && used.length > 1 && mergeInfo.ok) after = gpuMB(o.baseSize, o.baseSize) + gpuMB(o.mrSize, o.mrSize) + gpuMB(o.normalSize, o.normalSize);
  else after = textures.reduce((a, t) => a + (t.to ? gpuMB(t.to.w, t.to.h) : 0), 0);
  const warnings = [];
  const wheelish = used.slice(1).some(m => doc.getRoot().listNodes().some(n => n.getMesh()?.listPrimitives().some(p => p.getMaterial() === m) && /wheel|tyre|tire|rim|hub/i.test(n.getName() || '')));
  if (used.length > 1) {
    const what = wheelish ? 'The wheels use their own material / texture set' : `${used.length} materials (${textured.length} texture set${textured.length === 1 ? '' : 's'}) are used`;
    if (o.merge && mergeInfo.ok) warnings.push({ level: 'info', text: `${what}: they are merged into one atlas.` });
    else warnings.push({ level: 'warn', text: `${what}, which multiplies the memory. ${o.merge ? 'Could not merge them: ' + mergeInfo.reason + '.' : 'Tick "Merge into one texture set" to combine them.'}` });
  }
  if (bare && used.length) warnings.push({ level: 'warn', text: 'Some parts have no material at all.' });
  return { used: used.length, sets: textured.length, bare, textures, dropped, packs: packs.length, mergeable: mergeInfo, beforeMB: before, afterMB: after, status: memoryStatus(after), warnings, options: o };
}

/* ---------- can the materials be merged into one atlas? ---------- */
const KNOWN_EXT = ['KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_specular', 'KHR_materials_diffuse_transmission'];
export function mergeable(doc, used = usedMaterials(doc).list) {
  if (used.length < 2) return { ok: false, reason: 'only one material' };
  for (const m of used) {
    if (m.getAlphaMode() !== 'OPAQUE') return { ok: false, reason: 'a material is transparent or cut out' };
    for (const e of KNOWN_EXT) if (m.getExtension?.(e)) return { ok: false, reason: 'a material uses ' + e.replace('KHR_materials_', '') };
    for (const s of SLOTS) { const ti = slotTextures(m)[s] && texInfo(m, s); if (ti && (ti.getTexCoord() !== 0 || ti.getExtension?.('KHR_texture_transform'))) return { ok: false, reason: 'a texture uses a second UV set or a texture transform' }; }
  }
  const set = new Set(used);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial(); if (!m) return { ok: false, reason: 'some parts have no material' };
    if (!set.has(m)) continue;
    const uv = p.getAttribute('TEXCOORD_0');
    if (!uv) { const st = slotTextures(m); if (st.base || st.mr || st.normal || st.occ) return { ok: false, reason: 'a textured part has no UVs' }; continue; } // plain colour: sits on a colour tile
    const e = [0, 0]; for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, e); if (e[0] < -0.002 || e[0] > 1.002 || e[1] < -0.002 || e[1] > 1.002) return { ok: false, reason: 'UVs tile outside 0-1' }; }
  }
  return { ok: true };
}

/* ---------- pixel helpers ---------- */
const S2L = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const l2s = x => { x = Math.max(0, Math.min(1, x)); return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); };
const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
function fillRGBA(w, h, r, g, b, a = 255) { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; } return d; }
function blit(dst, W, src, x0, y0, w, h) { for (let y = 0; y < h; y++) dst.set(src.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * W + x0) * 4); }

async function cellPixels(role, m, w, h, ops) {
  const st = slotTextures(m);
  if (role === 'base') {
    const f = m.getBaseColorFactor();
    if (!st.base) return fillRGBA(w, h, l2s(f[0]), l2s(f[1]), l2s(f[2]));
    const px = await ops.decode(st.base.getImage(), st.base.getMimeType(), w, h);
    if (f[0] !== 1 || f[1] !== 1 || f[2] !== 1) for (let i = 0; i < px.length; i += 4) { px[i] = l2s(S2L[px[i]] * f[0]); px[i + 1] = l2s(S2L[px[i + 1]] * f[1]); px[i + 2] = l2s(S2L[px[i + 2]] * f[2]); }
    return px;
  }
  if (role === 'mr') {
    const rf = m.getRoughnessFactor(), mf = m.getMetallicFactor(), strength = m.getOcclusionStrength();
    const px = st.mr ? await ops.decode(st.mr.getImage(), st.mr.getMimeType(), w, h) : fillRGBA(w, h, 255, 255, 255);
    if (!st.mr) for (let i = 0; i < px.length; i += 4) { px[i + 1] = clamp8(rf * 255); px[i + 2] = clamp8(mf * 255); }
    else if (rf !== 1 || mf !== 1) for (let i = 0; i < px.length; i += 4) { px[i + 1] = clamp8(px[i + 1] * rf); px[i + 2] = clamp8(px[i + 2] * mf); }
    if (st.occ) { const ao = st.occ === st.mr ? px : await ops.decode(st.occ.getImage(), st.occ.getMimeType(), w, h); for (let i = 0; i < px.length; i += 4) px[i] = clamp8(255 - (255 - ao[i]) * strength); }
    else for (let i = 0; i < px.length; i += 4) px[i] = 255;
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    return px;
  }
  const sc = m.getNormalScale();   // role === 'normal'
  if (!st.normal) return fillRGBA(w, h, 128, 128, 255);
  const px = await ops.decode(st.normal.getImage(), st.normal.getMimeType(), w, h);
  if (sc !== 1) for (let i = 0; i < px.length; i += 4) { px[i] = clamp8(128 + (px[i] - 128) * sc); px[i + 1] = clamp8(128 + (px[i + 1] - 128) * sc); }
  return px;
}

/* ---------- merge the materials into one atlas ---------- */
async function mergeAtlas(doc, o, ops, done) {
  const { list: used } = usedMaterials(doc), n = used.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const dims = { base: o.baseSize, mr: o.mrSize, normal: o.normalSize };
  const tex = {};
  for (const role of ['base', 'mr', 'normal']) {
    const W = dims[role], H = dims[role], cw = Math.floor(W / cols), ch = Math.floor(H / rows);
    const atlas = role === 'normal' ? fillRGBA(W, H, 128, 128, 255) : role === 'mr' ? fillRGBA(W, H, 255, 255, 255) : fillRGBA(W, H, 255, 255, 255);
    for (let i = 0; i < n; i++) blit(atlas, W, await cellPixels(role, used[i], cw, ch, ops), (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
    const enc = await ops.encode(atlas, W, H, o.quality);
    tex[role] = doc.createTexture(`atlas_${role}`).setImage(enc.bytes).setMimeType(enc.mime); done.add(tex[role]);
  }
  // UVs of every primitive move into its material's cell (a new accessor per primitive: accessors can be shared between primitives)
  const cell = new Map(used.map((m, i) => [m, { ox: (i % cols) / cols, oy: Math.floor(i / cols) / rows, sx: 1 / cols, sy: 1 / rows }]));
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const c = cell.get(p.getMaterial()), uv = p.getAttribute('TEXCOORD_0'); if (!c) continue;
    if (!uv) { // plain-colour part with no UVs: every vertex points at the middle of its colour tile
      const cnt = p.getAttribute('POSITION').getCount(), flat = new Float32Array(cnt * 2);
      for (let i = 0; i < cnt; i++) { flat[i * 2] = c.ox + c.sx / 2; flat[i * 2 + 1] = c.oy + c.sy / 2; }
      p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(flat)); continue;
    }
    const out = new Float32Array(uv.getCount() * 2), e = [0, 0];
    for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, e); out[i * 2] = c.ox + e[0] * c.sx; out[i * 2 + 1] = c.oy + e[1] * c.sy; }
    p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(out));
  }
  // one material for everything: the first (biggest) one, now carrying the atlas
  const keep = used[0];
  keep.setDoubleSided(used.some(m => m.getDoubleSided())); // one shared material: double-sided if any part needed it
  keep.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(1).setNormalScale(1).setOcclusionStrength(1).setEmissiveFactor([0, 0, 0])
    .setBaseColorTexture(tex.base).setMetallicRoughnessTexture(tex.mr).setOcclusionTexture(tex.mr).setNormalTexture(tex.normal).setEmissiveTexture(null);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMaterial() && p.getMaterial() !== keep) p.setMaterial(keep);
  return n;
}

/* ---------- do it ---------- */
// ops: { decode(bytes, mime, w, h) -> RGBA of w x h; encode(rgba, w, h, quality) -> {bytes, mime}; prune(doc); enableWebP(doc) }
export async function apply(doc, options, ops, progress = () => {}) {
  const o = { ...DEFAULTS, ...options }, p0 = plan(doc, o), report = { ...p0, merged: 0, packed: 0, notes: [] };
  const done = new WeakSet();
  // emissive maps and colours go (a racing game does not use them)
  const { list: used } = usedMaterials(doc);
  for (const m of used) { if (m.getEmissiveTexture()) m.setEmissiveTexture(null); const e = m.getEmissiveFactor(); if (e && (e[0] || e[1] || e[2])) { m.setEmissiveFactor([0, 0, 0]); report.notes.push('Emissive colour removed.'); } }
  await ops.prune(doc);
  ops.enableWebP?.(doc);
  if (o.merge && used.length > 1 && p0.mergeable.ok) { progress('Merging the texture sets into one atlas…'); report.merged = await mergeAtlas(doc, o, ops, done); }
  // pack occlusion into the metal/rough map, then size every remaining texture for its role
  const caps = SLOT_CAP(o);
  const roles = new Map();
  for (const m of usedMaterials(doc).list) { const st = slotTextures(m); for (const s of SLOTS) if (st[s]) { if (!roles.has(st[s])) roles.set(st[s], new Set()); roles.get(st[s]).add(s); } }
  for (const m of usedMaterials(doc).list) {
    const st = slotTextures(m);
    if (st.mr && st.occ && st.mr !== st.occ && !done.has(st.mr)) {
      const s = sizeOf(st.mr), t = fitTo(s, caps.mr), w = t.w, h = t.h;
      const px = await ops.decode(st.mr.getImage(), st.mr.getMimeType(), w, h), ao = await ops.decode(st.occ.getImage(), st.occ.getMimeType(), w, h), k = m.getOcclusionStrength();
      for (let i = 0; i < px.length; i += 4) { px[i] = clamp8(255 - (255 - ao[i]) * k); px[i + 3] = 255; }
      const enc = await ops.encode(px, w, h, o.quality); st.mr.setImage(enc.bytes).setMimeType(enc.mime); done.add(st.mr);
      m.setOcclusionTexture(st.mr).setOcclusionStrength(1); report.packed++;
    }
  }
  await ops.prune(doc);
  const tlist = doc.getRoot().listTextures();
  for (let i = 0; i < tlist.length; i++) {
    const t = tlist[i]; if (done.has(t)) continue;
    const r = roles.get(t) || new Set(['other']), cap = Math.max(...[...r].map(x => caps[x] || caps.other)), s = sizeOf(t), f = fitTo(s, cap);
    progress(`Sizing texture ${i + 1} of ${tlist.length}…`);
    const px = await ops.decode(t.getImage(), t.getMimeType(), f.w, f.h), enc = await ops.encode(px, f.w, f.h, o.quality);
    t.setImage(enc.bytes).setMimeType(enc.mime); done.add(t);
  }
  // what the file really holds now
  const final = doc.getRoot().listTextures().map((t, i) => { const s = sizeOf(t), r = roles.get(t) || new Set(['base']); return { name: texName(t, i), w: s?.w, h: s?.h, roles: [...r], mb: s ? gpuMB(s.w, s.h) : 0 }; });
  report.final = final; report.afterMB = final.reduce((a, t) => a + t.mb, 0); report.status = memoryStatus(report.afterMB);
  report.finalMaterials = usedMaterials(doc).list.length;
  return report;
}

export function describe(report) {
  const f = report.final || [];
  const lines = [];
  if (f.length) lines.push('Textures: ' + f.map(t => `${(t.roles.length ? t.roles.map(r => ROLE_LABEL[r] || r).join(' + ') : 'other')} ${t.w}×${t.h}`).join(', '));
  return lines;
}
export { ROLE_LABEL };
