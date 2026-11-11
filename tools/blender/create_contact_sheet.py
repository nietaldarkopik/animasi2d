#!/usr/bin/env python3
"""
Create a contact sheet from rendered Blender frame images using FFmpeg.

Examples (run from the project root):
  python tools/blender/create_contact_sheet.py
  python tools/blender/create_contact_sheet.py --input-dir tools/blender/output/scene_action_preview_frames
  python tools/blender/create_contact_sheet.py --input-dir tools/blender/output/my_frames --samples 30 --columns 5
  python tools/blender/create_contact_sheet.py --input-dir tools/blender/output/my_frames --output tools/blender/output/scene2_contact_sheet.jpg

Requires FFmpeg (ffmpeg.exe must be available on PATH, or pass --ffmpeg).
"""

import argparse
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a contact sheet from rendered frame images."
    )
    parser.add_argument(
        "--input-dir",
        default="tools/blender/output/scene_action_preview_frames",
        help="Folder containing rendered frame images.",
    )
    parser.add_argument(
        "--output",
        default="tools/blender/output/scene2_contact_sheet.jpg",
        help="Output JPG path.",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=24,
        help="Number of frames to sample evenly across the folder (default: 24). Use 0 for all frames.",
    )
    parser.add_argument("--columns", type=int, default=4, help="Contact sheet columns.")
    parser.add_argument(
        "--cell-width", type=int, default=360, help="Width of each thumbnail cell."
    )
    parser.add_argument(
        "--cell-height", type=int, default=640, help="Height of each thumbnail cell."
    )
    parser.add_argument(
        "--quality", type=int, default=90, help="JPEG quality from 1 to 100."
    )
    parser.add_argument(
        "--ffmpeg", default="ffmpeg", help="FFmpeg executable or full path."
    )
    return parser.parse_args()


def natural_key(path):
    """Sort names numerically, so frame_2 comes before frame_10."""
    import re

    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", path.name)
    ]


def choose_samples(files, count):
    if count <= 0 or count >= len(files):
        return files
    if count == 1:
        return [files[0]]
    indices = sorted({round(i * (len(files) - 1) / (count - 1)) for i in range(count)})
    return [files[index] for index in indices]


def ffconcat_escape(path):
    # FFmpeg concat demuxer accepts single-quoted paths; escape embedded quotes.
    value = str(path.resolve()).replace("\\", "/")
    return value.replace("'", r"'\''")


def main():
    args = parse_args()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()

    if not input_dir.is_dir():
        raise SystemExit("[ERROR] Folder frame tidak ditemukan: {}".format(input_dir))

    ffmpeg = shutil.which(args.ffmpeg)
    if not ffmpeg and Path(args.ffmpeg).is_file():
        ffmpeg = str(Path(args.ffmpeg).resolve())
    if not ffmpeg:
        raise SystemExit(
            "[ERROR] FFmpeg tidak ditemukan. Pastikan ffmpeg ada di PATH atau gunakan --ffmpeg."
        )

    files = sorted(
        [
            path
            for path in input_dir.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ],
        key=natural_key,
    )
    if not files:
        raise SystemExit("[ERROR] Tidak ada file gambar di: {}".format(input_dir))

    selected = choose_samples(files, max(0, args.samples))
    columns = max(1, args.columns)
    rows = math.ceil(len(selected) / columns)
    cell_w = max(80, args.cell_width)
    cell_h = max(80, args.cell_height)
    quality = max(1, min(100, args.quality))

    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="blender_contact_sheet_") as temp_dir:
        concat_file = Path(temp_dir) / "frames.txt"
        with concat_file.open("w", encoding="utf-8") as handle:
            for frame in selected:
                handle.write("file '{}'\n".format(ffconcat_escape(frame)))

        filter_graph = (
            "scale={}:{}:force_original_aspect_ratio=decrease,"
            "pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=0x202020,"
            "setsar=1,"
            "tile={}x{}:nb_frames={}:padding=8:margin=8:color=0x101010"
        ).format(
            cell_w,
            cell_h,
            cell_w,
            cell_h,
            columns,
            rows,
            len(selected),
        )

        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-vf",
            filter_graph,
            "-frames:v",
            "1",
            "-q:v",
            str(max(2, round((100 - quality) * 0.31))),
            str(output),
        ]

        print("[Contact Sheet] Input frames : {}".format(len(files)))
        print("[Contact Sheet] Sampled       : {}".format(len(selected)))
        print("[Contact Sheet] Grid          : {} x {}".format(columns, rows))
        print("[Contact Sheet] Output        : {}".format(output))

        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stderr)
            raise SystemExit("[ERROR] FFmpeg gagal membuat contact sheet.")

    if not output.is_file() or output.stat().st_size == 0:
        raise SystemExit("[ERROR] File contact sheet tidak berhasil dibuat.")

    print("[OK] Contact sheet berhasil dibuat ({} bytes).".format(output.stat().st_size))


if __name__ == "__main__":
    main()
