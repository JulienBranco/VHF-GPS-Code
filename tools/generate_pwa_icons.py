"""Regenerate the PNG icons shipped with the offline web app (requires Pillow)."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "icons"
ICON_DIR.mkdir(exist_ok=True)


def make_icon(size: int, path: Path, maskable: bool = False) -> None:
    scale = 4
    pixels = size * scale
    image = Image.new("RGB", (pixels, pixels), "#06131a")
    draw = ImageDraw.Draw(image)

    def box(*coords: float) -> tuple[int, ...]:
        return tuple(round(value * pixels) for value in coords)

    radius = round(pixels * (0.145 if maskable else 0.19))
    if not maskable:
        draw.rounded_rectangle((0, 0, pixels - 1, pixels - 1), radius=radius, fill="#06131a")

    # All meaningful marks stay inside the maskable safe area.
    draw.ellipse(box(0.19, 0.19, 0.81, 0.81), fill="#62ddb7")
    draw.ellipse(box(0.245, 0.245, 0.755, 0.755), fill="#0c222c")

    line = round(0.024 * pixels)
    draw.line(box(0.5, 0.14, 0.5, 0.265), fill="#eaf9f7", width=line)
    draw.line(box(0.5, 0.735, 0.5, 0.86), fill="#eaf9f7", width=line)
    draw.line(box(0.14, 0.5, 0.265, 0.5), fill="#eaf9f7", width=line)
    draw.line(box(0.735, 0.5, 0.86, 0.5), fill="#eaf9f7", width=line)

    # A simple north-pointing needle and a smaller south half.
    draw.polygon(
        [box(0.5, 0.31), box(0.41, 0.585), box(0.5, 0.535)],
        fill="#ffffff",
    )
    draw.polygon(
        [box(0.5, 0.31), box(0.59, 0.585), box(0.5, 0.535)],
        fill="#c5f5e2",
    )
    draw.polygon(
        [box(0.41, 0.585), box(0.5, 0.535), box(0.5, 0.69)],
        fill="#188d72",
    )
    draw.polygon(
        [box(0.59, 0.585), box(0.5, 0.535), box(0.5, 0.69)],
        fill="#0e654f",
    )
    draw.ellipse(box(0.475, 0.475, 0.525, 0.525), fill="#ffffff")

    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(path, optimize=True)


if __name__ == "__main__":
    make_icon(192, ICON_DIR / "icon-192.png")
    make_icon(512, ICON_DIR / "icon-512.png")
    make_icon(512, ICON_DIR / "icon-maskable-512.png", maskable=True)
    make_icon(180, ICON_DIR / "apple-touch-icon.png")
