// Hollow only the interior. Manifold cuts that cavity from the original solid,
// so the outer triangles are not voxel-remeshed. Coordinates are finished mm.
export function prepareHollow({ THREE, MeshBVH, wasm, positions, indices, wall, onProgress = () => {} }) {
  if (!Number.isFinite(wall) || wall < 0.8 || wall > 10) throw Error('Choose a wall thickness between 0.8 and 10 mm.');
  if (indices.length > 3_000_000) throw Error('This mesh is too dense to hollow here. Try reducing the detail first or use your slicer.');
  const { Manifold, Mesh } = wasm;
  const keep = [];
  const own = obj => (keep.push(obj), obj);
  const release = () => { for (const o of keep.splice(0).reverse()) o.delete?.(); };
  const valid = obj => obj.status() === 'NoError' && !obj.isEmpty();
  const geo = new THREE.BufferGeometry();
  let parts = [];
  try {
    onProgress('Checking the outer mesh…');
    const input = own(new Mesh({ numProp: 3, vertProperties: positions, triVerts: indices }));
    input.merge();   // Weld STL facet seams / display-normal splits without smoothing the model.
    let outer = own(new Manifold(input));
    if (!valid(outer)) throw Error('Hollowing needs a closed mesh. Try FIX IT and AUTO-SHRINK again, or use your slicer.');
    // First version accepts one outer shell. Don't silently fill existing voids or separate parts.
    parts = outer.decompose();
    if (parts.length !== 1) throw Error('This version hollows a single closed shell. Use your slicer for separate parts or already hollow models.');
    if (outer.volume() < 0) {
      const reversed = indices.slice();
      for (let i = 0; i < indices.length; i += 3) [reversed[i + 1], reversed[i + 2]] = [reversed[i + 2], reversed[i + 1]];
      const mesh = own(new Mesh({ numProp: 3, vertProperties: positions, triVerts: reversed }));
      mesh.merge();
      outer = own(new Manifold(mesh));
    }
    if (!valid(outer) || !(outer.volume() > 0)) throw Error('No usable closed solid was found.');
    const bounds = outer.boundingBox();
    const size = bounds.max.map((n, i) => n - bounds.min[i]);
    if (Math.min(...size) <= 2 * wall) throw Error('This model is too thin to hollow at that wall thickness.');
    // Budget the marching grid and don't go coarse enough to make the wall unreliable.
    let step = Math.max(0.12, wall / 5);
    const samples = () => size.reduce((n, s) => n * (Math.ceil(s / step) + 3), 1);
    while (samples() > 1_500_000) step *= 1.1;
    if (step > wall / 2) throw Error('This size needs a thicker wall for browser hollowing. Increase the wall thickness or use your slicer.');

    const surface = meshData(outer);
    geo.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(surface.indices, 1));
    const tree = new MeshBVH(geo, { indirect: true });
    const point = new THREE.Vector3();
    const ray = new THREE.Ray(point, new THREE.Vector3(0.923127, 0.349929, 0.158147).normalize());
    const nearest = {};
    onProgress('Building the inner cavity…');
    const sdf = p => {
      point.set(...p);
      const hit = tree.raycastFirst(ray, THREE.DoubleSide);
      if (!hit || hit.face.normal.dot(ray.direction) <= 0) return -step;
      return tree.closestPointToPoint(point, nearest, 0, wall + 2 * step)?.distance ?? wall + 2 * step;
    };
    const cavity = own(Manifold.levelSet(sdf, bounds, step, wall));
    if (!valid(cavity) || cavity.volume() < 1) throw Error('There is not enough internal space at that wall thickness.');
    const chambers = cavity.decompose();
    keep.push(...chambers);
    const outerVolume = outer.volume();
    // This also catches failed inside/outside classification around difficult meshes.
    const spill = own(cavity.subtract(outer));
    if (!spill.isEmpty()) throw Error('The cavity crossed the outside surface. Try a thicker wall or use your slicer.');
    const innerMesh = meshData(cavity);

    return {
      innerMesh, wall, chambers: chambers.length, savedMl: cavity.volume() / 1000, dispose: release,
      drill(holes, diameter) {
        if (!Number.isFinite(diameter) || diameter < 1 || diameter > 15) throw Error('Choose a hole diameter between 1 and 15 mm.');
        if (holes.length > 20) throw Error('This version supports up to 20 holes.');
        const temp = [];
        const take = o => (temp.push(o), o);
        const used = [], count = chambers.map(() => 0), statuses = [];
        try {
          for (const { point, normal } of holes) {
            const d = norm(normal).map(n => -n);
            const origin = point.map((n, i) => n - d[i] * (diameter + 1));
            const end = point.map((n, i) => n + d[i] * Math.hypot(...size));
            const entry = outer.rayCast(origin, end);
            const inner = cavity.rayCast(origin, end)[0];
            const epsilon = Math.max(0.05, step / 2);
            const penetration = inner ? Math.sqrt(dist2(origin, inner.position)) + epsilon : 0;
            if (entry.length < 2 || !inner || inner.distance <= entry[0].distance ||
                penetration + epsilon >= Math.sqrt(dist2(origin, entry[1].position)) ||
                dist2(entry[0].position, point) > epsilon ** 2) {
              statuses.push('Misses the cavity. Try a thicker spot.');
              continue;
            }
            // Keep the two openings separate even if their axes cross inside the wall.
            const axis = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
            const u = norm(cross(axis, d)), v = cross(d, u);
            const tube = take(Manifold.cylinder(penetration, diameter / 2, diameter / 2, 32));
            const cutter = take(tube.transform([...u, 0, ...v, 0, ...d, 0, ...origin, 1]));
            // The second intersection prevents counting a cutter that only skims the cavity.
            const opens = [];
            for (let i = 0; i < chambers.length; i++) {
              const cut = take(chambers[i].intersect(cutter));
              if (cut.volume() >= Math.PI * (diameter / 2) ** 2 * epsilon * 0.15) opens.push(i);
            }
            if (opens.length !== 1) { statuses.push('Does not open one chamber cleanly. Move this hole.'); continue; }
            const bore = take(outer.intersect(cutter));
            if (used.some(other => !take(other.intersect(bore)).isEmpty())) {
              statuses.push('Overlaps another hole. Move it further away.'); continue;
            }
            used.push(bore);
            count[opens[0]]++;
            statuses.push('Connected to cavity');
          }
          if (!count.every(n => n >= 2) || used.length !== holes.length) return { statuses, count };
          const result = take(Manifold.difference([outer, cavity, ...used]));
          if (!valid(result)) throw Error('The drilled shell could not be built. Move the holes and try again.');
          // A sealed cavity would appear as its own inward-facing shell.
          const finalParts = result.decompose();
          temp.push(...finalParts);
          if (finalParts.length !== 1 || result.volume() <= 0) throw Error('The result has a sealed pocket or disconnected shell. Reposition the holes.');
          return { ...meshData(result), statuses, count, savedMl: (outerVolume - result.volume()) / 1000 };
        } finally { for (const o of temp.reverse()) o.delete?.(); }
      }
    };
  } catch (err) { release(); throw err; }
  finally { geo.dispose(); for (const o of parts) o.delete?.(); }
}

const dist2 = (a, b) => a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0);
const cross = ([x,y,z], [a,b,c]) => [y*c-z*b, z*a-x*c, x*b-y*a];
const norm = a => { const n = Math.hypot(...a); return a.map(v => v / n); };

function meshData(solid) {
  const mesh = solid.getMesh();
  try {
    const p = mesh.vertProperties, stride = mesh.numProp;
    const positions = new Float32Array(p.length / stride * 3);
    for (let i = 0, j = 0; i < p.length; i += stride) {
      positions[j++] = p[i]; positions[j++] = p[i+1]; positions[j++] = p[i+2];
    }
    return { positions, indices: new Uint32Array(mesh.triVerts) };
  } finally { mesh.delete?.(); }
}
