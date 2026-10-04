// Shared test helpers. The page scripts load modules from the web (esm.sh) and from ?v=KEY urls, which Node cannot do,
// so prepare() writes node-friendly copies into tests/.build/ and installWorkerShim() fakes a Web Worker in-process.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const build = path.join(root, 'tests', '.build');

export function prepare() {
  fs.mkdirSync(build, { recursive: true });
  fs.copyFileSync(path.join(root, 'repair-core.js'), path.join(build, 'repair-core.js'));
  const sr = fs.readFileSync(path.join(root, 'solid-rebuild.js'), 'utf8')
    .replace(/'https:\/\/esm\.sh\/three@0\.180\.0'/g, "'three'")
    .replace(/'\.\/solid-core\.js\?v=[0-9.]+'/g, "'./solid-core.js'")
    .replace(/\.\/repair-core\.js\?v=\$\{(VERSION|FIX)\}/g, './repair-core.js');
  fs.writeFileSync(path.join(build, 'solid-rebuild.mjs'), sr);
  fs.writeFileSync(path.join(build, 'mesh-tools-stub.mjs'), 'export function buildBinaryStl({ model }) { globalThis.__lastModel = model; return { buffer: new ArrayBuffer(84) }; }\n');
  const link = path.join(build, 'node_modules');
  if (!fs.existsSync(link)) { try { fs.symlinkSync(path.join(root, 'tests', 'node_modules'), link, 'dir'); } catch {} }
}

export async function installWorkerShim({ delayMs = 0 } = {}) {
  const core = await import(path.join(build, 'repair-core.js'));
  globalThis.Worker = class {
    constructor(url) { this.url = String(url); }
    postMessage(m) {
      setTimeout(() => {
        if (this.dead) return;
        try {
          if (m.type === 'repair') {
            const r = core.repairMesh({ positions: m.positions, indices: m.indices, onProgress: (pct, text) => { if (!this.dead) this.onmessage?.({ data: { type: 'progress', pct, text } }); } });
            if (!this.dead) this.onmessage?.({ data: { type: 'done', positions: r.positions, indices: r.indices, stats: r.stats } });
          } else if (m.type === 'health') {
            if (!this.dead) this.onmessage?.({ data: { type: 'done', health: core.meshHealth(m.positions, m.indices) } });
          }
        } catch (e) { this.onmessage?.({ data: { type: 'error', message: e.message } }); }
      }, delayMs);
    }
    terminate() { this.dead = true; }
  };
}

let fails = 0;
export const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) { fails++; process.exitCode = 1; } };
export const failures = () => fails;
export const wait = ms => new Promise(r => setTimeout(r, ms));
