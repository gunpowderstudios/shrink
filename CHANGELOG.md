# CHANGELOG — SHRINK 3D

This file records user-facing workflow and architecture changes. Git history remains the authoritative line-by-line record.

## v2.72 — the best cut is found automatically, and the search no longer freezes the page

### Fixed
- **"Find best cut" crashed/froze the page on a big model** (v2.71). It re-walked the entire mesh for every cross-section (~175 passes) in one blocking call. Now `buildSlicer()` takes one pass over the mesh and sorts the triangles into 512 height bins; each cross-section only looks at the triangles near its height (preview and search are several times cheaper too). The search runs in small steps (`await` between heights, progress shown, coarser steps above 600k triangles), is cancelled by a newer search, never spreads huge arrays into `Math.max`, and any error is caught and reported on the card instead of crashing.
- `split-print.js` ignores a second load (`window.__shrinkSplitLoaded`): a duplicate copy used to add a second download handler and replace `__shrinkSplit` with one that had no preview data (this showed up in the test harness, which loads it twice).

### Changed
- **Best cut is automatic.** Choosing 2 parts picks the cut for you (after a short pause, once per model/height) and the card says what it did. The tick-box "Pick the best cut for me" stays on until you drag Cut height yourself, which switches it off and leaves your cut alone; ticking it again, opening a new model, or **FIND AGAIN** re-runs it.

### Tests
- Group N renumbered 40–45 (they collided with groups 20–24). New: auto pick on the axe model, drag takes over, FIND AGAIN, re-tick, dense 130k-triangle model finishes with the page still responsive. 217 checks pass.

---

## v2.71 — split pegs: see at a glance whether they fit, and the file matches the preview

