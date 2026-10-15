# CHANGELOG — SHRINK 3D

This file records user-facing workflow and architecture changes. Git history remains the authoritative line-by-line record.

## v2.100 — Paint/stamp fixes, Redo, colour swatches, settings from the start screen

- **Stamp**: one click pastes and the stamp is finished (ghost gone, Stamp switches off, the copied patch is kept; press Stamp again to paste another, or hold **Shift** while clicking to keep Stamp on). The ghost only shows while aiming and hides when the pointer leaves the viewer.
- **Esc / lost mouse-up**: Esc now always ends a stroke in progress and leaves the tool; a mouse-up anywhere in the window (e.g. over the wheel sliders), a lost pointer capture or the window losing focus also ends the stroke. Before, a missed mouse-up left the brush (especially Spray) painting and Esc was ignored.
- **Undo / Redo**: Redo button + Ctrl/Cmd+Shift+Z (or Ctrl+Y); 20 steps each way (was undo only). Ctrl/Cmd+Z now works in any mode, not only while a paint tool is on. A new stroke clears Redo. The bumps (normal map) part of a stroke follows undo and redo too.
- **Colours**: Paint now has a colour picker in the tool strip with swatches of the last 12 colours used or picked (this browser only); click one to use it again.
- **Settings file**: "Load settings" is also under the drop zone on the start screen; the file is applied once the model has opened. Saving settings while there is paint says the paint is not in that file (Download GLB keeps the painted model).

## v2.99 — Save / load settings (JSON)

- Under the Optimise button (Game mode): **Save settings** writes `name-SHRINK-settings.json`; **Load settings** reads one back. It stores the target card, Detail kept, texture size/quality, WebP/quantize/meshopt, protect options and every Car wheels setting (on/off, layout, all sliders).
- Loading sets the controls and fires their normal events, so the markers move and the button turns red ("Optimise again"). It does not build or download by itself.
- Not in the file: the model itself, paint edits and Look (material) changes. Unknown or invalid entries are skipped; other JSON files and files from a newer SHRINK are refused with a plain message.
- `settings-file.js` (+ `tests/settings-file.test.mjs`).

## v2.98 — Wheels left / right, on by default

- Adjust wheels: **Front wheels left / right**, **Rear wheels left / right** (shift the axle's wheels sideways) and **Wheels in / out** (wider or narrower track for every pair). Markers move live. `splitWheels(doc, adj)` takes `shiftFront`, `shiftRear`, `track` (tyre radii; positive = the car's right / outward).
- "Separate the wheels" is now ticked by default and the Car wheels box starts open. On a model with no wheels the note says nothing was separated and the model is saved as it was.

## v2.97 — Three-wheelers

- Car wheels panel: **Wheel layout** = 4 wheels (default), 3 wheels (one on the middle line at the front, two at the back) or Auto (try 4, then 3). The three-wheeler gives `Wheel_F`, `Wheel_RL`, `Wheel_RR`; the sliders work on the single front wheel too (a "Front wheel (single)" up/down slider appears in the 3-wheel layout). A single wheel must stand on the ground; a lump on the underside is refused.
- Tested on a synthetic three-wheeler and the Mini (forcing 3 wheels on a four-wheeler is refused). Not yet tried on a real three-wheeler GLB.

## v2.96 — Wheel width

- Adjust wheels: **Front wheel width** and **Rear wheel width** sliders (40–160%). The width decides how far in and out from the tyre's middle triangles count as wheel; markers show it live. `splitWheels(doc, adj)` takes `widthFront` / `widthRear` (factors). Making a wheel wider than the tyre takes in arch/body triangles.

## v2.95 — Plain Game download name

- Game mode saves as `<name>-SHRINK.glb` (no height/adjustment tag like `H953p6`). The Print tools keep their own naming.

## v2.94 — Wheel height per axle and per wheel

- "All wheels up / down" is replaced by **Front wheels up / down** and **Rear wheels up / down**, plus an "Each wheel up / down" fold with a slider for each of the four wheels (added on top of the axle setting). Markers follow live. `splitWheels(doc, adj)` takes `dyFront`, `dyRear` and `dyW: { Wheel_FL, ... }` (tyre radii); the older `dy` still works.

