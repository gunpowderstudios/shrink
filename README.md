# SHRINK 3D v2.21

Browser tool (everything runs locally). Simple mode is the default in 3D print; Advanced mode keeps the full control panel.

Browser tool (everything runs locally) for shrinking 3D models for games or 3D printing.
See the in-app steps. Inputs: GLB, STL, OBJ, PLY. Outputs: GLB (game), STL / OBJ (print, in mm), GLB (print, uncompressed).

v1.75 = v1.74 (branding, SEO, Matrix theme) on the real v1.7 live-preview core. The v17-*-compat.js shims and
print-preview-fix.js were removed: the core now provides live preview, build-and-download and game/print units itself.
After deploying, hard-refresh (Cmd+Shift+R).

## Versioning
The current **core engine graph is v2.18**. v2.21 is deliberately a Simple-mode UI/workflow layer (`simple-goals.js`, `simple-preflight.js` and their CSS) loaded on top of that proven engine.
Do not retag individual core modules one by one. When the core engine changes again, bump all of its `./file.js?v=X` imports and VERSION constants together so the browser never loads two copies of the same module.

## Simple Print workflow — repair first
v2.21 changes Simple Print so an uploaded model must pass a mesh-health check before the normal SHRINK controls are unlocked:
1. **Upload → automatic model check.** SHRINK checks the original uploaded mesh for open edges, pinched/non-manifold edges and degenerate triangles before reduction starts.
2. **Clean model:** the workflow unlocks automatically and shows a green "Model check passed" message. Separate closed printable pieces are allowed; they do not have to be fused merely to continue.
3. **Needs repair:** the rest of Simple mode stays locked and the user gets **Repair model — keep the detail**. This uses `repair-core.js` to weld coincident points, remove bad triangles, orient faces and close holes while leaving the rest of the surface alone.
4. **Repair succeeds:** SHRINK makes an in-memory repaired STL, automatically re-opens it as the new source model, checks it again, then unlocks the normal workflow. Reduction therefore works from the repaired geometry rather than the broken upload.
5. **Normal repair fails:** SHRINK offers **Stronger fix — rebuild watertight** using `solid-rebuild.js` / the remesh worker. This recreates the outer surface and can soften tiny detail, so it is never automatic.
6. **Stronger rebuild also fails:** Simple mode stops. It offers **Download original**, **Try Advanced**, and **Re-upload repaired file** instead of reducing a mesh that SHRINK could not make reliable.

## Simple mode controls
- **What do you want to do?** This choice now appears only after the upload has passed the repair gate:
  - **Make it smaller** — reduces triangles and leaves separate mesh parts separate.
  - **Make it one solid** — keeps 100% of the repaired source triangle count and joins touching/overlapping printable parts where possible.
  - **Do both** — starts from the checked/repaired source, then reduces and fuses/checks as needed. This is the default/recommended sculpt workflow.
- **Compact panel layout:** the Simple controls hug their content instead of stretching to the viewer height, so action buttons sit directly below the settings rather than leaving a large empty gap.
- **Detail level:** Maximum detail (0.02 mm), Best detail (0.05 mm, the default), Balanced (0.1 mm) or Smallest file (0.2 mm). The automatic shrink keeps the surface within that distance of the original. Best and Maximum check 99.5% of the surface, Balanced 99% and Smallest file 95%, so small detailed areas such as faces, hands and beards are protected by the quality check.
- **Protect fine detail:** paint over faces, hands or ornaments (Cmd/Ctrl + drag rotates while painting). Painted areas are not reduced. This is hidden for Fuse-only because that mode keeps 100% of the mesh.
- **Fine-tune:** after the result, a size strip shows Original vs Now in MB and how much you save, above a live detail slider with Compare next to it. Fine-tune is hidden for Fuse-only.
- **Save / load settings:** settings files store printer type, bed size, print height, detail size and the reduction percentage. The repaired model is still checked before loaded settings can be applied.

## Repair and stronger rebuild
The normal repair is intentionally conservative. It touches only trouble spots and should be tried first. The stronger rebuild is the fallback when topology cannot be repaired locally.

After reduction/fusing, the existing solid check still runs as a second safety pass. If a later operation creates a new mesh problem, SHRINK can still warn or repair it before download.

## Solid rebuild
The stronger rebuild traces the model into a voxel grid, seals manageable gaps, fills enclosed interiors and recreates a watertight mesh. It runs in a background worker where available. Because it recreates the whole surface, detail finer than the chosen voxel size can soften; this is why v2.21 never runs it automatically.

## Licence
**SHRINK 3D © 2026 Gunpowder Studios**
Free to download and use for personal, non-commercial purposes. You may not sell it, sublicense it, or include it in a paid product or service without written permission. To ask about commercial use, get in touch via www.gunpowderstudios.co.uk.
Third-party libraries used by SHRINK 3D remain under their own licences (see Third-party libraries below).

## Third-party libraries
SHRINK 3D runs in the browser on these third-party libraries, loaded from public CDNs (check each project's own licence page for the exact terms before redistributing):
three.js (MIT), glTF-Transform (MIT), meshoptimizer (MIT), three-mesh-bvh (MIT), fflate (MIT) and Manifold (Apache-2.0).
