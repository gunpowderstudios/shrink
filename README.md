# SHRINK 3D v2.20

Browser tool (everything runs locally). Simple mode is the default in 3D print; Advanced mode keeps the full control panel.

Browser tool (everything runs locally) for shrinking 3D models for games or 3D printing.
See the in-app steps. Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).

v1.75 = v1.74 (branding, SEO, Matrix theme) on the real v1.7 live-preview core. The v17-*-compat.js shims and
print-preview-fix.js were removed: the core now provides live preview, build-and-download and game/print units itself.
After deploying, hard-refresh (Cmd+Shift+R).

## Versioning
The current **core engine graph is v2.18**. v2.20 is deliberately a UI/workflow layer (`simple-goals.js` / `simple-goals.css`) loaded on top of that proven engine.
Do not retag individual core modules one by one. When the core engine changes again, bump all of its `./file.js?v=X` imports and VERSION constants together so the browser never loads two copies of the same module.

## Simple mode controls
- **What do you want to do?** v2.20 starts with three plain-English choices:
  - **Make it smaller** — reduces triangles and leaves the mesh parts as they are. A normal one-piece download will not be fused automatically.
  - **Make it one solid** — keeps 100% of the triangle count, checks/fuses the model, and automatically tries the safe detail-preserving repair if needed. The stronger voxel rebuild remains optional because it can soften detail.
  - **Do both** — reduces first when that is safer in the browser, then checks/fuses and automatically tries the safe repair. This is the default/recommended sculpt workflow.
- **Compact panel layout:** the Simple controls hug their content instead of stretching to the viewer height, so action buttons sit directly below the settings rather than leaving a large empty gap.
- **Detail level:** Maximum detail (0.02 mm), Best detail (0.05 mm, the default), Balanced (0.1 mm) or Smallest file (0.2 mm). The automatic shrink keeps the surface within that distance of the original. Best and Maximum check 99.5% of the surface, Balanced 99% and Smallest file 95%, so the small areas with the most detail (faces, hands, beards) are protected. The numbers behind the verdict are shown under the slider.
- **Protect fine detail:** paint over faces, hands or ornaments (Cmd/Ctrl + drag rotates while painting). Painted areas are not reduced. Also available in Advanced, under the SHRINK card's advanced settings. This is hidden for Fuse-only because that mode keeps 100% of the mesh.
- **Fine-tune:** after the result, a size strip shows Original vs Now in MB and how much you save (estimated binary-STL sizes, the same figure the Download button shows), above a live slider that changes the detail kept, with Compare next to it. The solid check re-runs when you stop moving it. Fine-tune is hidden for Fuse-only.
- **Save / load settings:** "Save these settings" (under the fine-tune slider) downloads a small JSON file with your printer type, bed size, print height, detail size and the percentage you settled on. Settings files saved before v2.15 do not contain the height, so save them again. "Load saved settings" (step 1) applies it to any other model. Loading shows "Settings loaded!" and the main action button pulses. By default the detail size is reused and the best reduction is found automatically; open "Reduce by the same amount instead" to keep the same share of triangles.
- **Steps:** the two step buttons at the top of the card go back and forward without reloading. Cancel stops a run or a rebuild.

## Repair (keeps all detail) and the stronger rebuild
When the solid check fails, Simple mode offers two fixes, in this order:
1. **Repair (repair-core.js)** touches only the trouble spots: it joins loose points, removes duplicate or empty triangles, keeps the two triangles that continue the surface where three or more meet on an edge, turns flipped triangles round, closes each hole with a small patch and makes sure every closed part faces outward. The rest of the surface is not changed, so no detail is lost. The result is checked with Manifold before it replaces the preview, and Undo re-runs the current workflow.
2. **Stronger fix: voxel rebuild** (see below) for models that repair cannot clean. It softens detail finer than one voxel, and the button says how big that is for the current model (about 0.55 mm on a 200 mm tall model).

For **Make it one solid** and **Do both**, the safe detail-preserving Repair is attempted automatically when the first solid check fails. The stronger rebuild is never automatic.

## Solid rebuild
When a model fails the solid check, Simple mode can rebuild it as one watertight solid and preview it before download.
It rebuilds from your original file (not the shrunk copy), so fine detail is kept as far as the voxel size allows.
The surface is traced into a voxel grid (solid-core.js), gaps up to about 3.5% of the model's size are sealed, everything the outside
cannot reach becomes solid, and a marching-tetrahedra pass turns it back into a watertight mesh (Manifold validates it, and builds it
instead if ours is ever rejected). The mesh is then simplified within a third of a voxel. It runs in a background worker (remesh-worker.js).
It fills hollow insides, softens detail finer than one voxel (about 0.14 mm on a 47 mm figure) and refuses models with bigger gaps.

## Licence
**SHRINK 3D © 2026 Gunpowder Studios**
Free to download and use for personal, non-commercial purposes. You may not sell it, sublicense it, or include it in a paid product or service without written permission. To ask about commercial use, get in touch via www.gunpowderstudios.co.uk.
Third-party libraries used by SHRINK 3D remain under their own licences (see Third-party libraries below).

## Third-party libraries
SHRINK 3D runs in the browser on these third-party libraries, loaded from public CDNs (check each project's own licence page for the exact terms before redistributing):
three.js (MIT), glTF-Transform (MIT), meshoptimizer (MIT), three-mesh-bvh (MIT), fflate (MIT) and Manifold (Apache-2.0).
