// SHRINK 3D v2.56 — crease-aware shading normals for DISPLAY (pure JS, no imports, no DOM).
//
// Why: a heavily reduced mesh has large triangles. Plain smooth vertex normals average the faces around a vertex even across a
// hard edge (the rim of a base, a belt, a blade edge), so a big flat triangle ends up shaded as if it were curved and shows dark
// or light smudges. The geometry is fine (an STL stores only triangles); only the picture is wrong.
//
// What: split each vertex into one copy per "smoothing group" (faces whose normals are within `creaseDeg` of each other) and give
// each copy its own normal. Original vertex numbers stay valid: the first group keeps the original vertex, extra groups are
// APPENDED at the end, so index buffers coming from the reducer keep working and the geometry itself (positions, triangles) is unchanged.

export function creaseSplit(positions, indices, { creaseDeg = 55 } = {}) {
  const nv = positions.length / 3, nt = Math.floor(indices.length / 3);
  const cosT = Math.cos(creaseDeg * Math.PI / 180);

  // face normals (unit) and areas
  const fnx = new Float32Array(nt), fny = new Float32Array(nt), fnz = new Float32Array(nt), area = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
    if (len > 1e-30) { fnx[t] = nx / len; fny[t] = ny / len; fnz[t] = nz / len; area[t] = len; }   // `area` is twice the area: only ratios matter
  }

  // corners per vertex (CSR layout)
  const start = new Int32Array(nv + 1);
  for (let c = 0; c < nt * 3; c++) start[indices[c] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nv), corner = new Int32Array(nt * 3);
  for (let c = 0; c < nt * 3; c++) corner[fill[indices[c]]++] = c;

  const outIdx = Uint32Array.from(indices);
  let cap = nv + Math.max(1024, nv >> 3), nOut = nv;
  let outPos = new Float32Array(cap * 3); outPos.set(positions);
  let outNrm = new Float32Array(cap * 3);
  const grow = () => { cap *= 2; const p = new Float32Array(cap * 3); p.set(outPos); outPos = p; const n = new Float32Array(cap * 3); n.set(outNrm); outNrm = n; };

  // scratch for one vertex's groups
  let gx = new Float64Array(16), gy = new Float64Array(16), gz = new Float64Array(16), gid = new Int32Array(16);
  const ensure = n => { if (n > gx.length) { const m = n * 2; const x = new Float64Array(m), y = new Float64Array(m), z = new Float64Array(m), i = new Int32Array(m); x.set(gx); y.set(gy); z.set(gz); i.set(gid); gx = x; gy = y; gz = z; gid = i; } };

  for (let v = 0; v < nv; v++) {
    const s = start[v], e = start[v + 1];
    if (s === e) continue;
    let groups = 0;
    for (let k = s; k < e; k++) {
      const c = corner[k], t = (c / 3) | 0;
      if (area[t] === 0) continue;                                    // empty triangle: contributes nothing, keeps the original vertex
      const w = area[t], x = fnx[t], y = fny[t], z = fnz[t];
      let hit = -1;
      for (let g = 0; g < groups; g++) {                              // compare with each group's current average direction
        const l = Math.hypot(gx[g], gy[g], gz[g]) || 1;
        if ((gx[g] * x + gy[g] * y + gz[g] * z) / l >= cosT) { hit = g; break; }
      }
      if (hit < 0) { ensure(groups + 1); hit = groups++; gx[hit] = 0; gy[hit] = 0; gz[hit] = 0; gid[hit] = -1; }
      gx[hit] += x * w; gy[hit] += y * w; gz[hit] += z * w;
      // remember which group this corner belongs to (stored temporarily in the index copy)
      outIdx[c] = hit;
    }
    // give every group a vertex: group 0 keeps `v`, the others are appended copies
    for (let g = 0; g < groups; g++) {
      let id = v;
      if (g > 0) { if (nOut >= cap) grow(); id = nOut++; outPos[id * 3] = positions[v * 3]; outPos[id * 3 + 1] = positions[v * 3 + 1]; outPos[id * 3 + 2] = positions[v * 3 + 2]; }
      gid[g] = id;
      const l = Math.hypot(gx[g], gy[g], gz[g]) || 1;
      outNrm[id * 3] = gx[g] / l; outNrm[id * 3 + 1] = gy[g] / l; outNrm[id * 3 + 2] = gz[g] / l;
    }
    // point the corners at their group's vertex
    for (let k = s; k < e; k++) {
      const c = corner[k], t = (c / 3) | 0;
      outIdx[c] = area[t] === 0 ? v : gid[outIdx[c]];
    }
    if (groups === 0) { outNrm[v * 3 + 1] = 1; }
  }
  return { positions: outPos.slice(0, nOut * 3), indices: outIdx, normals: outNrm.slice(0, nOut * 3), vertexCount: nOut, splitVertices: nOut - nv };
}
