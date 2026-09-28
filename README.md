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
