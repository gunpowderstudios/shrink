# CLAUDE.md — SHRINK 3D handoff notes

Read this file before changing the repository.

## Current baseline

- Current main release: **v2.407**. `audit-regression-tests-20261122` is an unreleased v2.408 review branch. (see CHANGELOG.md; the multitool core dates from v2.57; see "3D Print multitool" below). The old Simple wizard and the Racer preset were deleted in v2.239; their notes are in `ARCHIVE.md`.
- Default branch: **main**
- The current core engine graph is still **v2.18**.
- v2.19–v2.25 are deliberately layered mainly through Simple-mode workflow/UI files rather than retagging the whole engine graph.
- Current public app: https://gunpowderstudios.github.io/shrink/

## Detail slider queue (v2.408 review branch)
- `live-reduce.js` `request()` can run its delayed `pump()` while `runExact()` owns `R.busy`. The exact call now drains any queued slider request when it finishes. Keep the reducer's `request`-during-`runExact` test in `tests/livereduce.test.mjs`. `tests/multitool.test.mjs` also checks the visible model through 20%, 50%, 100%, 10%. Browser verification required before release.

## 3D Print multitool (v2.38 onward) — read this before touching print code

`print-v2-ui.js` owns the visible 3D Print interface: printer & size, **FUSE IT**, **SHRINK IT**, **DOWNLOAD IT**, the MODEL HEALTH card with **FIX IT**, and the change chips. The tools are **cumulative and order-free**: each one acts on the *current working model* and its result becomes the new working model. The untouched upload stays in `app().originalModel` for Compare/reset.

### The working model
- `window.__shrinkWorkingModel()` returns it; `window.__shrinkSetWorkingModel(model)` sets it. `sourceModel()` in `fuse-export.js`, `split-print.js`, `split-fallback.js`, `print-export-safety.js` and `print-tools.js` all start from it. **Never read `app().originalModel` or `app().optimizedModel` directly in a print tool.**
- **To make a tool's result the new working model, call `window.__shrinkInstallWorkingModel(root, kind)`** (defined in `print-v2-ui.js`). It does everything in the right order: `setPreview`, `setWorkingModel`, `show('optimized')`, restore the camera, `notifyReduced`, change chip, clear the red warning. FIX IT uses it. Do not copy those steps into a new tool. Call `window.__shrinkRefreshHealth()` afterwards if the health card must update at once.
- `setPreview()` disposes the previous preview's geometry. Never keep using a model after it has been passed to `setPreview` as its replacement.

### Split / Fuse rules
- DOWNLOAD IT must **never** switch `fuseSolidToggle` on. Fuse is a deliberate tool (FUSE IT). The legacy Fuse export (`fuse-export.js`) and the split export (`split-print.js`) both intercept `saveStlBtn` in the capture phase and call `stopImmediatePropagation()`, and their order depends on module load order, so the Fuse export steps aside whenever `splitMode !== 'off'`.
- **A model made of several separate closed pieces is valid.** Do not require `components === 1` unless the operation truly needs one connected solid (it does not for splitting or exporting).
- A closed mesh can be inside-out (negative Manifold volume). `fuse-export.js` turns it outward; any new code that builds Manifold solids from meshes must go through `meshToSolid`/`modelToSolid`.
- Pegs are best-effort. If a peg cannot be built the joint stays flat and the status message must say so. Pegs need material on both sides of the cut.
- If the solid split fails, `split-fallback.js` (`raw-split.js`) makes a direct capped split. It must keep working on inside-out input and on cuts that pass exactly through a ring of vertices.
- `syncSplitControls()` runs from a page-wide `MutationObserver`. Anything it does must be idempotent (write only when a value changes) or the page will loop.

### SHRINK keeps a clean model clean (v2.57)
(v2.246) `shrinkModel()` must never return silently: it waits for `#v2ShrinkBtn[data-checking]` to clear and for `#autoBtn` to be enabled, else it throws and sets `window.__shrinkShrinkNote`. A 12-file batch had five models leave unshrunk because it used to just return.
The simplifier can leave a few non-manifold edges on a model of many small pieces. `shrinkModel()` notes whether the working model was clean before it ran (reusing `lastHealth`) and tells the reducer with `window.__shrinkLive.setTidy(wasClean)`. **The repair happens inside `live-reduce.js` `apply()`**, on the reduced indices, before the display geometry is built; it is not a separate model installed afterwards. **Never replace `app().optimizedModel`/the working model with a different object while the Detail kept slider is meant to drive it**: the slider modifies `engine.root` in place, so the model on screen must stay `engine.root` (v2.56 broke exactly this). If another tool (FIX IT, FUSE IT, Make watertight) installs a new working model, the next slider move re-bases the reducer on it (`__shrinkLiveUI.rebaseWorking`) first. A model that was already unhealthy is never repaired behind the person's back. Do not "fix" non-manifold output by changing simplifier flags: `LockBorder`, `Prune` and `Sparse` make no difference. The in-place repair is skipped above 300,000 triangles (`TIDY_MAX_TRIANGLES`).

(v2.270) The Detail kept number is always % of the ORIGINAL upload (`detailScale` = the rebased model's triangles / the upload's). After FIX/FUSE it shows e.g. 1.1; dragging above that reverts the working model to `app().originalModel` (FIX/FUSE undone, `clearApplied()`), then the usual rebase. `applyDetailValue` converts shown value to the reducer's native % with `value / detailScale`.

### Display shading (v2.56, unchanged in v2.57)
Reduced previews and FIX/FUSE results get their shading normals from `crease-normals.js` (`creaseSplit`), not `computeVertexNormals()`. Plain smooth normals smear shading over big flat triangles across hard edges and look like dark patches; the geometry is fine and the STL never contains them. `creaseSplit` only appends duplicate vertices and never changes positions or triangles; the original vertex numbers stay valid, which `live-reduce.js` relies on (worker indices refer to the original numbering). Keep `src.baseAttrs` (pristine attributes) in `live-reduce.js` and rebuild the display geometry from `s.positions` on every reduction.

### One big health card (v2.215)
The left column is gone. `buildMainCard()` in `print-v2-ui.js` moves the Height/Width/Depth rows, the Detail slider (`#v2Detail`), the SHRINK/FIX/FUSE cards and DOWNLOAD IT (+ GLB) into a `.v2-main-card` in `.v2-left-stack` (v2.225: the MODEL HEALTH card `#v2HealthCard` itself stays in the viewer, top-right, always visible; the red `#printDiagnosticPanel` is hidden by CSS). Everything else (printer dropdown, hidden `[data-printer]`/`[data-quality]` buttons, split mode, joint, pegs, cut height) is kept in a hidden `.v2-legacy-hold` because BATCH and the tests click it. **Splitting/pegging has no UI any more**; the hidden `#v2SplitMode` stays `off` because nothing visible can change it (the split engine and its tests are kept, dormant). (v2.244, Tim asked for it back) The split controls are visible again as a folded `<details id="v2SplitMenu">` "Split into parts" (badge `#v2SplitBadge`) above DOWNLOAD IT in `.v2-main-download`: `buildMainCard()` moves the existing split/joint/cut/best-cut/peg-status controls and the peg-settings fold (found via `#v2PegPosition`, other `.v2-advanced` blocks exist) into it; nothing was rebuilt, so the hidden-control wiring and tests still hold. Default stays One STL. (v2.244, Tim) The aim is as much model area as possible: ADVANCED open = normal-width side column + viewer fills the rest; closed = viewer fills everything. Do not make the open panel wider or stack it above the viewer. `ui-mode.css` lifts the 1500px `.app-shell` cap once a model is open.

### Helper cache keys and the diagnostic report (v2.188)
`print-export-safety.js` loads fuse-export / split-print / split-fallback / preview-material-fix / watertight-remesh under `REL` (the `?v=` it was itself imported with = `PRINT_RELEASE`), NOT its old fixed `VERSION` ('2.63'): a fixed key made browsers keep stale copies after a fix. Never hard-code a cache key for a module that changes. `#v2DiagBtn` (Advanced drawer) copies `window.__shrinkDiagReport()`; `window.__shrinkFuseBuild` shows which fuse-export is really loaded and `window.__shrinkLastFuse` the last fuse result.

### Make watertight (removed in v2.254)
The button, `makeWatertightCopy`, `window.__shrinkMakeWatertight`, BATCH's `watertightRow` and tests W1/H/J are gone: Tim found it always loses detail. `watertight-remesh.js` remains only for the switched-off CLAY tool. The red box `#printDiagnosticPanel` still exists (hidden by CSS) but has no button.

### Minor edges are fine (v2.195; limit raised from 10 to 250 in v2.249 at Tim's request: Make watertight always costs too much detail)
`deps.minor()` in batch.js reads the MODEL HEALTH rows: no open edges and 1 to `MINOR_EDGES` (250) non-manifold edges plus flipped faces together (v2.197) = fine to print (row stays green, no Make watertight button). Voxel rebuilds drop detail (104k to 21k triangles in a real run) so they are not worth it for that.

### Start screen and mode (v2.275: one "Choose a model file" button `#startOpenBtn` replaces the two big cards, which stay in the DOM hidden because BATCH and tests click them; it calls `setMode()` from the extension then `__shrinkApp.openFile`; v2.239; the file type still picks the mode since v2.200)
`ui-mode.js` shows the two big cards (`.mode-chooser`, Gaming / 3D Printing) as a start screen while `body.start-screen` is set. A click on a card calls `setMode(mode, true)`, removes the class. (v2.243) Nothing is remembered any more: a reload always opens Home (`performance` navigation type `reload`, hash rewritten to `#home`); a fresh visit opens the tab named by its `#hash`, else Home. Only our own switch-with-a-model-open reload carries the target, in `sessionStorage['shrink-go']` (read once, then removed). The SHRINK 3D logo (`.title-row h1.logo-home`) is a Home link through the same `goTab('home')` path as the Home tab. (v2.240) The top bar has tabs `.mode-tabs` (Home / 3D Printing / Gaming) in place of the old `.mode-switch` link; Home just shows the cards again. (v2.242) The tabs are always visible; with a model open (`#workspace` not `.hidden`) a click on another tab asks `confirm()`, stores the target in `sessionStorage['shrink-go']`, sets the hash and reloads the page, because a loaded model cannot change mode safely. `#v2BatchPanel` is on the left (`left:14px`; floating top 96px; v2.264 centred it by mistake, undone in v2.265; the BATCH UPLOAD button row is what is centred). The tabs follow the address: `#home`, `#3d-printing`, `#gaming` (`syncTabs()` writes it with `replaceState`, a tab click `pushState`s, `hashchange` calls `applyHash()`, which is ignored once a model is open; a hash on load is read BEFORE `setMode()` rewrites it and is what a fresh visit opens). While `start-screen` is set CSS hides the drop zone, the print upload hero, BATCH UPLOAD and the settings-file row. Opening a file still sets the mode from `sourceKind` on `shrink:model-opened` (glb = game, anything else = print) without saving it. `.mode-override` ("Use as a print model") shows for a GLB in game mode. Batch and tests click `.mode-card` even though it is hidden after the start screen. BATCH UPLOAD (`.v2-batch-home`) is hidden in Gaming mode: BATCH runs the print pipeline. The green side tab is `.v2-left-toggle`.

### Minor score (v2.199)
`healthScore()` in `print-v2-ui.js` returns 95 / 'Good' / `minor` for no open edges and 1 to `MINOR_MAX` (250) non-manifold edges plus flipped faces. Anything that tests `score === 100` still treats it as not perfectly clean (QUICK-FIX still tries to fix); BATCH decides warnings with `deps.minor()`.

