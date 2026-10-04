# CLAUDE.md — SHRINK 3D handoff notes

Read this file before changing the repository.

## Current baseline

- Current user-facing release: **v2.29**
- Default branch: **main**
- The current core engine graph is still **v2.18**.
- v2.19–v2.25 are deliberately layered mainly through Simple-mode workflow/UI files rather than retagging the whole engine graph.
- Current public app: https://gunpowderstudios.github.io/shrink/

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
- stop Simple mode
- offer original download / Tools / re-upload
- do not reduce a mesh SHRINK considers broken

Separate closed printable pieces are allowed. They do not have to be fused simply to continue.

### Mesh health: one definition
`repair-core.js` owns it via `meshHealth`. Preflight, post-reduction guard and repair results must all use that definition.

Clean = no open edges, no tangled (3+) edges, no flipped edges. Empty/degenerate triangles are reported but do not block the Simple workflow.

Do not reintroduce a second topology check with a different weld tolerance. Heavy repair/health work runs in `repair-worker.js` where supported. The repair graph (`repair-core.js`, `repair-worker.js`, `solid-rebuild.js`) uses cache key **2.27**, independently of the v2.18 engine graph.

### 2. Repair is also a standalone feature
After a repair/rebuild succeeds, pause and allow:

- **Download repaired STL**
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

## Desktop viewport sizing
- Desktop workspace height is dynamic, not a fixed pixel cap.
- `panel-layout.js` measures each active workspace's actual `getBoundingClientRect().top` and sets `--shrink-workspace-height` to the remaining viewport height.
- Simple controls and viewer must both stretch to this height; controls may scroll internally.
- Do not reintroduce the old `max-height:900px` cap.
- Resize events recalculate the workspace so different desktop/laptop screens fit neatly.
- Mobile sizing rules remain separate.

## Dockable panel layout
- Desktop Controls and Viewer are intentionally user-reorderable via `panel-layout.js` / `panel-layout.css`.
- Preference key: `shrink-panel-side` with values `left` or `right`.
- Do not hard-code the viewer or controls permanently to one desktop side.
- Game mode uses the native `#workspace` grid.
- Simple Print uses explicit columns in `.v2-top-grid` so dynamically inserted preflight/control cards stay together opposite the viewer.
- Mobile remains stacked; drag handles are hidden at <=900px.
- This is UI-only. Do not couple panel placement to repair/reduction state.

## Game viewer layout
- The navigation hint (**Drag to rotate · Scroll to zoom · Right-drag to pan**) belongs inside the 3D viewer canvas.
- The large red **Find the smallest that still looks the same** button belongs below the viewer in its own row.
- Do not position both relative to the full viewer panel; that caused them to overlap.

## Viewer/UI rules

- Before reduction, do **not** show Original/Reduced controls because there is no meaningful reduced result yet.
- After a real reduction completes, Original/Reduced and Compare can appear.
- Reduced print preview normals must be recomputed after connectivity changes so the model does not appear artificially dark.
- Once a model is loaded on desktop, the header/branding should collapse to reclaim height.
- Viewer and controls may be on either side according to the saved dock preference.
- Simple control panel scrolls independently on the right.
- Avoid large dead vertical gaps.
- Mobile warning is intentionally cheeky but non-blocking.

## Important files

### Current Simple workflow layer
- `panel-layout.js`
- `panel-layout.css`
- `simple-wizard.js`
- `simple-wizard.css`
- `simple-preflight.js`
- `simple-postreduce.js`
- `simple-focus.js`
- `simple-mode.js`
- `simple-mode.css`

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
