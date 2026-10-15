# Real-browser check of the Game page (wheel splitter) (not part of `npm test`)

The page loads three.js etc. from esm.sh, which the cloud sandbox cannot reach, so this harness bundles those libraries locally with esbuild and
serves them to a headless Chromium (software WebGL) by intercepting the esm.sh requests. It opens the real `index.html`, loads a GLB, ticks "Separate the wheels", optimizes and
saves a screenshot + the downloaded GLB. Use it whenever you change `wheel-split.js`, `wheel-split-core.js` or `app.js` export code.

```
mkdir /tmp/h && cd /tmp/h && echo '{"name":"h","private":true,"type":"module"}' > package.json
npm i three@0.180.0 three-mesh-bvh@0.9.15 meshoptimizer@0.24.0 fflate@0.8.2 @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 @gltf-transform/functions@4.5.0 esbuild
mkdir out && cp <repo>/tests/browser/build-bundles.sh build.sh && bash build.sh
(cd <repo> && python3 -m http.server 8123 &)
cp <repo>/tests/browser/run-wheels.py run.py && python3 run.py /tmp/h/shot [model.glb]
```
Edit the model path inside `run-wheels.py` (it uses /mnt/user-data/uploads/mini.glb). Chromium is at /opt/pw-browsers/chromium-1194 in the sandbox.