## v2.93 — Game mode: one Optimise button

- New `game-flow.js`. The Save card is now a sticky bar at the bottom of the left panel with **Optimise** and **Download GLB**. Optimise builds the file and no longer downloads it by itself in Game mode.
- Button states: green **Optimise** (nothing built yet), **✔ Optimised** (the built file matches every setting), red **Optimise again** (a setting changed since the build; Download is disabled). Putting a setting back turns it green again. It compares a signature of the left-panel controls on input/change/click; no page-wide observer.
- "Wheels separated!" now shows under the bar. The wheel sliders, markers and reset moved into an "Adjust wheels (only if the markers look wrong)" fold inside Car wheels.
- Print mode is untouched.

## v2.92 — Adjust the wheels

- Car wheels panel: sliders for **front wheels forward/back**, **rear wheels forward/back**, **all wheels up/down** and **wheel size**. With the markers showing they move live; press Optimize again and the split uses the adjusted wheels (`splitWheels(doc, adj)`, units of one tyre radius).
- Markers are now depth-tested. Before, the far-side wheels were drawn through the car and, seen at an angle, looked misplaced when they were not (the detector puts both wheels of an axle at the same position by construction). Turn the car to check the far side.

## v2.91 — Wheel splitter tells you what it did

- After Optimize with "Separate the wheels" ticked, a green "Wheels separated!" line shows in the Car wheels panel, under the result card and in the status line (or "No wheels separated: <reason>"). The panel opens by itself.
- **Show / Hide wheel markers** button: coloured discs in the viewer at the wheels it found (FL red, FR blue, RL amber, RR green). They are for looking only and are never saved.
- Checked on the Dodge GLB Tim sent: its saved file already had Wheel_FR/FL/RR/RL as separate parts; there was just no feedback.

## v2.90 — Separate the wheels; Tron removed

- **Car wheels panel (Game mode).** Tick "Separate the wheels" and press Optimize (or download an edited GLB): the four wheels are cut out of the car as their own parts, `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`, each with its pivot at the wheel's centre, so a game can spin and steer them. It runs on the normal reduce path, so the car keeps its real shape, arches, textures and reflections. Off by default. If no wheels are found the model is saved as it was and the panel says why.
- The preview looks the same as before; the wheels are separate in the saved file only.
- **Tron removed** (tron-core/ui/worker and tests). It could not hold concave shapes such as wheel arches and lost the reflection maps.
- New `wheel-split-core.js` + `wheel-split.js`, test `wheel-split.test.mjs`. Real-browser harness renamed `tests/browser/run-wheels.py`.

## v2.89 — Tron: Baked picture, much smaller files

- **Baked picture (new default).** Tron now paints the original car's colours onto the flat body as one small image. Each face is looked at from the side it faces most (front, back, left, right, top) and takes its picture coordinates from that flat view, so window rims, grille, headlights, door lines and the number plate are as sharp as the picture, instead of one colour per triangle (which gave the jagged, speckled look). "Flat colour per triangle" stays as an option; a **Picture size** menu (512 / 1024 / 2048) sets the image size.
- **Much smaller files.** The saved body now shares corners between neighbouring faces, stores no normals (any viewer flat-shades without them) and stores colours as bytes. Flat colours: 3,000 triangles about 160 KB, 5,650 about 250 KB (was roughly 3x that). Baked at 1024 is about 600 KB, nearly all of it the picture.
- Default is now 3,000 triangles. The wheels, snap and slider are unchanged.
- Real-browser check: `tests/browser/` (headless Chromium with local bundles of the esm.sh libraries). The 1.6M-triangle Mini takes about 6 s in the real page.
- Note: the cream roof Tim saw in v2.88 was the real colour of his 2CV model, not a bug.

## v2.88 — Tron much closer to the real car

