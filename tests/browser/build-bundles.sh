B=./node_modules/.bin/esbuild
T=node_modules/three
EXT="--external:three --external:@gltf-transform/core"
$B $T/build/three.module.js --bundle --format=esm --outfile=out/three.js --log-level=error
for f in controls/OrbitControls environments/RoomEnvironment exporters/GLTFExporter loaders/GLTFLoader; do
  mkdir -p out/three-jsm/$(dirname $f); $B $T/examples/jsm/$f.js --bundle --format=esm --external:three --outfile=out/three-jsm/$f.js --log-level=error; done
$B node_modules/three-mesh-bvh/src/index.js --bundle --format=esm --external:three --outfile=out/bvh.js --log-level=error
$B node_modules/meshoptimizer/index.module.js --bundle --format=esm --outfile=out/meshopt.js --log-level=error
$B node_modules/fflate/esm/browser.js --bundle --format=esm --outfile=out/fflate.js --log-level=error
$B node_modules/@gltf-transform/core/dist/index.js --bundle --external:node:* --format=esm --outfile=out/gt-core.js --log-level=error
$B node_modules/@gltf-transform/extensions/dist/index.js --bundle --format=esm $EXT --outfile=out/gt-ext.js --log-level=error
$B node_modules/@gltf-transform/functions/dist/index.js --bundle --format=esm $EXT --outfile=out/gt-fn.js --log-level=error
