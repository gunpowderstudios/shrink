# CHANGELOG — SHRINK 3D

This file records user-facing workflow and architecture changes. Git history remains the authoritative line-by-line record.

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
