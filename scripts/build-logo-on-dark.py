"""Builds the dark-background logo variant from the official supplied asset.

Source: src/assets/the-ai-school-logo.png (official red logo, white background,
black "THE"). Output: src/assets/the-ai-school-logo-on-dark.png (transparent
background, "AI SCHOOL" kept in the original red, only "THE" lettering turned
white). No shapes are redrawn: every pixel is derived from the source by
un-mixing it from the white background, so anti-aliased edges stay sharp.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "assets" / "the-ai-school-logo.png"
OUT = ROOT / "src" / "assets" / "the-ai-school-logo-on-dark.png"


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    px = src.load()

    # Sample the solid brand red from fully saturated pixels of the source.
    reds = [
        px[x, y]
        for y in range(h)
        for x in range(w)
        if px[x, y][0] > 180 and px[x, y][1] < 70 and px[x, y][2] < 70
    ]
    brand = tuple(sorted(c[i] for c in reds)[len(reds) // 2] for i in range(3))

    # Darkest neutral ink used for "THE".
    ink = min(
        (sum(px[x, y]) / 3 for y in range(h) for x in range(w) if max(px[x, y]) - min(px[x, y]) < 25),
        default=30,
    )

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r - (g + b) / 2 > 35:
                # Red artwork: un-mix from white using the green channel.
                a = (255 - g) / max(1, 255 - brand[1])
                op[x, y] = (*brand, max(0, min(255, round(a * 255))))
            else:
                # Neutral ink ("THE") or background: luminance -> alpha, recolour white.
                lum = (r + g + b) / 3
                a = (255 - lum) / max(1, 255 - ink)
                op[x, y] = (255, 255, 255, max(0, min(255, round(a * 255))))

    # Drop near-invisible compression noise from the source's white background.
    alpha = out.getchannel("A").point(lambda v: 0 if v < 12 else v)
    out.putalpha(alpha)

    bbox = out.getbbox()
    if bbox:
        pad = 4
        out = out.crop(
            (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad))
        )
    out.save(OUT, "PNG", optimize=True)
    print(f"brand red={brand} ink={ink:.0f} -> {OUT.name} {out.size}")


if __name__ == "__main__":
    main()
