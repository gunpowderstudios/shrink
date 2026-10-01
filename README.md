# SHRINK 3D

A browser-based app for reducing and optimising 3D files for gaming or 3D printing.

## Features

- Opens GLB, STL, OBJ and PLY models.
- Live 3D polygon-reduction preview.
- 3D viewer with orbit, zoom and pan.
- Compare the original and reduced model before saving.
- Game targets for web/mobile, PC/console and close-up/hero assets.
- Resin/FDM print presets and print-detail checks.
- Polygon reduction with Meshoptimizer.
- Optional mesh quantization and Meshopt compression.
- Texture resizing and WebP conversion for game GLBs.
- 3D texture painting, colour picking and clone retouching.
- Protect-detail brush for print models.
- Detail-loss heatmap and topology/watertight checks.
- STL / OBJ export in millimetres for printing.
- Runs entirely in the browser; models are not uploaded to a server.

## GitHub Pages

The project is static and can be hosted directly with GitHub Pages from the repository root on the `main` branch.

## Notes

The first load downloads Three.js, glTF-Transform and Meshoptimizer from public ES module CDNs. After loading a model, reduction and optimisation happen locally in the browser.
