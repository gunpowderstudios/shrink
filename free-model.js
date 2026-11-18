// v2.334: "FREE Model" corner widget on the start screen: a small spinning dwarf (decimated preview, ~470 KB);
// a click loads the full free STL into the normal print viewer so the visitor can download it.
const REL = new URL(import.meta.url).searchParams.get('v') || '';
const BASE = new URL('./free/', import.meta.url);
const FULL = 'FREE-BOD-Dwarf-Model.stl';
const css = `#v2FreeModel{position:fixed;right:18px;bottom:18px;z-index:40;width:150px;border:1px solid rgba(73,165,255,.6);border-radius:14px;background:rgba(5,15,20,.88);color:#fff;cursor:pointer;padding:6px 6px 8px;text-align:center;font:inherit;box-shadow:0 6px 24px rgba(0,0,0,.45)}
#v2FreeModel:hover{border-color:#48a7ff;background:rgba(16,37,54,.94)}
#v2FreeModel canvas{display:block;width:136px;height:150px;margin:0 auto}
#v2FreeModel strong{display:block;font-size:14px;letter-spacing:.06em;color:#6fd36f}
#v2FreeModel small{display:block;font-size:11px;opacity:.75}
#v2FreeModel[data-busy="1"]{opacity:.6;pointer-events:none}
body:not(.start-screen) #v2FreeModel{display:none}`;
function build() {
  if (document.getElementById('v2FreeModel')) return document.getElementById('v2FreeModel');
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const b = document.createElement('button'); b.type = 'button'; b.id = 'v2FreeModel'; b.title = 'Open the free dwarf model in the viewer';
  b.innerHTML = '<div class="v2-free-cv"></div><strong>FREE Model</strong><small>Click to open &amp; download</small>';
  document.body.appendChild(b); return b;
}
async function openFree(b) {
  b.dataset.busy = '1'; const small = b.querySelector('small'), old = small.textContent; small.textContent = 'Loading…';
  try {
    const r = await fetch(new URL(FULL, BASE) + (REL ? '?v=' + REL : '')); if (!r.ok) throw new Error('HTTP ' + r.status);
    const file = new File([await r.blob()], FULL, { type: 'model/stl' });
    window.__shrinkFreeOpening = true; // print-v2-ui.js greys SHRINK for this already-shrunk model
    document.querySelector('.mode-card[data-mode="print"]')?.click();
    await window.__shrinkApp?.openFile?.(file);
  } catch (e) { window.__shrinkFreeOpening = false; small.textContent = 'Could not load'; console.warn('[SHRINK] free model', e); setTimeout(() => { small.textContent = old; }, 2500); }
  finally { delete b.dataset.busy; if (small.textContent === 'Loading…') small.textContent = old; }
}
async function preview(b) {
  const THREE = await import('https://esm.sh/three@0.180.0');
  const buf = await (await fetch(new URL('dwarf-preview.bin', BASE) + (REL ? '?v=' + REL : ''))).arrayBuffer();
  const [nv, nf] = new Uint32Array(buf, 0, 2), pos = new Float32Array(buf, 8, nv * 3), idx = new Uint16Array(buf, 8 + nv * 12, nf * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3)); g.setIndex(new THREE.BufferAttribute(idx.slice(), 1)); g.computeVertexNormals();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(136, 150);
  b.querySelector('.v2-free-cv').replaceWith(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 136 / 150, 0.1, 10); cam.position.set(0, 0.25, 2.6); cam.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1)); const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(2, 3, 3); scene.add(key);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc9d4e0, roughness: 0.55, metalness: 0.05 })); mesh.rotation.x = -Math.PI / 2; // the STL is Z-up
  const pivot = new THREE.Group(); pivot.add(mesh); scene.add(pivot);
  let last = performance.now();
  const loop = t => { requestAnimationFrame(loop); if (!document.body.classList.contains('start-screen') || document.hidden) { last = t; return; } pivot.rotation.y += (t - last) * 0.0009; last = t; renderer.render(scene, cam); };
  requestAnimationFrame(loop);
}
const b = build(); b.addEventListener('click', () => openFree(b));
preview(b).catch(e => { console.warn('[SHRINK] free model preview', e); b.querySelector('.v2-free-cv')?.remove(); });
