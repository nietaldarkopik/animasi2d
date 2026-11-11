#!/usr/bin/env python3
"""
Create a contact sheet from rendered frame images or a motion-preview video.

Examples (run from the project root):
  python tools/blender/create_contact_sheet.py
  python tools/blender/create_contact_sheet.py --input-video tools/blender/output/scene2_motion_preview.mp4
  python tools/blender/create_contact_sheet.py --input-dir tools/blender/output/my_frames --samples 30 --columns 5

Requires FFmpeg and FFprobe on PATH (or pass --ffmpeg / --ffprobe).
"""

import argparse
import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a contact sheet from rendered frame images or a preview video."
    )
    parser.add_argument(
        "--input-dir",
        default="tools/blender/output/scene_action_preview_frames",
        help="Folder containing rendered frame images (default source).",
    )
    parser.add_argument(
        "--input-video",
        help="Optional MP4/video source. When supplied, frames are sampled directly from it.",
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
        help="Number of frames to sample evenly (default: 24). Use 0 for all image files.",
    )
    parser.add_argument("--columns", type=int, default=4, help="Contact sheet columns.")
    parser.add_argument("--cell-width", type=int, default=360, help="Width of each thumbnail cell.")
    parser.add_argument("--cell-height", type=int, default=640, help="Height of each thumbnail cell.")
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality from 1 to 100.")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable or full path.")
    parser.add_argument("--ffprobe", default="ffprobe", help="FFprobe executable or full path.")
    return parser.parse_args()


def natural_key(path):
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"(\d+)", path.name)]


def choose_samples(files, count):
    if count <= 0 or count >= len(files):
        return files
    if count == 1:
        return [files[0]]
    indices = sorted({round(i * (len(files) - 1) / (count - 1)) for i in range(count)})
    return [files[index] for index in indices]


def ffconcat_escape(path):
    value = str(path.resolve()).replace("\\", "/")
    return value.replace("'", r"'\\''")


def resolve_executable(value):
    found = shutil.which(value)
    if not found and Path(value).is_file():
        found = str(Path(value).resolve())
    return found


def video_frame_count(ffprobe, video):
    command = [
        ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1:nokey=1",
        str(video),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "FFprobe gagal membaca video.")
    try:
        count = int(result.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        raise RuntimeError("Jumlah frame video tidak dapat dibaca oleh FFprobe.")
    if count < 1:
        raise RuntimeError("Video tidak memiliki frame.")
    return count


def main():
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    columns = max(1, args.columns)
    cell_w = max(80, args.cell_width)
    cell_h = max(80, args.cell_height)
    quality = max(1, min(100, args.quality))
    samples = max(1, args.samples) if args.samples != 0 else 0

    ffmpeg = resolve_executable(args.ffmpeg)
    if not ffmpeg:
        raise SystemExit("[ERROR] FFmpeg tidak ditemukan di PATH atau lokasi yang diberikan.")

    output.parent.mkdir(parents=True, exist_ok=True)

    if args.input_video:
        video = Path(args.input_video).expanduser().resolve()
        if not video.is_file():
            raise SystemExit("[ERROR] Video tidak ditemukan: {}".format(video))
        ffprobe = resolve_executable(args.ffprobe)
        if not ffprobe:
            raise SystemExit("[ERROR] FFprobe tidak ditemukan di PATH atau lokasi yang diberikan.")
        try:
            total_frames = video_frame_count(ffprobe, video)
        except RuntimeError as exc:
            raise SystemExit("[ERROR] {}".format(exc))

        sample_count = min(samples or total_frames, total_frames)
        if sample_count == 1:
            indices = [0]
        else:
            indices = sorted({
                round(i * (total_frames - 1) / (sample_count - 1))
                for i in range(sample_count)
            })
        rows = math.ceil(len(indices) / columns)
        select_expr = "+".join("eq(n\\,{})".format(index) for index in indices)
        filter_graph = (
            "select='{}',"
            "scale={}:{}:force_original_aspect_ratio=decrease,"
            "pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=0x202020,"
            "setsar=1,"
            "tile={}x{}:nb_frames={}:padding=8:margin=8:color=0x101010"
        ).format(select_expr, cell_w, cell_h, cell_w, cell_h,
                 columns, rows, len(indices))
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(video), "-vf", filter_graph, "-frames:v", "1",
            "-q:v", str(max(2, round((100 - quality) * 0.31))), str(output),
        ]
        print("[Contact Sheet] Source video : {}".format(video))
        print("[Contact Sheet] Video frames : {}".format(total_frames))
        print("[Contact Sheet] Sampled      : {}".format(len(indices)))
        print("[Contact Sheet] Grid         : {} x {}".format(columns, rows))
    else:
        input_dir = Path(args.input_dir).expanduser().resolve()
        if not input_dir.is_dir():
            raise SystemExit("[ERROR] Folder frame tidak ditemukan: {}".format(input_dir))
        files = sorted(
            [p for p in input_dir.iterdir()
             if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS],
            key=natural_key,
        )
        if not files:
            raise SystemExit("[ERROR] Tidak ada file gambar di: {}".format(input_dir))
        selected = choose_samples(files, samples)
        rows = math.ceil(len(selected) / columns)
        with tempfile.TemporaryDirectory(prefix="blender_contact_sheet_") as temp_dir:
            concat_file = Path(temp_dir) / "frames.txt"
            with concat_file.open("w", encoding="utf-8") as handle:
                for frame in selected:
                    handle.write("file '{}'\\n".format(ffconcat_escape(frame)))
            filter_graph = (
                "scale={}:{}:force_original_aspect_ratio=decrease,"
                "pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=0x202020,"
                "setsar=1,"
                "tile={}x{}:nb_frames={}:padding=8:margin=8:color=0x101010"
            ).format(cell_w, cell_h, cell_w, cell_h, columns, rows, len(selected))
            command = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_file),
                "-vf", filter_graph, "-frames:v", "1",
                "-q:v", str(max(2, round((100 - quality) * 0.31))), str(output),
            ]
            print("[Contact Sheet] Input frames: {}".format(len(files)))
            print("[Contact Sheet] Sampled     : {}".format(len(selected)))
            print("[Contact Sheet] Grid        : {} x {}".format(columns, rows))
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode != 0:
                raise SystemExit("[ERROR] FFmpeg gagal:\\n{}".format(result.stderr))

    if args.input_video:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit("[ERROR] FFmpeg gagal:\\n{}".format(result.stderr))

    if not output.is_file() or output.stat().st_size == 0:
        raise SystemExit("[ERROR] File contact sheet tidak berhasil dibuat.")
    print("[OK] Contact sheet: {} ({} bytes)".format(output, output.stat().st_size))


if __name__ == "__main__":
    main()