- Tron's slider now runs **300 to 20,000 triangles** (logarithmic, so both ends have room) and a higher setting uses a finer voxel grid.
- New **snap** step: after the flat faces are made, every vertex is moved along its normal onto the real skin of the original (the average of the original's points facing the same way), so edges, door handles, lights, window frames and the number plate come back. The Mini at 5,000 triangles now shows them; at 12,000 it is crisp. About 4-5 s in Node for the 1.6M-triangle Mini.
- Colour fix: a model whose normals are missing or all zero (the viewer's copy can be) now gets normals computed, so the roof is no longer painted with the colour of the interior lining.
- The **Make Tron version** button was white (no colour): it now uses the accent colour.

## v2.87 — Tron (beta): flat low-poly cars

- New **Tron (beta)** panel in Game mode (left column, above Retouch textures). It turns a dense car (e.g. a Meshy download) into a solid, flat-faced low-poly car with **four separate wheels** (`Wheel_FL/FR/RL/RR`, origin at the wheel centre, axle along Z, so rotate about Z to spin and about Y to steer). A slider sets the body triangles, 300 to 5,000; a finer slider setting also uses a finer voxel grid.
- Each face is painted one flat colour sampled from the original (facing the same way, so the inside of the roof is ignored). The interior, wipers and aerial are dropped. The loaded model is never changed: Tron shows its car in place of the model, and **Back to the normal model** (or Original/Reduced/Compare, a new model, or a reduction) returns to it. **Download Tron GLB** saves it with vertex colours and no textures (`<name>-TRON<faces>.glb`).
- A car that is long in Z is turned a quarter turn so the output is always length-along-X, Y up. The front is guessed from where the roof sits (the roof is nearer the rear); rename the wheels if it guessed wrong.
- The maths is `tron-core.js` (pure, runs in `tron-worker.js`): wheel fit -> voxel skin from the triangles -> close gaps, fill slice by slice (a real car is not watertight, a 3D flood would leak) -> open (drops spikes) -> cut wheel arches -> blur + Surface Nets -> meshoptimizer simplify -> per-face colours. The 1.6M-triangle test Mini takes about 3 s in Node.
- New tests: `tron.test.mjs` (maths on a made-up car) and `tron-ui.test.mjs` (panel, wheels, slider, save, leaving Tron). Not checked in a real browser: the worker start-up, the texture colour sampling from a real GLB, and the viewer swap are the parts to watch.

## v2.86 — Paint / Clone / Stamp keep your view

- Clicking a paint tool while the Reduced model was showing used to switch to the Original and re-frame the camera. It now switches without re-framing and puts the camera back exactly where you had rotated it.
- Not checked in a real browser.

## v2.85 — One-line header

- The header is now a single row: **SHRINK 3D** [version] · *Reduce your models, keep the detail* … [Runs locally in your browser]. The "GUNPOWDER STUDIOS" line above the title is gone (the footer still credits Gunpowder Studios) and the subtitle no longer changes between Game and Print.
- Not checked in a real browser.

## v2.84 — Switching Paint / Clone / Stamp off

- Click the tool that is already on to switch it off again, press **Esc**, or use the new **Done · Esc** button at the right of the brush strip. The model then goes back to plain rotating (the hidden Navigate mode).
- Not checked in a real browser.

## v2.83 — Viewer really is full height, with a drag handle

- Why it was still short: `ui-mode.css` forced every viewer to `calc(100vh - 200px) !important`, which beat the v2.80 rule. In Game mode on a desktop-width window the viewer is now `calc(100vh - 36px)` tall (the rule is in `ui-mode.css`, after the old one).
- New **drag handle** along the bottom edge of the viewer: drag down to make it taller (up to 2.5 screens), drag up to shrink it, double-click to reset. It is not remembered between visits.
- `style.css` and `ui-mode.css` now carry the release as their cache key (`?v=2.83`), so a changed style sheet is not served stale.
- Not checked in a real browser.

## v2.82 — Paint, Stamp and Clone now handle the bumps too

- The raised lettering and panel edges that stayed visible under repainted areas live in the **normal map**, which 3D painting never touched. A new tick-box in the brush strip, **Flatten the bumps too** (on by default), makes Paint smooth the relief under the paint (gradually when Opacity is low or Spray can is on), makes Stamp smooth what it covers, and makes Clone (**Copy the bumps too**) copy the source area's relief along with its colour.
- The change is made on a private copy of the normal map, shown live, and written into the GLB by **Apply texture to model** along with the colour edits. Undo restores it step by step (multi-undo now numbers its steps and announces undo events).
- The first stroke on a texture reads the whole normal map once, so on a 4096px map it can pause for a moment.
- Stamp's copy no longer adds a spurious entry to the Undo list.
- The pure parts (normal blending across different texture sizes, undo rectangles) are tested in `stamp.test.mjs`; the 3D parts were not run in a real browser. Not handled: a normal map that uses a different UV set from the colour map.

## v2.81 — Paint: Softness and Spray can

- The brush strip under the viewer toolbar gains **Softness** (edge fade, 2–100%; the old fixed look was 28%; 100% = airbrush) for Paint and Clone, and a **Spray can** tick-box for Paint. Spray makes each dab faint, so colour builds up as you go over a spot again and while you hold the button still (a dab every 60 ms).
- Paint is still fully opaque by default (Opacity 100%, 28% soft edge): lower Opacity, raise Softness, tick Spray can for a spray-paint feel.
- Not checked in a real browser.

## v2.80 — Game mode: bigger viewer, brush options on the viewer

- On a desktop-width window the Game viewer is now the full height of the browser window (minus a small margin) and stays in view while the left panel scrolls.
- The big red "Find the smallest…" button under the viewer is gone; the one in the left panel is the only one.
- A tool-options strip sits under the Paint / Clone / Stamp buttons: **Brush size** and **Opacity** (mirroring the left-panel sliders, both ways) for Paint and Clone; Opacity plus Size / Rotate / Flip for Stamp. It hides in Navigate mode so the model gets the room.
- Not checked in a real browser.

## v2.79 — Stamp tool: copy part of the model and paste it somewhere else

- New **Stamp** button next to Clone. Drag a box around something on the model (a number, a badge); that part is copied *as you see it*. Turn the car, aim at the destination (a ghost outline shows size, rotation and flip), click to paste. Paste as many times as you like; Undo works as usual.
- Size (25–300%, 100% = same real-world size as the original), Rotate (-180…180°) and Flip are in a small bar over the viewer. Option/Alt-drag copies something new.
- The copy is a projection, so it comes out upright however the texture's pieces are laid out (unlike Clone, which only works within one view).
- Works on the colour texture only (the one painted in 3D). Details held in the normal or metallic/roughness pictures are not changed.
- The maths is in `stamp-core.js` and tested (`stamp.test.mjs`). The 3D copy/paste itself (raycasting, painting) was not run in a real browser.

## v2.78 — Smaller GLBs without losing looks: data maps at half size

- Pictures that only feed metallic/roughness or AO are now saved at no more than 512px (never enlarged); colour and normal maps keep the chosen size. These maps hold smooth values, so this is the cheapest saving that is barely visible. On by default, with a tick-box in Material look › Smaller file ("Save these two maps at half size") to turn it off. The file-size estimate and the drop-map savings follow it.
- A picture that is also used as base colour, normal or emissive keeps the full size.
- Not run against a real GLB in a browser (the resize happens in the WebP step).

## v2.77 — Game mode viewer: no more washed-out models

- The preview was lit three ways at once (studio reflections + three bright lamps) and tone-mapped with ACES, which brightens and desaturates colours. Game mode now uses the studio light with low-key lamps and Khronos Neutral tone mapping, so a model looks like its textures. Print mode is unchanged.
- This only changes the preview. The GLB file and the colour sliders are untouched. Not checked in a real browser.

## v2.76 — Material look: colour correction and Reflection

- **Colour** (Game mode, Material look): Hue, Saturation and Brightness sliders plus Reset colour. They repaint the base-colour picture (or the plain colour value) of the whole model, in the preview and in the saved GLB. The preview uses a corrected 1024px copy with its own image source; the original texture is never touched. The export repaints at the texture's own size before it is resized (JPEG stays JPEG, others PNG, then WebP if on).
- **Reflection (shininess)**: scales roughness down (sharper, glossier reflections), from the file's own value, preview and saved GLB. It cannot make a surface rougher than its roughness map; use Metallic for less reflection.
- Whole-model only: no masking, so a yellow car's yellow lights shift too.
- Not tested in a real browser: the canvas repaint path ran against a fake canvas in the tests.

## v2.75 — One button: "Make it game-ready" merged into "Find the smallest…"

- Removed the separate 🎮 button. In Game mode, **Find the smallest that still looks the same** (panel and the red button under the viewer) now also reports the file size split (textures / mesh), warns if above the chosen triangle target, and hints at texture size, WebP/Meshopt if off, and droppable maps.
- It no longer switches WebP/Meshopt on or caps triangles at the target; it only tells you. Print mode is unchanged (geometry only).
- Untested in a real browser; the search itself is unchanged.

## v2.74 — Game mode: size breakdown, "Make it game-ready", drop maps that add little

### Why
On a scanned car at 37k triangles the GLB was still ~5 MB: the mesh is ~0.4 MB, the three 2048px textures are ~4.8 MB (and ~64 MB of graphics memory). More triangle reduction does not help; texture work does.

### Added
- **Size breakdown** under "GLB file ≈": *of that: textures ≈ X · mesh ≈ Y*.
- **🎮 Make it game-ready** (Game mode, under "Find the smallest…"): turns WebP + Meshopt on, runs the smallest-that-still-looks-the-same search, never goes above the chosen budget (web 25k / PC 100k / hero 300k), then says where the remaining megabytes are and what else could go (e.g. a smaller "Largest texture size", or the maps below).
- **Material look → Smaller file**: *Drop the metallic/roughness map* (flat roughness slider, default 50%; metal falls to 20% so the car does not turn chrome without its map) and *Drop the occlusion (AO) map*. Each row says what it would save (file + graphics memory, sized at the current texture cap). A packed ORM image is only freed when both maps are dropped, and the panel says so; an image that is also the base colour/normal/emissive map is never offered. Rows hide when the model has no such map.
- Applies to the live preview (original and reduced; un-ticking restores the real maps) and to the saved game GLB / Save edited GLB (`prune()` removes the orphaned images).

### Not covered by an automated test
- The **Make it game-ready** button flow itself (it drives the real reducer's `runExact`); verified by reading only. The size breakdown line and the maps logic are covered (`tests/material.test.mjs`, 245 checks pass overall).

### Version boundaries
- Visible release **v2.74**; `live-ui.js` key 2.57 → 2.74 in `index.html` (it changed); `live-reduce.js` stays 2.57.

---

## v2.73 — Game mode: Material look (turn down the metallic effect)

### Added
- **Material look → Metallic** slider in the Touch up step (Game mode only), with "Car paint (20%)", "No metal (0%)" and "As in the file" buttons. glTF "metallic" makes a surface mirror the room and tint the reflection with its own colour, so a scanned silver car with metallic = 1 looks like chrome. The slider scales every material's metallic factor (a metallic texture too, since glTF multiplies the two).
- It drives the **live preview** (original and reduced, so Compare stays fair, and rebuilt live previews inherit it) and is written into the **saved game GLB** (`optimizeModel`) and **Save edited GLB** (`downloadEdited`). The uploaded file is never touched; opening a new model resets it to "As in the file". The panel says how metallic the model is, or that there is nothing to turn down.
- New file `material-look.js` (loaded from `ui-mode.js`); `app.js` calls `window.__shrinkMaterial.applyToDocument(doc)` at the two write points.

### Not changed
- Roughness is not adjustable: glTF multiplies roughness by a texture and the factor cannot exceed 1, so a rougher-than-texture surface cannot be written back.

### Tests
- `tests/material.test.mjs` (13 checks): preview scaling from the file's own value, rebuilt previews, buttons, export factors, reset on new model. 230 checks pass in total.

### Version boundaries
- Visible release **v2.73**; `app.js` key bumped 2.62 → 2.73 in `index.html` (it changed).

---

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
