import * as THREE from 'https://esm.sh/three@0.180.0';
import { loadBVH } from './bvh-support.js?v=2.06';

// SHRINK 3D v2.06 — watertight voxel/level-set repair.
// Unlike the old nearest-normal sign test, this version decides inside/outside
// by ray parity per mesh/subtool, then unions those volumes. This is much more
// tolerant of flipped faces and overlapping sculpt subtools.
const VERSION = '2.06';

function disposeRoot(root) {
  root?.traverse?.(o => {
    if (!o.isMesh) return;
    o.geometry?.disposeBoundsTree?.();
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => m?.dispose?.());
  });
}

function qualityDivisor(quality) {
  if (quality === 'high') return 64;
  if (quality === 'fast') return 40;
  return 52; // balanced — intentionally conservative for browser voxel work
}

function countTriangles(model) {
  let triangles = 0;
  model?.traverse?.(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    triangles += Math.floor((g.index?.count || g.attributes.position.count) / 3);
  });
  return triangles;
}

function browserBudget(quality) {
  if (quality === 'high') return 220000;
  if (quality === 'fast') return 650000;
  return 400000;
}

export function remeshPreflight(model, quality = 'balanced') {
  const triangles = countTriangles(model);
  const divisor = qualityDivisor(quality);
  const approxGridSamples = divisor ** 3;
  const triangleLimit = browserBudget(quality);
  const safe = triangles <= triangleLimit;
  return { triangles, triangleLimit, approxGridSamples, quality, safe };
}

