// v2.236: extra export formats for the 3D Printing tools. No DOM here, so Node tests can load it.
//   build3mf  -> .3mf  (millimetres, Z-up as the 3MF spec says; slicers read it directly)
//   buildUsdz -> .usdz (metres, Y-up; opens in Apple Quick Look / AR)
// Both take the same `{ THREE, model, mmPerUnit }` as buildBinaryStl and return { blob, triangles }.

const enc = new TextEncoder();

// ---- tiny "store only" zip writer (3MF and USDZ are both plain zips; USDZ needs 64-byte aligned, uncompressed files) ----
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
export function zipStore(files, { align = 0 } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    let extraLen = 0;
    if (align) { const at = offset + 30 + name.length; extraLen = (align - (at % align)) % align; if (extraLen > 0 && extraLen < 4) extraLen += align; }
    const head = new Uint8Array(30 + name.length + extraLen), dv = new DataView(head.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);   // fixed date (1980-01-01)
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true); dv.setUint16(28, extraLen, true);
    head.set(name, 30);
    if (extraLen) { dv.setUint16(30 + name.length, 0x1986, true); dv.setUint16(32 + name.length, extraLen - 4, true); }
    parts.push(head, data);
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    offset += head.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end]);
}

// ---- text collector: strings in, one Uint8Array out (keeps big models from building one giant string) ----
function textBuilder() {
  const chunks = []; let pending = [], pendingLen = 0, bytes = 0;
  const flush = () => { if (!pending.length) return; const u = enc.encode(pending.join('')); chunks.push(u); bytes += u.length; pending = []; pendingLen = 0; };
  return {
    add(s) { pending.push(s); pendingLen += s.length; if (pendingLen > 200000) flush(); },
    done() { flush(); const out = new Uint8Array(bytes); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; }
  };
}

// every visible mesh as world-space positions (scaled) and triangle indices, merged into one list
function gather(THREE, model, scale, place) {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3(), pos = [], idx = [];
  let base = 0;
  model.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.visible === false) return;
    const g = o.geometry, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).multiplyScalar(scale);
      place(v, pos);
    }
    const n = g.index ? g.index.count : p.count;
    for (let t = 0; t + 2 < n; t += 3) idx.push((g.index ? g.index.getX(t) : t) + base, (g.index ? g.index.getX(t + 1) : t + 1) + base, (g.index ? g.index.getX(t + 2) : t + 2) + base);
    base += p.count;
  });
  return { pos, idx };
}

export function build3mf({ THREE, model, mmPerUnit = 1 }) {
  // 3MF is Z-up: the model's Y-up becomes Z-up the same way the STL's Z-up option does (x, -z, y)
  const { pos, idx } = gather(THREE, model, mmPerUnit, (v, out) => out.push(v.x, -v.z, v.y));
  const tris = idx.length / 3;
  const x = textBuilder();
  x.add('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Application">SHRINK 3D</metadata>\n<resources>\n<object id="1" type="model">\n<mesh>\n<vertices>\n');
  for (let i = 0; i < pos.length; i += 3) x.add(`<vertex x="${+pos[i].toFixed(4)}" y="${+pos[i + 1].toFixed(4)}" z="${+pos[i + 2].toFixed(4)}"/>\n`);
  x.add('</vertices>\n<triangles>\n');
  for (let i = 0; i < idx.length; i += 3) x.add(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>\n`);
  x.add('</triangles>\n</mesh>\n</object>\n</resources>\n<build>\n<item objectid="1"/>\n</build>\n</model>\n');
  const files = [
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: x.done() }
  ];
  const blob = zipStore(files);
  return { blob: new Blob([blob], { type: 'model/3mf' }), triangles: tris };
}

export function buildUsdz({ THREE, model, mmPerUnit = 1 }) {
  // USDZ: metres, Y-up (what Apple Quick Look expects), one mesh with smooth vertex normals and a plain grey colour
  const { pos, idx } = gather(THREE, model, mmPerUnit / 1000, (v, out) => out.push(v.x, v.y, v.z));
  const tris = idx.length / 3, nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;   // area-weighted
    for (const k of [a, b, c]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  const f = n => +n.toPrecision(6);
  const x = textBuilder();
  x.add('#usda 1.0\n(\n    defaultPrim = "Model"\n    metersPerUnit = 1\n    upAxis = "Y"\n    doc = "Made with SHRINK 3D"\n)\n\ndef Xform "Model" (\n    kind = "component"\n)\n{\n    def Mesh "Mesh"\n    {\n        uniform bool doubleSided = 1\n        uniform token subdivisionScheme = "none"\n        color3f[] primvars:displayColor = [(0.72, 0.74, 0.77)]\n        int[] faceVertexCounts = [');
  for (let i = 0; i < tris; i++) x.add(i ? ',3' : '3');
  x.add(']\n        int[] faceVertexIndices = [');
  for (let i = 0; i < idx.length; i++) x.add(i ? ',' + idx[i] : String(idx[i]));
  x.add(']\n        point3f[] points = [');
  for (let i = 0; i < pos.length; i += 3) x.add(`${i ? ',' : ''}(${f(pos[i])},${f(pos[i + 1])},${f(pos[i + 2])})`);
  x.add(']\n        normal3f[] normals = [');
  for (let i = 0; i < nrm.length; i += 3) x.add(`${i ? ',' : ''}(${f(nrm[i])},${f(nrm[i + 1])},${f(nrm[i + 2])})`);
  x.add('] (\n            interpolation = "vertex"\n        )\n    }\n}\n');
  const blob = zipStore([{ name: 'model.usda', data: x.done() }], { align: 64 });
  return { blob: new Blob([blob], { type: 'model/vnd.usdz+zip' }), triangles: tris };
}
