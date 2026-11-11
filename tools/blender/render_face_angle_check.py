# render_face_angle_check.py — Diagnose 2.5D face alignment from multiple camera angles.
"""
Run:
  blender --background tools/blender/output/cinematic_draft.blend --python tools/blender/render_face_angle_check.py -- --output-dir tools/blender/output/face_angle_check --character uki --frame 80 --scale 70

The character billboard constraints are temporarily retargeted to a diagnostic camera.
The original in-memory scene is restored afterwards; this script does not save the .blend.
"""
import argparse
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


def _args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--output-dir", default="tools/blender/output/face_angle_check")
    p.add_argument("--character", default="uki")
    p.add_argument("--frame", type=int, default=0, help="0 = timeline midpoint")
    p.add_argument("--scale", type=int, default=70)
    p.add_argument("--projection", choices=("both", "perspective", "orthographic"), default="both")
    return p.parse_args(argv)


def main():
    args = _args()
    scene = bpy.context.scene
    if not bpy.data.filepath:
        raise RuntimeError("Open a saved .blend file before running this diagnostic.")

    key = args.character.lower()
    roots = [o for o in scene.objects
             if o.type == "EMPTY" and o.parent is None
             and o.name.lower().startswith("char_" + key + "_")]
    if not roots:
        raise RuntimeError("No root character object found for: " + key)
    root = roots[0]
    original_camera = scene.camera
    if original_camera is None:
        raise RuntimeError("The scene has no active camera.")

    old = {
        "camera": scene.camera,
        "frame": scene.frame_current,
        "percentage": scene.render.resolution_percentage,
        "filepath": scene.render.filepath,
        "format": scene.render.image_settings.file_format,
        "mode": scene.render.image_settings.color_mode,
        "extension": scene.render.use_file_extension,
    }
    frame = args.frame or (scene.frame_start + scene.frame_end) // 2
    frame = max(scene.frame_start, min(scene.frame_end, frame))
    out_dir = os.path.abspath(args.output_dir)
    os.makedirs(out_dir, exist_ok=True)

    diag_data = original_camera.data.copy()
    diag_camera = bpy.data.objects.new("TEMP_FACE_ANGLE_CAMERA", diag_data)
    scene.collection.objects.link(diag_camera)
    diag_camera.matrix_world = original_camera.matrix_world.copy()
    tracked = []
    try:
        for obj in scene.objects:
            if obj.type != "EMPTY" or not obj.name.startswith("CHAR_"):
                continue
            for con in obj.constraints:
                if con.type == "LOCKED_TRACK" and con.target == original_camera:
                    tracked.append((con, con.target))
                    con.target = diag_camera

        scene.camera = diag_camera
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        origin = root.matrix_world.translation.copy()
        target = origin + Vector((0.0, 0.0, 1.48))
        distance = max(3.5, (original_camera.location - origin).length)
        diag_data.lens = float(original_camera.data.lens)

        scene.render.resolution_percentage = max(10, min(100, int(args.scale)))
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.use_file_extension = True

        # Compare perspective and orthographic projection at identical angles.
        # Orthographic scale is derived from the perspective frame at this distance.
        projections = ("perspective", "orthographic") if args.projection == "both" else (args.projection,)
        view_angles = (("front", 0), ("oblique_45", 45), ("near_side_75", 75))
        frame_corners = diag_data.view_frame(scene=scene)
        frame_width = max(v.x for v in frame_corners) - min(v.x for v in frame_corners)
        ortho_scale = distance * frame_width

        report = {"blend_file": bpy.data.filepath, "character": key,
                  "root": root.name, "frame": frame,
                  "projection_modes": list(projections),
                  "orthographic_scale": round(ortho_scale, 6),
                  "camera_tests": []}

        for projection in projections:
            diag_data.type = "PERSP" if projection == "perspective" else "ORTHO"
            if projection == "orthographic":
                diag_data.ortho_scale = ortho_scale
            for label, degrees in view_angles:
                angle = math.radians(degrees)
                diag_camera.location = (
                    origin.x + math.sin(angle) * distance,
                    origin.y - math.cos(angle) * distance,
                    target.z + 0.12,
                )
                diag_camera.rotation_euler = (target - diag_camera.location).to_track_quat("-Z", "Y").to_euler()
                bpy.context.view_layer.update()

                # Measure whether the evaluated character card normal actually faces
                # the diagnostic camera. The sprite plane's front normal is local -Y.
                depsgraph = bpy.context.evaluated_depsgraph_get()
                root_eval = root.evaluated_get(depsgraph)
                root_matrix = root_eval.matrix_world
                root_origin = root_matrix.translation
                card_normal = (root_matrix.to_3x3() @ Vector((0.0, -1.0, 0.0))).normalized()
                to_camera = (diag_camera.matrix_world.translation - root_origin)
                to_camera.z = 0.0
                to_camera.normalize()
                normal_horizontal = Vector((card_normal.x, card_normal.y, 0.0)).normalized()
                facing_dot = normal_horizontal.dot(to_camera)
                facing_angle = math.degrees(math.acos(max(-1.0, min(1.0, facing_dot))))

                # Measure the actual projected dimensions of visible character cards.
                projected_cards = []
                for child in root.children_recursive:
                    if child.type != "MESH" or not any(token in child.name.lower() for token in ("_b_", "_h_", "_m_")):
                        continue
                    child_eval = child.evaluated_get(depsgraph)
                    points = [
                        world_to_camera_view(scene, diag_camera, child_eval.matrix_world @ Vector(corner))
                        for corner in child_eval.bound_box
                    ]
                    xs = [p.x for p in points]
                    ys = [p.y for p in points]
                    width = max(xs) - min(xs)
                    height = max(ys) - min(ys)
                    world_matrix = child_eval.matrix_world
                    local_bounds = [Vector(corner) for corner in child_eval.bound_box]
                    local_size = [
                        round(max(v[i] for v in local_bounds) - min(v[i] for v in local_bounds), 6)
                        for i in range(3)
                    ]
                    world_axes = [
                        [round(v, 6) for v in (world_matrix.to_3x3() @ axis)]
                        for axis in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
                    ]
                    parent_eval = child.parent.evaluated_get(depsgraph) if child.parent else None
                    parent_matrix = parent_eval.matrix_world if parent_eval else None
                    parent_inverse = child.matrix_parent_inverse
                    basis_matrix = child.matrix_basis
                    projected_cards.append({
                        "object": child.name,
                        "parent": child.parent.name if child.parent else None,
                        "matrix_parent_inverse": [[round(parent_inverse[r][c], 6) for c in range(4)] for r in range(4)],
                        "matrix_basis": [[round(basis_matrix[r][c], 6) for c in range(4)] for r in range(4)],
                        "matrix_local": [[round(child_eval.matrix_local[r][c], 6) for c in range(4)] for r in range(4)],
                        "matrix_world_evaluated": [[round(child_eval.matrix_world[r][c], 6) for c in range(4)] for r in range(4)],
                        "parent_world_matrix": [[round(parent_matrix[r][c], 6) for c in range(4)] for r in range(4)] if parent_matrix else None,
                        "hide_render": bool(child.hide_render),
                        "hide_viewport": bool(child.hide_viewport),
                        "constraints": [{"name": con.name, "type": con.type, "influence": round(con.influence, 6), "mute": bool(con.mute)} for con in child.constraints],
                        "animation_data": bool(child.animation_data and child.animation_data.action),
                        "local_scale": [round(v, 6) for v in child_eval.scale],
                        "local_bounds_size": local_size,
                        "world_axis_vectors": world_axes,
                        "projected_width": round(width, 6),
                        "projected_height": round(height, 6),
                        "width_height_ratio": round(width / height, 6) if height > 1e-9 else None,
                    })

                image_path = os.path.join(out_dir, "{}_{}_{}_f{:06d}.png".format(key, projection, label, frame))
                scene.render.filepath = image_path
                print("[Face Angle Check] {} ({} deg)".format(label, degrees), flush=True)
                bpy.ops.render.render(write_still=True)
                if not os.path.isfile(image_path) or os.path.getsize(image_path) < 1024:
                    raise RuntimeError("Render output missing or too small: " + image_path)
                report["camera_tests"].append({
                    "projection": projection, "view": label, "angle_degrees": degrees,
                    "image": os.path.basename(image_path),
                    "size_bytes": os.path.getsize(image_path),
                    "billboard_facing_angle_degrees": round(facing_angle, 3),
                    "billboard_facing_dot": round(facing_dot, 6),
                    "card_normal_world": [round(v, 6) for v in card_normal],
                    "camera_direction_horizontal": [round(v, 6) for v in to_camera],
                    "projected_cards": projected_cards,
                })

        report_path = os.path.join(out_dir, "face_angle_check_report.json")
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
        print("[Face Angle Check] Report: " + report_path, flush=True)
    finally:
        for con, previous_target in tracked:
            con.target = previous_target
        scene.camera = old["camera"]
        scene.frame_set(old["frame"])
        scene.render.resolution_percentage = old["percentage"]
        scene.render.filepath = old["filepath"]
        scene.render.image_settings.file_format = old["format"]
        scene.render.image_settings.color_mode = old["mode"]
        scene.render.use_file_extension = old["extension"]
        bpy.data.objects.remove(diag_camera, do_unlink=True)
        bpy.data.cameras.remove(diag_data)


if __name__ == "__main__":
    main()
