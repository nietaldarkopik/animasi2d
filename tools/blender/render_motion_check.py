# render_motion_check.py — Render lightweight timeline samples from an existing .blend
"""Render evenly spaced frames to inspect character and camera motion without a full video render.

Run:
  blender --background path/to/scene.blend --python tools/blender/render_motion_check.py -- \
    --output-dir tools/blender/output/motion_check --samples 6 --scale 50
"""

import argparse
import json
import os
import sys

import bpy


def _arguments():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Render motion-check stills from the current Blender file")
    parser.add_argument("--output-dir", default="", help="Output directory (default: <blend>_motion_check)")
    parser.add_argument("--samples", type=int, default=6, help="Number of evenly spaced frames (2-24)")
    parser.add_argument("--scale", type=int, default=50, help="Render resolution percentage (10-100)")
    parser.add_argument("--frames", type=str, default="", help="Optional comma-separated explicit frame numbers")
    return parser.parse_args(argv)


def main():
    args = _arguments()
    scene = bpy.context.scene
    if not bpy.data.filepath:
        raise RuntimeError("Open a saved .blend file before running motion check.")

    output_dir = args.output_dir.strip() or (os.path.splitext(bpy.data.filepath)[0] + "_motion_check")
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    start = int(scene.frame_start)
    end = int(scene.frame_end)
    if args.frames.strip():
        frames = sorted({max(start, min(end, int(v.strip()))) for v in args.frames.split(",") if v.strip()})
    else:
        count = max(2, min(24, int(args.samples)))
        if end <= start:
            frames = [start]
        else:
            frames = sorted({round(start + (end - start) * i / (count - 1)) for i in range(count)})

    old_percentage = scene.render.resolution_percentage
    old_format = scene.render.image_settings.file_format
    old_mode = scene.render.image_settings.color_mode
    old_quality = scene.render.image_settings.quality
    old_filepath = scene.render.filepath
    report = {
        "blend_file": bpy.data.filepath,
        "frame_start": start,
        "frame_end": end,
        "resolution_percentage": max(10, min(100, int(args.scale))),
        "samples": [],
    }

    try:
        scene.render.resolution_percentage = report["resolution_percentage"]
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.quality = 88
        scene.render.use_file_extension = True

        print("[Motion Check] Rendering {} samples from frame {} to {}".format(len(frames), start, end), flush=True)
        for index, frame in enumerate(frames, 1):
            scene.frame_set(frame)
            camera = scene.camera
            camera_name = camera.name if camera else None
            output_path = os.path.join(output_dir, "motion_{:02d}_f{:06d}.jpg".format(index, frame))
            scene.render.filepath = output_path
            print("[Motion Check] {}/{} frame={} camera={}".format(index, len(frames), frame, camera_name), flush=True)
            bpy.ops.render.render(write_still=True)
            if not os.path.isfile(output_path) or os.path.getsize(output_path) < 1024:
                raise RuntimeError("Render output missing or too small: " + output_path)
            report["samples"].append({
                "index": index,
                "frame": frame,
                "camera": camera_name,
                "file": os.path.basename(output_path),
                "size_bytes": os.path.getsize(output_path),
            })

        report_path = os.path.join(output_dir, "motion_check_report.json")
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
        print("[Motion Check] Complete: " + output_dir, flush=True)
        print("[Motion Check] Report: " + report_path, flush=True)
    finally:
        scene.render.resolution_percentage = old_percentage
        scene.render.image_settings.file_format = old_format
        scene.render.image_settings.color_mode = old_mode
        scene.render.image_settings.quality = old_quality
        scene.render.filepath = old_filepath


if __name__ == "__main__":
    main()
