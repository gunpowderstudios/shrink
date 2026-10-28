# CLAUDE.md — SHRINK 3D handoff notes

Read this file before changing the repository.

## Current baseline

- Current user-facing release: **v2.196** (see CHANGELOG.md; the multitool core dates from v2.57) (the multitool; see "3D Print multitool" below). Older sections that mention the Simple wizard describe code that still exists in the repo but is **not loaded** by the page since v2.38.
- Default branch: **main**
- The current core engine graph is still **v2.18**.
- v2.19–v2.25 are deliberately layered mainly through Simple-mode workflow/UI files rather than retagging the whole engine graph.
- Current public app: https://gunpowderstudios.github.io/shrink/

## 3D Print multitool (v2.38 onward) — read this before touching print code

`print-v2-ui.js` owns the visible 3D Print interface: printer & size, **FUSE IT**, **SHRINK IT**, **DOWNLOAD IT**, the MODEL HEALTH card with **FIX IT**, and the change chips. The tools are **cumulative and order-free**: each one acts on the *current working model* and its result becomes the new working model. The untouched upload stays in `app().originalModel` for Compare/reset.

### The working model
- `window.__shrinkWorkingModel()` returns it; `window.__shrinkSetWorkingModel(model)` sets it. `sourceModel()` in `fuse-export.js`, `split-print.js`, `split-fallback.js`, `print-export-safety.js` and `print-tools.js` all start from it. **Never read `app().originalModel` or `app().optimizedModel` directly in a print tool.**
- **To make a tool's result the new working model, call `window.__shrinkInstallWorkingModel(root, kind)`** (defined in `print-v2-ui.js`). It does everything in the right order: `setPreview`, `setWorkingModel`, `show('optimized')`, restore the camera, `notifyReduced`, change chip, clear the red warning. FIX IT and Make watertight use it. Do not copy those steps into a new tool. Call `window.__shrinkRefreshHealth()` afterwards if the health card must update at once.
- `setPreview()` disposes the previous preview's geometry. Never keep using a model after it has been passed to `setPreview` as its replacement.

### Split / Fuse rules
- DOWNLOAD IT must **never** switch `fuseSolidToggle` on. Fuse is a deliberate tool (FUSE IT). The legacy Fuse export (`fuse-export.js`) and the split export (`split-print.js`) both intercept `saveStlBtn` in the capture phase and call `stopImmediatePropagation()`, and their order depends on module load order, so the Fuse export steps aside whenever `splitMode !== 'off'`.
- **A model made of several separate closed pieces is valid.** Do not require `components === 1` unless the operation truly needs one connected solid (it does not for splitting or exporting).
- A closed mesh can be inside-out (negative Manifold volume). `fuse-export.js` turns it outward; any new code that builds Manifold solids from meshes must go through `meshToSolid`/`modelToSolid`.
- Pegs are best-effort. If a peg cannot be built the joint stays flat and the status message must say so. Pegs need material on both sides of the cut.
- If the solid split fails, `split-fallback.js` (`raw-split.js`) makes a direct capped split. It must keep working on inside-out input and on cuts that pass exactly through a ring of vertices.
- `syncSplitControls()` runs from a page-wide `MutationObserver`. Anything it does must be idempotent (write only when a value changes) or the page will loop.

### SHRINK keeps a clean model clean (v2.57)
The simplifier can leave a few non-manifold edges on a model of many small pieces. `shrinkModel()` notes whether the working model was clean before it ran (reusing `lastHealth`) and tells the reducer with `window.__shrinkLive.setTidy(wasClean)`. **The repair happens inside `live-reduce.js` `apply()`**, on the reduced indices, before the display geometry is built; it is not a separate model installed afterwards. **Never replace `app().optimizedModel`/the working model with a different object while the Detail kept slider is meant to drive it**: the slider modifies `engine.root` in place, so the model on screen must stay `engine.root` (v2.56 broke exactly this). If another tool (FIX IT, FUSE IT, Make watertight) installs a new working model, the next slider move re-bases the reducer on it (`__shrinkLiveUI.rebaseWorking`) first. A model that was already unhealthy is never repaired behind the person's back. Do not "fix" non-manifold output by changing simplifier flags: `LockBorder`, `Prune` and `Sparse` make no difference. The in-place repair is skipped above 300,000 triangles (`TIDY_MAX_TRIANGLES`).

