#!/usr/bin/env python3
"""Extract Uki sitting reference figures from the green-screen JPG sheets.

Run from repository root:
  python karakter/uki/_proses/proses_duduk.py

Requires Pillow and NumPy (already used by the existing Uki pipeline).
Outputs transparent PNGs under karakter/uki/poses/sitting/references/.
The original JPG sheets are never modified.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "_mentah"
OUT = ROOT / "poses" / "sitting" / "references"

# The source sheets contain three isolated figures in left-to-right panels:
# 0 = standing scale reference, 1 and 2 = sitting pose references.
SHEETS = {
    "A": {"file": "uki_duduk_A.jpg", "poses": {1: "sit_chair_neutral_a", 2: "sit_chair_lean_a"}},
    "B": {"file": "uki_duduk_B.jpg", "poses": {1: "sit_floor_crosslegged_b", 2: "sit_chair_neutral_b"}},
    "C": {"file": "uki_duduk_C.jpg", "poses": {1: "sit_chair_neutral_c", 2: "sit_chair_lean_c"}},
    "D": {"file": "uki_duduk_D.jpg", "poses": {1: "sit_floor_crosslegged_d", 2: "sit_wide_legs_d"}},
}
# Equal panel partitions are intentionally used as a starting point. A small
# overlap protects hands/shoes that approach a panel boundary.
PANEL_COUNT = 3
PANEL_OVERLAP = 24


def remove_green(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    # Key only saturated green-dominant pixels. A soft transition preserves
    # anti-aliased edges while avoiding a hard, jagged silhouette.
    dominance = green - np.maximum(red, blue)
    saturation = green - np.minimum(red, blue)
    key_strength = np.minimum(dominance - 28.0, saturation - 34.0)
    alpha = 255.0 - np.clip((key_strength - 8.0) * (255.0 / 52.0), 0.0, 255.0)

    # Despill only partially transparent edge pixels; fully opaque colors stay
    # unchanged so green clothing details are not indiscriminately recolored.
    edge = (alpha > 0) & (alpha < 250)
    spill = np.maximum(0.0, green - np.maximum(red, blue))
    rgb[..., 1][edge] = np.maximum(np.maximum(red[edge], blue[edge]), green[edge] - spill[edge] * 0.82)

    rgba = np.dstack((np.clip(rgb, 0, 255), alpha)).astype(np.uint8)
    result = Image.fromarray(rgba, "RGBA")

    # Remove isolated chroma-key noise without shrinking the character contour.
    a = result.getchannel("A").filter(ImageFilter.MedianFilter(3))
    result.putalpha(a)
    return result


def trim_transparent(image: Image.Image, pad: int = 12) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise ValueError("No foreground detected; check the source panel/key settings.")
    x0, x1 = max(0, int(xs.min()) - pad), min(image.width, int(xs.max()) + 1 + pad)
    y0, y1 = max(0, int(ys.min()) - pad), min(image.height, int(ys.max()) + 1 + pad)
    return image.crop((x0, y0, x1, y1))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = {
        "schema_version": 1,
        "character": "uki",
        "kind": "reference_pose_assets",
        "canvas": "transparent_trimmed_png",
        "notes": [
            "These are static pose references, not animation frames.",
            "The source figures have no heads; attach a compatible head using a neck anchor after review.",
            "Chair is a separate prop and is not included in the source images.",
            "Green-screen removal is an initial automated pass; inspect edges before production use.",
        ],
        "poses": [],
    }

    for sheet_id, spec in SHEETS.items():
        source_path = SOURCE / spec["file"]
        if not source_path.is_file():
            raise FileNotFoundError(f"Missing source sheet: {source_path}")
        source = Image.open(source_path).convert("RGB")
        keyed = remove_green(source)
        for panel_index, pose_id in spec["poses"].items():
            left = max(0, round(source.width * panel_index / PANEL_COUNT) - PANEL_OVERLAP)
            right = min(source.width, round(source.width * (panel_index + 1) / PANEL_COUNT) + PANEL_OVERLAP)
            panel = trim_transparent(keyed.crop((left, 0, right, source.height)))
            filename = f"{pose_id}.png"
            panel.save(OUT / filename, optimize=True)
            catalog["poses"].append({
                "id": pose_id,
                "source": f"_mentah/{spec['file']}",
                "source_panel": panel_index,
                "file": f"references/{filename}",
                "width": panel.width,
                "height": panel.height,
                "has_head": False,
                "has_chair": False,
            })
            print(f"{pose_id}: {panel.width}x{panel.height}")

    (OUT.parent / "pose_manifest.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Pose manifest written: {OUT.parent / 'pose_catalog.json'}")


if __name__ == "__main__":
    main()
