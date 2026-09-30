# Shrink

A browser-based GLB optimizer for game assets.

## Features

- Drag-and-drop `.glb` files.
- 3D viewer with orbit, zoom and pan.
- Compare the original and optimized model before saving.
- Presets for Safe, Game Optimized, Small and Aggressive output.
- Polygon reduction with Meshoptimizer.
- Optional mesh quantization.
- Texture resizing and WebP conversion.
- Shows original/optimized file size and percentage saved.
- Runs entirely in the browser; models are not uploaded to a server.

## GitHub Pages

The project is static and can be hosted directly with GitHub Pages from the repository root on the `main` branch.

## Notes

The first load downloads Three.js, glTF-Transform and Meshoptimizer from public ES module CDNs. After loading a model, optimization happens locally in the browser.

## v1.5 — Print & Share
- Opens GLB, STL, OBJ, PLY.
- Figure height (mm) + printer detail (mm) + target triangles, with live STL/OBJ/GLB size estimates.
- Protect brush: paint areas whose detail must survive; everything else is reduced first.
- Compare: drag a divider across the model (original | reduced).
- Detail loss: heat map of how far the reduction moved the original surface, in mm vs your printer detail.
- Save STL / OBJ in mm (Z-up option for slicers).
- Paint engine rewrite: fast BVH raycasting, true 3D brush (no UV streaks), screen-space strokes, projective clone, per-texture edits.
Files new in 1.5: mesh-tools.js, bvh-support.js, print-tools.js. All other listed files replace the old ones.
