# CLAUDE.md — SHRINK 3D handoff notes

Read this file before changing the repository.

## Current baseline

- Current user-facing release: **v2.55** (the multitool; see "3D Print multitool" below). Older sections that mention the Simple wizard describe code that still exists in the repo but is **not loaded** by the page since v2.38.
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

Do not reintroduce a second topology check with a different weld tolerance. Heavy repair/health work runs in `repair-worker.js` where supported. The repair graph (`repair-core.js`, `repair-worker.js`, `solid-rebuild.js`) uses cache key **2.27**, independently of the v2.18 engine graph.

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
- The large red **Find the smallest that still looks the same** button belongs below the viewer in its own row.
- Do not position both relative to the full viewer panel; that caused them to overlap.

## Viewer/UI rules

- Before reduction, do **not** show Original/Reduced controls because there is no meaningful reduced result yet.
- After a real reduction completes, Original/Reduced and Compare can appear.
- Reduced print preview normals must be recomputed after connectivity changes so the model does not appear artificially dark.
- Once a model is loaded on desktop, the header/branding should collapse to reclaim height.
- Viewer stays in the fixed right-hand desktop column in Simple Print mode.
- Simple control/preflight cards use natural height in the fixed left-hand column.
- Avoid large dead vertical gaps.
- Mobile warning is intentionally cheeky but non-blocking.

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
