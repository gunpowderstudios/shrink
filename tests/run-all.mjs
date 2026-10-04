// Runs every test file in turn. Usage: cd tests && npm install && npm test   (perf.mjs is separate: node perf.mjs)
import { spawnSync } from 'child_process';
const files = ['repair.test.mjs', 'fallback.test.mjs', 'normals.test.mjs', 'preflight.test.mjs', 'postreduce.test.mjs'];
let bad = 0;
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [f], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} test file(s) FAILED` : '\nALL TEST FILES PASSED');
process.exit(bad ? 1 : 0);
