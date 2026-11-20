#!/usr/bin/env python3
"""Extract Uki sitting references from green-screen JPG sheets.

Run from repository root:
  python karakter/uki/_proses/proses_duduk.py

Requires Pillow and NumPy. Original JPG sheets are never modified.
Outputs PNG references, a manifest, a visual contact sheet and QA report.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "_mentah"
POSE_DIR = ROOT / "poses" / "sitting"
OUT = POSE_DIR / "references"

# Each source sheet has three equal-width panels:
# 0 = standing reference, 1 and 2 = sitting references.
SHEETS = {
    "A": {"file": "uki_duduk_A.jpg", "poses": {1: "sit_chair_neutral_a", 2: "sit_chair_lean_a"}},
    "B": {"file": "uki_duduk_B.jpg", "poses": {1: "sit_floor_crosslegged_b", 2: "sit_chair_neutral_b"}},
    "C": {"file": "uki_duduk_C.jpg", "poses": {1: "sit_chair_neutral_c", 2: "sit_chair_lean_c"}},
    "D": {"file": "uki_duduk_D.jpg", "poses": {1: "sit_floor_crosslegged_d", 2: "sit_wide_legs_d"}},
}
PANEL_COUNT = 3
PADDING = 12


def remove_green(image: Image.Image) -> Image.Image:
    """Apply a soft green chroma key and mild edge despill."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32).copy()
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    dominance = green - np.maximum(red, blue)
    saturation = green - np.minimum(red, blue)
    key_strength = np.minimum(dominance - 28.0, saturation - 34.0)
    alpha = 255.0 - np.clip((key_strength - 8.0) * (255.0 / 52.0), 0.0, 255.0)

    # Reduce green spill only on partially transparent edge pixels.
    edge = (alpha > 0) & (alpha < 250)
    spill = np.maximum(0.0, green - np.maximum(red, blue))
    rgb[..., 1][edge] = np.maximum(
        np.maximum(red[edge], blue[edge]),
        green[edge] - spill[edge] * 0.85,
    )

    rgba = np.dstack((np.clip(rgb, 0, 255), alpha)).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def trim_transparent(image: Image.Image, pad: int = PADDING) -> tuple[Image.Image, tuple[int, int, int, int]]:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise ValueError("No foreground detected; check the source panel and chroma-key settings.")

    bounds = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(image.width, int(xs.max()) + 1 + pad),
        min(image.height, int(ys.max()) + 1 + pad),
    )
    return image.crop(bounds), bounds