### Red box rules (v2.198)
`showDiagnostic()` (print-export-safety.js) does nothing while `window.__shrinkBatchRunning` is set (batch.js) or when the model has no open edges and 1 to 250 non-manifold edges plus flipped faces; the batch also hides the box when it finishes.

### Dim screen (v2.309; replaces the v2.191 big-task note)
`setWorking(on, delayMs, label)` in `print-v2-ui.js` keeps a stack of jobs; `dimUpdate()` shows `#v2Dim` (fixed, full screen, blocks clicks) with the label of the OUTERMOST labelled job (so a health check inside FIX IT still reads Fixing…). Labels: updateHealthCard 'Checking…' (no delay until the first check is done, 350 ms after), fixHealthModel, fuseCheck, shrinkModel, hollowModelNow, editModelNow, clay `applyNow` (via `window.__shrinkWork(true, 0, label)`). `firstChecking` is set on `shrink:model-opened` and cleared when `quickState('ready')` runs, so the dim stays until the first health check AND piece count are done. `window.__shrinkDimState()` for tests (M1 in `tests/clay.test.mjs`). Any new long job should call `setWorking(true, 0, 'Word…')`.

### Health score ignores degenerates (v2.190)
`healthScore()` in `print-v2-ui.js` no longer deducts for degenerate triangles and the row is never red; they are informational (same rule as `meshHealth`). Do not delete them to "fix" the row: a zero-area triangle can be part of a closed edge loop.

### Fuse fallback and dust (v2.189)
(v2.254) The v2.248 `solidFromComponents()` surface-piece route was removed: it never fused a real model (minotaur, Tarak). When Manifold refuses a model, QUICK-FIX reports it honestly; if the model is already one watertight piece it says "nothing to fuse" (v2.253).
The repair fallback in `modelToSolid()` (`repairWholeModelSolid`, used when a mesh part is rejected as non-manifold, e.g. a stacked duplicate shell) goes through `splitShells()` too. After the union, components with volume <= 1e-5 of the biggest (including negative, inside-out ones) are dust and dropped. `shrinkMyModel()`'s verdict `healthy` = `lastHealth.h.clean` (degenerates alone do not count).

### Fuse unions shells inside one mesh (v2.187)
`modelToSolid()` in `fuse-export.js` runs `splitShells()` on every mesh's solid (Manifold `decompose()`, inside-out shells turned outward, zero-volume shells dropped) BEFORE `Manifold.union`. Without it a single STL mesh with overlapping shells was never unioned. After the union, pieces under 1e-6 of the biggest volume are dust and are dropped (`Manifold.compose`), and `components` counts what is left. `fusedPieces` makes the FUSED chip say `FUSED · N PIECES`. Tests: U1/U2 in `tests/clay.test.mjs` (`models.overlap`).

### FUSE IT size guard (v2.124; the yellow `#v2SizeWarn` banner was removed in v2.244 as too confusing, `updateSizeWarning()` now just removes it)
`fuseCheck()` in `print-v2-ui.js` refuses above `FUSE_MAX_TRIANGLES` (1,000,000; tests can override with `window.__shrinkFuseTriLimit`) and tells the person to SHRINK IT first. Manifold runs on the main thread, so a multi-million triangle model freezes the tab. The proper fix would be moving fuse into a worker. (v2.125) `updateSizeWarning()` shows the yellow `#v2SizeWarn` banner above the Fuse card from `updateHealthCard()` while the working model is over the limit.

