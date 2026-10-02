import * as THREE from 'https://esm.sh/three@0.180.0';
import { loadBVH } from './bvh-support.js?v=2.03';

// SHRINK 3D v2.03 — on-demand watertight remesh with browser safety preflight.
const VERSION = '2.03';

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
  if (quality === 'high') return 105;
  if (quality === 'fast') return 55;
  return 75; // balanced — intentionally conservative in-browser
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
  if (quality === 'high') return 250000;
  if (quality === 'fast') return 700000;
  return 450000;
}

export function remeshPreflight(model, quality = 'balanced') {
  const triangles = countTriangles(model);
  const divisor = qualityDivisor(quality);
  const approxGridSamples = divisor ** 3;
  const triangleLimit = browserBudget(quality);
  const safe = triangles <= triangleLimit;
  return { triangles, triangleLimit, approxGridSamples, quality, safe };
}

async function bakeWorldGeometry(model) {
  const lib = await loadBVH();
  if (!lib?.StaticGeometryGenerator) throw new Error('The remesh helper could not load in this browser.');
  model.updateMatrixWorld(true);
  const generator = new lib.StaticGeometryGenerator(model);
  generator.attributes = ['position'];
  generator.applyWorldTransforms = true;
  generator.useGroups = false;
  const geometry = generator.generate();
  if (!geometry?.attributes?.position?.count) throw new Error('No printable surface was found in this model.');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeBoundsTree({ targetLeafSize: 16 });
  return { geometry, lib };
}

function signedDistanceFactory(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const tree = geometry.boundsTree;
  const p = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), delta = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

  return point => {
    p.set(point[0], point[1], point[2]);
    const found = tree.closestPointToPoint(p, hit);
    if (!found || !Number.isFinite(hit.distance)) return -1e9;
    const base = Math.max(0, hit.faceIndex | 0) * 3;
    const ia = idx ? idx.getX(base) : base;
    const ib = idx ? idx.getX(base + 1) : base + 1;
    const ic = idx ? idx.getX(base + 2) : base + 2;
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
    if (n.lengthSq() < 1e-20) return -hit.distance;
    n.normalize();
    delta.subVectors(p, hit.point);
    return n.dot(delta) <= 0 ? hit.distance : -hit.distance;
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

  onStatus(`Preparing ${new Intl.NumberFormat().format(preflight.triangles)} triangles for watertight repair…`);
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  const { geometry } = await bakeWorldGeometry(model);
  try {
    const box = geometry.boundingBox.clone();
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, 1e-6);
    const divisor = qualityDivisor(quality);
    const edgeLength = longest / divisor;
    const pad = edgeLength * 3;
    box.expandByScalar(pad);

    onStatus(quality === 'high'
      ? 'Making a watertight copy — High detail uses more memory…'
      : 'Making a watertight copy…');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const wasm = await window.__shrinkFuse?.loadManifold?.();
    if (!wasm?.Manifold?.levelSet) throw new Error('The watertight repair engine is not available.');

    const sdf = signedDistanceFactory(geometry);
    const bounds = { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
    const solid = wasm.Manifold.levelSet(sdf, bounds, edgeLength, 0, -1);
    try {
      const status = solid?.status?.();
      if (solid?.isEmpty?.()) throw new Error(`Remesh produced no solid${status ? ` (${status})` : ''}.`);
      const root = window.__shrinkFuse?.solidToThree?.(solid);
      if (!root) throw new Error('The repaired solid could not be converted back to a model.');
      root.name = 'SHRINK watertight repair';
      root.userData.shrinkWatertight = true;
      root.userData.remeshQuality = quality;
      root.userData.edgeLength = edgeLength;
      root.updateMatrixWorld(true);
      return { root, edgeLength, quality, preflight };
    } finally {
      try { solid?.delete?.(); } catch {}
    }
  } finally {
    geometry.disposeBoundsTree?.();
    geometry.dispose?.();
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
