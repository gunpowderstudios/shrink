import { repairMesh, meshHealth } from '../repair-core.js';
import { ok, failures } from './helpers.mjs';

const positions = new Float32Array([
  0,0,0, 1,0,0, 0,1,0,
  0,0,0, 0,1,0, 0,0,1,
  0,0,0, 0,0,1, 1,0,0
]);
const indices = new Uint32Array([0,1,2, 3,4,5, 6,7,8]);

const before = meshHealth(positions, indices);
ok(!before.clean && before.open > 0, 'open test mesh is detected as needing repair');

const repaired = repairMesh({ positions, indices });
ok(repaired.stats.after.clean, 'detail-preserving repair returns a clean mesh');

const clean = meshHealth(repaired.positions, repaired.indices);
ok(clean.clean, 'shared health check agrees with the repair result');

const withEmpty = new Uint32Array([...repaired.indices, 0,0,0]);
const emptyHealth = meshHealth(repaired.positions, withEmpty);
ok(emptyHealth.clean && emptyHealth.degenerate === 1, 'empty triangles are reported but do not block');

console.log(failures() ? failures() + ' FAILED' : 'all passed');
