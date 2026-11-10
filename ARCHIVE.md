# ARCHIVE — retired SHRINK 3D notes

These sections describe code that is no longer in the repository (the Simple wizard, deleted in v2.239; the Racer preset, deleted in v2.239) or layout experiments that were replaced. They are kept only for history. Do not follow them for current work; `CLAUDE.md` is the live handoff.

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

## Racer preset (v2.119; removed from the page in v2.230: card deleted from index.html, `racer.js` no longer imported by ui-mode.js, files and tests kept dormant)
- Target card `data-target="racer"` (no triangle target; `GAME_TARGETS.racer.tris` is null, so `live-ui.js` leaves Detail kept alone). `racer.js` owns the panel (`#racerPanel`) and `window.__shrinkRacer`; `app.js` `optimizeModel` calls `__shrinkRacer.process(document, progress)` instead of the generic WebP step when the card is active.
- `racer-core.js` is DOM-free: `plan()` (pure estimate/report), `mergeable()`, `apply()` (merge atlas -> prune -> resize/encode each texture). Pixel work goes through the `ops` object (`decode`/`encode`/`prune`/`enableWebP`) supplied by the page, so Node tests use fakes. Budget: target 12 MB, FAIL at 46 MB of GPU memory (w*h*4*1.33).
- Merge keeps the first used material and reassigns every primitive to it; each primitive gets a NEW `TEXCOORD_0` accessor (accessors may be shared). Plain-colour parts without UVs point at their colour tile. Do not merge transparent, KHR_materials_* or tiling-UV materials.