### Display shading (v2.56, unchanged in v2.57)
Reduced previews and FIX/FUSE results get their shading normals from `crease-normals.js` (`creaseSplit`), not `computeVertexNormals()`. Plain smooth normals smear shading over big flat triangles across hard edges and look like dark patches; the geometry is fine and the STL never contains them. `creaseSplit` only appends duplicate vertices and never changes positions or triangles; the original vertex numbers stay valid, which `live-reduce.js` relies on (worker indices refer to the original numbering). Keep `src.baseAttrs` (pristine attributes) in `live-reduce.js` and rebuild the display geometry from `s.positions` on every reduction.

### Helper cache keys and the diagnostic report (v2.188)
`print-export-safety.js` loads fuse-export / split-print / split-fallback / preview-material-fix / watertight-remesh under `REL` (the `?v=` it was itself imported with = `PRINT_RELEASE`), NOT its old fixed `VERSION` ('2.63'): a fixed key made browsers keep stale copies after a fix. Never hard-code a cache key for a module that changes. `#v2DiagBtn` (Advanced drawer) copies `window.__shrinkDiagReport()`; `window.__shrinkFuseBuild` shows which fuse-export is really loaded and `window.__shrinkLastFuse` the last fuse result.

### Make watertight in one place (v2.193)
`makeWatertightCopy()` (print-export-safety.js, `window.__shrinkMakeWatertight`) works with or without its button and returns true when a clean model was installed. The red box `#printDiagnosticPanel` sits top-right like `#v2BatchPanel` and `placeDiagnostic()` moves it inside the batch window while that is open. BATCH's `watertightRow(id)` opens the file, waits for QUICK-FIX `ready`, calls it, then clicks `#saveStlBtn` with `S.silent` set so `fixingCapture` returns true (ZIP updated, nothing saved); the row gets `.fixed` (green). Rows that only have "separate pieces" get no such button (they need FUSE IT). Test W1 in `tests/clay.test.mjs`.

### Minor edges are fine (v2.195)
`deps.minor()` in batch.js reads the MODEL HEALTH rows: no open edges, no flipped faces and 1 to `MINOR_EDGES` (10) non-manifold edges = fine to print (row stays green, no Make watertight button). Voxel rebuilds drop detail (104k to 21k triangles in a real run) so they are not worth it for that.

### Big-task note (v2.191, centred since v2.192)
`#v2BigTask` (still built inside `.v2-magic-wrap`, but `position:fixed` in the middle of the screen with `pointer-events:none`) is shown by `shrinkMyModel()` when the model starts above `BIG_TASK_TRIANGLES` (1,000,000; tests override with `window.__shrinkBigTaskTris`) and hidden in its `finally`. Tests: M1 in `tests/clay.test.mjs`.

### Health score ignores degenerates (v2.190)
`healthScore()` in `print-v2-ui.js` no longer deducts for degenerate triangles and the row is never red; they are informational (same rule as `meshHealth`). Do not delete them to "fix" the row: a zero-area triangle can be part of a closed edge loop.

### Fuse fallback and dust (v2.189)
The repair fallback in `modelToSolid()` (`repairWholeModelSolid`, used when a mesh part is rejected as non-manifold, e.g. a stacked duplicate shell) goes through `splitShells()` too. After the union, components with volume <= 1e-5 of the biggest (including negative, inside-out ones) are dust and dropped. `shrinkMyModel()`'s verdict `healthy` = `lastHealth.h.clean` (degenerates alone do not count).

