"""
Prepare non-destructive 2D cutout layers for Arum's arm-rig prototype.

This is deliberately a PREPARATION step, not a deforming rig:
- keeps the torso/skirt pixels rigid
- extracts each complete arm as an independent transparent layer
- clears the corresponding arm silhouette from the base layer
- preserves the original 800x1400 canvas and pixel alignment

Run with Blender:
  blender --background --python tools/blender/arm_cutout_prepare.py -- \
    --character-root karakter/arum \
    --output-dir tools/blender/output/arum_cutout
"""
import bpy
import os
import sys
import argparse
from array import array

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--character-root", default="karakter/arum")
    p.add_argument("--output-dir", default="tools/blender/output/arum_cutout")
    p.add_argument("--source", default="arum_badan_diam.png")
    return p.parse_args(argv)

def inside_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)):
            cross = (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
            if x < cross:
                inside = not inside
        j = i
    return inside

def save_rgba(name, width, height, pixels, filepath):
    img = bpy.data.images.new(name, width=width, height=height, alpha=True)
    img.pixels.foreach_set(pixels)
    img.file_format = "PNG"
    img.filepath_raw = filepath
    img.save()
    img.pack()
    return img

def main():
    a = parse_args()
    root = os.path.abspath(a.character_root)
    out_dir = os.path.abspath(a.output_dir)
    os.makedirs(out_dir, exist_ok=True)
    source_path = os.path.join(root, a.source)
    if not os.path.isfile(source_path):
        raise FileNotFoundError(source_path)

    src = bpy.data.images.load(source_path, check_existing=False)
    src_size = tuple(src.size)
    width, height = src_size
    if (width, height) != (800, 1400):
        raise RuntimeError("Expected 800x1400 Arum body sprite; got %sx%s" % src_size)

    # Coordinates are in source-image space, origin at top-left.
    # The cut line intentionally follows the sleeve/torso seam; inspect the
    # diagnostic outputs before building any production rig from these masks.
    masks = {
        "left": [
            (278, 319), (300, 326), (320, 350), (329, 390),
            (319, 445), (303, 500), (286, 558), (270, 620),
            (256, 680), (250, 718), (244, 746), (238, 778),
            (230, 810), (218, 807), (207, 785), (205, 750),
            (207, 718), (211, 680), (218, 635), (226, 585),
            (235, 530), (244, 475), (252, 420), (260, 365)
        ],
        "right": [
            (522, 319), (500, 326), (480, 350), (471, 390),
            (481, 445), (497, 500), (514, 558), (530, 620),
            (544, 680), (550, 718), (556, 746), (562, 778),
            (570, 810), (582, 807), (593, 785), (595, 750),
            (593, 718), (589, 680), (582, 635), (574, 585),
            (565, 530), (556, 475), (548, 420), (540, 365)
        ]
    }

    source_pixels = array('f', [0.0]) * (width * height * 4)
    src.pixels.foreach_get(source_pixels)
    base_pixels = array('f', source_pixels)
    arm_pixels = {
        side: array('f', [0.0]) * (width * height * 4)
        for side in masks
    }

    # Pixel centers are tested against the polygons. Source alpha is preserved.
    # Blender stores pixel rows bottom-up; convert from top-left mask coordinates.
    for y_top in range(height):
        y_bl = height - 1 - y_top
        for x in range(width):
            side_hit = None
            for side, poly in masks.items():
                if inside_polygon(x + 0.5, y_top + 0.5, poly):
                    side_hit = side
                    break
            if side_hit is None:
                continue
            idx = (y_bl * width + x) * 4
            alpha = source_pixels[idx + 3]
            if alpha <= 0.001:
                continue
            target = arm_pixels[side_hit]
            target[idx] = source_pixels[idx]
            target[idx + 1] = source_pixels[idx + 1]
            target[idx + 2] = source_pixels[idx + 2]
            target[idx + 3] = alpha
            # Clear only the arm mask from the static torso layer.
            base_pixels[idx + 3] = 0.0

    outputs = [
        ("arum_body_clean.png", "ARUM_BODY_CLEAN", base_pixels),
        ("arum_arm_left.png", "ARUM_ARM_LEFT_CUTOUT", arm_pixels["left"]),
        ("arum_arm_right.png", "ARUM_ARM_RIGHT_CUTOUT", arm_pixels["right"]),
    ]
    for filename, name, pixels in outputs:
        save_rgba(name, width, height, pixels, os.path.join(out_dir, filename))
        print("[Cutout] Wrote:", os.path.join(out_dir, filename))

    print("[Cutout] Source:", source_path)
    print("[Cutout] Canvas:", width, "x", height)
    print("[Cutout] No mesh deformation or production assets modified.")
    print("[Cutout] Inspect body_clean + both arm layers before proceeding to pivots/rig.")

if __name__ == "__main__":
    main()