(v2.58–v2.70 were GPT's peg work — draggable pegs, true-size X-ray pegs, axis sliders, pink exposed areas — and are not itemised here. This release builds on it.)

### Added
- **Peg report.** Every peg is checked against the model along its whole depth (the lower part's cross-sections at 9 heights down the peg, plus one just above the cut for the peg's root). The Download card lists each peg in plain words with a green / amber / red dot — "fits inside the model, 16.8 mm of wall", "tight: only 0.3 mm of wall", "sticks out of the model by 2.2 mm (the lowest 6 mm of the peg)", "its socket would break through the surface". A status ring on the cut plane in the viewer uses the same colours; the pink X-ray colouring of exposed areas is kept.
- **Better automatic placement.** The old preview picked the roomiest point of the cut *face* only. Auto now maximises the worst cross-section anywhere down the peg (grid of candidates, shortlist, then a small pattern search), so the peg sits in the thickest part of the model rather than near the middle of the bounding box.
- **Find best cut** (2 parts; automatic since v2.72). Scans 20–80% of the height and prefers a cut through ONE solid outline (not a plank, axe or cape as well), with room for two pegs; cuts within ~1% of the height of a ledge/arm are treated as fragile. Moves the Cut height slider.
- **Manual sliders can go into the red.** A manual peg may be slid anywhere on the material so the problem is visible; red pegs are left out of the files and the message says so. "Snap pegs to safest spot" (the old Reset) returns to the automatic spots.

### Fixed
- **Pegs disappeared when the cut landed exactly on a ring of vertices** (a flat plateau, a sphere's equator): the cut outline came out doubled and unusable, so the split silently became a flat cut. Outlines are now taken a hair (0.02% of the height) above or below such a ring. This was also why 4 checks in the v2.70 suite failed.
- **The file now uses the pegs the preview shows** (auto as well as manual), so what you see is what is exported. The Manifold volume check still guards each peg. The direct-split fallback uses the same pegs (`__shrinkSplit.shownPegPoints()`).
- Stale peg data is cleared when split is switched off.

### Performance
- Cut outlines skip triangles that do not reach the cut height before allocating anything: preview 340 ms on a 240k-triangle model, Find best cut ~3 s.

### Tests
- `multitool.test.mjs` group N (N1–N5): green report for a central cut, no pegs/flagged near the bottom, manual peg slid to red then snapped back, Find best cut avoids a plank (new `models.axe`), cut exactly on a vertex ring (and inside-out). A1 updated to GPT's `…-H40-SHRINK-SPLIT2.zip` / `…-PART1of2.stl` names. 211 checks pass.

### Version boundaries
- Visible release **v2.71**; cache key unchanged scheme (`PRINT_RELEASE` in `ui-mode.js`).

---

## v2.57 — the Detail kept slider drives the picture again (regression from v2.56)

### Fixed
- **After SHRINK IT the Advanced "Detail kept" slider changed the numbers but not the picture** (Compare showed the same faceted model at 1% and at 100%).
  - **Cause (mine, v2.56).** The slider drives the live reducer's own preview (`engine.root`). v2.56 tidied the reduced model by building a *different* repaired model and installing it as the preview, so the model on screen was no longer the one the slider modifies. Pressing FIX IT after SHRINK always did this; v2.56 made it happen on almost every SHRINK of a many-piece model.
  - **Fix.** The tidy now happens **inside** the live reducer: `live-reduce.js` `apply()` health-checks each reduction and, if the model was clean going in (`engine.setTidy(true)`, set by SHRINK IT) and the reduction left it unclean, repairs it there and builds the display geometry from the repaired mesh. The model on screen is always the engine's own preview, so the slider, Compare and the working model all agree. `print-v2-ui.js` no longer installs a second model after SHRINK; the result card reads `engine.last.tidied` ("Tidied N edges the reduction disturbed").
  - A reduction that stays clean, or a model that was unhealthy before SHRINK, is not touched.
- **The slider re-bases after another tool replaced the model.** If FIX IT, FUSE IT or Make watertight has installed a new working model, the next move of "Detail kept" first re-bases the live reducer on that model (`__shrinkLiveUI.rebaseWorking`, tidy flag set from its health), then applies the slider. Percentages are then of the current model, and the picture follows.
- Cost of the in-place tidy (1M-triangle source): health check 125–250 ms per update; repair 0.4 s at 50k triangles, 0.9 s at 216k, only when needed. It is skipped above 300,000 triangles while sliding (the health card flags it; FIX IT repairs).

### Tests
- `multitool.test.mjs` groups K, K2, K3, K4 now use the **real live reducer and real simplifier** wired like `live-ui.js`: SHRINK keeps a clean model clean; the slider at 50% / 100% / 10% changes the geometry on screen (triangle count, original vertices at 100%) and the model stays clean; after FIX IT the slider re-bases and the picture follows; a clean reduction and an unhealthy model are left alone.
- `livereduce.test.mjs`: tidy off vs on (13 non-manifold edges kept vs tidied), valid normals/indices, 100% restores the original exactly. All 188 checks pass (`cd tests && npm test`).

### Version boundaries
- Visible release **v2.57**. Multitool graph **2.57** (`print-v2-ui.*`, `print-export-safety.js`, `fuse-export.js`, `split-print.js`, `split-fallback.js`, `raw-split.js`, `watertight-remesh.js`).
- `live-ui.js`, `live-reduce.js` and `crease-normals.js` carry **2.57** (`live-reduce.js` now also imports `repair-core.js?v=2.27`). `reduce-core.js`, `mesh-tools.js`, `app.js` stay **2.18**; repair graph stays **2.27**.

---

## v2.56 — SHRINK no longer breaks a clean model; no more dark patches on the base

### Fixed: MODEL HEALTH fell from 100 to "Needs attention" after SHRINK IT
- **Cause.** The simplifier (meshoptimizer, via `reduce-core.js`) does not promise to keep a mesh manifold. On a model made of many small closed pieces (the repaired dwarf has ~94) a reduction can leave a few edges shared by three triangles. Reproduced with the app's own reducer settings on a clean test model: 1 / 13 / 2 non-manifold edges at 50% / 20% / 4%. `LockBorder`, `Prune` and `Sparse` change nothing.
- **Fix.** SHRINK IT notes whether the model was clean going in (it reuses the health result already measured for the card). If it was clean and the reduction left it unclean, SHRINK runs the same gentle repair as FIX IT on the reduced model and installs the result through `__shrinkInstallWorkingModel`. The result card says what it did ("Tidied 13 edges the reduction disturbed."). On the test model 6,410 → 6,384 triangles (13 tangled edges removed); it takes ~50–120 ms.
- A model that was **not** clean before SHRINK is left alone: FIX IT stays the person's decision. A reduction that happens to stay clean is used as it is.

### Fixed: dark patches on flat areas (the base) of the reduced model
- **Cause.** Display only. A heavily reduced mesh has big triangles, and `computeVertexNormals()` averages the faces around a vertex even across a hard edge (the rim of a base), so a big flat triangle is shaded as if it were curved. The geometry was fine: on the test base 0% of the top faces pointed the wrong way or were tilted, while 9–10% of the top surface was shaded more than 12° wrong. An STL stores only triangles, so **the downloaded file never contained these patches**; a slicer shades from the triangles.
- **Fix.** New `crease-normals.js` (`creaseSplit`): vertices on a crease (faces more than 55° apart) get one copy per smoothing group, each with its own normal. Positions and triangles are unchanged (health, points and triangle counts are identical once welded), original vertex numbers stay valid (extra copies are appended). Used by the live reduced preview (`live-reduce.js`) and by FIX IT / FUSE IT results (`fuse-export.js`). A preview at 100%, or a mesh with extra vertex data (colours), uses the previous path; going back to 100% restores the original normals exactly.
- Measured: top of a decimated base shaded >12° wrong: 9.3% → 0.04% (20% reduction), 10.4% → 0.06% (5%). 1,000,000 triangles take 0.4 s.

### Tests
- `tests/crease.test.mjs`, `tests/livereduce.test.mjs` (the real reducer and the real simplifier), and groups K, K2, K3 and L in `tests/multitool.test.mjs` (SHRINK on a clean model, a clean reduction, an unhealthy model, and a model with crease-split vertices through health, STL export, FUSE IT and split).
- Against v2.55 the new K group fails exactly as reported (13 non-manifold edges remain; health never returns to 100).

### Version boundaries
- Visible release **v2.56**. Multitool graph key **2.56** (`print-v2-ui.*`, `print-export-safety.js`, `fuse-export.js`, `split-print.js`, `split-fallback.js`, `raw-split.js`, `watertight-remesh.js`).
- `live-reduce.js` and `live-ui.js` are engine-graph files and now carry **2.56** (`live-ui.js` in `index.html`, `live-reduce.js` from `live-ui.js`). `crease-normals.js` is **2.56** everywhere it is imported (`live-reduce.js`, `fuse-export.js`).
- Reducer core `reduce-core.js`, `mesh-tools.js`, `app.js` stay **2.18**; repair graph stays **2.27**.

---

## v2.55 — Split and Make watertight fixed in the multitool

### Fixed: splitting into sections (DOWNLOAD IT → 2 parts / 3 parts / Auto by maximum height)
- **DOWNLOAD IT no longer switches Fuse on.** It used to tick the legacy `fuseSolidToggle` whenever a split was chosen. The Fuse export listens in the capture phase and calls `stopImmediatePropagation()`, so it swallowed the click and the split never ran (on a model made of several closed pieces it failed with "disconnected solids" and saved a plain STL instead). Fuse is only ever used through **FUSE IT**; the Fuse export also steps aside whenever a split is requested.
- **Several separate closed pieces are valid.** `split-print.js` and the Fuse export no longer require `components === 1`. The cut planes slice every piece, and the Fuse export reports "N separate watertight pieces" instead of failing.
- **Pegs only where material exists on both sides of the cut.** The probe used to look only below the cut, so on multi-piece models a peg could be attached to nothing. A peg that cannot be built now leaves a flat cut for that joint instead of failing the whole split, and the status message only claims pegs that were really added.
- **Inside-out meshes.** A closed mesh whose triangles face inwards gave Manifold a negative volume, which silently disabled pegs and could invert cut parts. `fuse-export.js` now turns such parts outward; `raw-split.js` does the same for the direct fallback.
- **Direct (capped) fallback** left open edges when a cut plane passed exactly through a ring of vertices. Such cuts are nudged by 0.02% of the height so the cap outline is complete.
- **Cut slider:** `print-v2-ui.js` read/wrote `splitCutPct`, which does not exist. It now uses the real `splitCutHeight`, so the cut position reaches the split engine.
- **Auto by maximum height** now has a visible **Maximum part height** box (`v2MaxHeight` → `splitMaxHeight`). The engine never makes a part shorter than 20 mm.
- `syncSplitControls()` is called from a page-wide `MutationObserver`; it now writes only when a value actually changed, so it cannot re-trigger itself.

### Fixed: Make watertight
- It rebuilt `app().originalModel`, downloaded a `-watertight.stl` and then disposed the result. It never replaced the working model, never refreshed health and never cleared the warning.
- It now rebuilds the **current working model** and installs the result like every other tool, through the new shared helper `window.__shrinkInstallWorkingModel(root, kind)` in `print-v2-ui.js` (the same steps FIX IT uses): `setPreview` → `setWorkingModel` → `show('optimized')` → restore the camera → `notifyReduced` → change chip → clear the red panel. Health is refreshed straight away and a **REBUILT** chip appears.
- The rebuilt skin must pass the shared `meshHealth` check before it replaces anything. If the rebuild is refused (gaps too big, too heavy) or unhealthy, the working model, the warning panel and the camera are left exactly as they were and nothing is downloaded.
- Position, orientation and scale are those of the model being rebuilt (tested inside a scaled, rotated, moved parent).

### Tests (new)
- `tests/mt-harness.mjs` loads the **real** `print-v2-ui.js`, `fuse-export.js`, `split-print.js`, `split-fallback.js`, `raw-split.js`, `print-export-safety.js` and `watertight-remesh.js` into jsdom with the real Manifold library, and the tests click the visible buttons.
- `tests/multitool.test.mjs` (76 checks): flat 2/3 parts, keyed pegs, auto by maximum height, the cut slider, no self-triggering page watcher, multi-piece models, inside-out models, the direct fallback (flat and pegs), a failing peg, splitting the working model rather than the original, a stale Fuse toggle, FUSE IT then split, Make watertight (replace, viewer, camera, health, chips, transform, refusal).
- Run against the previous v2.54 code the split groups fail; against this release all 128 checks in the six test files pass.

### Version boundaries
- Visible release: **v2.55** (`index.html`). Print-multitool graph key: **2.55** (`print-v2-ui.js`, `print-v2-ui.css`, `print-export-safety.js` and what it imports).
- Repair graph (`repair-core.js`, `repair-worker.js`, `solid-rebuild.js`) stays **2.27**; reducer/core engine stays **2.18**.

---

## v2.37–v2.54 — reconstructed from commit titles (these releases were not documented here)
This summary comes from `git log`, not from release notes. Check the commits before relying on any detail.
- **v2.37–v2.38** consolidated the Simple Print layout and made the full print dashboard the only print interface.
- **v2.39–v2.42** made 3D Print a multitool (Fuse / SHRINK / Download, any order), added Protect Detail to the SHRINK tool and stacked the tools beside a larger viewer.
- **v2.43–v2.45** detail-preserving repair before the voxel Fuse fallback; watertight fallback defaults to high detail; watertight multi-part meshes count as healthy.
- **v2.46–v2.48** automatic MODEL HEALTH chart on the viewer with a **FIX IT** action; FIX IT uses a gentle, non-Boolean repair that keeps the original surface.
- **v2.49** cumulative tools: `window.__shrinkWorkingModel()` / `__shrinkSetWorkingModel()`; Fix, Fuse, SHRINK, export and split all act on the latest working model; the live reducer can rebase onto it.
- **v2.50** download file names standardised to `<name>-SHRINK…`; applied-change chips.
- **v2.51–v2.54** FIX IT re-arms when later tools create issues; FIXED/FUSED/SHRUNK chips; corrected compare rendering and normals; NaN triangle labels fixed.

---

## v2.36 — Restore actual Oct 3 layout

### Restored from history
- Restored `simple-wizard.css` from the last Oct 3 build, commit `67ce3c` (v2.25).
- Restored `simple-preflight.css` from the same historical commit.
- This is the real pre-movable-panel layout rather than a new approximation.

### Preserved
- Current v2.31–v2.33 repair/reduction/shared-health reliability work.
- v2.32 Download as it is / Continue anyway behaviour.
- v2.33 STL orientation and camera/view preservation.
- v2.33 stable live reduced preview.
- New amber warning colour for a bypassed mesh remains, but no newer layout rules remain.

### Scope
- No engine or geometry algorithm rollback.
- `simple-mode.css`, `print-v2-ui.css`, and `style.css` were already identical to the Oct 3 state.

---

## v2.35 — Natural-height controls

### Layout
- Controls / Check-Repair on the left now use natural content height instead of being forced to match the viewer depth.
- The viewer remains the dominant right-hand panel with a tall browser-relative height.
- Desktop grid is roughly 32% controls / 68% viewer.
- Returned to normal document flow and normal page scrolling.
- Removed the remaining equal-height assumptions from the v2.34 CSS reset.

### Scope
- CSS/layout only.
- No repair, reduction, mesh-health, camera or orientation logic changed.

---

## v2.34 — Layout reset

### Removed
- Removed the v2.28+ draggable/dockable panel system.
- Deleted `panel-layout.js` and `panel-layout.css`.
- Removed drag handles, saved left/right panel preference and JavaScript workspace-height recalculation.

### Restored
- Returned desktop Simple mode to the fixed pre-v2.28 two-column layout:
  - Controls / Check-Repair on the left
  - 3D viewer on the right
- Workspace sizing is CSS-only again.
- Both columns use the same browser-relative height.
- Controls and preflight cards scroll internally when their content is taller than the workspace.
- The 3D viewer fills the remaining column height.

### Preserved
- v2.33 orientation fix and camera/view-state preservation.
- Stable live reduced preview during reduction.
- v2.31/v2.32 reliability, shared mesh-health, reduction and repair improvements.
- No geometry algorithm was rolled back.

---

## v2.33 — Viewer stability

### Orientation / camera
- Fixed repaired/rebuilt STL reopen orientation: internal Y-up geometry is exported with `zUp:true` before re-import, matching SHRINK's STL importer.
- Added camera/view-state capture and restore around the repair/rebuild reopen.
- User rotation, zoom and OrbitControls target now survive that internal reopen.

### Flicker
- During Simple reduction the live reduced preview remains on screen instead of the wizard switching back to Original between updates.
- Showing the same model repeatedly is now idempotent, avoiding scene remove/add churn.

### Desktop viewport
- Loaded Simple mode is locked to the desktop browser viewport; controls scroll internally instead of forcing page scroll.
- Workspace height is capped to the visible viewport even if the page had previously been scrolled.
- Removed the permanent body-wide MutationObserver from `panel-layout.js`.
- Layout mounts via a short startup retry and explicit SHRINK events instead of reacting to every text/result DOM mutation.
- The layout module exposes an explicit resize hook and the Simple wizard calls it when model-loaded state changes.

### Scope
- No reduction algorithm, repair algorithm or mesh-health rule changed.
- User-facing release: **v2.33**.
- Repair graph remains **v2.27**.
- Reducer/core algorithm graph remains **v2.18**; `app.js?v=2.33` is a viewer-shell cache key only.

---

## v2.32 — P1 Simple-mode tidy-up

### Simple quality presets
- Removed misleading millimetre claims from the home-user quality choices.
- Simple presets are now described as what they actually are: conservative triangle targets for dense models:
  - Maximum detail: ~450k
  - Best detail: ~320k
  - Balanced: ~240k
  - Smallest file: ~170k
- The internal mm values remain only for explicit Compare/Tools measurements and rebuild-detail estimates.
- Compare still opts into the real BVH surface-loss measurement.

### Reduction ownership
- Deleted `simple-focus.js`.
- Moved its target-selection logic into `simple-mode.js`, so one controller owns Simple reduction.
- Removed the click interception / temporary fake “saved percentage” state.
- Fine-tune now updates the target silently and performs one awaited `runExact()` reduction instead of two overlapping reductions.
- Simple exports keep Fuse off unless the user deliberately chooses it in Tools.

### User choice
- A clean model now offers **Download as it is** before any reduction.
- If normal repair fails, choices are **Stronger fix**, **Continue anyway**, **Download as it is**, or **Tools**.
- If the stronger rebuild also fails, the user can still **Continue anyway** or **Download as it is**.
- Continuing with known mesh faults keeps an amber warning visible; SHRINK does not pretend the model passed.

### Cleanup
- Removed the duplicate `viewer-auto-button.js` dynamic import; the helper now loads once.
- Added regression assertions for unchanged download and preflight bypass.

### Version boundaries
- User-facing Simple/UI release: **v2.32**.
- Repair graph remains **v2.27**.
- Core reducer remains **v2.18**.

### Next
Browser-test Duric again. If stable, prototype the new recipe/job-state flow beside the existing UI behind a flag rather than adding another override layer.

---

## v2.31 — P0 reliability cleanup

### Reliability
- Restored the missing repair regression cases: flipped triangles, tangled edges, duplicates, inside-out shells, overlapping clean parts, large holes, degenerate triangles and pre-weld equivalence.
- Added GitHub Actions CI to run the regression suite on every push/PR plus the dense-mesh performance smoke test.
- Simple Print now skips the expensive BVH visual-loss measurement during normal operation; Compare can still request it explicitly.
- Simple reduction now awaits `live-reduce.runExact()` / the reducer promise rather than polling `#verdict`.
- Removed the remaining Simple-mode verdict polling from fine tuning.
- Replaced Simple's post-reduction Manifold validation with the shared v2.27 mesh-health worker.
- Removed the remaining legacy Simple repair Manifold validation; Manifold is now reserved for deliberate Fuse/Split work.
- `print-export-safety.js` now reports topology through the same `healthOfModel/meshHealth` definition used by preflight and repair.

### Consistency
- `index.html` owns the visible app version; `simple-wizard.js` no longer writes the badge.
- The Simple shell and its helper imports use a single v2.31 cache key.
- User-facing navigation uses **Tools** consistently; old **Advanced** wording has been removed.
- Main Simple reduction action is now **Make smaller** rather than **SHRINK IT**.

### Version boundaries
- User-facing Simple/UI release: **v2.31**.
- Repair graph remains **v2.27**.
- Underlying reducer/core engine remains **v2.18**; no reducer algorithm rewrite was made in this release.

### Next
Stop here for a real-browser Duric test before beginning the proposed recipe/state-machine Simple workflow.

---

## v2.30 — Full-height repair module

### Fixed
- Step 1 **Check / Repair** now stretches to the same full desktop module height as the 3D viewer.
- Removed the old `align-self:start` behaviour from the preflight card.
- Repair/preflight content scrolls internally if it exceeds the available height.
- Preflight CSS gets a fresh v2.30 cache key so browsers do not retain the older short-card layout.

---

## v2.29 — Fill the desktop window

### Changed
- Desktop workspace height is calculated from its real top position to the bottom of the current browser viewport.
- Controls and Viewer now stretch to the same available height.
- Controls scroll internally when their content is taller than the screen.
- Viewer expands to fill the available workspace instead of stopping at a fixed maximum height.
- Removed the old 900px Simple-workspace height cap.
- Dockable left/right panel preference from v2.28 is preserved.
- Mobile layout is unchanged.

---

## v2.28 — Dockable left/right panels

### Added
- Desktop **Controls** and **3D viewer** now behave like dockable modules.
- Drag one module onto the other to swap left/right.
- Clicking the small ↔ module strip also swaps sides.
- Layout choice is saved in `localStorage`, so each browser/user can keep a personal preference.
- Works in Game mode and Simple Print mode.
- Mobile/tablet layouts remain stacked and ignore the left/right preference.

### Architecture
- Added `panel-layout.js` and `panel-layout.css`.
- No repair/reduction engine code changed.

---

## v2.27 — One definition of "clean", and repair off the main thread

### Fixed
- Preflight, post-reduction guard and repair now share one mesh-health check (open, tangled and flipped edges fail; empty triangles are reported but never block). Removes the "repaired, then could not confirm a clean mesh" loop.
- Repair is substantially faster and lighter on dense meshes and now runs in a Web Worker with progress and Cancel where supported.
- A new upload now cancels any running repair/rebuild; stale timers and results from an older upload are ignored.
- A reduced mesh that already passes the shared check is accepted as it is instead of being sent through needless back-off/repair.
- Reduced-model normals are recomputed once per connectivity change rather than on every UI change.

### Removed
- Unused `simple-goals.js` / `simple-goals.css`.

### Cache keys
- Repair graph (`repair-core.js`, `repair-worker.js`, `solid-rebuild.js`) is on key **2.27**; the core engine graph stays on **2.18**.

### Testing note
- Claude's supplied regression suite reports 51 checks passing on the handoff pack. Browser/Duric acceptance testing is still required.

---

## v2.26 — Game viewer controls separated

### Fixed
- Moved the **Drag to rotate · Scroll to zoom · Right-drag to pan** help pill inside the actual 3D viewer area.
- Kept the large red **Find the smallest that still looks the same** action in its own row below the viewer.
- Prevents the help text and action button overlapping in Game mode.
- Loaded the viewer layout helper with its own v2.26 cache key without retagging the v2.18 core engine graph.

---

## v2.25 — Simplify and stay responsive

### Changed
- Reframed Simple Print around **Repair → Reduce → Prepare/Download**.
- Simple mode now aims for a sensible print mesh rather than the absolute smallest possible mesh.
- Replaced the normal exhaustive reduction search with conservative starting targets.
- Typical Simple starting targets:
  - Maximum detail: ~450k triangles / minimum ~42% kept
  - Best detail: ~320k / minimum ~30%
  - Balanced: ~240k / minimum ~22%
  - Smallest file: ~170k / minimum ~16%
- If the first reduced candidate damages topology, SHRINK makes one safer attempt rather than launching repeated repair/remesh passes.
- If that still fails, Simple mode prefers the full repaired mesh rather than forcing a broken reduced version.
- Simple download no longer Boolean-fuses everything by default.
- **Advanced** was renamed **Tools** in the user-facing switch.
- Power-user controls are hidden from the normal Simple journey but preserved in Tools.
- Loaded desktop layout now collapses the large header and lets the right panel scroll independently while the viewer stays in place.
- Removed unnecessary broad DOM watching from the simplification layer.

### Why
A million-triangle print sculpt could trigger too many expensive reduction, detail and topology checks, making Chrome jumpy or temporarily unresponsive. The product goal is now “small enough, clean and responsive”.

---

## v2.24 — Topology-aware reduction backoff

### Changed
- After reduction, if the visually smallest candidate was structurally invalid, SHRINK progressively kept more geometry until it found a clean candidate.
- Corrected the result headline so an invalid reduced mesh no longer said **Ready to print**.
- Recomputed vertex normals after heavy reduction to prevent the reduced preview appearing artificially dark.

### Why
A repaired ~1M triangle sculpt could reduce to ~15% visually, but the resulting topology was no longer printable.

### Superseded by v2.25
The multi-step backoff worked but could still be expensive. v2.25 simplified it to a conservative first target plus a limited fallback.

---

## v2.23 — Automatic post-reduction tidy

### Changed
- Added a second safety check after reduction.
- If aggressive reduction introduced small topology faults, SHRINK tried to tidy the reduced copy automatically.
- Only exposed stronger repair/rebuild options if that automatic tidy failed.

### Why
Users should not be asked to manually “repair again” immediately after already completing the repair stage.

### Superseded by v2.24/v2.25
Repair-after-reduction was replaced by keeping more geometry when possible.

---

## v2.22 — Simple Print wizard

### Changed
- Reorganised Simple Print into:
  1. Check / Repair
  2. Printer & size
  3. Reduce
  4. Prepare / Download
- Removed the old three-choice “What do you want to do?” decision from Simple mode.
- Added a repair checkpoint:
  - **Download repaired STL**
  - **Continue to printer & size**
- Hid Original/Reduced and Compare controls until a real reduced result exists.

### Why
Repair is a complete useful job by itself, and technical operations such as Fuse should not be the first decisions presented to home users.

---

## v2.21 — Upload preflight gate

### Added
- Automatic mesh health check immediately after print-model upload.
- Simple workflow is locked until a broken model is repaired or rebuilt.
- Conservative repair is tried before stronger voxel rebuild.
- Repaired geometry becomes the new in-memory working source.
- Separate closed printable pieces are accepted and do not require fusion.
- Failure state offers original download / Tools / re-upload rather than continuing on a broken mesh.

### Why
Reduction should never be the first operation on geometry SHRINK already knows is broken.

---

## v2.20 — Compact Simple layout

### Changed
- Stopped the right Simple panel stretching to the full viewer height.
- Removed large dead gaps between controls.
- Kept action controls grouped near the content they belong to.

---

## v2.19 — Three workflow goals experiment

### Added
Simple Print briefly offered:
- **Make it smaller**
- **Make it one solid**
- **Do both**

### Important behaviour
- Fuse-only forced 100% geometry so it did not secretly reduce.
- Fuse/Do both could attempt safe repair.

### Superseded by v2.22
The three-goal choice was removed because Simple mode should decide the technical path rather than asking the user to understand Fuse vs Reduce.

---

## v2.18 — New Simple-mode baseline

### Added / established
- Large Simple-mode print workflow layered over the existing engine.
- Repair core and stronger solid rebuild path.
- Background worker for heavier rebuild work.
- Save/load printer settings.
- Fine tuning, compare and detail-protection tools.
- Simple/Advanced split, later renamed Simple/Tools.
- Current core engine graph remains based on this v2.18 generation.

---

## v2.04 — Voxel/parity remesh direction

### Changed
- Replaced the earlier nearest-normal inside/outside remesh test with a voxel/parity-style rebuild approach.
- Treated sculpt subtools as separate volumes before union-style rebuild.

### Why
The earlier remesh could create floating shards/spikes around dirty overlapping sculpts.

---

## v2.03 — Remesh crash safety

### Added
- Workload/triangle safety gate before heavy browser remeshing.
- More conservative remesh limits.
- Friendly “too heavy to remesh safely in your browser” message.

### Why
Dense sculpts could make Chrome run out of memory during synchronous remesh work.

---

## v2.02 — Mobile warning

### Added
Non-blocking mobile/tablet warning encouraging users to use a laptop/desktop for large 3D files, fusion, rebuild and splitting.

---

## v2.01 — Print upload state

### Added
- Dedicated large **Drop a sculpt here** print-mode upload panel.
- After load, upload collapses to a smaller **Change model** control.

---

## v2.00 — Four-step Print UI

### Added
First major home-user print dashboard:
1. Printer & size
2. Fuse it baby!
3. SHRINK my model
4. Download

### Notes
- Generic Resin / FDM / Custom printer choices.
- Height and quality controls.
- Viewer integrated into the dashboard.
- Split and peg options available on download.
- Existing Game mode preserved.

### Later direction
The v2.00 “Fuse first as a visible step” concept evolved into the current approach where Repair and Reduce are headline jobs and Fuse is an internal/Tools preparation operation.

---

## Earlier print-tool milestones

### v1.92–v1.93
- Added first **Make watertight** repair/remesh UI.
- Added a large automatic “find the smallest that still looks the same” button.

### v1.90–v1.91
- Adjustable split-height slider and live cut plane.
- Fuse diagnostics panel.

### v1.87–v1.89
- Direct split fallback with peg/socket joints and topology warnings.
- Pre-Fuse weld/degenerate/duplicate cleanup.
- Standardised joint orientation: upper section = male pegs; lower/base = sockets.

### v1.77–v1.86
- Introduced Fuse and Split workflows.
- Browser Manifold loading and construction fixes.
- Safety fallbacks.
- Fixed Game mode accidentally inheriting Print protection state during GLB save.

---

## Maintenance rule

For future releases:
- keep this file focused on meaningful behaviour/architecture changes
- do not list every tiny CSS commit
- preserve Git commit messages for implementation-level detail
- update `CLAUDE.md` whenever the handoff rules or architecture change
