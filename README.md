# SHRINK 3D v2.07

Browser tool (everything runs locally). v2.07 adds Simple mode (default in 3D print): pick a printer, press one button, download. Advanced mode is the full control panel and is unchanged.

Browser tool (everything runs locally) for shrinking 3D models for games or 3D printing.
See the in-app steps. Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).

v1.75 = v1.74 (branding, SEO, Matrix theme) on the real v1.7 live-preview core. The v17-*-compat.js shims and
print-preview-fix.js were removed: the core now provides live preview, build-and-download and game/print units itself.
After deploying, hard-refresh (Cmd+Shift+R).

Versioning: every ./file.js?v=X import and every VERSION constant must use the same number (currently 2.07).
A different ?v= string makes the browser load a second, separate copy of that module. Bump all of them together.
