// A made-up car for the Tron tests: box body, box cabin set towards the rear, four cylinder wheels.
export function makeCar() {
const P = [], N = [], C = [], I = [];
function quad(a, b, c, d, n, col) { const o = P.length / 3; for (const v of [a, b, c, d]) { P.push(...v); N.push(...n); C.push(...col); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); }
function box(x0, x1, y0, y1, z0, z1, side, top) {
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side);
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], side);
}
function wheel(cx, cy, cz, r, w, col) {
  const seg = 28;
  for (let s = 0; s < seg; s++) {
    const a0 = 2 * Math.PI * s / seg, a1 = 2 * Math.PI * (s + 1) / seg, nm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
    const p = (a, z) => [cx + r * Math.cos(a), cy + r * Math.sin(a), cz + z];
    quad(p(a0, -w / 2), p(a1, -w / 2), p(a1, w / 2), p(a0, w / 2), nm, col);
    const o = P.length / 3; for (const [v, n] of [[[cx, cy, cz + w / 2], [0, 0, 1]], [p(a0, w / 2), [0, 0, 1]], [p(a1, w / 2), [0, 0, 1]]]) { P.push(...v); N.push(...n); C.push(...col); } I.push(o, o + 1, o + 2);
  }
}
const RED = [200, 30, 30], GOLD = [230, 190, 40], BLUE = [40, 80, 200], DARK = [30, 30, 30];
box(-2, 2, -0.1, 0.5, -0.9, 0.9, RED, RED);          // body: red
box(-0.6, 1.0, 0.5, 1.1, -0.75, 0.75, BLUE, GOLD);    // cabin: blue sides, gold roof, sits towards the rear (+x), so the front is -x
const WY = -0.1;                                      // wheel centres: 0.4 up from the ground (y = -0.5)
for (const x of [-1.3, 1.3]) for (const z of [-0.85, 0.85]) wheel(x, WY, z, 0.4, 0.3, DARK);
  return { RED, GOLD, BLUE, DARK, WY, src: { positions: Float32Array.from(P), normals: Float32Array.from(N), colors: Uint8Array.from(C), indices: Uint32Array.from(I) }, P, N, C, I, box, RED2: RED };
}


