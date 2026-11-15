import { prepareHollow } from './hollow-core.js';
import * as THREE from 'https://esm.sh/three@0.180.0';
import { MeshBVH } from 'https://esm.sh/three-mesh-bvh@0.9.15?deps=three@0.180.0';

const MANIFOLD_JS = 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.js';
let wasmPromise, project;
function loadWasm() {
  return wasmPromise ||= import(MANIFOLD_JS).then(async ({ default: factory }) => {
    const wasm = await factory({ locateFile: name => new URL(name, MANIFOLD_JS).href });
    wasm.setup();
    return wasm;
  });
}
self.onmessage = async ({ data }) => {
  const reply = (type, payload = {}, transfer = []) => self.postMessage({ id: data.id, type, ...payload }, transfer);
  try {
    if (data.type === 'prepare') {
      project?.dispose();
      project = null;
      reply('progress', { message: 'Loading the hollowing tools…' });
      project = prepareHollow({ ...data, THREE, MeshBVH, wasm: await loadWasm(), onProgress: message => reply('progress', { message }) });
      const { innerMesh, chambers, savedMl } = project;
      reply('prepared', { ...innerMesh, chambers, savedMl }, [innerMesh.positions.buffer, innerMesh.indices.buffer]);
    } else if (data.type === 'drill' && project) {
      const r = project.drill(data.holes, data.diameter);
      reply('drilled', r, r.positions ? [r.positions.buffer, r.indices.buffer] : []);
    }
  } catch (err) { reply('error', { message: err.message || String(err) }); }
};
