# SHRINK 3D v2.23

Browser tool (everything runs locally). Simple mode is the default in 3D print; Advanced mode keeps the full control panel.

Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).
After deploying, hard-refresh (Cmd+Shift+R).

## Versioning
The current **core engine graph is v2.18**. v2.23 is deliberately a Simple-mode UI/workflow layer (`simple-wizard.js`, `simple-preflight.js`, `simple-postreduce.js` and their CSS) loaded on top of that proven engine.
Do not retag individual core modules one by one. When the core engine changes again, bump all of its `./file.js?v=X` imports and VERSION constants together so the browser never loads two copies of the same module.

## What SHRINK 3D does
Simple Print is organised around three jobs:
- **Repair** — check the uploaded mesh and fix holes, bad edges and broken geometry before anything else happens.
- **Reduce** — remove unnecessary triangles while preserving the visible detail appropriate to the chosen printer and finished size.
- **Prepare for printing** — check fit, fuse touching/overlapping parts when needed, split oversized models when needed, then export.

Fuse is therefore a preparation tool, not a decision a home user has to understand before they start.

## Simple Print wizard — v2.23
The Simple workflow is now:
1. **Check / Repair** — every upload is checked immediately. If the mesh is healthy, SHRINK says so. If it needs repair, the next stage remains locked until the conservative repair succeeds or the stronger watertight rebuild succeeds.
2. **Printer & size** — choose Resin/FDM, finished height, optional printer size and desired detail.
3. **Reduce** — press **SHRINK MY MODEL**. SHRINK finds the smallest version that still looks the same at the intended print size, then runs its solid/fit safety checks.
4. **Prepare & Download** — SHRINK fuses a clean one-piece export where appropriate, offers splitting if the model is too tall, and downloads the STL.

### Repair checkpoint
After a successful repair/rebuild, SHRINK deliberately pauses before reduction. The user can either:
- **Download repaired STL** / **Download rebuilt STL** and stop there, or
- **Continue to printer & size** and carry on through the SHRINK workflow.

A clean upload gets **Continue to printer & size** without an unnecessary repair step.

### Automatic final mesh tidy
A mesh that passed the upload repair check can occasionally pick up tiny topology faults during aggressive triangle reduction. Simple mode keeps the second safety check, but no longer asks the user to repair the model again immediately.

If the reduced copy fails that final check, v2.23 automatically runs the conservative detail-preserving repair on the **reduced copy**. If that succeeds, the workflow continues and shows a green confirmation. Only if the automatic tidy cannot make the reduced copy reliable are the stronger/manual repair options shown.

This keeps the user-facing journey simple: **repair once → reduce → download**, while retaining a final print-safety check underneath.

### Viewer logic
Before any reduction has actually been run, Simple mode shows only the model. **Original / Reduced**, **Compare** and **Detail loss** stay hidden because there is not yet a meaningful reduced result. They appear once the Reduce stage has produced a result.

### Failure ladder
1. Conservative repair (`repair-core.js`) first — welds coincident points, removes bad triangles, orients faces and closes holes while preserving the original surface wherever possible.
2. If that fails, **Stronger fix — rebuild watertight** uses `solid-rebuild.js` / the worker. It recreates the outer surface and can soften tiny detail, so it is never automatic during upload repair.
3. If the stronger rebuild also fails, Simple mode stops and offers **Download original**, **Try Advanced**, and **Re-upload repaired file** instead of reducing a broken mesh.

Separate closed printable pieces are allowed through the health check; they do not have to be fused merely to continue.

## Other Simple controls
- **Detail level:** Maximum detail (0.02 mm), Best detail (0.05 mm, default), Balanced (0.1 mm) or Smallest file (0.2 mm).
- **Protect fine detail:** paint over faces, hands or ornaments so reduction leaves them alone.
- **Fine-tune:** after reduction, adjust detail live and Compare against the original.
- **Save / load settings:** reuse printer, size, detail and reduction preferences on another model. The new model still has to pass the repair gate first.

## Solid rebuild
The stronger rebuild traces the model into a voxel grid, seals manageable gaps, fills enclosed interiors and recreates a watertight mesh. It runs in a background worker where available. Because it recreates the whole surface, detail finer than the chosen voxel size can soften.

## Licence
**SHRINK 3D © 2026 Gunpowder Studios**
Free to download and use for personal, non-commercial purposes. You may not sell it, sublicense it, or include it in a paid product or service without written permission. To ask about commercial use, get in touch via www.gunpowderstudios.co.uk.
Third-party libraries used by SHRINK 3D remain under their own licences.

## Third-party libraries
SHRINK 3D runs in the browser on these third-party libraries, loaded from public CDNs: three.js (MIT), glTF-Transform (MIT), meshoptimizer (MIT), three-mesh-bvh (MIT), fflate (MIT) and Manifold (Apache-2.0).