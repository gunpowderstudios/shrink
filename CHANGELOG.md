# CHANGELOG — SHRINK 3D

This file records user-facing workflow and architecture changes. Git history remains the authoritative line-by-line record.

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
