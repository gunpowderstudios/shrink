# SHRINK 3D v2.31

Browser tool (everything runs locally). Simple mode is the default in 3D print; **Tools** keeps the full technical control panel.

Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).
After deploying, hard-refresh (Cmd+Shift+R).

## Versioning
The current **core engine graph is v2.18**. v2.31 is deliberately a Simple-mode UI/workflow layer (`simple-wizard.js`, `simple-preflight.js`, `simple-postreduce.js`, `simple-focus.js` and their CSS) loaded on top of that proven engine.
Do not retag individual core modules one by one. When the core engine changes again, bump all of its `./file.js?v=X` imports and VERSION constants together so the browser never loads two copies of the same module.

## v2.31 reliability cleanup
This release completes the P0 cleanup from the v2.30 architecture review before any new Simple workflow is attempted.

- Restored broad repair regression coverage and added GitHub Actions CI.
- Simple Print skips the expensive BVH visual-loss measurement during ordinary reductions; Compare remains the explicit exception.
- Simple waits for the reducer's actual completion instead of polling UI labels.
- Simple mesh validation uses the shared v2.27 `meshHealth` worker path; Manifold is reserved for deliberate Fuse/Split operations.
- Export diagnostics now use the same shared mesh-health definition.
- `index.html` is the sole owner of the visible release badge.
- User-facing navigation consistently says **Tools**, and the main reduction action says **Make smaller**.
- The underlying reducer/core engine remains v2.18; the repair graph remains v2.27.

## v2.30 full-height repair module
The Step 1 Check/Repair card now explicitly stretches to the full desktop module height, matching the 3D viewer. Its controls stay at the top and the card scrolls internally if needed. This removes the old `align-self:start` rule that could make the repair panel stop halfway down the workspace.

## v2.29 viewport-filling workspace
On desktop, SHRINK measures the space from the workspace's actual top edge to the bottom of the browser window and stretches both main modules to that height. Controls scroll internally when needed; the 3D viewer expands to use the rest. Fixed 900px height caps are removed. Mobile rules are unchanged.

## v2.28 dockable panels
On desktop, the **Controls** and **3D viewer** are dockable left/right modules in Game mode and Simple Print mode. Drag one module onto the other, or click its small ↔ strip, to swap sides. The preference is stored locally in that browser, so different users can keep different layouts. Mobile remains stacked.

## v2.27 repair architecture
Preflight, repair and the post-reduction guard now use the same mesh-health definition from `repair-core.js`. Dense repair/health work uses `repair-worker.js` where supported, with cancellation and stale-upload protection. The repair graph uses cache key **2.27** while the core engine graph remains **2.18**.

## v2.26 viewer polish
In Game mode, the viewer navigation help now sits inside the 3D canvas while the large **Find the smallest that still looks the same** button remains below it, so the two controls cannot overlap.

## What SHRINK 3D does
Simple Print is organised around three jobs:
- **Repair** — check the uploaded mesh and fix holes, bad edges and broken geometry before anything else happens.
- **Reduce** — make an appropriately smaller print mesh without chasing the mathematically smallest possible file.
- **Prepare for printing** — check fit, split oversized models when needed, then export.

Fuse, voxel rebuild, manual percentages, protection painting and the exhaustive smallest-mesh search remain available in **Tools** for people who deliberately want them. Simple mode does not Boolean-fuse every download by default.

## Simple Print wizard — v2.25
The Simple workflow is:
1. **Check / Repair** — every upload is checked immediately. If repair is needed, Simple mode stays locked until the conservative repair or stronger rebuild succeeds.
2. **Printer & size** — choose Resin/FDM, finished height, optional printer size and desired detail.
3. **Reduce** — press **SHRINK MY MODEL**. Simple mode chooses a sensible print target in one pass instead of running the old eight-step exhaustive search.
4. **Prepare & Download** — SHRINK checks that the reduced topology stayed clean, checks fit, offers splitting when needed, then downloads the STL.

### Repair checkpoint
After a successful repair/rebuild, SHRINK pauses. The user can either download the repaired STL immediately or continue to printer/size and reduction.

### Faster Simple reduction
The goal in Simple mode is now **small enough, clean and responsive**, not the absolute smallest possible mesh.

Typical starting targets are deliberately conservative:
- Maximum detail: roughly 450k triangles / at least ~42% of the source.
- Best detail: roughly 320k / at least ~30%.
- Balanced: roughly 240k / at least ~22%.
- Smallest file: roughly 170k / at least ~16%.

Small models that are already sensible are left alone. The old exhaustive visual search remains in Tools.

### Lightweight topology backoff
If the first reduced candidate damages topology, SHRINK no longer runs repeated Manifold/repair/rebuild passes. It makes one safer reduction attempt using a cheap topology check; if that still fails it falls back to the full repaired mesh rather than forcing a broken reduction. The user therefore does not get sent through Repair a second time after Stage 1.

### Cleaner Simple UI
- Once a model is loaded, the branding/header collapses to reclaim vertical space.
- The viewer stays in the left work area while the right Simple panel scrolls independently.
- Protect-detail painting, manual fine-tune controls and technical details are hidden from Simple mode and remain available in Tools.
- **Advanced** is labelled **Tools** in the user-facing switch.
- Reduced preview normals are recalculated after connectivity changes so print models do not appear artificially dark.

### Viewer logic
Before reduction, Simple mode shows only the model. **Original / Reduced**, **Compare** and **Detail loss** appear only after a meaningful reduced result exists.

## Repair and rebuild
Conservative repair is always tried before the stronger voxel rebuild. The stronger rebuild recreates the outer surface and can soften very fine detail, so it remains a fallback at the upload/repair stage rather than something Simple mode repeatedly invokes after reduction.

Separate closed printable pieces are allowed through the health check; they do not have to be fused merely to continue.

## Licence
**SHRINK 3D © 2026 Gunpowder Studios**
Free to download and use for personal, non-commercial purposes. You may not sell it, sublicense it, or include it in a paid product or service without written permission. To ask about commercial use, get in touch via www.gunpowderstudios.co.uk.
Third-party libraries used by SHRINK 3D remain under their own licences.

## Third-party libraries
SHRINK 3D runs in the browser on these third-party libraries, loaded from public CDNs: three.js (MIT), glTF-Transform (MIT), meshoptimizer (MIT), three-mesh-bvh (MIT), fflate (MIT) and Manifold (Apache-2.0).