def make_contact_sheet(items: list[tuple[str, Image.Image]]) -> Path:
    cols, cell_w, cell_h = 4, 320, 380
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "#eeeeee")
    draw = ImageDraw.Draw(sheet)

    for index, (pose_id, pose) in enumerate(items):
        col, row = index % cols, index // cols
        x, y = col * cell_w, row * cell_h

        # Checkerboard makes transparent areas and green fringes easier to spot.
        tile = Image.new("RGBA", (cell_w - 20, cell_h - 54), "#f4f4f4")
        tile_draw = ImageDraw.Draw(tile)
        checker = 16
        for cy in range(0, tile.height, checker):
            for cx in range(0, tile.width, checker):
                if (cx // checker + cy // checker) % 2:
                    tile_draw.rectangle(
                        (cx, cy, min(cx + checker - 1, tile.width), min(cy + checker - 1, tile.height)),
                        fill="#d8d8d8",
                    )

        preview = pose.copy()
        preview.thumbnail((tile.width - 16, tile.height - 16), Image.Resampling.LANCZOS)
        px = (tile.width - preview.width) // 2
        py = (tile.height - preview.height) // 2
        tile.alpha_composite(preview, (px, py))
        sheet.paste(tile.convert("RGB"), (x + 10, y + 6))
        draw.text((x + 10, y + cell_h - 38), pose_id, fill="#202020")

    path = POSE_DIR / "pose_contact_sheet.jpg"
    sheet.save(path, quality=92, optimize=True)
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    POSE_DIR.mkdir(parents=True, exist_ok=True)

    manifest = {
        "schema_version": 1,
        "character": "uki",
        "kind": "reference_pose_assets",
        "canvas": "transparent_trimmed_png",
        "notes": [
            "Static pose references, not animation frames.",
            "Source figures have no heads; attach a compatible head using a neck anchor after review.",
            "Chair is a separate prop and is not included in the source images.",
            "Green-screen removal is an automated first pass; inspect the contact sheet before production use.",
        ],
        "poses": [],
    }
    qa = {"schema_version": 1, "checks": [], "warnings": []}
    contact_items: list[tuple[str, Image.Image]] = []

    for sheet_id, spec in SHEETS.items():
        source_path = SOURCE / spec["file"]
        if not source_path.is_file():
            raise FileNotFoundError(f"Missing source sheet: {source_path}")

        source = Image.open(source_path).convert("RGB")
        panel_edges = [round(source.width * i / PANEL_COUNT) for i in range(PANEL_COUNT + 1)]
        keyed_sheet = remove_green(source)

        for panel_index, pose_id in spec["poses"].items():
            # No overlap: prevents pixels from the neighbouring figure entering this pose.
            left, right = panel_edges[panel_index], panel_edges[panel_index + 1]
            raw_panel = keyed_sheet.crop((left, 0, right, source.height))
            panel, bounds = trim_transparent(raw_panel)

            x0, y0, x1, y1 = bounds
            touches_edge = x0 <= PADDING or y0 <= PADDING or x1 >= raw_panel.width - PADDING or y1 >= raw_panel.height - PADDING
            if touches_edge:
                qa["warnings"].append({
                    "pose_id": pose_id,
                    "warning": "Foreground reaches a panel boundary; inspect for possible clipping.",
                })

            alpha = np.asarray(panel.getchannel("A"))
            visible = alpha > 8
            semi = (alpha > 8) & (alpha < 247)
            visible_count = int(visible.sum())
            transparent_ratio = float(1.0 - visible.mean()) if visible.size else 1.0

            # Residual green is measured on visible pixels, not treated as an automatic failure.
            rgba = np.asarray(panel.convert("RGBA"))
            rgb = rgba[..., :3].astype(np.int16)
            visible_rgb = rgb[visible]
            green_pixels = (
                (visible_rgb[:, 1] > visible_rgb[:, 0] + 35)
                & (visible_rgb[:, 1] > visible_rgb[:, 2] + 35)
            ) if len(visible_rgb) else np.array([], dtype=bool)
            green_ratio = float(green_pixels.mean()) if len(green_pixels) else 0.0

            filename = f"{pose_id}.png"
            panel.save(OUT / filename, optimize=True)
            contact_items.append((pose_id, panel.copy()))

            entry = {
                "id": pose_id,
                "source": f"_mentah/{spec['file']}",
                "source_panel": panel_index,
                "file": f"references/{filename}",
                "width": panel.width,
                "height": panel.height,
                "has_head": False,
                "has_chair": False,
            }
            manifest["poses"].append(entry)
            qa["checks"].append({
                "pose_id": pose_id,
                "width": panel.width,
                "height": panel.height,
                "visible_pixels": visible_count,
                "semi_transparent_edge_pixels": int(semi.sum()),
                "transparent_pixel_ratio": round(transparent_ratio, 4),
                "residual_green_pixel_ratio": round(green_ratio, 4),
                "touches_panel_boundary": touches_edge,
                "alpha_channel": panel.mode == "RGBA",
            })
            print(f"{pose_id}: {panel.width}x{panel.height} | residual green {green_ratio:.2%}")

    manifest_path = POSE_DIR / "pose_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    qa_path = POSE_DIR / "pose_qa_report.json"
    qa_path.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    contact_path = make_contact_sheet(contact_items)
    print(f"Pose manifest written: {manifest_path}")
    print(f"QA report written: {qa_path}")
    print(f"Contact sheet written: {contact_path}")
    if qa["warnings"]:
        print(f"WARNING: {len(qa['warnings'])} pose(s) touch a panel boundary; inspect before production.")
    else:
        print("No panel-boundary clipping warnings detected.")


if __name__ == "__main__":
    main()
