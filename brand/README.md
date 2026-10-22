# Ridge Co brand assets

- **Source of truth:** Drive file `1zqfvOy9RcHx--PEa8uHIUGLrYfNWaa9a` (Gemini_Generated_Image_kwawdckwawdckwaw.png, the "facebook logo for ridge co"), in logo folder `1w0o-7ggmpX122UfeIlX_dfauP8XcWoWu`. Sibling: `Ridge facebook logo.png` (`1Ig_CuLavxk11z2vkE3r_r9kh2of25L1p`).
- **Brand navy:** `#253562`. Mark = square frame (stroke 23 of 376) + solid peak triangle. Wordmark = stencil "Ridge Co."
- **Rebuild everything** (full lockup SVG, transparent PNGs, app icons 180/192/512/1024, maskable): `pip install pillow numpy potracer cairosvg && python3 -I brand/make_brand.py <source.png> <outdir>`.
- **Mark SVGs** (`ridgeco-mark-*.svg`) are exact geometry and safe to recolor via `fill`.
- **`icon-template.svg`** is the per-owner home-screen icon: replace `{{BRAND_BG}}` (owner primary color; default `#253562`) and `{{BRAND_FG}}` (default `#ffffff`), then rasterize to 180/192/512 PNG. Used by the hybrid white-label icon mechanism.
- Full-lockup SVG/PNG set lives in the Drive logo folder (uploaded 2026-10-22) and regenerates from the script.
