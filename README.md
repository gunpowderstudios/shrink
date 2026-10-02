# SHRINK 3D v2.09

Browser tool (everything runs locally). v2.09 adds Simple mode (default in 3D print): pick a printer, press one button, download. Advanced mode is the full control panel and is unchanged.

Browser tool (everything runs locally) for shrinking 3D models for games or 3D printing.
See the in-app steps. Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).

v1.75 = v1.74 (branding, SEO, Matrix theme) on the real v1.7 live-preview core. The v17-*-compat.js shims and
print-preview-fix.js were removed: the core now provides live preview, build-and-download and game/print units itself.
After deploying, hard-refresh (Cmd+Shift+R).

Versioning: every ./file.js?v=X import and every VERSION constant must use the same number (currently 2.09).
A different ?v= string makes the browser load a second, separate copy of that module. Bump all of them together.

## Licence
**SHRINK 3D © 2026 Gunpowder Studios**
Free to download and use for personal, non-commercial purposes. You may not sell it, sublicense it, or include it in a paid product or service without written permission. To ask about commercial use, get in touch via www.gunpowderstudios.co.uk.
Third-party libraries used by SHRINK 3D remain under their own licences (see Third-party libraries below).

## Third-party libraries
SHRINK 3D runs in the browser on these third-party libraries, loaded from public CDNs (check each project's own licence page for the exact terms before redistributing):
three.js (MIT), glTF-Transform (MIT), meshoptimizer (MIT), three-mesh-bvh (MIT), fflate (MIT) and Manifold (Apache-2.0).
