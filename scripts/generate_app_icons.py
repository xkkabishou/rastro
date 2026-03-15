#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"
ICONSET_DIR = ICONS_DIR / "rastro_icon.iconset"
SOURCE_ICON_PATH = ICONS_DIR / "source-icon.png"


PNG_OUTPUTS = {
    "icon.png": 1024,
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

ICONSET_OUTPUTS = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}


def build_icon() -> Image.Image:
    return Image.open(SOURCE_ICON_PATH).convert("RGBA").resize((1024, 1024), Image.Resampling.LANCZOS)


def resize_icon(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def write_png_outputs(image: Image.Image) -> None:
    for filename, size in PNG_OUTPUTS.items():
        resize_icon(image, size).save(ICONS_DIR / filename)


def write_iconset_outputs(image: Image.Image) -> None:
    if ICONSET_DIR.exists():
        shutil.rmtree(ICONSET_DIR)
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)

    for filename, size in ICONSET_OUTPUTS.items():
        resize_icon(image, size).save(ICONSET_DIR / filename)


def write_platform_icons(image: Image.Image) -> None:
    image.save(
        ICONS_DIR / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    subprocess.run(
        ["iconutil", "--convert", "icns", str(ICONSET_DIR), "-o", str(ICONS_DIR / "icon.icns")],
        check=True,
    )


def main() -> None:
    icon = build_icon()
    write_png_outputs(icon)
    write_iconset_outputs(icon)
    write_platform_icons(icon)


if __name__ == "__main__":
    main()
