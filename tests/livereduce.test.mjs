// The live reducer (live-reduce.js) with the real simplifier: the reduced preview must shade hard edges crisply WITHOUT changing the geometry,
// and going back to 100% must restore the original preview exactly.
import path from 'path';
import { JSDOM } from 'jsdom';
import { MeshoptSimplifier } from 'meshoptimizer';
import { prepareMultitool, mtBuild, makeFigure, THREE, ok, failures, wait } from './mt-harness.mjs';
import { root } from './helpers.mjs';
prepareMultitool();
const win = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' }).window;
Object.assign(globalThis, { window: win, document: win.document, CustomEvent: win.CustomEvent });
delete globalThis.Worker;                                         // Node has no Web Worker: the reducer falls back to the main thread, as in old browsers
await MeshoptSimplifier.ready;
const { createLiveReducer } = await import(path.join(mtBuild, 'live-reduce.js'));
const { reduceIndices } = await import(path.join(root, 'reduce-core.js'));
const core = await import(path.join(root, 'repair-core.js'));

const wrong = geo => { const P = geo.attributes.position.array, N = geo.attributes.normal.array, I = geo.index.array; let bad = 0, tot = 0; for (let t = 0; t < I.length / 3; t++) { const a = I[t*3], b = I[t*3+1], c = I[t*3+2]; if (Math.min(P[a*3+1], P[b*3+1], P[c*3+1]) < 2.8) continue; if (Math.max(P[a*3+1], P[b*3+1], P[c*3+1]) > 3.4) continue; const ux=P[b*3]-P[a*3],uy=P[b*3+1]-P[a*3+1],uz=P[b*3+2]-P[a*3+2],vx=P[c*3]-P[a*3],vy=P[c*3+1]-P[a*3+1],vz=P[c*3+2]-P[a*3+2]; const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz); if (len < 1e-12 || ny / len < 0.9) continue; tot += len / 2; let mx = 0; for (const v of [a, b, c]) mx = Math.max(mx, Math.acos(Math.max(-1, Math.min(1, (N[v*3]*nx + N[v*3+1]*ny + N[v*3+2]*nz) / len))) * 180 / Math.PI); if (mx > 12) bad += len / 2; } return tot ? 100 * bad / tot : 0; };
const mkApp = model => ({ originalModel: model, optimizedModel: null, setPreview(r) { this.optimizedModel = r; }, clearPreview() { this.optimizedModel = null; }, notifyReduced() {} });
const geoOf = app => app.optimizedModel.children[0].geometry;

const figure = await makeFigure();
const g0 = figure.children[0].geometry, origVerts = g0.attributes.position.count, origIdx = g0.index.count;
{
  const app = mkApp(figure), engine = createLiveReducer(app);
  await engine.prepare();
  ok(engine.ready, 'the live reducer is ready on the main-thread fallback');
  await engine.runExact(0.05);
  const g = geoOf(app), direct = reduceIndices({ simplifier: MeshoptSimplifier, positions: g0.attributes.position.array, indices: g0.index.array, lock: null, ratio: 0.05, error: 0.05 }).indices;
  ok(g.index.count === direct.length, `5% preview has the same triangles as the plain reduction (${g.index.count / 3})`);
  ok(!!g.attributes.normal && g.attributes.normal.count === g.attributes.position.count && g.index.array.every(x => x < g.attributes.position.count), 'normals present, same length as positions, every index valid');
  ok(g.attributes.position.count > origVerts, `hard edges got their own vertices (${g.attributes.position.count - origVerts} split)`);
  // geometry unchanged
  const h1 = core.meshHealth(g0.attributes.position.array, direct), h2 = core.meshHealth(g.attributes.position.array, g.index.array);
  ok(h1.triangles === h2.triangles && h1.points === h2.points && h1.open === h2.open && h1.tangled === h2.tangled && h1.flipped === h2.flipped, `geometry is exactly the plain reduction's (tris ${h2.triangles}, points ${h2.points}, non-manifold ${h2.tangled})`);
  // shading
  const plain = new THREE.BufferGeometry(); plain.setAttribute('position', g0.attributes.position); plain.setIndex(new THREE.BufferAttribute(direct, 1)); plain.computeVertexNormals();
  const before = wrong(plain), after = wrong(g);
  // The top of this figure's base is bumpy on purpose, so some smoothing across bumps is intended (up to the 55 degree crease angle); what matters is how much better it is.
  ok(before > 10 && after < before * 0.2, `top of the base shaded more than 12 degrees off its true surface: ${before.toFixed(1)}% with plain normals -> ${after.toFixed(1)}% now`);
  // back to 100%: pristine
  await engine.runExact(1);
  const g1 = geoOf(app);
  ok(g1.attributes.position.count === origVerts && g1.index.count === origIdx, '100% restores the original vertex and triangle counts');
  ok(g1.attributes.normal.array.length === g0.attributes.normal.array.length && g1.attributes.normal.array.every((v, i) => v === g0.attributes.normal.array[i]), '100% restores the original shading normals exactly');
  // and the next reduction still works (no corruption from the extended attributes)
  await engine.runExact(0.2);
  const g2 = geoOf(app), d2 = reduceIndices({ simplifier: MeshoptSimplifier, positions: g0.attributes.position.array, indices: g0.index.array, lock: null, ratio: 0.2, error: 0.05 }).indices;
  ok(g2.index.count === d2.length && g2.index.array.every(x => x < g2.attributes.position.count), `a later 20% reduction is still correct (${g2.index.count / 3} triangles)`);
  await engine.runExact(0.05); await engine.runExact(0.05);
  ok(geoOf(app).index.count === direct.length, 'repeating a reduction gives the same result');
}
{
  // a mesh with extra vertex data (e.g. colours) keeps the old, safe path: positions are not split
  const colored = await makeFigure(); const cg = colored.children[0].geometry;
  cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count * 3).fill(0.7), 3));
  const app = mkApp(colored), engine = createLiveReducer(app); await engine.prepare(); await engine.runExact(0.1);
  const g = geoOf(app);
  ok(g.attributes.position.count === cg.attributes.position.count && !!g.attributes.normal && !!g.attributes.color, 'a mesh with vertex colours keeps its vertices and attributes (legacy path)');
}
console.log(failures() ? `\n${failures()} FAILED` : '\nall passed');
process.exit(failures() ? 1 : 0);