### SHRINK MY MODEL! (v2.140; shown to people as DO EVERYTHING since v2.213 and as plain SHRINK since v2.235, now in `#v2SideStack` under the health box; still `#v2MagicBtn` and still called QUICK-FIX in this file)
`shrinkMyModel()` in `print-v2-ui.js` (button `#v2MagicBtn` in `.topbar`, report `#v2MagicNote`) just calls the existing `shrinkModel()`, `fixHealthModel()` (only if the health score is not 100), `fuseCheck()` (success read from `#v2FuseCard` `data-state`), then `levelModel()` (finds the best flat face within 50° of down and turns the model onto it, then turns it about Y so the long side is along X; rotates the working model root's quaternion about its centre, never its geometry; exposed as `window.__shrinkLevel`) and `centreOnBed()`. Both work in WORLD space (`moveWorld`/`rotateAboutCentre`; the root can have a scaled/rotated parent) and measure with `Box3.setFromObject(model, true)` (precise; the cached geometry box can be stale after in-place reduction). `centreOnBed()` moves the working model root's `position` (exports use `matrixWorld`, so it follows into STL/split); it never replaces the model object. `showBedGuide()`/`removeBedGuide()` (also `window.__shrinkBedGuide`) add a `shrinkBedGuide` group (grid, dark plane, XYZ arrows) to the viewer scene and hide the default grid; it is removed on `shrink:model-opened` and in Game mode. Do not copy the step logic: change the individual tools.

### Other formats (v2.236)
`#v2SideGlb` is a `<details>` "Other formats" menu (GLB, OBJ, 3MF, USDZ) in `#v2SideStack`; buttons call `window.__shrinkExportFormat(kind)` in `print-tools.js` (`exportModel`/`exportGlb`). 3MF and USDZ come from `export-formats.js` (own tiny store-only zip writer; USDZ files are 64-byte aligned). Like STL they export the working model through `saveBlob`, so BATCH capture still sees them. The left tab `#v2LeftToggle` always reads ADVANCED.

### HOLLOW IT (v2.281, shown to everyone since v2.295; `?hollow=0` hides it)
`hollow-core.js` (no DOM; `hollowSolid(Manifold, solid, {wall, holes, holeRadius})`): voxelises the closed solid with vertical rays, Euclidean distance transform inward, `Manifold.levelSet` for the cavity at `wall` depth, `solid.subtract(cavity)` so the OUTER surface is never rebuilt, then Y-axis cylinders from the lowest point of the base up into the cavity as drain holes. `fuse-export.js` `hollowModel(model, opts)` wraps it (world units; the card converts mm with `__shrinkPrint.mmPerUnit()`). `print-v2-ui.js` `#v2HollowCard` (shown by `renderAppliedChanges()` when `appliedChanges` has `shrunk`), `hollowModelNow()`, `hollowClip(pct)` (a three.js clipping plane on the working model's materials, DoubleSide while cut; slider `#v2HollowCutRange`). Result goes through `installWorkingResult(root, 'hollow')` -> chip HOLLOW (`hollowed` in `appliedChanges`; counts as processed for the Detail slider revert). Needs a watertight model: `modelToSolid` refuses leaky ones. (v2.294) `hollowBase` keeps a cloned copy of the pre-hollow model; pressing again re-hollows from it while the working model is still `hollowResult`. The cut-away blue is a `shrinkHollowBlue` group in the viewer scene (BackSide MeshBasicMaterial, same clip plane), removed on any other install; never add it under the model or it would be exported. (v2.302) `#v2AutoHollow` (tick box under `#v2MagicBtn`, off by default): `shrinkMyModel()` step 5 calls `hollowModelNow()` after levelling and centring. (v2.303) `#v2HollowSlide` (vertical blue slider in `.v2-viewer-slot`, shown while `hollowed` is applied) drives `hollowClip`, which keeps it and `#v2HollowCutRange` in step. (v2.305) `change` on `#v2HollowWall`/`#v2HollowHoles` re-runs `hollowModelNow()` (debounced) while the working model is `hollowResult`, keeping the cut position. (v2.306) `#v2HollowHoleSize` (diameter in mm, default 3) sets `holeRadius`. Tests: `hollow.test.mjs`, `hollow-ui.test.mjs`.

### EDIT MODEL (v2.307; tabs + Brush v2.308)
(v2.308) `buildMainCard()` adds `.v2-main-tabs` (`#v2TabEdit` / `#v2TabFinish`); `mainCard.dataset.tab` is `edit` or `finish` (default finish) and CSS shows `#v2EditPane` (the Edit card + the CLAY card, now called Brush) or the SHRINK/FIX/FUSE/HOLLOW cards; `window.__shrinkTab(tab)`. `#v2EditCard` is a plain section now; its `#v2EdTab` menu is brush/shape/slice and `editTabChanged()` shows the matching controls (Brush = `#v2ClayCard`, `clay.js`, switched back on with `CLAY_ENABLED = true`). The shape/slice preview only exists while the EDIT tab is open. Shape/Slice refuse a hollowed working model (`hollowResult`); the Brush path (clay.js) has no such guard yet.
`edit-core.js` (no DOM; `primitive`, `applyShapes(M, solid, [{kind, mode:'join'|'cut', matrix}])`, `sliceSolid(M, solid, normal, offset)` keeps n·x >= offset) wrapped by `fuse-export.js` `editModel(model, {shapes}|{slice})` (world units, via `modelToSolid`/`solidToThree`, so it needs a watertight model). `print-v2-ui.js` `<details id="v2EditCard">` (`editModelNow`, `undoEdit`, `window.__shrinkEdit`): result goes through `installWorkingResult(root, 'edit')` -> chip EDITED (`edited`). Undo = `editStack` of cloned pre-edit models (max 6, cleared on `shrink:model-opened`). The preview is a `shrinkEditPreview` group in the viewer scene (never under the model, so it is not exported). No gizmo yet: numeric inputs only (the add-part.js TransformControls could be added, it needs a guarded dynamic import because jsdom cannot load esm.sh). Not yet built: click-to-remove loose pieces, a freehand brush, manual hole fill. Tests: `edit.test.mjs`, `edit-ui.test.mjs`.

(v2.310) The EDIT tab's tool / shape / Join-Cut choices are `.v2-icon-btn[data-ed=tool|kind|mode]` buttons that set the hidden selects `#v2EdTab`/`#v2EdKind`/`#v2EdMode` (tests and code still drive the selects; `editTabChanged()` re-syncs the pressed state). The Brush shows a `#v2BrushRing` (fixed-position div, sized by projecting the brush radius at the hit point; `__shrinkClay.ring(e)` for tests); the Brush size slider `#v2ClaySize` is the tip WIDTH in mm, `radius()` = width / 2.

(v2.311) Part tool: `#v2EdPartBox` (file input `#v2EdPartFile`, height/turn/move inputs, SIT ON TOP / CENTRE). `loadPartFile()` reads STL/PLY (Z-up turned to Y-up), OBJ or GLB with the esm.sh three loaders into a centred triangle-soup `editPart`; `partMatrix()` places it in world space; apply passes `{part:{root, mode}}` to `editModel`, which makes a solid of the placed part with `modelToSolid` and `applySolid` (edit-core.js) joins or cuts it. The part is used up after one apply. jsdom cannot load esm.sh, so tests use `__shrinkEdit.setPart(Float32Array, zUp, name)`; the file loaders are untested outside a real browser.

(v2.312) Copy / cut: `#v2EdCopyBox` (blue box `#v2EdCW/CH/CD` + move `#v2EdCX/CY/CZ`, `copyPieceNow(remove)`), `editModel(model, {copy:{matrix, remove}})` -> `edit-core.js copyRegion` (intersect with the box, subtract when removing). The piece becomes `editPart` (`copied`, `origin` = its world centre so it pastes back in place), the Join/Cut select is set to join and the tool switches to Paste part. Tool selection: `#v2EdTab` has a `none` value (click the pressed tool icon again, or Esc while the EDIT tab is open); `none`/`brush` show no shape preview. `editBase` is a clone of the model from before the first edit (cleared on `shrink:model-opened`); `resetEdits()` installs a clone of it, clears the stack, brush strokes and the part, and puts the inputs back to their defaults.

(v2.313) EDIT tools are now Lasso, Razor, Shape, Paste part, Slice (hidden `#v2EdTab` values lasso/razor/shape/part/slice/none). The Brush (clay.js, `CLAY_ENABLED = false`; `#v2ClayCard` hidden by CSS) and the box Copy/cut tool (`copyRegion`, `#v2EdCopyBox`) were removed. Lasso/razor: capture-phase pointer events on `#viewer` draw into a `#v2LassoCv` canvas; the loop is stored as NDC points plus a `cameraSnap()` (camera world matrix, fov/ortho size) and cleared when the camera moves, Esc, or the tool changes. `lassoApply(op)` ('delete' | 'copy' | 'cut') gets near/far from `depthRange()` (front half or right through), calls `editModel(model, {lasso:{pts,cam,near,far,op}})` -> `edit-core.js` `lassoPrism` (CrossSection extruded, perspective via scaleTop, turned 180° about Y, placed with the camera matrix) and `lassoRegion` (intersect for the piece, subtract for the rest, so the hole is always capped). A piece becomes `editPart` (`copied`, `origin` = its WORLD centre, computed BEFORE `partFromPoints`, which centres the array in place) and the tool switches to Paste part with Join. `#v2PartPad` (built by `ensurePad()` into `#viewer`, shown by `updatePad()` while a part is waiting) drives the part inputs and `partRot` (a world-space quaternion multiplied in front of the Euler turn inputs, in `partMatrix()`). Test hooks: `__shrinkEdit.lasso(op, {pts, cam})`, `setSel`, `pad(act)`, `padVisible`. jsdom cannot drive real pointer drawing or the canvas; check the mouse lasso, razor cursor and pad in a real browser.

(v2.314) `lassoRed(sel)` marks every surface triangle whose centre projects inside the loop and lies within `depthRange()` (same snapshot as the cut) in a red `shrinkLassoRed` group; `clearLasso()`/`removeLassoRed()` remove it. It is an approximation of the cut (centres, not exact intersection). Tests: ED26 (fakes `__shrinkViewer = {scene}`). Next idea (not built): branch detection, selecting the connected geometry beyond a loop drawn round a limb's base.

(v2.315) `#v2EdWhole` ("Grab the whole loose piece"): `lassoMasks(sel, whole)` returns one triangle mask per mesh; with `whole` it grows to every island (union-find over vertices welded by quantised world position, `islandsOf`, cached per model in `islandCache`, cleared on `shrink:model-opened`). `wholePieceEdit()` removes the masked triangles from a clone and COMPACTS the vertices (the precise `Box3.setFromObject(model, true)` reads every vertex, so orphans would keep the old size, centring and Height wrong); no Manifold. Tests: ED27. Not built: detection of a branch fused into a single shell.

(v2.316) Sculpt tool (`#v2EdSculptBox`, hidden select `#v2EdSculptMode` smooth/pull/push, `#v2SculptSize` tip WIDTH mm, `#v2SculptStrength` 1-10). `sculptBegin()` pushes an UNDO snapshot per stroke and, unless the working model is already `sculptWork`, installs a private clone via `installWorkingResult(.., 'edit')` (never edit the slider-driven reduced model in place). `sculptBuild()` welds vertices by quantised world position into gids with CSR neighbours; `sculptDab()` BFS-collects gids inside the tip, then Taubin smoothing (lambda/mu) or displacement along the hit face normal plus a light smooth, and writes local positions back through each mesh's inverse matrix. Normals are recomputed (throttled) for indexed geometry only. Needs no watertight model. Tests: ED28 via `__shrinkEdit.sculpt(point, mm, strength, mode, normal, dabs)`. Mouse drawing, the ring and speed on a 1M-triangle model are untested in a real browser.

(v2.317) `SCULPT_MAX_TRIANGLES` (2,500,000, a guess, not measured) applies to Sculpt and to the lasso with `#v2EdWhole`; Manifold tools keep `FUSE_MAX_TRIANGLES`. `updateEditHint()` is per tool and runs from `editTabChanged()`. Test ED29.

(v2.318) `#v2EdDepth` is "Which part": `near` (default for Lasso, "Nearest part (auto)"), `through` ("Everything under the loop", the Razor default), `front` ("Half way through"). `lassoMasks` in `near` mode sorts the depths of the triangles under the loop and keeps the layer before the first gap larger than 8% of the depth range (`out.band` = near/far for the Manifold cut). Heuristic: a hand thicker than that gap would merge with the body; untested on real models. Lasso DELETE over `FUSE_MAX_TRIANGLES` (up to `SCULPT_MAX_TRIANGLES`) goes through `wholePieceEdit(model, sel, 'delete', false)` (mesh-level, open hole, message says FIX IT); COPY/CUT OFF over the limit refuse. `edToast()` shows errors in `#v2EdToast` in the viewer. Tests: ED30.

(v2.319) Part ghost: two meshes in `shrinkEditPreview` (`shrinkPartGhostSee` depthTest off, `shrinkPartGhost` depthTest on); `removeEditPreview` no longer disposes `editPart.geometry` (shared, rebuilt every drag move). Mouse grab: `wirePartDrag()` (capture-phase pointer events on `#viewer`, only when the pointer hits the ghost, otherwise orbit works); `partDragApply(mode, ndcFrom, ndcTo, shift, cam)` does MOVE (ray-plane through the part centre, Shift = along the view), TURN (`partRot`, trackball about camera up/right) and SIZE (`#v2EdPartH`), using `rayFor(cam, ndc)` so it is testable without a real camera. `padMode` is set by the `[data-pmode]` pad buttons. A COPY (not cut) starts one piece-width to the camera's right. Tests: ED31 (`__shrinkEdit.drag/partState/ghosts`). Real pointer dragging, the hover cursor and the ghost look are untested in a real browser.

(v2.320) EDIT keyboard shortcuts live in one `keydown` listener next to the `#v2EdReset` wiring (ignored in INPUT/SELECT/TEXTAREA): Ctrl/Cmd+Z `undoEdit`, +C / +X `lassoApply('copy'|'cut')` with a loop, +V `editModelNow` with a floating part, +/- `#v2SculptSize` x1.15, X/Y/Z `partTurnWorld` (world axes). Delete is the older listener. Tests: ED32.

(v2.321) The EDIT tools no longer live in the main card. `#v2TabEdit` (class `v2-edit-toggle`) is created in the ADVANCED wiring block and inserted right after `#v2LeftToggle` in `.viewer-actions`; `#v2EditPanel` (holds `#v2EditPane` > `#v2EditCard`) is built in `buildMainCard()` and moved into the viewer panel (absolute, drops down under the toolbar, outside `#viewer` so lasso pointer events do not see it). `editActive()` = the panel is not hidden. `setMainTab('edit'|'finish')` / `window.__shrinkTab` open and close it; the main card has no tabs and its `data-tab` stays `finish`. The test harness now has a `.viewer-toolbar .viewer-actions` so the real placement is tested. Tests: ED33.

(v2.322) `#v2PartPad` is now inserted at the top of `#v2EditPanel` (before `#v2EditPane`), not into `#viewer`: in a real browser the viewer can be taller than the window and its bottom-right corner was off screen. Falls back to `#viewer` when there is no panel. CSS makes it static inside the panel.

(v2.323) Overlap preview: `overlapUpdate()` (debounced 160 ms by `scheduleOverlap()` from `updateEditPreview()`) marks every ghost triangle with at least one vertex inside the model in a red `shrinkPartOverlap` group (depthTest off). Inside = parity of a +Y ray against a cached grid of the model's world triangles (`ovBuild`/`ovInside`, cached per model + `__shrinkStretchTick`, skipped above `FUSE_MAX_TRIANGLES`); no BVH needed. Note text in `#v2PadJoin`. `body.v2-editing` (set by `setMainTab`) hides `#v2HealthCard` and `#v2SideStack` while the EDIT panel is open. Tests: ED34, ED35. The multitool split-download failures (A1-A4) predate this and are still there.

(v2.324) `setMainTab('edit')` selects the Lasso the first time the panel opens (`editOpened`); later opens keep the last tool. Tests that need the Shape tool now pick it explicitly.

(v2.325) The pad's MOVE/TURN/SIZE mode buttons and `padMode` are gone. Handles live on the floating part: `gizmoBuild()` adds a `shrinkPartGizmo` group (3 arrows, 3 rings, depthTest off) to `shrinkEditPreview`; picking is plain maths, not three.js raycast (`gizmoPick(ndc, cam)`: ray vs arrow segment, ray-plane vs ring radius, arrows win ties), `gizmoApply(kind, axis, from, to, cam)` slides along an axis (closest-point parameter, delta applied to `#v2EdPartX/Y/Z`) or turns about a world axis (`partRot`). `wirePartDrag()` tries the gizmo first, then the ghost (screen-plane move). `#v2PartHud` (− / +, HTML in `#viewer`, placed at the projected part centre by `hudPlace()`, follows `controls` 'change') calls `partScale()`; +/- keys too. Tests: ED36 (`__shrinkEdit.gizmoPick/gizmoDrag/scale/hudVisible`). Real pointer picking, handle sizes and the HUD position are untested in a real browser.

(v2.326) Several floating pieces. `editPart` is the SELECTED piece (its state lives in the `#v2EdPart*` inputs and `partRot`); the others wait in `parked` = `[{part, vals, rot, mode}]`. `setPart(part)` parks the current piece instead of replacing it; `takeParked(i)` swaps one in; `dropSelected()` (after weld or delete) selects the last parked one; `dupPart()` = COPY PIECE (shares the geometry; `removeEditPreview` spares every parked geometry); `partMatrixOf(part, vals, rot)` builds a matrix for any piece. `updateEditPreview()` draws all floating pieces (`shrinkParkedGhost*` dim, selected `shrinkPartGhost*` plus a `shrinkPartGlow` back-face shell) under ANY edit tool, the gizmo only under Paste part. Mouse: `wirePartDrag` pointerdown falls back to `parkedAt(ndc)` and selects that piece, then drags it. `#v2PadPlace` = WELD IT, `#v2PadAll` = WELD ALL (`weldAll()` loops `editModelNow()`), `#v2PadCopy`, `#v2PadCancel` = DELETE PIECE (`discardPiece()`); keys Ctrl/Cmd+C dup, Delete discard. `parked` cleared on `shrink:model-opened` and in `resetEdits`. Tests: ED37 (`__shrinkEdit.parked/select/dup/weldAll/discard`). Clicking a waiting piece with the real mouse is untested in a browser; with Lasso/Razor active pieces are shown but not grabbable.

(v2.327) Gizmo arrows are `L = R * 2.2` long in both `gizmoPick` and `gizmoBuild` (keep the two in step); shaft radius 0.04 R, head 0.12 R.

(v2.328) Floating pieces persist and can be saved. `shrink:model-opened` no longer clears `parked` / `editPart` (it only resets `partRot` when nothing floats, and refreshes the preview 500 ms later). File format `.shrinkparts`: `"SHRINKPARTS1\n"`, uint32 LE header length, JSON header `{pieces:[{name,height,mode,vals,rot,off,count}]}`, then raw float32 triangle soups (`buildPiecesFile`/`loadPiecesBuffer`/`savePiecesFile`; `vals` are the `#v2EdPart*` inputs in mm relative to the model centre). `ensurePiecesRow()` adds `#v2PiecesRow` (SAVE/LOAD PIECES) to `#v2EditPane` and the `#v2SavePieces` tick box under `#v2DownloadBtn`; `download()` saves the file 400 ms after the STL click when ticked. It goes through `__shrinkCapture` like every export. Tests: ED38. No full project file yet (edited model + undo history).

(v2.329) Select tool (`#v2EdTab` value `select`, first icon). `pieceTool()` = part or select; the pad, pointer grab/pick (`wirePartDrag`), overlap preview, the C / V / Delete shortcuts and `editModelNow`'s part branch now test `pieceTool()` instead of `=== 'part'`. Select draws the pieces and the glow but no gizmo / HUD (`isPart` only), and hides `#v2EdGo` and the Join/Cut row. `#v2EdHint` explains it. Tests: ED39. Only one piece is selected at a time; no multi-select / select-all yet.

(v2.330) The Finished height row (`#v2Height` + `#v2HeightRange`) and `#v2ResizeBtn` are moved by `ensureMagicButton()` into `.v2-side-height` at the top of `#v2SideStack`, above `#v2MagicBtn`. Uniform / Width / Depth stay in `.v2-main-size` (ADVANCED). Everything finds them by id, so nothing else changed. `tests/clay.test.mjs` HT1 (3 cases) already failed before this and still does.

(v2.331) SHRINK keeps a fixed share of the triangles (Tim: the automatic search lost too much detail). `shrinkModelInner()` calls `window.__shrinkApplyDetail(target)` (= `applyDetailValue`, so the slider and `detailScale` stay right), then waits for `shrink:live-busy` true -> false (2.5 s grace if it never starts, 4 min cap) instead of clicking `#autoBtn`. Target = `window.__shrinkShrinkTarget ?? 50`, capped by `window.__shrinkShrinkCap`; `0` or no live reducer (jsdom) = the old `#autoBtn` search (`fixedShrinkReady()`). QUICK-FIX step 1b no longer walks the printer-quality ladder in this mode: if still over `FUSE_MAX_TRIANGLES` it shrinks once more with the cap set to ~90% of the limit. The printer quality no longer changes how far SHRINK goes (it still sets the printer tag/detail used elsewhere). BATCH therefore also lands at 50%. The real reducer path is untested in a real browser (jsdom test ED40 stubs it).

(v2.332) Alt + left drag orbits while any EDIT tool is active: lasso/razor `on()`, sculpt pointerdown/move and `wirePartDrag` pointerdown all return early on `e.altKey` (like Ctrl/Cmd), so OrbitControls (LEFT = rotate) gets the drag. Test ED41. Real-browser orbit untested.

(v2.333) Tiny-model pop-up: `fitHeightToModel()` records `tinyRawMm` (raw height < 30 mm); `wireTinyWarning()` puts a capture-phase click guard on `#v2ShrinkBtn`/`#v2MagicBtn` that shows `#v2TinyBox` once per model (skipped when `manualHeight`, `__shrinkBatchRunning` or `window.__shrinkTinyWarn === false`). Test ED42.

(v2.334) FREE Model corner widget: `free-model.js` (loaded by `ui-mode.js`) builds `#v2FreeModel` (fixed bottom-right, only while `body.start-screen`), spins `free/dwarf-preview.bin` (decimated, format: uint32 nVerts, uint32 nTris, float32 xyz normalised to the box, uint16 indices; Z-up) with three from esm.sh, and on click fetches `free/FREE-BOD-Dwarf-Model.stl`, clicks the print `.mode-card` and calls `__shrinkApp.openFile`. If three cannot load the button stays without the picture. Checked in headless Chromium with three served locally; the click-to-open path with the real app was not (esm.sh is blocked in the sandbox).

(v2.335, reworked v2.336) `print-v2-ui.js` sets `preShrunk` when `#fileName` reads `FREE-BOD-Dwarf-Model.stl` (checked once at dashboard build and 150/1200 ms after each `shrink:model-opened`; the dashboard can be built by the first open, so an event-only flag missed it) and calls `markWorkflowReady()` so DOWNLOAD works without a SHRINK. It sets sets `body[data-v2-preshrunk]` (CSS greys `#v2ShrinkBtn`/`#v2MagicBtn`) and a capture-phase click guard swallows presses until `manualHeight` becomes true (`window.__shrinkSyncPre()` is called where it is set). Test ED43.

(v2.337) Sculpt strength: smooth = `1 + round(strength*7)` Taubin pairs (0.6 / -0.63) per dab with a flat falloff (`min(1, u*3)`); push/pull `amt = s * R * 0.12` (was 0.015). The ring floor is 3 px (was 8). Tip size slider min 0.2, step 0.1. Real-mouse feel and speed on the 369k-triangle dwarf are untested.

(v2.338) Wand: hidden `#v2EdTab` value `wand` (a lasso-family tool: `lzTool()` includes it, it reuses `#v2EdLassoBox` and the DELETE/COPY buttons; `#v2EdLassoBox[data-tool=wand]` hides the whole-piece and depth rows). `wandPick(e)` raycasts with `sculptPick` (now returns `faceIndex`), `wandSelect(mesh, tri)` selects every triangle with the same `islandsOf` island id and sets `lassoSel = {pts: [], cam, wand: masks}`; `lassoMasks` returns `sel.wand` straight away, `lassoApply` forces the direct mesh path (`wholePieceEdit`) for it, and it is not cleared by camera moves. Test hook `__shrinkEdit.wand(meshIndex, tri)`, tests ED44. 'Nearest part' (`lassoMasks`, mode `near`) no longer sorts depth gaps: it seeds at the nearest masked triangle and flood-fills over edge-adjacent masked triangles (welded vertex ids kept in `islandsOf(...)[k].tv`, `isl.gids`) up to depth seed + 1.2 x the smaller loop side at the seed depth; `out.band` = near .. deepest grown triangle + 10% of that cap. Untested on real figures: a leg welded to the body behind it with no surface break will still pull that body in within the depth cap.

(v2.339) `placeHeightBox()` (idempotent, called from `ensureMagicButton()` and right after `buildMainCard()`) puts `#v2Height` row + `#v2ResizeBtn` into `.v2-side-height`; the v2.330 move had run before the dashboard existed, so the row stayed in ADVANCED. Hollow: `holeX`/`holeZ` opts in `hollowSolid` (fractions of the model size, from `#v2HollowHoleX/Z` sliders, -50..50 %) move the first drain hole to the nearest base column; the default is the base centroid. Tests HU14-16, H10-11. Real-browser layout untested.

(v2.340) Camera move no longer clears a Lasso/Razor selection: the `controls` 'change' handler sets `lassoSel.moved = true` and removes only the 2D outline (`lassoPaint(null)`); the red `shrinkLassoRed` group is 3D and `lassoMasks`/`lassoApply`/`depthRange` all use `sel.cam` (the snapshot), so nothing depends on the live camera. Cleared by a new loop, Esc, tool change, or an edit. Real-browser orbit untested.

(v2.341) SAVE PROJECT / LOAD PROJECT replace the v2.328 pieces buttons (`#v2ProjectSave/Load/File` in `#v2PiecesRow`; the `#v2SavePieces` tick box and `.shrinkparts` UI are gone, `buildPiecesFile`/`loadPiecesBuffer` stay as the pieces block inside the project). `.shrinkproject` = `"SHRINKPROJECT1\n"`, uint32 LE header length, JSON `{name, heightMm, triangles, stl, pieces, autoHollow}`, binary STL of the working model (Z-up, finished-height mm, from `window.__shrinkBuildStl` set in print-tools.js; print-v2-ui.js is also run as a classic script by the test harness, so it must not use `import.meta`), then the pieces file. Loading: `window.__shrinkOpenProject(file)` (app.js `openFile` hands `.shrinkproject` to it; ui-mode.js treats it as print) discards floating pieces, opens the STL through `__shrinkApp.openFile`, restores the height, `markWorkflowReady()`, then loads the pieces. Not saved: undo history, original upload (Compare/RESET treat the loaded model as the original), chips. Tests ED38, ED45. Real browser untested (esm.sh/three file path).

(v2.342) Piece library (`ensureLibrary()` called from `ensurePiecesRow()`; row `#v2LibRow`: `#v2LibAdd` ADD TO LIBRARY (enabled by `piecesUi()` while `editPart` exists), `#v2LibOpen`; panel `#v2LibPanel` on `<body>`, grid `#v2LibGrid`). Storage: IndexedDB `shrink-library` / store `pieces` (`libAll/libPut/libDel`, plain `libMem` Map when IndexedDB is missing, i.e. jsdom). Record `{id, name, created, hMm, tris, soup (Float32Array, centred triangle soup in the original model's units), thumb (PNG data URL from `thumbOf`, a 2D-canvas painter's-algorithm render; '' when no canvas)}`. `libUse(id)` = `partFromPoints` + `setPart`, sets `#v2EdPartH` to the saved mm height and `#v2EdPartX` beside the model, Join, Paste-part tool. Browser-only storage: not in `.shrinkproject`, not synced. Also: `lassoApply` COPY falls back to `wholePieceEdit(model, sel, 'copy', false)` (open shell, `r.openCopy`) when Manifold refuses an open model (error matches manifold/printable/watertight/FIX IT). CUT and the Manifold tools still need a closed model. Tests ED46, ED47 (ED47 stubs `__shrinkFuse.editModel` to throw). Real-browser IndexedDB, the thumbnails and the grid layout are untested.

(v2.343) `downloadPieceStl('sel'|'part')` + `#v2PieceStlBtn` (a `.v2-lasso-act` button under DELETE/COPY, enabled with a selection) and `#v2PadStl` on the pad: `sel` = `wholePieceEdit(model, lassoSel, 'copy', ...).piece`, `part` = the selected floating piece's soup through `partMatrix()`; both go through `window.__shrinkBuildStl` (zUp) at `mmPerUnit` and `__shrinkCapture`/anchor download as `<name>-piece.stl`. The model is not touched. Test ED48 (`__shrinkEdit.pieceStl`).

(v2.344) Gizmo plane handles: `gizmoBuild` adds three `gizmo-plane-x|y|z` squares (normal = that axis, spanning 0.2R to 0.65R along both in-plane axes; `gizmoPick` uses the same numbers, keep them in step); `gizmoPick` returns `{kind:'plane', axis}` and `gizmoApply('plane', axis, ...)` moves the part in that world plane (needs the camera not edge-on, |dir . normal| >= 0.15). Floating pieces are `MeshStandardMaterial` 0xa9adb3 (flat shaded) with a back-face outline shell `shrinkPartGlow` (blue 0x2f86ff, orange for cut; parked pieces get one too). `uploadPart(file)` + `#v2UpPart` / `#v2UpPartFile` in `#v2PiecesRow` switch to Paste part and call `loadPartFile`. The gizmo and HUD now show for Select as well (`isPart || isSel`); `editTabChanged()` selects the last waiting piece when a piece tool opens with nothing selected, and `wirePartDrag`'s `act()` accepts parked pieces. Tests ED49, ED39/ED50. Real pointer dragging of the squares, the grey/blue look and the upload file picker are untested in a real browser.

(v2.345) The Paste part tool no longer shows CHOOSE A PART FILE; `#v2EdPartFile` stays as a hidden input (same listener) and `#v2UpPart` (top of the EDIT card, wide dashed button) is the one visible way to upload a part.

(v2.346) `gizmoSize()` is 0.55 x the part's bounding radius (pick and build share it); handles are thin and green (`GZ_COL`). Ghost material 0xc9cacd roughness 0.75 (the model's look), see-through pass only 8-12% opacity, outline shell depth-tested at scale 1.015. Looks untested in a real browser.

(v2.347) Gizmo handles are blue (`GZ_COL`); `gizmoHot({kind, axis})` (set from the pointer-move hover, the drag start and cleared on drag end) paints that handle `GZ_HOT` green through `gizmoPaint`, which `gizmoBuild` also applies so the highlight survives rebuilds while dragging. Test ED51. Real-mouse hover untested in a browser.

(v2.348) A weld stores the piece on the pre-edit snapshot (`snap.userData.shrinkWeld = {part, vals, rot, mode}`); `undoEdit()` pushes it back into `parked`, selects it and switches to Paste part, so undo returns the piece floating. A toast after WELD IT mentions Ctrl/Cmd+Z. Test ED52.

(v2.351) `updateEditPreview()` draws floating pieces even when the EDIT panel is closed (`act = editActive()`; slice/shape previews, gizmo and pad need `act`); `setMainTab('finish')` calls it instead of `removeEditPreview()`. Test ED53.

(v2.352) Lasso/Razor on floating pieces: when `lassoRed` finds nothing on the model, `lassoEnd()` tries `pieceHits(sel)` (every floating piece's soup in WORLD space via `partMatrixOf`, triangle centres projected with `ndcOfWorld(sel.cam)`, point-in-loop, depth layer from `#v2EdDepth`), marks `lassoSel.onPieces`, draws the hits red (`pieceRed`, same `shrinkLassoRed` group) and `lassoApply` calls `pieceLassoApply(op, sel)`: delete / copy / cut rebuild the piece(s) from the world soups (`partFromPoints`, vals computed from the bounding-box centre, rot reset) with no Manifold. Undo pushes `{pieceSnap}` onto `editStack` (`floatSnap`/`floatRestore`); `undoEdit` handles it first. The selected piece after copy/cut is the new bit. Test ED54 (`__shrinkEdit.pieceLasso`). Real-mouse use untested; the 'nearest layer' depth heuristic is a guess for thick pieces.

(v2.353) `ensureLibrary()` adds a `<details id="v2LibInfo">` under `#v2LibRow` and an open `#v2LibInfo2` inside `#v2LibPanel` telling people the library is browser-local only (shared text `LIB_NOTE`). Test ED55.

(v2.354) `openOnPiece(ndc, cam)` + two capture listeners in `wirePartDrag` (pointerdown/up, only while `!editActive()`, < 5 px movement): a click on the selected piece (`ghostHit`) or a waiting one (`parkedAt` + `takeParked`) sets `#v2EdTab` to select and calls `setMainTab('edit')`. `updateEditPreview()` wires it whenever pieces float. Test ED56 (`__shrinkEdit.openOn`). Real-mouse click untested.

(v2.355) `deselectPiece()` parks the selected piece (`editPart = null`); `wirePartDrag` notes a background pointerdown (target `#viewer` or its canvas, no gizmo/ghost/parked hit) and deselects on pointerup under 5 px movement while a piece tool is active. Test ED57 (`__shrinkEdit.deselect`). Real-mouse click untested.

(v2.356) `scheduleOverlap()` no longer debounces while `partDrag` is set: it runs `overlapUpdate()` at most every 50 ms (plus a trailing run) and leaves the old red on screen until the new one replaces it. Cost grows with the piece's triangles (capped at 200k per pass) and the model grid is cached, but a very heavy piece on a big model is untested in a real browser. Test ED58 (`__shrinkEdit.dragging`).

(v2.357) Per-piece stretch: `vals.SX/SY/SZ` (percent, inputs `#v2EdPartSX/SY/SZ`, default 100 via `valsDef`) scale the part in its OWN axes inside `partMatrixOf` (compose T·R·S, so no shear). The gizmo gets three `gizmo-scale-x|y|z` cubes at `-SC_AT * R` (1.3) along the part's local axes (`localAxis(m, i)`); `gizmoPick` tests them first, `gizmoApply('scale', axis, ...)` multiplies by the ratio of the pointer's distance along -u (0.5..2 per move, 5..2000 %). `gizmoSize` now uses the height scale only so handles do not grow while stretching. The library bakes the stretch into the saved soup. Ghost colour is 0xc9cacd lerped 10 % toward 0x36d88a. Tests ED59, ED49/ED60. Real-mouse feel untested.

(v2.358) Undo: `undoPush(entry)` is the only way onto `editStack` (max `UNDO_MAX` 50 entries; whole-model snapshots limited to `floor(UNDO_TRIS = 8e6 / triangles)`, min 3). Piece transforms push `{pieceSnap, sig, kind, t}` through `noteTransform(kind)` at the START of a gesture (gizmo/ghost drag in `wirePartDrag`, `partScale`, `partTurnWorld`, `partPlace`; typed values via a focus snapshot + `change` listener on the `#v2EdPart*` inputs); `pruneNoopTransform()` drops a drag that changed nothing; same-kind scale/turn/place within 700 ms coalesce. Any new piece-moving code must call `noteTransform`. Keypad 0 (`e.code === 'Numpad0'`, EDIT open, not typing) = `centreViewOnPiece()` (pans camera + OrbitControls target to the selected piece centre). Tests ED61; ED18/ED32 now count `modelDepth()`. Real-mouse undo of a drag and the keypad key are untested in a browser.

(v2.359) Deselect rework: a dedicated capture pointerdown/up pair in `wirePartDrag` (`bg`) deselects on a < 5 px click when the Select / Paste part tool is active, a piece is selected, the target is not inside `button,input,select,textarea,a,label,summary,#v2PartHud,#v2PartPad,#v2EdToast`, and gizmo/ghost/parked all miss. Esc (EDIT open, piece tool, a piece selected, not typing) calls `deselectPiece()` before the old Esc = tool 'none' rule. Real-mouse still untested in a browser (jsdom drives `__shrinkEdit.deselect` and a real Esc key event).

(v2.360) FILL (paint bucket) tool: `fill-core.js` (no DOM; `openLoops` traces boundary loops over welded vertex ids, `fillOpenEdges` caps each loop flat by ear clipping on the Newell plane up to 4000 points, otherwise a fan to the loop centre; `openEdgeSegments` for drawing) imported by `fuse-export.js` as `fill-core.js?v=2.360` (bump that key when fill-core changes; the test harness copies it too). `fuse-export.js` `fillModel(model, {point?})` / `openEdgesOfModel(model)` work on `gatherWorld` and return a new single-mesh root like FIX IT (materials flattened, world transform baked). `print-v2-ui.js`: tool value `fill` (`#v2EdFillBox`, `#v2FillAllBtn`), `fillNow(point)` (undo snapshot, `installWorkingResult(.., 'edit')`), red `shrinkFillLines` group (`fillLinesUpdate`/`removeFillLines`, refreshed on tool open, after a fill, after undo/redo), `wireFill()` click = pointerdown/up under 5 px, `sculptPick` hit point picks the nearest loop. Limit `SCULPT_MAX_TRIANGLES`. Not covered: floating pieces, loops that pinch themselves, smooth/domed caps. Tests `fill.test.mjs` (F1-F13), ED62.
REDO: `redoStack` (cleared by every `undoPush` unless `inRedo`, by reset and on `shrink:model-opened`). `undoEdit` pushes the state it leaves (`{pieceSnap}` or `{model: clone with userData.shrinkFloat, wd}`); `redoEdit` swaps back, re-pushing an undo entry (weld info `shrinkWeld` carried so UNDO after REDO floats the piece again). Button `#v2EdRedo`, keys Ctrl/Cmd+Shift+Z and Ctrl+Y. Tests ED64.
Floating pieces are solid (the `shrinkPartGhostSee` pass was removed); the red overlap group is the only see-through marker. ED31/ED63.

(v2.361) Esc in the EDIT panel, in order: clear lasso, deselect piece, tool -> none, then `setMainTab('finish')` (closes the panel). `E` (no modifiers, not in an input, panel closed) clicks `#v2TabEdit`. Test ED65. Floating pieces are NOT part of the working model until welded: DOWNLOAD ignores them; AUTO-SHRINK (v2.362) first calls `weldEverything()` (selects the piece tool, welds each piece via `editModelNow`, reports failures). Esc deselects a selected piece with any tool, editor open or closed. (v2.363) `download()` is async and calls `weldEverything()` first; ghost tint and outline shell only when `editActive()`. (v2.366) `weldEverything()` forces JOIN for every piece (counts `weldCuts`). (v2.369) `setPart()` resets the Join/Cut switch to join for every new piece, and project load ignores a saved cut. Test ED66.

(v2.369) `#v2PartPad` is buttons only (title "Floating part"): WELD IT, COPY PART, DOWNLOAD PART, `#v2PadUpload` (clicks `#v2UpPartFile`), DELETE PART, WELD ALL. CSS hides `.v2-pad-row`, `.v2-pad-tilt`, `#v2PadStep` and the `#v2EdPartBox` Exact numbers; the elements stay for tests. The `shrinkPartGlow` outline is drawn always (blue join, orange cut), the grey body tint stays editor-only.

(v2.369) `shrinkPartGlow` outline colours are 0x3daeff (join) / 0xffc83d (cut), 30% brighter than the old 0x2f86ff / 0xff9a2f.

(v2.370) `gizmoApply(kind, axis, from, to, cam, drag, snap)`: for rings, `drag` (the `partDrag` object) accumulates `rawAng`/`doneAng`; with `snap` (Shift held) the applied turn is `round(raw / 90deg) * 90deg`. `dupPart()` and the lasso COPY no longer offset the new piece: it starts in the same place as the original. Test ED67; ED31 now expects x = 0.

(v2.372) `centreViewOnPiece()` runs on `Digit0` as well as `Numpad0` and sets the camera distance to 3.2 x the piece radius (perspective only).

(v2.373) Shape tool: `editModelNow()` calls `makeShapePiece()` first, which builds a unit soup (`shapeSoup`: box / sphere / cylinder / cone, 1 unit tall), makes it a floating piece (`part.isShape`), sets `#v2EdPartH` = the H box, `#v2EdPartSX/SZ` = W/H and D/H in %, the position from `#v2EdX/Y/Z`, keeps the chosen Join/Cut mode and switches to Select (gizmo). `weldEverything2()` does not force JOIN on `isShape` pieces, so a cut shape stays a cut. The old direct shape path (`shapeSpec()` into `editModel`) is no longer reached from the button. Test ED68; ED3/ED25 click the button twice (float, then weld), and ED6 discards the shape that UNDO floats back.

(v2.374) `#v2PadBoole` = `booleNow()`: forces the Cut mode, then `editModelNow()`, so the selected floating piece is subtracted from the model. Test ED69 (`__shrinkEdit.boole`).

(v2.375) `#v2PadAll` (WELD ALL (N), same row as WELD IT, shown while `parked.length`) calls `weldAllButton()`: `weldEverything()`, then `fuseCheck()` so the model ends as one piece, then a toast (`one` read from `#v2FuseCard` `data-state === 'good'`). The older `weldAll()` loop stays for tests. Test ED70 (`__shrinkEdit.weldAllBtn`). The button only shows while a piece is selected; with nothing selected the pad is hidden.

(v2.376) Tab / Shift+Tab (EDIT open, not typing, a piece floats) call `cyclePiece(dir)`: forward = `takeParked(0)` (the selected piece goes to the end of `parked`, so the order is stable); backward re-orders `parked` so the previous piece is selected and the order stays the same. Switches to the Select tool if a non-piece tool is active. Test ED71 (`__shrinkEdit.cycle/selName`). Real-browser focus behaviour of Tab is untested.

(v2.377) A click on a `.v2-icon-btn[data-ed=kind]` while the Shape tool is active calls `addShapeFromIcon()`: sets W/H/D to 25% of the model's biggest side, X to the right of the model, Y on the ground, then `makeShapePiece()`. Test ED72 (`__shrinkEdit.addShape`).

(v2.378) `applyDetailValue` revert path: before switching to `app().originalModel` it records the working model's world box; after the rebase it applies `poseD` to the new `engine.root` and moves it back to the old box (bottom + centre). Real reducer path untested in a browser (jsdom has no live reducer).

(v2.379) FILL INSIDE: `edit-core.js` `fillPocket(M, CS, solid, point)` rotates the solid so world Y is Manifold Z, slices up and down from the click, follows the hole outline (negative-area ring containing or within 2% of the point, smallest wins) while it stays enclosed, extrudes it slab by slab, unions, drops zero-volume slivers. `fuse-export.js` `editModel(model, {pocket:{point}})`; `print-v2-ui.js` `fillInsideNow(point)`, tick box `#v2FillInside` in the Fill box (`__shrinkEdit.fillInside`). Tests EP1-EP4 in `edit.test.mjs`. Stair-stepped slabs (160 per side): a strongly tapered cup may keep tiny gaps. Real-browser click untested.

(v2.380) `shrinkMyModel()` no longer calls `faceFront()`; the camera is left alone (`centreOnBed` still shifts camera + target with the model, but levelling's turn does not move the camera). Key 0: `faceFront()` (whole-model front view) unless a floating piece is selected in EDIT (then `centreViewOnPiece`); a separate keydown listener handles 0 when the EDIT panel is closed. `__shrinkPlatePreview` (BATCH row) still frames. Real-browser untested.

(v2.381) `toolbarize()` (print-v2-ui.js, `window.__shrinkToolbarize`, idempotent, called from `ensureMagicButton`, the EDIT-toggle block and by timers) moves `#v2MagicBtn`, `#v2MagicDownload`, `#v2SideGlb`, `.v2-side-height` and `.v2-auto-hollow` from `#v2SideStack` into `.viewer-toolbar .viewer-actions` after ADVANCED / EDIT (CSS block at the end of print-v2-ui.css: 140x38 px buttons), and `#v2ReduceNote` + `#v2WorkflowStatus` into `#v2HealthCard`. `#v2SideStack` stays in the DOM (hidden when empty). `placeHeightBox()` must cope with `#v2MagicBtn` no longer being a child of the stack. Real-browser layout (row wrapping on narrow windows, the Other formats drop-down) untested.

(v2.382) `updateWorkflowButtons()`: `#v2MagicDownload` / `#v2DownloadBtn` are enabled whenever a model is loaded and no job / detail preview is running (no longer tied to `autoReady`; the status line says it can be downloaded as it is). `toolbarize()` puts the `.v2-auto-hollow` tick box into a `<details id="v2Extras">` "Extras" drop-down on the toolbar; `#v2ResizeBtn` stays in `.v2-main-size` (ADVANCED), only the Finished height row goes to the toolbar. Tests C8, HU10, HU14, HU15 updated. Real-browser layout untested.

(v2.383) `toolbarize()` now moves only `#v2MagicBtn` + `#v2MagicDownload` to the toolbar; `#v2SideGlb` (Other formats) and `.v2-auto-hollow` go into `.v2-main-extras` at the end of `.v2-main-controls` (ADVANCED left column). `placeHeightBox()` is a no-op: the Finished height row stays in `.v2-main-size` with RESIZE. No `#v2Extras` drop-down any more. Tests HU10/HU14 updated. Real-browser layout untested.

(v2.405-v2.406) Solid cut and Text tool. Handoff for whoever works on this next (ChatGPT or Claude).
- Goal (Tim): place a floating block (any tilt) over part of a figure's base, CUT PART OUT / BOOLE, and get a clean cut whose new face is SOLID: no hollow showing behind it, no jagged lip. His test model is a resin diorama of 6 figures on a base (~1.9M triangles). The base is a hollow shell, apparently with drain holes (the cavity connects to the outside), and it is not watertight until FIX IT.
- Open model (health not clean): `surfaceCutByPart` (print-v2-ui.js, v2.404) skips Manifold and deletes every triangle whose centre is inside the block (`wholePieceEdit`). It leaves an open edge, and big triangles that straddle the block survive and look like spikes/webs. Tested only for "remaining triangles unchanged" (ED78b). Idea not built: CUT PART OUT runs FIX IT first and refuses if the model still is not watertight.
- Closed model: `fuse-export.js` `editModel` -> `plugCavities(M, CS, solid, cutter, margin, 48, true)` (edit-core.js) BEFORE `applySolid(... 'cut')`. It rotates so world Y is Manifold Z, slices, takes void outlines (negative-area rings), offsets them a little, intersects with the cutter's shadow (`project()` offset by margin = a quarter of the cutter's size when `full`), extrudes slabs, reaches one step past the first/last slice that has a hollow (otherwise a thin air crack stays open at the floor/ceiling), unions with the model and keeps enclosed voids (negative volume must NOT be dropped by the dust filter). `full` = all the way up the model (v2.406; v2.405 only covered the cutter's own height and left a paper-thin terrain lip above a tilted cut). Result note says when it plugged. Tests SC1-SC8 (edit.test.mjs): synthetic hollow disc with a drain hole, volume matches the exact plug within 3%, genus unchanged.
- Not verified on the real model after v2.405: the full-height plug. Risks: slab stair-steps (48) may leave thin cracks in deep or strongly tapered hollows; ~100 slices of a million-triangle model run on the main thread (not timed); slicing can freeze the tab. Alternative worth trying: cap the exposed hollow straight on the cut surface (fill-core `fillOpenEdges` on the cut loops, or `fillPocket`) instead of slicing.
- TEXT tool (v2.406): EDIT > Text (`#v2EdTextBox`, `#v2TextStr/Font/Bold/Size/Depth`, `#v2TextAdd`). `textBits` draws the words on a canvas (`window.__shrinkTextBits` overrides it in tests), `text-core.js` `bitmapToShapes` traces outlines (marching squares on edge midpoints so outlines never touch, Douglas-Peucker 0.8 px) with holes, `textSoup` extrudes them with three.js `ExtrudeGeometry` (font size = 1 unit, thickness = depthMm/sizeMm) into a floating piece (`part.textMeta`, `part.isShape = true` so a CUT text stays an engraving). While a text piece is selected the same box edits it: `rebuildText()` replaces `editPart` with a NEW object (so UNDO still holds the old words) and keeps its place; `syncTextBox()` runs from `updatePad()`/`editTabChanged()` and never overwrites a focused field. `text-core.js` is loaded by ui-mode.js into `window.__shrinkTextCore`. Do not give the ADD button the class `v2-lasso-act` (`lassoBarState` disables every such button). (v2.407) JOIN of any floating piece on a model Manifold rejects (or known not clean) goes through `surfaceJoinByPart` in print-v2-ui.js: the piece is added to a clone of the model as a separate closed mesh (world space), ED80. Tests text.test.mjs T1-T6, ED79. Real canvas text checked in headless Chromium (Hello / Tim 2026 / OBOE give the right holes); not tested: the tool in the live page, Manifold welding of real letters, curly fonts at small sizes.

### CLAY / Brush (v2.141; switched off in v2.173; back on in v2.308 as the Brush tool in the EDIT tab, chip BRUSH)
`clay.js` (ES module, loaded by `ui-mode.js`; card built into `#v2ClayHost`, which `print-v2-ui.js` puts above the Advanced drawer) + `clay-core.js` (no DOM, no three.js: icosphere, `dabSoup`, `dabsAlong`, `thin`, `joinSoups`). Strokes are lists of world-space balls `{x,y,z,r}` kept in `window.__shrinkClay` (`hasClay`, `apply`, `finish`, `addStroke` for tests). The preview is two `InstancedMesh`es in a `shrinkClay` scene group (pink = add, orange = cut); they ignore raycasts. Painting raycasts the working model; Ctrl/Cmd+drag rotates, Esc leaves the tool, as the other brushes do. `fixHealthModel()` calls `__shrinkClay.apply(model)` instead of the gentle repair when clay exists, and `shrinkMyModel()` no longer skips the fix step when clay is present. `apply()`: route A = `modelToSolid` (exact Manifold union/difference, keeps all detail); route B (Manifold rejects a leaky mesh, e.g. piece_55) = add balls to the triangle soup and run `makeWatertight` (balanced, then fast; `high` pinches), then subtract cuts with Manifold. The result must pass `healthOfModel` or nothing is installed. Ball count is thinned and coarsened (`ballLevel`) because the wrap refuses above 1.5M triangles. Tests: `tests/clay.test.mjs`.

### QUICK-FIX order (v2.147)
`shrinkMyModel()` repairs FIRST when the model has at most `FIX_FIRST_MAX` (600,000) triangles (repair runs on the main thread), then shrinks, then repairs again only if still unhealthy, then fuses, levels and centres. Reason: shrinking a leaky mesh bakes the leaks into a coarse mesh that repair cannot close. `repairMesh` step 5 is now `fillHoles(false)` (boundary followed in triangle direction) and, if edges are still open, `fillHoles(true)` (undirected tracing, cap turned to match the neighbouring triangle), kept only if `open+tangled+flipped` goes down. (v2.149) The top-right button `#v2MagicReset` is now **RELOAD**: it just opens `#fileInput` to load a different model; the old revert-to-original code (`resetModel`, `initialBytes`) was removed. The repair graph cache key is **2.196** now (v2.196).

### QUICK-FIX verdict and fuse step-down (v2.186)
(v2.253) `alreadyOne` in `shrinkMyModel()`: one piece, healthy (minor), no open edges and Manifold refused the fuse = "ONE SOLID PIECE (nothing to fuse)", `verdict.fused` true, the step row is green. The Fuse card itself still shows the refusal; the chip stays unfused. (v2.251/v2.252) The fix step after shrinking retries up to two more passes while health < 100 and improving; BATCH waits for `__shrinkHealthIsCurrent()` before pressing QUICK-FIX.
`shrinkMyModel()` step 1b: if the shrunk model is still over `FUSE_MAX_TRIANGLES` it calls `setQuality()` down the ladder ultra, fine, standard, large (only levels that exist in `PRINTER_LIST` for the printer type) and `shrinkModel()` again until it fits; the dropdown/tag keep the level really used and `localStorage['shrink-printer']` is put back to the person's own choice. `countPieces()` (welded world positions, union-find, skipped above 1.5M triangles) fills a **Pieces** row in the health box (`#v2HealthRows[data-pieces]`, `strong.note` amber, never `.issue`, so score and BATCH issue lists ignore it). The final verdict is in `window.__shrinkLastVerdict` `{healthy, pieces, fused, text}`; BATCH reads it and flags N>1 pieces.

### BATCH (v2.151)
(v2.247) Footer link `#shrinkDiagLink` (ui-mode.js) shows `__shrinkDiagReport()` + `__shrinkSnap()` + the batch report in one overlay (`#shrinkDiagBox`). (v2.245) Secret diagnostic: Shift-click the BATCH title (`showReport()`, `__shrinkBatch.report()`); each finished item stores `item.diag` built from `window.__shrinkSnap()` (print-v2-ui.js) plus file bytes and seconds.
`batch.js` (ES module, loaded by `ui-mode.js`; the only button is BATCH UPLOAD on the start screen (the v2.180 top-bar `#v2BatchTop` was removed in v2.238; the load-screen button `#v2BatchHome` was removed in v2.184 and came back in v2.212 as the plainer BATCH UPLOAD under the drop zone), panel `#v2BatchPanel`, `window.__shrinkBatch`). For each queued file it calls `__shrinkApp.openFile`, waits for the QUICK-FIX button (`data-state="ready"`), clicks it, waits until `data-busy` clears, then clicks DOWNLOAD with `window.__shrinkCapture` set. **Every `saveBlob` must call `window.__shrinkCapture?.(blob, filename)` first** (print-tools, fuse-export, split-print, split-fallback do); a new exporter that saves on its own would bypass the batch. Memory bar = `estimate()`: biggest file x12 plus finished results, against `performance.memory.jsHeapSizeLimit` (Chrome) or deviceMemory x 0.5. (v2.154) The panel has its own Printer + Height; `applySettings()` clicks the print dashboard's `[data-printer]`/`[data-quality]` buttons and sets `#v2Height` for every file (always scope to `.print-v2-dashboard`: another `data-quality` element appears after a second open). These factors are rough guesses, tune them with real runs. Tests: `tests/clay.test.mjs` (B1-B4, with the real work stubbed through `__shrinkBatch.deps`).

### QUICK-FIX button state (v2.149)
`quickState()` in `print-v2-ui.js` sets `#v2MagicBtn[data-state]` (`checking` = grey and disabled, like DOWNLOAD; `ready` = green) from `updateHealthCard()`. BATCH waits for `ready`. (v2.304) `firstHealthDone`: grey from `shrink:model-opened` until the first check AND `countPieces` finish; later re-checks never go back to `checking`.

### 16K ultra (v2.150, default since v2.159)
The printer type + quality are saved in `localStorage['shrink-printer']` (`savePrinter()`/`savedPrinter()` in `print-v2-ui.js`; BATCH reads the same key) and restored when the dashboard is built; with nothing saved the default is resin + `ultra`. `setQuality('ultra')`: detail 0.018 mm for resin and `window.__shrinkStrict='p995'`; Standard/Fine/Large put it back to default. (v2.166) The visible control is one `#v2PrinterSel` dropdown built from `window.__shrinkPrinterList` (BATCH reads the same list); the old `[data-printer]`/`[data-quality]` buttons stay in a hidden block so code and tests can still click them. `downloadStem()` builds the export name (v2.266): `<name>-SHRINK` only after SHRINK, then `-<height>mm` (the older -16K/-FIXED/-FUSED parts were dropped).

### Viewer lighting (v2.145)
`syncViewerEnvironment()` in `app.js` sets print mode to low hemisphere/fill light plus a strong `key` lamp with `castShadow` (game mode keeps the old gentle lamps and no shadows). `fitShadows()` runs each frame: it flags the original/optimized/current model meshes `castShadow`/`receiveShadow` and, every 20 frames, refits the key lamp and its orthographic shadow camera around the shown model (bounding sphere), so a moved or replaced model keeps good shadows. New meshes added to the scene need nothing extra unless they should not cast shadows (guide/clay groups are not flagged).

### TURN pad (v2.161; hidden by CSS since v2.181)
`turnModel(axis, deg)` / `ensureTurnPad()` in `print-v2-ui.js` (`#v2TurnPad`, built from `updateHealthCard()`, `window.__shrinkTurn`): rotates the working root about its centre through `rotateAboutCentre` (so `notePose`/Compare follow), refuses when the root is stretched (non-uniform scale would shear), then `centreOnBed()` and the bed guide. Tests: T1 in `tests/clay.test.mjs`.

### Compare pose (v2.143)
The levelling, centring and stretch tools move the working model root, never the original. `notePose()` in `print-v2-ui.js` records each change in `poseD`; `window.__shrinkComparePose()` returns it (null when nothing moved); `app.js` `enterCompare()` applies it to `originalModel` and `leaveCompare()` restores the saved position/quaternion/scale. Any new tool that moves or turns the working root must go through `moveWorld`/`rotateAboutCentre`/`notePose`. `poseD` resets on `shrink:model-opened`.

### Uniform / Width / Depth (v2.140)
(v2.274, Tim: remember this) A model that reads under 30 mm tall is set to 30 mm on open (`fitHeightToModel()`); 30 mm and taller keep their own height; over 500 keeps the default. (v2.279) Typing or dragging the Height makes `#v2ResizeBtn` glow (`.glow`) until it is pressed.
Width/Depth read-outs come from `modelSize()` (precise world box of the working model; cached on uuid + `reducedTick` + matrixWorld). With `#v2Uniform` ticked they just set the Height (everything scales together via `mmPerUnit`). Unticked, they call `applyStretch(fx, fz)`: stretch lives on the working root's `scale` in WORLD axes, so `normalizeRoot()` first moves any root rotation into an inner `shrinkInner` group (root keeps identity rotation, so no shear). Factors are in `model.userData.shrinkStretch`. FIX/FUSE bake the world transform into a new root, so the stretch is then baked in and the factors read 1. `levelModel()` must run on an unstretched root (`resetStretch()` first). `window.__shrinkStretchTick` invalidates split-print's auto-cut signature.

### Hidden tabs and busy buttons (v2.255)
Never `await requestAnimationFrame` alone in a processing path: a hidden or covered tab stops sending frames and the job freezes. Use the frame-or-60 ms race (`paintNow` in print-v2-ui.js). While any job runs, `setWorking()` puts `data-v2-work` on `<body>` and the last rule in print-v2-ui.css holds the big buttons grey; do not re-enable them from other code to fix a flicker. Timers still slow down in a hidden tab (Chrome clamps to about 1 s, and further after 5 minutes), workers do not.

### Tests
`cd tests && npm install && npm test`. `multitool.test.mjs` clicks the real DOWNLOAD IT / FUSE IT / Make watertight buttons on a jsdom page that loads the real modules and the real Manifold library (`mt-harness.mjs`). If you change split, fuse, working-model or watertight code, run it and add a case for what you changed.

## Still-true rules from the Simple-wizard era
### Mesh health: one definition
`repair-core.js` owns it via `meshHealth`. Preflight, post-reduction guard and repair results must all use that definition.

Clean = no open edges, no tangled (3+) edges, no flipped edges. Empty/degenerate triangles are reported but do not block the Simple workflow.

Do not reintroduce a second topology check with a different weld tolerance. Heavy repair/health work runs in `repair-worker.js` where supported. The repair graph (`repair-core.js`, `repair-worker.js`, `solid-rebuild.js`) uses cache key **2.196** (bumped in v2.196 with the extra untangle round), independently of the v2.18 engine graph.


- Internal STL reopen rule: SHRINK stores print geometry Y-up internally but STL import assumes Z-up. Any repaired/rebuilt model exported only for SHRINK to reopen must use `buildBinaryStl(... zUp:true)`.
- Preserve view state across internal model replacement/reopen: camera position, OrbitControls target, up/zoom/near/far.
- Model display should be idempotent when the requested model is already shown.
- The Duric dwarf sculpt (~1M triangles) is the stress test for repair, shrink, shading and responsiveness.

(Everything else from the old Simple wizard, the v2.31–v2.36 layout notes and the Racer preset is in `ARCHIVE.md`. Those files were deleted in v2.239 and live on in git history.)

## Product direction

SHRINK 3D has two distinct jobs:

### Game model
Optimise GLB game assets: geometry, textures and file size.

### 3D print / modelling
The flow is the multitool described above (check/repair, shrink, fuse, download, in any order). The product message is:

**Repair it. Reduce it. Print it.**

Do not force home users to understand Boolean union, manifold status, voxel grids, peg tolerances or Meshopt unless they open **ADVANCED**.

## Performance philosophy

Browser responsiveness matters more than squeezing out the last few percent of triangles.

Avoid:
- long chains of repeated solid checks
- repeated BVH/detail scans when one conservative target is sufficient
- main-thread remesh work on very dense models
- broad MutationObservers watching the entire document unnecessarily
- automatically retrying many heavy candidate reductions

Prefer:
- one sensible reduction
- one cheap topology verification
- one safer fallback
- workers for heavy rebuilds
- yielding to the UI before expensive work
- keeping more triangles when that produces a reliable result quickly

A reduction from 1,000,000 triangles to 300,000 that stays clean is a success. Do not spend 40 seconds proving that 160,000 might also work.

## Game viewer layout
- The navigation hint (**Drag to rotate · Scroll to zoom · Right-drag to pan**) belongs inside the 3D viewer canvas.
- (v2.80) The big red **Find the smallest…** button under the viewer was removed on purpose; the button in the left panel was the only one. (v2.118) That left-panel button (`#autoBtn`) is now hidden in Game mode too (CSS `:has`); it stays in the DOM because print mode's SHRINK IT clicks it (`print-v2-ui.js` `shrinkModel`). Do not remove the element.
- (v2.83) The Game viewer height rule lives in `ui-mode.css` (an older `!important` rule there beat the one in `style.css`). The user explicitly asked for the drag handle along the viewer's bottom edge (`viewer-auto-button.js`), so it is allowed; it keeps no saved state. Change a style sheet, bump its `?v=` in `index.html`.
- (v2.80) In Game mode on desktop the viewer panel is `calc(100vh - 36px)` tall and sticky. Brush size / Opacity / Stamp options live in the `.tool-options` strip under the viewer toolbar (built in `paint3d.js`), not floating over the model.

## Viewer/UI rules

- Before reduction, do **not** show Original/Reduced controls because there is no meaningful reduced result yet.
- After a real reduction completes, Original/Reduced and Compare can appear.
- Reduced print preview normals must be recomputed after connectivity changes so the model does not appear artificially dark.
- Once a model is loaded on desktop, the header/branding should collapse to reclaim height.
- Avoid large dead vertical gaps.
- (v2.158) Phones and tablets are blocked by a full-screen message from `mobile-warning.js` (no dismiss). It is a deliberate product decision by Tim; do not make it dismissible without asking.

## Important files

### Print multitool (loaded by `ui-mode.js`)
- `print-v2-ui.js` + `print-v2-ui.css` (the visible tools, working model, health card)
- `print-export-safety.js` (red diagnostic panel, Make watertight, safe export fallbacks; loads fuse/split helpers)
- `fuse-export.js`, `split-print.js`, `split-fallback.js`, `raw-split.js`, `watertight-remesh.js`

### Print geometry / repair
- `repair-core.js`
- `repair-worker.js`
- `solid-core.js`
- `solid-rebuild.js`
- `remesh-worker.js`
- `fuse-export.js`
- `split-print.js`
- `print-export-safety.js`
- `mesh-tools.js`

### Core/app
- `app.js`
- `live-ui.js`
- `reduce-core.js`
- `live-reduce.js`
- `live-worker.js`
- `ui-mode.js`
- `index.html`

## Versioning rule

This repository has previously suffered from stale/mixed cache versions.

Before editing:
1. Fetch the current file from `main`.
2. Use its current SHA.
3. Do not overwrite unseen recent changes.
4. Check whether another contributor has changed the same module.

When making a user-facing release:
- bump the visible app badge
- bump the Simple workflow/cache key that actually changed
- do not retag random v2.18 core modules one by one
- if the core engine graph itself changes, bump its interconnected imports/version constants together

Do not let helper modules overwrite the visible app version badge. The page/release layer owns the displayed release number.

## Collaboration / handoff rule

Tim switches between ChatGPT and Claude.

Before changing code:
- inspect current `main`
- read `CLAUDE.md`
- read `CHANGELOG.md`
- read the current `README.md`
- do not assume the repo still matches a previous conversation
- preserve newer work unless deliberately replacing it

After meaningful changes:
- add a clear commit message
- update `CHANGELOG.md`
- update this file only when architecture, workflow rules or handoff rules change
- mention the new visible version in `README.md`

## Current open design question

The existing print reduction still ultimately relies on the Meshopt/live reduction machinery inherited from the game-oriented engine.

Longer term, it may be worth testing a topology/manifold-preserving reducer specifically for print models.

Do **not** replace the current reducer casually. First prove that the v2.25 conservative Simple workflow is still insufficient, then prototype a print-specific reducer in isolation.

## Split pegs (v2.71)
- `split-print.js` owns the preview AND the export's peg choice: the file uses the pegs the preview shows (`previewPegsFor`), minus any marked `bad`. Do not add a second placement algorithm.
- A peg is judged by the worst cross-section down its whole depth (`worstClearance`), not by the cut face alone. Statuses: ok / warn / bad (`assessPeg`).
- Cut outlines must go through `cutLoopsFromModel` / `cutLoopsFromSolid` (they step off vertex rings with `CUT_NUDGES`). Never slice at an exact height without that.
- Manual pegs may sit anywhere on material so problems are visible; export skips red pegs and says so.
- Cross-sections go through `buildSlicer()` (one pass, height bins); pass the slicer along instead of re-walking the mesh. Long searches must `await` between steps.
- `split-print.js` must stay safe against being loaded twice (`DUPLICATE_LOAD`).
- Game-mode material tweaks go through `material-look.js` (`__shrinkMaterial`): scale from `userData._shrinkOrigMetal`, never from the current value; the same factor is applied to the glTF-Transform document at export.
- Dropped maps (metallic/roughness, AO) are a preview + export option in `material-look.js` only; original maps are kept in a `WeakMap`, never in `userData` (material.clone() would copy textures through it).

## Wheel splitter (v2.90)
- Game mode only. Tim's "Car wheels" panel (`wheel-split.js`, default ON and open since v2.98) sets `window.__shrinkWheels.enabled`; `app.js` calls `__shrinkWheels.apply(document)` in `optimizeModel()` after simplify and before `prune()`/meshopt/quantize, and in `downloadEdited()`. The cutting is `wheel-split-core.js` (no DOM; tested in Node by `wheel-split.test.mjs` with a real glTF-Transform Document).
- It works on the saved document, so the original material, textures, PBR maps, normals and UVs go with the triangles. The live preview still shows the reduced model without separate wheels: do not swap the preview to show them (it fights the live reducer). Check the saved GLB instead.
- Wheels are found as circles in the side view (both axles share one radius), the tyre width is measured at the ground contact so spats/arch panels stay on the body, and the front is the side opposite the cabin's middle (`cabinMid`, percentile-based so it does not depend on triangle density; an earlier "median of top vertices" version flipped on reduced meshes).
- `adj.layout` is `'4'` (default), `'3'` (single wheel on the middle line at the front + rear pair, nodes `Wheel_F`, `Wheel_RL`, `Wheel_RR`; front = the single wheel's end, not the cabin guess) `'2'` (one axle anywhere along the body, `Wheel_L`/`Wheel_R`, role 'front' so the Front sliders drive it; for a caravan/trailer) or `'auto'` (4, then 3, then 2). `layout3` is only unit-tested on a synthetic trike so far.
- Output: nodes `Wheel_FL/FR/RL/RR` at the scene root, translation = wheel centre in world space, geometry recentred on it, `extras = { wheel, axle ('z' when the car's length is along X, else 'x'), radius, width }`. A failure leaves the model untouched and says why in `#wheelSplitNote`.
- `splitWheels(doc, adj)` takes manual nudges (`front`, `rear`, `dyFront`, `dyRear`, per-wheel `dyW` in tyre radii, `sizeFront`/`sizeRear` (wheel scale per axle; the older single `size` multiplies both), `size` factor, `widthFront`/`widthRear` factors, `shiftFront`/`shiftRear` (sideways, + = car's right) and `trackFront`/`trackRear` (axle width, + = outward; the older single `track` is still honoured); each wheel keeps its own centre `cx`,`cy`) from the panel sliders (`__shrinkWheels.adj`); the result remembers the `adj` it used so the markers can move live by the difference. Markers are depth-tested on purpose.
- (v2.101) `fitAxle` searches axle centres 0.10–0.45 body-lengths out and is tried *grounded* first (tyre bottom within −0.02…+0.035 L of the lowest point), then free. Ring-density scoring is fragile on sparse tyre meshes / twin tyres (motorhome); lower-half-only and inner-band scoring were tried and were worse on the Dodge, so do not retry them without all of mini + dodge + motorhome to compare.
- (v2.104) `splitWheels` first classifies each triangle by centroid, then gives every connected piece of the mesh (welded by position, `det.length * 2e-4`) that is >= 50% inside one wheel's zone to that wheel completely. Welded-to-body wheels (one huge component) still get the per-triangle cut. A wheel with hand-set width (`wf !== 1`) is excluded. Skipped above 800k triangles.
- (v2.120) `refinePivot()` moves each wheel node's pivot to a Kasa circle fit of its outer tread (and mid-width) after the cut, shifting the geometry back; skipped when `adj` has any nudge. The detection zone is still `radius * 1.06`; whole shells are taken regardless of it.
- Real-browser check: `tests/browser/` (`run-wheels.py`).
- Tron (v2.87–v2.89, voxel flattening) was removed in v2.90; it could not represent arches or spats and lost the PBR maps.

## Game flow bar (v2.93)
- `game-flow.js` owns the Game-mode Optimise/Download bar (`#flowBar`, `#flowDownload`). In Game mode `buildAndSave()` in `app.js` does NOT auto-download (`__shrinkGameFlow.active()`); Download is the bar's button (it clicks the hidden `#downloadBtn`). Print mode keeps its old behaviour.
- State is `new | done | stale`, from a signature of the left-panel inputs taken at `shrink:optimized`. If you add a control that changes the saved file, make sure it is an input/select in `.control-panel` (or add it to `signature()`); mirrors of other controls go in `SKIP`.
- `app.js` writes the button text after a build from `dataset.label`, so `game-flow.js` keeps `dataset.label` in step with the state.

## Remove / Weld brush (v2.109, v2.111)
- `remove-part.js` (UI) + `remove-part-core.js` (no DOM, tested by `remove-part.test.mjs`). The edit is a **mask (`alive`) over a baseline copy** of the model, read once per opened model (`st.data`, reset on `shrink:model-opened`). Selection lives on the glTF-Transform *document* triangles in world space, never on three.js triangle indices: `ensureBVH` reorders the preview's index buffer. Do not map by three.js index, and never mutate the baseline.
- Cut / weld: `applySelection` flips the mask, then a **fresh** `app.readDoc()` is passed to `rewrite()` (rebuilds the touched primitives from baseline vertex data, matched by path key `meshNodeOrdinal:primIndex`), pruned, written and sent through `app.replaceSource(bytes)` (clears any build, reloads the preview, fires `shrink:texture-applied` + `shrink:source-replaced`). The paint tool answers `texture-applied` by switching Paint on, so `swapIn` sets it back to navigate. Paint edits are applied into the model before the tools start.
- A primitive with no triangles left is kept as one collapsed triangle with `extras.shrinkEmpty`; `stripEmpty()` must run on any document that is exported (Optimise, edited download, Save project) and never on the working copy.
- Undo entries hold `{bytes, masks}`. The tools own the left mouse button while on (viewer capture + stopPropagation); Cmd/Ctrl swaps OrbitControls' LEFT to PAN to rotate, as the paint tools do.

## Settings file (v2.99)
- `settings-file.js` saves/loads the `.control-panel` inputs by element id (so new controls and wheel sliders are included automatically; mirrors and painting tools are in its `SKIP`). Loading only sets values and fires `input`/`change`; it never builds. Target card is clicked first, `geometry` applied last. Paint edits and Look are deliberately not stored. Print-mode state (FUSE IT etc.) is not covered.
- (v2.110) **Save project (GLB)** writes the source GLB (paint applied, Look baked, Remove cuts already in it) with the same settings object in glTF `extras.shrinkProject`. Opening such a file applies it via `projectFromBytes` + the pending path in `settings-file.js`. The wheel split is never baked into the project; `optimizeModel` strips `shrinkProject` from the game GLB.

## Paint tool rules (v2.100)
- `abortStroke()` in `paint3d.js` ends whatever is running (stroke, spray timer, stamp box); `setMode` and Esc call it. Window-level pointerup/cancel/move/blur handlers exist so a lost mouse-up can never leave the brush painting. Do not gate Esc on `state.painting` again.
- Undo/Redo live in `multi-undo.js` (hooked on the full-texture `getImageData` that `paint3d.js` does before each stroke). **Reading the texture canvas with `getImageData(0,0,w,h)` while a paint tool is on counts as a stroke** (tests: use `toDataURL`). Each stroke has a `serial`; the bumps layer swaps its saved region on `shrink:paint-undo` / `shrink:paint-redo` (`swapRegion`).
- Stamp: one paste finishes the stamp (`setMode('navigate')`, patch kept); Shift-click keeps it on. The ghost is hidden unless aiming. (v2.122) Esc in Stamp mode also drops the patch; every ghost unhide goes through `showGhost()`, which refuses unless `state.mode === 'stamp'` (copy/paste are async and can finish after Esc). (v2.123) The ghost is a `<canvas>` inside `.viewer`, and `.viewer canvas{display:block}` beats the `hidden` attribute: it needs its own `[hidden]{display:none!important}` rule. Test visibility with `getComputedStyle(...).display`, not the `hidden` property.
- Recent colours are kept in `localStorage['shrink-paint-colours']` (per browser, try/catch).

## Stamp (v2.79)
- `paint3d.js` owns the Stamp tool; `stamp-core.js` holds the pure maths (patch coordinates, bilinear sampling, edge fade) and is tested by `stamp.test.mjs`. The patch is captured by raycasting the screen and reading the active colour texture, and pasted by raycasting the destination: keep it a screen-space projection, do not turn it into a UV copy.
- 3D painting (Paint, Clone, Stamp) edits the colour texture (`material.map`) and, since v2.82, the normal map too (the `flat` layer in `paint3d.js`: flatten for Paint/Stamp, copy for Clone). The normal map is edited on its own private canvas, handed to Apply through `collectDirtyLayers`, and undone per step via `shrink:paint-undo` events from `multi-undo.js`. Metallic/roughness pictures can still only be edited in the flat editor.

## Centre on ground (v2.128)
- `ground-core.js` `centreOnGround(doc, getBounds)`; `app.js` `optimizeModel` calls it when `#groundToggle` is ticked, AFTER the wheel split (wheels are scene-root nodes and move with the car) and before textures/prune. Game mode only. It only edits scene-root translations, so rotation/scale of the model are never baked: a model that arrives lying on its side or Z-up is not turned upright.

## Add part (v2.112)
- `add-part.js` (UI, TransformControls gizmo on `__shrinkViewer`) + `add-part-core.js` (`mergePart`, no DOM, tested by `add-part.test.mjs`). Commit goes through the source GLB like Remove/Weld: `readDoc` -> `mergePart` (uses `mergeDocuments` from `@gltf-transform/functions`; `Document.merge` is disabled in 4.x) -> prune -> write -> `replaceSource`. Undo uses the Remove undo stack (`__shrinkRemove.noteChange`).
- Added parts go at the END of the main scene under one wrapper node, so Remove/Weld path keys stay valid. `mergePart` folds all accessors into one buffer (GLB allows only one). Added parts are not in the Remove/Weld baseline (they cannot be brushed).
- (v2.114) Added parts can be picked up again: wrapper nodes carry `extras.shrinkPart`; `editAdded()` removes them (recursively disposing, then prune), reloads them as ghosts from the in-session `st.lib` bytes. Not possible after reopening a project (lib is empty).
- (v2.115) Each ghost has `userData.nodeName` (Name box; first = Wheel_FL, mirror = opposite side) used as the merged wrapper's node name. `wheel-split.js` `apply` skips when root nodes are already named Wheel_*. Cancel during `editAdded` undoes the pick-up via `__shrinkRemove.undo()` (`st.editing`).
- (v2.116) `splitWheels` calls `unshareMeshes` first (dedup() in optimizeModel turns identical wheels into one mesh shared by several nodes; a shared mesh used to be skipped). `Mesh.clone()` shares the Primitive objects, so unshare clones the primitives too. Primitives emptied by the cut are disposed with their now-empty nodes.
