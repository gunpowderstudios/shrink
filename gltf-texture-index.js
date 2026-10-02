import { GLTFLoader } from 'https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';

// Preserve the exact glTF texture index on each Three.js texture as models load.
// Direct 3D paint can then select the correct embedded texture without guessing.
const originalParse = GLTFLoader.prototype.parse;
GLTFLoader.prototype.parse = function(data, path, onLoad, onError) {
  return originalParse.call(this, data, path, (gltf) => {
    try {
      const associations = gltf?.parser?.associations;
      gltf?.scene?.traverse?.((object) => {
        if (!object?.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if (!value?.isTexture) continue;
            const association = associations?.get?.(value);
            if (Number.isInteger(association?.textures)) {
              value.userData ||= {};
              value.userData.gltfTextureIndex = association.textures;
            }
          }
        }
      });
    } catch (error) {
      console.warn('Could not tag glTF texture indices:', error);
    }
    onLoad?.(gltf);
  }, onError);
};
