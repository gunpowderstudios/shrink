import * as THREE from 'https://esm.sh/three@0.180.0';
import { loadBVH } from './bvh-support.js?v=1.92';

// SHRINK 3D v1.92 — on-demand watertight remesh.
// This deliberately loads only when the user asks for it: rebuilding an SDF surface is heavier than quick repair.

const VERSION = '1.92';

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
  if (quality === 'high') return 130;
  if (quality === 'fast') return 65;
  return 90; // balanced
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
  geometry.computeBoundsTree({ targetLeafSize: 10 });
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
    // Most sculpt meshes have outward-facing triangles. Positive is inside for Manifold.levelSet.
    return n.dot(delta) <= 0 ? hit.distance : -hit.distance;
  };
}

export async function makeWatertight(model, quality = 'balanced', onStatus = () => {}) {
  if (!model) throw new Error('No model is loaded.');
  onStatus('Preparing the model for watertight repair…');
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
      ? 'Making a watertight copy — High detail can take a while…'
      : 'Making a watertight copy…');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const wasm = await window.__shrinkFuse?.loadManifold?.();
    if (!wasm?.Manifold?.levelSet) throw new Error('The watertight repair engine is not available.');

    const sdf = signedDistanceFactory(geometry);
    const bounds = {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z]
    };

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
      return { root, edgeLength, quality };
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
