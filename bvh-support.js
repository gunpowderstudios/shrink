// Fast raycasting for very dense meshes (three-mesh-bvh). Loaded on demand; every caller degrades gracefully
// to three.js' normal (slow) raycast if the library cannot be loaded.
import * as THREE from 'https://esm.sh/three@0.180.0';

let lib = null;
let loading = null;

export function loadBVH() {
  if (lib) return Promise.resolve(lib);
  if (!loading) {
    loading = import('https://esm.sh/three-mesh-bvh@0.9.15?deps=three@0.180.0').then(mod => {
      lib = mod;
      THREE.Mesh.prototype.raycast = mod.acceleratedRaycast;
      THREE.BufferGeometry.prototype.computeBoundsTree = mod.computeBoundsTree;
      THREE.BufferGeometry.prototype.disposeBoundsTree = mod.disposeBoundsTree;
      return mod;
    }).catch(err => {
      console.warn('three-mesh-bvh could not be loaded; falling back to slow raycasting.', err);
      loading = null;
      return null;
    });
  }
  return loading;
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

// Build a bounds tree for every mesh under `root` that does not have one yet.
export async function ensureBVH(root, onStatus) {
  const mod = await loadBVH();
  if (!mod || !root) return false;
  const todo = [];
  let tris = 0;
  root.traverse(o => {
    const g = o.geometry;
    if (!o.isMesh || !g?.attributes?.position || g.boundsTree) return;
    const pos = g.attributes.position;
    todo.push(o);
    tris += (g.index ? g.index.count : pos.count) / 3;
  });
  if (!todo.length) return true;
  if (onStatus) onStatus(`Preparing ${Math.round(tris).toLocaleString()} triangles for fast painting…`);
  await nextFrame();
  for (const mesh of todo) {
    try { mesh.geometry.computeBoundsTree({ targetLeafSize: 10 }); } catch (err) { console.warn('BVH build failed', err); }
    await nextFrame();
  }
  return true;
}

export function raycasterFor() {
  const rc = new THREE.Raycaster();
  rc.firstHitOnly = true;      // honoured by three-mesh-bvh, ignored otherwise
  return rc;
}

export async function getMeshBVH() {
  const mod = await loadBVH();
  return mod ? mod.MeshBVH : null;
}