### Fuse unions shells inside one mesh (v2.187)
`modelToSolid()` in `fuse-export.js` runs `splitShells()` on every mesh's solid (Manifold `decompose()`, inside-out shells turned outward, zero-volume shells dropped) BEFORE `Manifold.union`. Without it a single STL mesh with overlapping shells was never unioned. After the union, pieces under 1e-6 of the biggest volume are dust and are dropped (`Manifold.compose`), and `components` counts what is left. `fusedPieces` makes the FUSED chip say `FUSED · N PIECES`. Tests: U1/U2 in `tests/clay.test.mjs` (`models.overlap`).

### FUSE IT size guard (v2.124)
`fuseCheck()` in `print-v2-ui.js` refuses above `FUSE_MAX_TRIANGLES` (1,000,000; tests can override with `window.__shrinkFuseTriLimit`) and tells the person to SHRINK IT first. Manifold runs on the main thread, so a multi-million triangle model freezes the tab. The proper fix would be moving fuse into a worker. (v2.125) `updateSizeWarning()` shows the yellow `#v2SizeWarn` banner above the Fuse card from `updateHealthCard()` while the working model is over the limit.

### SHRINK MY MODEL! (v2.140)
`shrinkMyModel()` in `print-v2-ui.js` (button `#v2MagicBtn` in `.topbar`, report `#v2MagicNote`) just calls the existing `shrinkModel()`, `fixHealthModel()` (only if the health score is not 100), `fuseCheck()` (success read from `#v2FuseCard` `data-state`), then `levelModel()` (finds the best flat face within 50° of down and turns the model onto it, then turns it about Y so the long side is along X; rotates the working model root's quaternion about its centre, never its geometry; exposed as `window.__shrinkLevel`) and `centreOnBed()`. Both work in WORLD space (`moveWorld`/`rotateAboutCentre`; the root can have a scaled/rotated parent) and measure with `Box3.setFromObject(model, true)` (precise; the cached geometry box can be stale after in-place reduction). `centreOnBed()` moves the working model root's `position` (exports use `matrixWorld`, so it follows into STL/split); it never replaces the model object. `showBedGuide()`/`removeBedGuide()` (also `window.__shrinkBedGuide`) add a `shrinkBedGuide` group (grid, dark plane, XYZ arrows) to the viewer scene and hide the default grid; it is removed on `shrink:model-opened` and in Game mode. Do not copy the step logic: change the individual tools.

### CLAY (v2.141; switched off in v2.173: `CLAY_ENABLED = false` in `ui-mode.js`, card hidden, files and tests kept)
`clay.js` (ES module, loaded by `ui-mode.js`; card built into `#v2ClayHost`, which `print-v2-ui.js` puts above the Advanced drawer) + `clay-core.js` (no DOM, no three.js: icosphere, `dabSoup`, `dabsAlong`, `thin`, `joinSoups`). Strokes are lists of world-space balls `{x,y,z,r}` kept in `window.__shrinkClay` (`hasClay`, `apply`, `finish`, `addStroke` for tests). The preview is two `InstancedMesh`es in a `shrinkClay` scene group (pink = add, orange = cut); they ignore raycasts. Painting raycasts the working model; Ctrl/Cmd+drag rotates, Esc leaves the tool, as the other brushes do. `fixHealthModel()` calls `__shrinkClay.apply(model)` instead of the gentle repair when clay exists, and `shrinkMyModel()` no longer skips the fix step when clay is present. `apply()`: route A = `modelToSolid` (exact Manifold union/difference, keeps all detail); route B (Manifold rejects a leaky mesh, e.g. piece_55) = add balls to the triangle soup and run `makeWatertight` (balanced, then fast; `high` pinches), then subtract cuts with Manifold. The result must pass `healthOfModel` or nothing is installed. Ball count is thinned and coarsened (`ballLevel`) because the wrap refuses above 1.5M triangles. Tests: `tests/clay.test.mjs`.

### QUICK-FIX order (v2.147)
`shrinkMyModel()` repairs FIRST when the model has at most `FIX_FIRST_MAX` (600,000) triangles (repair runs on the main thread), then shrinks, then repairs again only if still unhealthy, then fuses, levels and centres. Reason: shrinking a leaky mesh bakes the leaks into a coarse mesh that repair cannot close. `repairMesh` step 5 is now `fillHoles(false)` (boundary followed in triangle direction) and, if edges are still open, `fillHoles(true)` (undirected tracing, cap turned to match the neighbouring triangle), kept only if `open+tangled+flipped` goes down. (v2.149) The top-right button `#v2MagicReset` is now **RELOAD**: it just opens `#fileInput` to load a different model; the old revert-to-original code (`resetModel`, `initialBytes`) was removed. The repair graph cache key is **2.196** now (v2.196).

### QUICK-FIX verdict and fuse step-down (v2.186)
`shrinkMyModel()` step 1b: if the shrunk model is still over `FUSE_MAX_TRIANGLES` it calls `setQuality()` down the ladder ultra, fine, standard, large (only levels that exist in `PRINTER_LIST` for the printer type) and `shrinkModel()` again until it fits; the dropdown/tag keep the level really used and `localStorage['shrink-printer']` is put back to the person's own choice. `countPieces()` (welded world positions, union-find, skipped above 1.5M triangles) fills a **Pieces** row in the health box (`#v2HealthRows[data-pieces]`, `strong.note` amber, never `.issue`, so score and BATCH issue lists ignore it). The final verdict is in `window.__shrinkLastVerdict` `{healthy, pieces, fused, text}`; BATCH reads it and flags N>1 pieces.

### BATCH (v2.151)
`batch.js` (ES module, loaded by `ui-mode.js`; the only button is `#v2BatchTop` in the top bar right after RELOAD (the load-screen button `#v2BatchHome` was removed in v2.184), panel `#v2BatchPanel`, `window.__shrinkBatch`). For each queued file it calls `__shrinkApp.openFile`, waits for the QUICK-FIX button (`data-state="ready"`), clicks it, waits until `data-busy` clears, then clicks DOWNLOAD with `window.__shrinkCapture` set. **Every `saveBlob` must call `window.__shrinkCapture?.(blob, filename)` first** (print-tools, fuse-export, split-print, split-fallback do); a new exporter that saves on its own would bypass the batch. Memory bar = `estimate()`: biggest file x12 plus finished results, against `performance.memory.jsHeapSizeLimit` (Chrome) or deviceMemory x 0.5. (v2.154) The panel has its own Printer + Height; `applySettings()` clicks the print dashboard's `[data-printer]`/`[data-quality]` buttons and sets `#v2Height` for every file (always scope to `.print-v2-dashboard`: another `data-quality` element appears after a second open). These factors are rough guesses, tune them with real runs. Tests: `tests/clay.test.mjs` (B1-B4, with the real work stubbed through `__shrinkBatch.deps`).

### QUICK-FIX button state (v2.149)
`quickState()` in `print-v2-ui.js` sets `#v2MagicBtn[data-state]` (`checking` = grey and disabled, like DOWNLOAD; `ready` = green) from `updateHealthCard()`. BATCH waits for `ready`.

### 16K ultra (v2.150, default since v2.159)
The printer type + quality are saved in `localStorage['shrink-printer']` (`savePrinter()`/`savedPrinter()` in `print-v2-ui.js`; BATCH reads the same key) and restored when the dashboard is built; with nothing saved the default is resin + `ultra`. `setQuality('ultra')`: detail 0.018 mm for resin and `window.__shrinkStrict='p995'`; Standard/Fine/Large put it back to default. (v2.166) The visible control is one `#v2PrinterSel` dropdown built from `window.__shrinkPrinterList` (BATCH reads the same list); the old `[data-printer]`/`[data-quality]` buttons stay in a hidden block so code and tests can still click them. `downloadStem()` adds the list `tag` (`-SHRINK-16K`) to every export name.

### Viewer lighting (v2.145)
`syncViewerEnvironment()` in `app.js` sets print mode to low hemisphere/fill light plus a strong `key` lamp with `castShadow` (game mode keeps the old gentle lamps and no shadows). `fitShadows()` runs each frame: it flags the original/optimized/current model meshes `castShadow`/`receiveShadow` and, every 20 frames, refits the key lamp and its orthographic shadow camera around the shown model (bounding sphere), so a moved or replaced model keeps good shadows. New meshes added to the scene need nothing extra unless they should not cast shadows (guide/clay groups are not flagged).

### TURN pad (v2.161; hidden by CSS since v2.181)
`turnModel(axis, deg)` / `ensureTurnPad()` in `print-v2-ui.js` (`#v2TurnPad`, built from `updateHealthCard()`, `window.__shrinkTurn`): rotates the working root about its centre through `rotateAboutCentre` (so `notePose`/Compare follow), refuses when the root is stretched (non-uniform scale would shear), then `centreOnBed()` and the bed guide. Tests: T1 in `tests/clay.test.mjs`.

### Compare pose (v2.143)
The levelling, centring and stretch tools move the working model root, never the original. `notePose()` in `print-v2-ui.js` records each change in `poseD`; `window.__shrinkComparePose()` returns it (null when nothing moved); `app.js` `enterCompare()` applies it to `originalModel` and `leaveCompare()` restores the saved position/quaternion/scale. Any new tool that moves or turns the working root must go through `moveWorld`/`rotateAboutCentre`/`notePose`. `poseD` resets on `shrink:model-opened`.

### Uniform / Width / Depth (v2.140)
Width/Depth read-outs come from `modelSize()` (precise world box of the working model; cached on uuid + `reducedTick` + matrixWorld). With `#v2Uniform` ticked they just set the Height (everything scales together via `mmPerUnit`). Unticked, they call `applyStretch(fx, fz)`: stretch lives on the working root's `scale` in WORLD axes, so `normalizeRoot()` first moves any root rotation into an inner `shrinkInner` group (root keeps identity rotation, so no shear). Factors are in `model.userData.shrinkStretch`. FIX/FUSE bake the world transform into a new root, so the stretch is then baked in and the factors read 1. `levelModel()` must run on an unstretched root (`resetStretch()` first). `window.__shrinkStretchTick` invalidates split-print's auto-cut signature.

### Make watertight
Rebuilds the **working model** (not the original), checks the result with the shared `meshHealth`, and only then installs it. On refusal or an unhealthy result nothing changes and nothing is downloaded.

### Tests
`cd tests && npm install && npm test`. `multitool.test.mjs` clicks the real DOWNLOAD IT / FUSE IT / Make watertight buttons on a jsdom page that loads the real modules and the real Manifold library (`mt-harness.mjs`). If you change split, fuse, working-model or watertight code, run it and add a case for what you changed.

## v2.36 historical layout baseline
The current Simple desktop layout is intentionally restored from the final Oct 3 v2.25 commit `67ce3c`.

- `simple-wizard.css` comes from that historical commit.
- `simple-preflight.css` comes from that historical commit.
- Do not add new viewport/dock/equal-height layout systems on top without an explicit new decision.
- The only post-Oct-3 CSS retained in the Simple wizard layer is the amber visual state for **Continue anyway**.
- `simple-mode.css`, `print-v2-ui.css`, and `style.css` already matched the Oct 3 state and were not rewritten.
- Engine/workflow logic remains current; this was layout-only.
- Keep v2.33 camera/orientation/stable-preview fixes independent of the historical layout CSS.

## v2.35 layout target
The desired desktop Simple layout is the cleaner pre-dock visual composition:

- fixed columns: Controls / Check-Repair left, Viewer right
- approximately 32% / 68% width
- left card uses natural content height and must **not** stretch to viewer depth
- right viewer is intentionally much taller than the left card
- normal page/document scrolling is allowed
- no JavaScript viewport sizing or equal-height module forcing
- do not reintroduce draggable/dockable panels
- keep v2.33 orientation/camera/viewer-stability fixes independent of layout

## v2.34 fixed layout rules
The draggable/dockable panel experiment from v2.28–v2.33 has been removed.

- `panel-layout.js` and `panel-layout.css` no longer exist.
- Do not reintroduce drag bars, panel-side localStorage, body-wide layout observers or JavaScript viewport-height managers without a new explicit design decision.
- Desktop Simple mode is fixed two-column: Controls/Check-Repair left, Viewer right.
- `simple-wizard.css` owns desktop workspace sizing using CSS only.
- Controls/preflight use natural height; the page remains ordinary document flow.
- Keep v2.33 camera/view preservation and orientation fixes independent of layout.

## v2.33 viewer stability rules
The Duric browser video exposed three UI/viewer problems and v2.33 fixes them without changing geometry algorithms.

- Internal STL reopen rule: SHRINK stores print geometry Y-up internally but STL import assumes Z-up. Any repaired/rebuilt model exported only for SHRINK to reopen must use `buildBinaryStl(... zUp:true)`.
- Preserve view state across internal model replacement/reopen: camera position, OrbitControls target, up/zoom/near/far.
- Simple reduction must keep the live reduced preview visible while stage === `working`; do not switch Original/Reduced back and forth on live events.
- Model display should be idempotent when the requested model is already shown.
- Loaded Simple desktop mode owns the viewport. Page scrolling is locked; the Controls module scrolls internally.
- Workspace-height calculation must clamp the measured top to the visible viewport so negative values from scroll cannot create an oversized viewer.
- Do not restore a permanent body-wide MutationObserver in `panel-layout.js`. UI text/result mutations must not trigger layout resize.
- `panel-layout.js` uses short startup retries plus explicit workflow events and exposes `resize()`.
- `app.js?v=2.33` is a viewer/app-shell cache key only; reducer/core algorithm modules are still v2.18.

## v2.32 P1 state
The follow-up tidy-up after the v2.31 reliability work is complete.

- Simple quality presets are triangle-target presets, not millimetre guarantees.
- Compare/Tools may run the real surface-loss measurement; ordinary Simple does not.
- `simple-mode.js` owns Simple reduction. Do not recreate click interception or fake saved-percentage state.
- `simple-focus.js` was deleted.
- Fine-tune must perform only one awaited reduction per settled change.
- Clean models may exit immediately via **Download as it is**.
- Failed automatic repair is a warning, not a prison: offer stronger repair, continue anyway, download as-is and Tools as appropriate.
- A bypass must remain visibly warned; never relabel it as a passed health check.
- Simple must not auto-Fuse on download.
- `viewer-auto-button.js` is loaded only once from the page.

The next architectural change should be the recipe/job-state flow behind a feature flag, not another Simple overlay. Browser-test Duric before switching the default flow.

## v2.31 P0 state
The v2.30 review P0 cleanup is complete. Before adding a new workflow:
- run the real Duric browser acceptance test
- do not add another Simple override layer
- keep ordinary Simple reduction free of BVH quality measurement
- Compare may opt into the visual-loss measurement
- Simple/preflight/post-reduction/export diagnostics must use the shared v2.27 `meshHealth` definition
- Manifold belongs to explicit Fuse/Split operations, not ordinary Simple validation
- Simple must await reducer promises/events, never poll status labels
- `index.html` alone owns the visible release badge
- user-facing navigation says **Tools**, not Advanced

The next architectural step, only after Tim approves the browser test, is to prototype the recipe/job-state workflow beside the old Simple layers rather than adding another overlay.

## Product direction

SHRINK 3D has two distinct jobs:

### Game model
Optimise GLB game assets: geometry, textures and file size.

### 3D print / modelling
The Simple workflow is intentionally:

**Upload → Check/Repair → Printer & size → Reduce → Prepare/Download**

The product message is:

**Repair it. Reduce it. Print it.**

Do not force home users to understand Boolean union, manifold status, voxel grids, peg tolerances or Meshopt unless they open **Tools**.

## Simple vs Tools

- **Simple** is the normal home-user workflow.
- The old **Advanced** label is presented to the user as **Tools**.
- Simple should stay short, progressive and conditional.
- Power-user controls belong in Tools rather than being deleted.

Tools may contain:
- Fuse / Boolean union
- stronger voxel rebuild
- manual reduction percentages
- exhaustive smallest-mesh search
- protect-detail painting
- topology diagnostics
- split/peg details
- OBJ and other technical export controls

## Print workflow rules

### 1. Check / Repair first
Every uploaded print model is checked before reduction.

If clean:
- show that it passed
- allow Continue

If normal repair is required:
- try conservative repair first
- keep original surface/detail wherever possible
- after success, use the repaired geometry as the new working source

If conservative repair fails:
- offer stronger watertight/voxel rebuild
- warn that very fine detail can soften
- do not silently rebuild

If stronger rebuild fails:
- warn clearly
- offer **Continue anyway**, **Download as it is**, Tools and re-upload
- if the user continues, keep the warning visible through the next stage

Separate closed printable pieces are allowed. They do not have to be fused simply to continue.

### Mesh health: one definition
`repair-core.js` owns it via `meshHealth`. Preflight, post-reduction guard and repair results must all use that definition.

Clean = no open edges, no tangled (3+) edges, no flipped edges. Empty/degenerate triangles are reported but do not block the Simple workflow.

Do not reintroduce a second topology check with a different weld tolerance. Heavy repair/health work runs in `repair-worker.js` where supported. The repair graph (`repair-core.js`, `repair-worker.js`, `solid-rebuild.js`) uses cache key **2.196** (bumped in v2.196 with the extra untangle round), independently of the v2.18 engine graph.

### 2. Repair is also a standalone feature
After a check/repair/rebuild completes, pause and allow:

- **Download as it is** for an unchanged clean source
- **Download repaired/rebuilt STL** after a fix
- **Continue to printer & size**

Someone should be able to use SHRINK only as a repair tool.

### 3. Reduce conservatively
Simple mode should aim for:

**small enough + visually good + responsive**

—not the mathematically smallest possible mesh.

v2.25 deliberately stopped using the old exhaustive visual search as the normal Simple path.

Typical v2.25 starting targets:

- Maximum detail: about 450k triangles / minimum ~42% kept
- Best detail: about 320k / minimum ~30%
- Balanced: about 240k / minimum ~22%
- Smallest file: about 170k / minimum ~16%

Small models that are already sensible should be left alone.

The exhaustive search remains available in Tools.

### 4. Avoid repair loops after reduction
A model that passed Stage 1 should not be sent through repeated repair/remesh loops after reduction.

If a reduced candidate damages topology:
- make one safer reduction/backoff attempt
- if that still fails, prefer the full repaired mesh over a broken reduced mesh
- do not repeatedly Manifold-check / repair / rebuild in Simple mode

### 5. Fuse is not a headline Simple feature
Fuse is a preparation tool, not something every home user must choose.

Do not Boolean-fuse every Simple download by default.

Use Fuse when a user deliberately wants touching/overlapping pieces unioned into one shell, or when a specific preparation path requires it.

### 6. Split only when needed
If the selected print size exceeds the user's printer size:
- offer split/scale choices
- keep peg/joint details simple in Simple mode
- detailed peg settings stay in Tools

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

## Repair/preflight module sizing
- Repair/preflight cards must fill the same module height as the viewer on desktop.
- Do not use `align-self:start` on `.simple-preflight-card`.
- The outer card stretches to 100% height; content stays top-aligned and scrolls internally when needed.
- This rule is separate from mobile behaviour.

## Desktop layout
- Fixed desktop two-column layout only.
- Controls / Check-Repair are on the left; Viewer is on the right.
- `simple-wizard.css` keeps the controls natural-height and gives only the viewer a tall browser-relative height.
- No JavaScript should continuously calculate workspace height.
- No user-reorderable dock system is currently supported.

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
- Viewer stays in the fixed right-hand desktop column in Simple Print mode.
- Simple control/preflight cards use natural height in the fixed left-hand column.
- Avoid large dead vertical gaps.
- (v2.158) Phones and tablets are blocked by a full-screen message from `mobile-warning.js` (no dismiss). It is a deliberate product decision by Tim; do not make it dismissible without asking.

## Important files

### Current Simple workflow layer
- `simple-wizard.js`
- `simple-wizard.css`
- `simple-preflight.js`
- `simple-postreduce.js`
- `simple-mode.js`
- `simple-mode.css`

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

## Current acceptance test

The troublesome Duric dwarf sculpt is a useful stress test because it is around one million triangles and has exposed:
- repair/remesh problems
- post-reduction topology failures
- stale-normal dark shading
- browser responsiveness issues
- layout overflow

A good Simple-mode run should:
1. check/repair once
2. pause after repair
3. reduce conservatively
4. remain responsive
5. keep the reduced mesh clean or fall back safely
6. fit within the viewport with the right panel independently scrollable
7. download without forcing the user through repeated technical decisions

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

## Racer preset (v2.119)
- Target card `data-target="racer"` (no triangle target; `GAME_TARGETS.racer.tris` is null, so `live-ui.js` leaves Detail kept alone). `racer.js` owns the panel (`#racerPanel`) and `window.__shrinkRacer`; `app.js` `optimizeModel` calls `__shrinkRacer.process(document, progress)` instead of the generic WebP step when the card is active.
- `racer-core.js` is DOM-free: `plan()` (pure estimate/report), `mergeable()`, `apply()` (merge atlas -> prune -> resize/encode each texture). Pixel work goes through the `ops` object (`decode`/`encode`/`prune`/`enableWebP`) supplied by the page, so Node tests use fakes. Budget: target 12 MB, FAIL at 46 MB of GPU memory (w*h*4*1.33).
- Merge keeps the first used material and reassigns every primitive to it; each primitive gets a NEW `TEXCOORD_0` accessor (accessors may be shared). Plain-colour parts without UVs point at their colour tile. Do not merge transparent, KHR_materials_* or tiling-UV materials.

## Add part (v2.112)
- `add-part.js` (UI, TransformControls gizmo on `__shrinkViewer`) + `add-part-core.js` (`mergePart`, no DOM, tested by `add-part.test.mjs`). Commit goes through the source GLB like Remove/Weld: `readDoc` -> `mergePart` (uses `mergeDocuments` from `@gltf-transform/functions`; `Document.merge` is disabled in 4.x) -> prune -> write -> `replaceSource`. Undo uses the Remove undo stack (`__shrinkRemove.noteChange`).
- Added parts go at the END of the main scene under one wrapper node, so Remove/Weld path keys stay valid. `mergePart` folds all accessors into one buffer (GLB allows only one). Added parts are not in the Remove/Weld baseline (they cannot be brushed).
- (v2.114) Added parts can be picked up again: wrapper nodes carry `extras.shrinkPart`; `editAdded()` removes them (recursively disposing, then prune), reloads them as ghosts from the in-session `st.lib` bytes. Not possible after reopening a project (lib is empty).
- (v2.115) Each ghost has `userData.nodeName` (Name box; first = Wheel_FL, mirror = opposite side) used as the merged wrapper's node name. `wheel-split.js` `apply` skips when root nodes are already named Wheel_*. Cancel during `editAdded` undoes the pick-up via `__shrinkRemove.undo()` (`st.editing`).
- (v2.116) `splitWheels` calls `unshareMeshes` first (dedup() in optimizeModel turns identical wheels into one mesh shared by several nodes; a shared mesh used to be skipped). `Mesh.clone()` shares the Primitive objects, so unshare clones the primitives too. Primitives emptied by the cut are disposed with their now-empty nodes.