function transformedGeometry(mesh) {
  const src = mesh.geometry;
  const g = src.clone();
  g.applyMatrix4(mesh.matrixWorld);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.deleteAttribute('uv1');
  g.deleteAttribute('color');
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

async function buildVoxelSources(model, onStatus = () => {}) {
  const lib = await loadBVH();
  if (!lib?.MeshBVH) throw new Error('The voxel repair helper could not load in this browser.');

  model.updateMatrixWorld(true);
  const sourceMeshes = [];
  model.traverse(o => {
    if (o.isMesh && o.geometry?.attributes?.position?.count >= 3) sourceMeshes.push(o);
  });
  if (!sourceMeshes.length) throw new Error('No printable surface was found in this model.');

  const components = [];
  const overall = new THREE.Box3();
  overall.makeEmpty();

  for (let i = 0; i < sourceMeshes.length; i++) {
    onStatus(`Preparing part ${i + 1} of ${sourceMeshes.length} for voxel repair…`);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const geometry = transformedGeometry(sourceMeshes[i]);
    try {
      geometry.computeBoundsTree({ targetLeafSize: 20 });
    } catch (err) {
      geometry.dispose?.();
      throw new Error(`Could not prepare mesh part ${i + 1} for voxel repair: ${err.message}`);
    }

    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const proxy = new THREE.Mesh(geometry, material);
    proxy.updateMatrixWorld(true);
    const box = geometry.boundingBox.clone();
    overall.union(box);
    components.push({ geometry, material, proxy, box, tree: geometry.boundsTree });
  }

  return { components, overall };
}

function disposeVoxelSources(components = []) {
  for (const c of components) {
    c.geometry?.disposeBoundsTree?.();
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  }
}

function boxDistanceToPoint(box, p) {
  const x = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
  const y = Math.max(box.min.y - p.y, 0, p.y - box.max.y);
  const z = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
  return Math.hypot(x, y, z);
}

function makeVoxelSignedDistance(components, edgeLength) {
  const point = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
  // Non-axis-aligned direction reduces ambiguous edge/vertex hits.
  const rayDir = new THREE.Vector3(1, 0.37139068, 0.17320508).normalize();
  const ray = new THREE.Ray();
  const dedupeTol = Math.max(edgeLength * 0.025, 1e-7);

  function nearestDistance() {
    let best = Infinity;
    for (const c of components) {
      if (boxDistanceToPoint(c.box, point) > best) continue;
      hit.distance = Infinity;
      const found = c.tree?.closestPointToPoint?.(point, hit);
      if (found && Number.isFinite(hit.distance) && hit.distance < best) best = hit.distance;
    }
    return best;
  }

  function insideComponent(c) {
    ray.origin.copy(point);
    ray.direction.copy(rayDir);
    if (!ray.intersectsBox(c.box)) return false;

    raycaster.ray.copy(ray);
    raycaster.near = 0;
    raycaster.far = Infinity;
    let hits;
    try {
      hits = raycaster.intersectObject(c.proxy, false);
    } catch {
      return false;
    }
    if (!hits?.length) return false;

    // Adjacent triangles can report the same crossing. Count distinct distances.
    let crossings = 0;
    let last = -Infinity;
    for (const h of hits) {
      if (!Number.isFinite(h.distance) || h.distance <= dedupeTol) continue;
      if (Math.abs(h.distance - last) <= dedupeTol) continue;
      crossings++;
      last = h.distance;
    }
    return (crossings & 1) === 1;
  }

  return xyz => {
    point.set(xyz[0], xyz[1], xyz[2]);
    const d = nearestDistance();
    if (!Number.isFinite(d)) return -1e9;

    // Union semantics: a point is inside when it is inside ANY source part.
    // This prevents overlapping sculpt subtools from cancelling each other out.
    let inside = false;
    for (const c of components) {
      if (insideComponent(c)) { inside = true; break; }
    }
    return inside ? d : -d;
  };
}

export async function makeWatertight(model, quality = 'balanced', onStatus = () => {}) {
  if (!model) throw new Error('No model is loaded.');

  const preflight = remeshPreflight(model, quality);
  if (!preflight.safe) {
    const nf = new Intl.NumberFormat();
    const err = new Error(`This model is too heavy to remesh safely in your browser (${nf.format(preflight.triangles)} triangles). SHRINK it first, then try Make watertight again.`);
    err.code = 'REMESH_TOO_HEAVY';
    err.preflight = preflight;
    throw err;
  }

  onStatus(`Preparing ${new Intl.NumberFormat().format(preflight.triangles)} triangles for voxel repair…`);
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  const { components, overall } = await buildVoxelSources(model, onStatus);
  try {
    const size = overall.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, 1e-6);
    const divisor = qualityDivisor(quality);
    const edgeLength = longest / divisor;
    const box = overall.clone().expandByScalar(edgeLength * 3);

    onStatus(quality === 'high'
      ? 'Voxelising the sculpt — High detail can take a while…'
      : 'Voxelising the sculpt into one watertight skin…');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const wasm = await window.__shrinkFuse?.loadManifold?.();
    if (!wasm?.Manifold?.levelSet) throw new Error('The watertight repair engine is not available.');

    const sdf = makeVoxelSignedDistance(components, edgeLength);
    const bounds = { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
    const solid = wasm.Manifold.levelSet(sdf, bounds, edgeLength, 0, -1);
    try {
      const status = solid?.status?.();
      if (solid?.isEmpty?.()) throw new Error(`Voxel remesh produced no solid${status ? ` (${status})` : ''}.`);
      const root = window.__shrinkFuse?.solidToThree?.(solid);
      if (!root) throw new Error('The repaired solid could not be converted back to a model.');
      root.name = 'SHRINK voxel watertight repair';
      root.userData.shrinkWatertight = true;
      root.userData.remeshMethod = 'voxel-parity-union';
      root.userData.remeshQuality = quality;
      root.userData.edgeLength = edgeLength;
      root.updateMatrixWorld(true);
      return { root, edgeLength, quality, preflight, method: 'voxel-parity-union' };
    } finally {
      try { solid?.delete?.(); } catch {}
    }
  } finally {
    disposeVoxelSources(components);
  }
}

export function installWatertightRoot(root, meta = {}) {
  if (window.__shrinkRepair?.root && window.__shrinkRepair.root !== root) disposeRoot(window.__shrinkRepair.root);
  window.__shrinkRepair = { root, ...meta, version: VERSION };
  return window.__shrinkRepair;
}

export function clearWatertightRoot() {
  if (window.__shrinkRepair?.root) disposeRoot(window.__shrinkRepair.root);
  window.__shrinkRepair = null;
}
