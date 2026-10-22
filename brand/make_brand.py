#!/usr/bin/env python3
"""Rebuild the Ridge Co logo as vector + raster set from the Drive source PNG.
Usage: python3 -I make_brand.py SRC_PNG OUT_DIR   (needs Pillow, numpy, potracer, cairosvg)
Mark geometry is exact (measured from source); wordmark is traced from a 4x upscaled threshold."""
import sys, os, numpy as np, potrace, cairosvg
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
NAVY = "#253562"

# ---- wordmark trace (source px region x219-933, y594-726)
im = Image.open(src).convert("RGB")
X0, Y0, X1, Y1 = 205, 585, 948, 740
crop = im.crop((X0, Y0, X1, Y1))
S = 4
big = crop.resize((crop.width*S, crop.height*S), Image.LANCZOS)
a = np.array(big).astype(int)
dark = (a[..., 0] < 120) & (a[..., 1] < 120) & (a[..., 2] < 175) & (a[..., 2] > a[..., 0])
bm = potrace.Bitmap(~dark)
plist = bm.trace(turdsize=40, alphamax=0.9, opttolerance=0.4)
def fmt(v): return f"{v:.2f}".rstrip("0").rstrip(".")
parts = []
for curve in plist:
    s = curve.start_point
    d = [f"M{fmt(s.x/S+X0)} {fmt(s.y/S+Y0)}"]
    for seg in curve.segments:
        if seg.is_corner:
            d.append(f"L{fmt(seg.c.x/S+X0)} {fmt(seg.c.y/S+Y0)}L{fmt(seg.end_point.x/S+X0)} {fmt(seg.end_point.y/S+Y0)}")
        else:
            d.append(f"C{fmt(seg.c1.x/S+X0)} {fmt(seg.c1.y/S+Y0)} {fmt(seg.c2.x/S+X0)} {fmt(seg.c2.y/S+Y0)} {fmt(seg.end_point.x/S+X0)} {fmt(seg.end_point.y/S+Y0)}")
    d.append("Z"); parts.append("".join(d))
WORD = "".join(parts)

# ---- mark: 376x376 square frame, stroke 23, triangle
FRAME_D = "M0 0H376V376H0Z M23 23V353H353V23Z"   # frame (evenodd)
PEAK_D = "M188 129L316 353H60Z"                  # peak (separate path so it never cancels the frame)
def mark_svg(color, vb="0 0 376 376"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Ridge Co mark">'
            f'<path fill="{color}" fill-rule="evenodd" d="{FRAME_D}"/><path fill="{color}" d="{PEAK_D}"/></svg>')
def lockup_svg(color, bg=None):
    r = f'<rect x="170" y="125" width="800" height="640" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="170 125 800 640" role="img" aria-label="Ridge Co.">{r}'
            f'<g fill="{color}"><g transform="translate(392 160)"><path fill-rule="evenodd" d="{FRAME_D}"/><path d="{PEAK_D}"/></g>'
            f'<path fill-rule="evenodd" d="{WORD}"/></g></svg>')
def icon_svg(bg, fg, scale=0.56, size=512):
    m = size*scale; o = (size-m)/2; k = m/376
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}"><rect width="{size}" height="{size}" fill="{bg}"/>'
            f'<g fill="{fg}" transform="translate({o:.2f} {o:.2f}) scale({k:.5f})"><path fill-rule="evenodd" d="{FRAME_D}"/><path d="{PEAK_D}"/></g></svg>')
def w(name, txt): open(os.path.join(out, name), "w").write(txt)
def png(name, svg, px, bgfill=None):
    cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(out, name), output_width=px, output_height=None if "logo" in name else px)

w("ridgeco-logo-navy.svg", lockup_svg(NAVY)); w("ridgeco-logo-white.svg", lockup_svg("#ffffff"))
w("ridgeco-mark-navy.svg", mark_svg(NAVY)); w("ridgeco-mark-white.svg", mark_svg("#ffffff"))
png("ridgeco-logo-navy-2400.png", lockup_svg(NAVY), 2400); png("ridgeco-logo-white-2400.png", lockup_svg("#ffffff"), 2400)
png("ridgeco-mark-navy-1024.png", mark_svg(NAVY), 1024); png("ridgeco-mark-white-1024.png", mark_svg("#ffffff"), 1024)
# app icons: full-bleed (iOS/Android apply their own masks), mark white on brand color; maskable uses a smaller safe-zone scale
for sz, nm in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png"), (1024, "icon-1024.png")]:
    png(nm, icon_svg(NAVY, "#fff"), sz)
png("icon-maskable-512.png", icon_svg(NAVY, "#fff", scale=0.46), 512)
w("icon-template.svg", icon_svg("{{BRAND_BG}}", "{{BRAND_FG}}"))
print("done", len(WORD), "path chars")
