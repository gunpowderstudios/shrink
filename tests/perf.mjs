import { repairMesh, meshHealth } from '../repair-core.js';
import { ok } from './helpers.mjs';
function sphereSoup(tris) {
  const seg = Math.round(Math.sqrt(tris / 2 * 2)), rings = Math.round(seg / 2);
  const pos = [], idx = []; let n = 0;
  const P = (y, x) => { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI; return [20 * Math.sin(v) * Math.cos(u), 20 * Math.cos(v), 20 * Math.sin(v) * Math.sin(u)]; };
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
    const a = P(y, x), b = P(y + 1, x), c = P(y, x + 1), d = P(y + 1, x + 1);
    for (const t of [[a, b, c], [b, d,c]]) { for (const v of t) { pos.push(...v); idx.push(n++); } }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
for (const tris of [30000, 100000, 321850, 1072845]) {
  const m = sphereSoup(tris);
  const t0 = performance.now();
  try {
    const r = repairMesh({ positions: m.pos, indices: m.idx }); global.__r = r;
    console.log(`${String(m.idx.length / 3).padStart(8)} triangles (unwelded): ${((performance.now() - t0) / 1000).toFixed(1)} s, clean=${r.stats.after.clean} (health ${r.stats.after.triangles} tris)`);
  } catch (e) { console.log(`${m.idx.length / 3} triangles: FAILED ${e.message}`); }
}
console.log('--- the health check alone (what preflight and the post-reduction guard run) ---');
for (const tris of [321850, 1072845]) {
  const m = sphereSoup(tris); const t0 = performance.now(); const h = meshHealth(m.pos, m.idx);
  console.log(`${String(m.idx.length / 3).padStart(8)} unwelded triangles: ${((performance.now() - t0) / 1000).toFixed(2)} s -> open ${h.open}, tangled ${h.tangled}, flipped ${h.flipped}, degenerate ${h.degenerate}, clean=${h.clean}`);
}
