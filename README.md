# SHRINK 3D v2.57

Browser tool (everything runs locally). 3D Print now uses one full workflow interface: Printer & size → Fuse/repair → SHRINK → Download/split.

Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).
After deploying, hard-refresh (Cmd+Shift+R).

## v2.57 — the Detail kept slider drives the picture again
- Fixes a v2.56 regression: after SHRINK IT the slider changed the numbers but not the model on screen. The tidy of edges the reduction disturbed now happens inside the live preview itself, so the slider, Compare and the working model are one and the same.
- If you press FIX IT / FUSE IT / Make watertight and then move **Detail kept**, it re-bases on the current model first.

## v2.56 — SHRINK keeps a clean model clean; no dark patches on flat areas
- After **SHRINK IT**, a model that was clean going in is tidied automatically if the reduction disturbed a few edges (MODEL HEALTH no longer drops from 100 to "Needs attention").
- The reduced preview and FIX IT / FUSE IT results use crease-aware shading, so flat areas next to hard edges (like a base rim) are no longer smudged with dark patches. This is display only: the STL you download never contained them.

## v2.55 — Split and Make watertight fixed
- **DOWNLOAD IT** splits the current working model into 2 / 3 / auto-by-height sections (flat or with keyed pegs) and downloads a ZIP of STLs. It no longer forces Fuse on, and models made of several separate closed pieces split fine.
- **Make watertight** now replaces the current working model in the viewer, refreshes **MODEL HEALTH** and clears the red warning, instead of only downloading a file. It adds a **REBUILT** chip.
- Tests: `cd tests && npm install && npm test` (188 checks, includes clicking the real buttons with the real Manifold library).

## v2.39 — 3D Print multitool

- **Printer & size** remains the setup step.
- Fuse, SHRINK and Download are now presented as independent tools with no 2 / 3 / 4 sequence.
- The interface says **USE ANY TOOL YOU NEED** so users can use one, two or all three actions in any order.
- Underlying repair, reduction and export engines are unchanged.


## v2.38 — one 3D Print interface

- Removed the Simple / Tools switch.
- The full print dashboard is now the only 3D Print interface.
- Keeps the four practical sections: **Printer & size**, **Fuse / repair**, **SHRINK**, and **Download / split**.
- The Simple-mode controller and wizard are no longer loaded, so they cannot compete with the print dashboard layout.
- Underlying repair, reduction and export engines are unchanged.


## Versioning
The proven repair, reduction and export engines are unchanged. v2.38 removes the separate Simple/Tools presentation split and uses the full print dashboard as the only 3D Print interface.
Do not retag individual core modules one by one. When the core engine changes again, bump all of its `./file.js?v=X` imports and VERSION constants together so the browser never loads two copies of the same module.

## v2.36 Oct 3 layout restore
The Simple desktop layout has been restored from the **actual final Oct 3 v2.25 commit** (`67ce3c`), rather than approximated.

- Restored `simple-wizard.css` from Oct 3.
- Restored `simple-preflight.css` from Oct 3.
- Kept only the newer amber **Continue anyway** warning colour as a non-layout addition.
- `simple-mode.css`, `print-v2-ui.css` and `style.css` were already unchanged from Oct 3, so they did not need reverting.
- Current repair, reduction, mesh-health, orientation and camera-preservation code remains untouched.

This is a layout rollback only.

## v2.35 natural-height layout
This release tunes the fixed desktop layout to match the cleaner pre-dock composition.

- Controls / Check-Repair remain on the left but use **natural content height** instead of stretching to the viewer.
- The 3D viewer remains the large visual area on the right and uses a tall browser-relative height.
- Desktop split is roughly **32% controls / 68% viewer**.
- Normal page scrolling is allowed.
- No JavaScript viewport sizing, draggable modules or equal-height panel forcing.
- Engine, repair/reduction logic, orientation and camera-preservation behaviour are unchanged.

## v2.34 layout reset
The draggable/dockable desktop module experiment introduced in v2.28 has been removed.

- Deleted `panel-layout.js` and `panel-layout.css`.
- Removed drag bars, left/right swapping, saved panel-side state and JavaScript viewport-height management.
- Restored the fixed pre-v2.28 two-column desktop structure: Controls on the left, 3D viewer on the right.
- Desktop sizing is CSS-only again. Both columns share one browser-relative height; Controls/Check-Repair scroll internally if needed while the Viewer fills its column.
- Kept all current v2.31–v2.33 repair/reduction/health-check logic.
- Kept the v2.33 STL orientation fix, camera/view preservation and stable live-reduced preview.

This is a layout rollback only, not an engine rollback.

## v2.33 viewer stability
This release keeps the 3D workspace calm while repair and reduction run.

- Repaired/rebuilt internal geometry is now exported as a normal Z-up STL before SHRINK reopens it, so the model does not rotate between stages.
- Camera position, OrbitControls target and zoom are saved before an internal repair/rebuild reopen and restored afterwards.
- While Simple reduction runs, the live reduced preview stays visible; the wizard no longer switches back to Original between updates.
- Repeated requests to show the model already on screen are idempotent.
- Loaded Simple desktop mode is locked to the browser viewport. The page itself does not need vertical scrolling; the controls module scrolls internally.
- Workspace height is clamped to the visible viewport so previous page scroll cannot make the viewer taller than the browser.
- Removed the permanent whole-document MutationObserver from the dock/layout layer. Mounting now uses short startup retries plus explicit workflow events.
- No reducer or repair algorithm changed.

The reducer/core algorithm graph remains v2.18 and the repair graph remains v2.27. `app.js?v=2.33` is a viewer/app-shell cache key for these display changes.

## v2.32 P1 tidy-up
This release removes more legacy Simple-mode glue before the proposed recipe/job-state UI is built.

- Simple quality presets now say what they really do: conservative triangle targets (~450k / 320k / 240k / 170k on dense models), not measured millimetre guarantees.
- Real surface-loss measurement remains available when **Compare** is opened and in Tools.
- The old `simple-focus.js` click-hijack layer has been removed. `simple-mode.js` now owns the Simple reduction target directly.
- Fine-tune now schedules one exact reduction rather than also triggering the native slider reducer.
- The duplicate `viewer-auto-button.js` import was removed.
- A clean model can **Download as it is** without reducing.
- After automatic repair/rebuild failure, the user can **Continue anyway**, **Download as it is**, or open **Tools**; continuing keeps an amber mesh warning visible.
- Simple downloads do not automatically Fuse. Fuse remains an explicit Tools operation.

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
