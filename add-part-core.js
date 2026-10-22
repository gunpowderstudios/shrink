// SHRINK 3D v2.128 — Add part (Game mode). No imports and no DOM, so it runs in the page and in the tests.
// Put another model (a separate wheel .glb, say) into the car's document under its own node, with the position, turn and size the person set in the viewer.

// Copy `partDoc` into `doc` (partDoc is not changed). Everything of the part's scene (meshes, materials, textures, its own node transforms) goes under ONE new node
// carrying `t` = { translation:[x,y,z], rotation:[x,y,z,w], scale:[x,y,z] }, added at the END of the main scene so existing mesh-node ordinals stay the same.
export function mergePart(doc, partDoc, t, name, mergeDocuments, extras) {   // mergeDocuments: from '@gltf-transform/functions' (passed in so this file needs no imports)
  const before = new Set(doc.getRoot().listScenes());
  mergeDocuments(doc, partDoc);
  const main = doc.getRoot().listScenes()[0];
  const wrapper = doc.createNode(name || 'Part').setTranslation(t.translation || [0, 0, 0]).setRotation(t.rotation || [0, 0, 0, 1]).setScale(t.scale || [1, 1, 1]);
  if (extras) wrapper.setExtras(extras);
  for (const sc of doc.getRoot().listScenes()) {
    if (before.has(sc)) continue;
    for (const ch of sc.listChildren()) { sc.removeChild(ch); wrapper.addChild(ch); }
    sc.dispose();
  }
  main.addChild(wrapper);
  // a GLB holds one buffer: bring the part's accessors into the car's
  const bufs = doc.getRoot().listBuffers();
  if (bufs.length > 1) { for (const a of doc.getRoot().listAccessors()) a.setBuffer(bufs[0]); for (const b of bufs.slice(1)) b.dispose(); }
  return wrapper;
}
