#!/usr/bin/env python3
"""
Render selected frame ranges from an existing Blender scene into a short MP4.

Run from the project root:
  blender --background tools/blender/output/suara_kamar_mandi.blend ^
    --python tools/blender/render_motion_preview.py -- ^
    --output tools/blender/output/scene2_motion_preview.mp4 ^
    --ranges 291-421,421-505,505-601,601-738 --scale 35 --step 2

The script renders every Nth frame, then encodes at scene_fps / N so playback
keeps the original scene timing. It does not modify or save the .blend file.
Requires FFmpeg on PATH (or pass --ffmpeg).
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(
        description="Render selected Blender frame ranges into a motion-preview MP4."
    )
    parser.add_argument(
        "--ranges",
        default="291-421,421-505,505-601,601-738",
        help="Comma-separated inclusive frame ranges, e.g. 291-421,421-505.",
    )
    parser.add_argument(
        "--output",
        default="tools/blender/output/scene2_motion_preview.mp4",
        help="Output MP4 path.",
    )
    parser.add_argument(
        "--scale",
        type=int,
        default=35,
        help="Render resolution percentage (10-100). Default: 35.",
    )
    parser.add_argument(
        "--step",
        type=int,
        default=2,
        help="Render every Nth frame. Output FPS is adjusted to preserve timing.",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=88,
        help="JPEG quality for temporary frames (1-100).",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=23,
        help="H.264 quality; lower is better/larger. Typical range 18-28.",
    )
    parser.add_argument(
        "--ffmpeg",
        default="ffmpeg",
        help="FFmpeg executable or full path.",
    )
    return parser.parse_args(argv)


def parse_ranges(value, frame_start, frame_end):
    frames = []
    seen = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" not in part:
            first = last = int(part)
        else:
            first_text, last_text = part.split("-", 1)
            first, last = int(first_text.strip()), int(last_text.strip())
        if last < first:
            raise ValueError("Invalid frame range: {}".format(part))
        first = max(frame_start, first)
        last = min(frame_end, last)
        for frame in range(first, last + 1):
            if frame not in seen:
                frames.append(frame)
                seen.add(frame)
    if not frames:
        raise ValueError("No valid frames remain inside the .blend timeline.")
    return frames


def main():
    args = parse_args()
    scene = bpy.context.scene

    if not bpy.data.filepath:
        raise SystemExit("[ERROR] Open a saved .blend file before running this script.")

    ffmpeg = shutil.which(args.ffmpeg)
    if not ffmpeg and Path(args.ffmpeg).is_file():
        ffmpeg = str(Path(args.ffmpeg).resolve())
    if not ffmpeg:
        raise SystemExit(
            "[ERROR] FFmpeg tidak ditemukan. Tambahkan ffmpeg ke PATH atau gunakan --ffmpeg."
        )

    try:
        frames = parse_ranges(args.ranges, int(scene.frame_start), int(scene.frame_end))
    except ValueError as exc:
        raise SystemExit("[ERROR] {}".format(exc))

    step = max(1, int(args.step))
    frames = frames[::step]
    if not frames:
        raise SystemExit("[ERROR] Tidak ada frame yang akan dirender.")

    scale = max(10, min(100, int(args.scale)))
    quality = max(1, min(100, int(args.quality)))
    crf = max(0, min(51, int(args.crf)))
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    fps = float(scene.render.fps) / float(scene.render.fps_base)
    output_fps = fps / step

    old = {
        "resolution_percentage": scene.render.resolution_percentage,
        "file_format": scene.render.image_settings.file_format,
        "color_mode": scene.render.image_settings.color_mode,
        "quality": scene.render.image_settings.quality,
        "filepath": scene.render.filepath,
        "use_file_extension": scene.render.use_file_extension,
        "frame": scene.frame_current,
    }

    print("[Motion Preview] Blend : {}".format(bpy.data.filepath), flush=True)
    print("[Motion Preview] Frames: {} (step {})".format(len(frames), step), flush=True)
    print("[Motion Preview] FPS   : {:.3f} -> {:.3f}".format(fps, output_fps), flush=True)
    print("[Motion Preview] Scale : {}%".format(scale), flush=True)
    print("[Motion Preview] Output: {}".format(output), flush=True)

    try:
        with tempfile.TemporaryDirectory(prefix="blender_motion_preview_") as temp_dir:
            temp_path = Path(temp_dir)
            scene.render.resolution_percentage = scale
            scene.render.image_settings.file_format = "JPEG"
            scene.render.image_settings.color_mode = "RGB"
            scene.render.image_settings.quality = quality
            scene.render.use_file_extension = True

            for index, frame in enumerate(frames):
                scene.frame_set(frame)
                frame_path = temp_path / "frame_{:06d}.jpg".format(index)
                scene.render.filepath = str(frame_path)
                print(
                    "[Motion Preview] Render {}/{} | frame {}".format(
                        index + 1, len(frames), frame
                    ),
                    flush=True,
                )
                bpy.ops.render.render(write_still=True)
                if not frame_path.is_file() or frame_path.stat().st_size < 512:
                    raise RuntimeError("Frame render missing: {}".format(frame_path))

            input_pattern = str(temp_path / "frame_%06d.jpg")
            command = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                "{:.6f}".format(output_fps),
                "-start_number",
                "0",
                "-i",
                input_pattern,
                "-frames:v",
                str(len(frames)),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                str(crf),
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(output),
            ]
            print("[Motion Preview] Encoding MP4...", flush=True)
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError("FFmpeg gagal:\n{}".format(result.stderr))

    finally:
        scene.render.resolution_percentage = old["resolution_percentage"]
        scene.render.image_settings.file_format = old["file_format"]
        scene.render.image_settings.color_mode = old["color_mode"]
        scene.render.image_settings.quality = old["quality"]
        scene.render.filepath = old["filepath"]
        scene.render.use_file_extension = old["use_file_extension"]
        scene.frame_set(old["frame"])

    if not output.is_file() or output.stat().st_size == 0:
        raise SystemExit("[ERROR] MP4 tidak berhasil dibuat.")

    print("[OK] Motion preview: {}".format(output), flush=True)
    print("[OK] Size: {} bytes".format(output.stat().st_size), flush=True)


if __name__ == "__main__":
    main()
