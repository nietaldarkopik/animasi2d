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
        # Broad, overlapping shoulder masks retain fabric under the torso edge.
        "left": [
            (270, 305), (305, 310), (337, 335), (350, 385),
            (345, 435), (330, 490), (315, 545), (300, 600),
            (285, 655), (270, 710), (260, 755), (250, 795),
            (238, 830), (205, 825), (190, 795), (190, 750),
            (195, 700), (202, 650), (210, 595), (220, 540),
            (232, 485), (242, 430), (250, 375), (258, 330)
        ],
        "right": [
            (530, 305), (495, 310), (463, 335), (450, 385),
            (455, 435), (470, 490), (485, 545), (500, 600),
            (515, 655), (530, 710), (540, 755), (550, 795),
            (562, 830), (595, 825), (610, 795), (610, 750),
            (605, 700), (598, 650), (590, 595), (580, 540),
            (568, 485), (558, 430), (550, 375), (542, 330)
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

    # Rebuild a neutral composite from the extracted layers for visual QC.
    composite = array('f', base_pixels)
    for side in ("left", "right"):
        layer = arm_pixels[side]
        for i in range(0, len(composite), 4):
            sa = layer[i + 3]
            if sa <= 0.001:
                continue
            da = composite[i + 3]
            out_a = sa + da * (1.0 - sa)
            if out_a > 1e-8:
                for channel in range(3):
                    composite[i + channel] = (
                        layer[i + channel] * sa +
                        composite[i + channel] * da * (1.0 - sa)
                    ) / out_a
            composite[i + 3] = out_a

    outputs = [
        ("arum_body_clean.png", "ARUM_BODY_CLEAN", base_pixels),
        ("arum_arm_left.png", "ARUM_ARM_LEFT_CUTOUT", arm_pixels["left"]),
        ("arum_arm_right.png", "ARUM_ARM_RIGHT_CUTOUT", arm_pixels["right"]),
        ("arum_cutout_composite.png", "ARUM_CUTOUT_COMPOSITE", composite),
    ]
    for filename, name, pixels in outputs:
        save_rgba(name, width, height, pixels, os.path.join(out_dir, filename))
        print("[Cutout] Wrote:", os.path.join(out_dir, filename))

    print("[Cutout] Source:", source_path)
    print("[Cutout] Canvas:", width, "x", height)
    print("[Cutout] Neutral composite:", os.path.join(out_dir, "arum_cutout_composite.png"))
    print("[Cutout] No mesh deformation or production assets modified.")
    print("[Cutout] Compare composite against source; do not rig unless the silhouette is clean.")

if __name__ == "__main__":
    main()
