// Pure triangle-reduction core (no imports) so it can run in a Web Worker, on the main thread, and in Node tests.
// Protected (locked) vertices keep their triangles; the rest of the mesh absorbs the reduction.
export function reduceIndices({ simplifier, positions, indices, lock = null, ratio, error = 0.05, protectKeep = 1, lockBorder = false }) {
  const vertexCount = positions.length / 3;
  const target = Math.max(3, Math.floor(ratio * indices.length / 3) * 3);
  const flags = lockBorder ? ['LockBorder'] : [];
  const dummy = new Float32Array(vertexCount);
  const run = (idx, lk, tgt) => simplifier.simplifyWithAttributes(idx, positions, 3, dummy, 1, [0], lk, tgt, error, flags)[0];

  let work = indices, keepUsed = 1, protectedTriangles = 0;
  if (lock) {
    let prot = 0;
    for (let t = 0; t < indices.length; t += 3) if (lock[indices[t]] && lock[indices[t + 1]] && lock[indices[t + 2]]) prot++;
    // The painted area may use at most ~60% of the triangle budget; beyond that it is thinned a little
    // so the rest of the model is not destroyed to pay for it.
    const cap = 0.6 * (target / 3);
    const keepEff = prot ? Math.min(protectKeep, cap / prot) : 1;
    keepUsed = keepEff;
    if (keepEff < 1) {
      const inverse = new Uint8Array(lock.length);
      for (let i = 0; i < lock.length; i++) inverse[i] = lock[i] ? 0 : 1;
      const total = indices.length / 3;
      const targetA = Math.max(0, Math.min(total, Math.floor(total - prot * (1 - keepEff)))) * 3;
      work = run(indices, inverse, targetA);
    }
  }
  const out = run(work, lock, target);
  if (lock) for (let t = 0; t < out.length; t += 3) if (lock[out[t]] && lock[out[t + 1]] && lock[out[t + 2]]) protectedTriangles++;
  return { indices: out, protectKeepUsed: keepUsed, protectedTriangles };
}
