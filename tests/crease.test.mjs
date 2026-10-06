// crease-normals.js: crease-aware shading for the reduced preview (display only; geometry must never change)
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { creaseSplit } from '../crease-normals.js';
import { reduceIndices } from '../reduce-core.js';
import { meshHealth, weldIds, defaultWeldTolerance } from '../repair-core.js';
import { ok, failures } from './helpers.mjs';
await MeshoptSimplifier.ready;

const welded = (P, I) => { const w = weldIds(P, defaultWeldTolerance(P).tol); const Pw = new Float32Array(w.unique * 3); for (let u = 0; u < w.unique; u++) { Pw[u*3] = P[w.first[u]*3]; Pw[u*3+1] = P[w.first[u]*3+1]; Pw[u*3+2] = P[w.first[u]*3+2]; } return { P: Pw, I: Uint32Array.from(I, v => w.canon[v]) }; };

// a cube: every corner touches three faces at 90 degrees
{
  const p = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const i = new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 2,3,7, 2,7,6, 1,2,6, 1,6,5, 0,4,7, 0,7,3]);
  const r = creaseSplit(p, i, { creaseDeg: 40 });
  ok(r.vertexCount === 24 && r.splitVertices === 16, `cube: 8 corners become 24 vertices (got ${r.vertexCount})`);
  let axis = true; for (let v = 0; v < r.vertexCount; v++) if (Math.max(...[r.normals[v*3], r.normals[v*3+1], r.normals[v*3+2]].map(Math.abs)) < 0.999) axis = false;
  ok(axis, 'cube: every shading normal is exactly along an axis (crisp edges)');
  ok(r.indices.length === i.length && r.indices.every(x => x < r.vertexCount), 'cube: triangle count unchanged, every index valid');
  const a = meshHealth(p, i), b = meshHealth(r.positions, r.indices);
  ok(b.clean === a.clean && b.triangles === a.triangles && b.points === a.points, 'cube: geometry identical once duplicates are welded');
}
// a smooth sphere: nothing is split, normals are radial
{
  const seg = 64, rings = 32, pos = [], idx = [];
  for (let y = 0; y <= rings; y++) for (let x = 0; x <= seg; x++) { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI; pos.push(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)); }
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) { const a = y * (seg + 1) + x, b = a + seg + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const { P, I } = welded(new Float32Array(pos), new Uint32Array(idx));
  const r = creaseSplit(P, I, { creaseDeg: 55 });
  ok(r.splitVertices === 0, `sphere: no vertex needs splitting (${r.splitVertices})`);
  let worst = 0; for (let v = 0; v < r.vertexCount; v++) { const l = Math.hypot(P[v*3], P[v*3+1], P[v*3+2]); worst = Math.max(worst, Math.acos(Math.min(1, Math.abs((r.normals[v*3]*P[v*3] + r.normals[v*3+1]*P[v*3+1] + r.normals[v*3+2]*P[v*3+2]) / l))) * 180 / Math.PI); }
  ok(worst < 3, `sphere: normals are radial to within ${worst.toFixed(2)} degrees`);
}
// a flat base with a hard rim, reduced hard: the dark-patch case
{
  const seg = 240, rings = 60, R = 20, H = 3, pos = [], idx = [], P0 = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  const top = []; for (let k = 0; k <= rings; k++) { const rr = R * k / rings, row = []; for (let s = 0; s < seg; s++) { const a = s / seg * 2 * Math.PI; row.push(P0(rr * Math.cos(a), H + (k > 3 ? 0.03 * Math.sin(a * 13) * Math.sin(rr) : 0), rr * Math.sin(a))); } top.push(row); }
  for (let k = 0; k < rings; k++) for (let s = 0; s < seg; s++) { const a = top[k][s], b = top[k][(s + 1) % seg], c = top[k + 1][s], d = top[k + 1][(s + 1) % seg]; if (k === 0) idx.push(a, d, c); else idx.push(a, c, b, b, c, d); }
  const sideTop = top[rings], sideBot = []; for (let s = 0; s < seg; s++) { const a = s / seg * 2 * Math.PI; sideBot.push(P0(R * Math.cos(a), 0, R * Math.sin(a))); }
  for (let s = 0; s < seg; s++) { const a = sideTop[s], b = sideTop[(s + 1) % seg], c = sideBot[s], d = sideBot[(s + 1) % seg]; idx.push(a, b, c, b, d, c); }
  const ctr = P0(0, 0, 0); for (let s = 0; s < seg; s++) idx.push(ctr, sideBot[s], sideBot[(s + 1) % seg]);
  const { P, I } = welded(new Float32Array(pos), new Uint32Array(idx)); for (let t = 0; t < I.length; t += 3) { const x = I[t+1]; I[t+1] = I[t+2]; I[t+2] = x; }
  const wrong = (Pa, Ia, nrm) => { let bad = 0, tot = 0; for (let t = 0; t < Ia.length / 3; t++) { const a = Ia[t*3], b = Ia[t*3+1], c = Ia[t*3+2]; if (Math.min(Pa[a*3+1], Pa[b*3+1], Pa[c*3+1]) < 2.0) continue; const ux=Pa[b*3]-Pa[a*3],uy=Pa[b*3+1]-Pa[a*3+1],uz=Pa[b*3+2]-Pa[a*3+2],vx=Pa[c*3]-Pa[a*3],vy=Pa[c*3+1]-Pa[a*3+1],vz=Pa[c*3+2]-Pa[a*3+2]; const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz); if (len < 1e-12) continue; tot += len / 2; let mx = 0; for (const v of [a, b, c]) mx = Math.max(mx, Math.acos(Math.max(-1, Math.min(1, (nrm[v*3]*nx + nrm[v*3+1]*ny + nrm[v*3+2]*nz) / len))) * 180 / Math.PI); if (mx > 12) bad += len / 2; } return 100 * bad / tot; };
  for (const ratio of [0.2, 0.05, 0.02]) {
    const red = reduceIndices({ simplifier: MeshoptSimplifier, positions: P, indices: I, lock: null, ratio, error: 0.05 }).indices;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(red, 1)); g.computeVertexNormals();
    const cs = creaseSplit(P, red, { creaseDeg: 55 });
    const before = wrong(P, red, g.attributes.normal.array), after = wrong(cs.positions, cs.indices, cs.normals);
    ok(after <= before * 0.4 && (ratio < 0.05 ? true : after < 0.5), `base reduced to ${ratio*100}%: top shaded wrong by >12 degrees: ${before.toFixed(1)}% with plain smooth normals -> ${after.toFixed(2)}% crease-aware`);
    const h1 = meshHealth(P, red), h2 = meshHealth(cs.positions, cs.indices);
    ok(h1.triangles === h2.triangles && h1.points === h2.points && h1.open === h2.open && h1.tangled === h2.tangled && h1.flipped === h2.flipped, `base ${ratio*100}%: geometry unchanged (same triangles, points and health once welded)`);
  }
}
// empty triangles must not break it, and the output must stay valid
{
  const p = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1, 5,5,5]);
  const i = new Uint32Array([0,2,1, 0,1,3, 0,3,2, 1,2,3, 4,4,4, 0,0,1]);
  const r = creaseSplit(p, i, { creaseDeg: 55 });
  ok(r.indices.length === i.length && r.indices.every(x => x < r.vertexCount) && r.normals.every(Number.isFinite), 'empty triangles: still valid, finite normals');
}
// speed
{
  const seg = 1000, rings = 500, pos = [], idx = [];
  for (let y = 0; y <= rings; y++) for (let x = 0; x < seg; x++) { const v = y / rings * Math.PI, u = x / seg * 2 * Math.PI; pos.push(Math.sin(v) * Math.cos(u) * (1 + 0.05 * Math.sin(u * 20)), Math.cos(v), Math.sin(v) * Math.sin(u)); }
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) { const a = y * seg + x, a2 = y * seg + (x + 1) % seg, b = a + seg, b2 = a2 + seg; idx.push(a, a2, b, b, a2, b2); }
  const t0 = performance.now(); const r = creaseSplit(new Float32Array(pos), new Uint32Array(idx), { creaseDeg: 55 }); const ms = performance.now() - t0;
  ok(ms < 3000, `1,000,000 triangles shaded in ${(ms/1000).toFixed(2)} s (${r.splitVertices} vertices split)`);
}
console.log(failures() ? `\n${failures()} FAILED` : '\nall passed');
process.exit(failures() ? 1 : 0);
