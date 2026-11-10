# camera_rig.py — Autonomous Cinematography & Camera Rig for Blender 5.2
import bpy, math
from typing import Dict, Any, Tuple, Optional
from mathutils import Vector, Quaternion

SHOT_CONFIGS = {
    "extreme_wide": {"dist": 6.8, "height": 1.9, "lens": 28, "dutch": 0.0},
    "wide": {"dist": 4.8, "height": 1.6, "lens": 35, "dutch": 0.0},
    "medium_wide": {"dist": 3.8, "height": 1.45, "lens": 42, "dutch": 0.0},
    "two_shot": {"dist": 3.4, "height": 1.40, "lens": 45, "dutch": 0.0},
    "medium": {"dist": 2.7, "height": 1.38, "lens": 50, "dutch": 0.0},
    "medium_close_up": {"dist": 2.8, "height": 1.55, "lens": 55, "dutch": 0.0},
    "close_up": {"dist": 2.5, "height": 1.60, "lens": 65, "dutch": 0.0},
    "extreme_close_up": {"dist": 1.9, "height": 1.62, "lens": 85, "dutch": 0.0},
    "over_the_shoulder": {"dist": 2.4, "height": 1.48, "lens": 55, "dutch": 0.0},
}

def create_cinematic_camera(
    sc: bpy.types.Scene,
    target_pos: Tuple[float, float, float] = (0, 0, 1.4),
    shot_size: str = "medium",
    angle: str = "eye_level",
    movement: str = "static",
    f0: int = 1,
    f1: int = 100,
    dutch_degrees: float = 0.0,
    aspect_ratio: str = "16:9",
) -> Dict[str, Any]:
    """
    Creates and animates a cinematic camera based on shot size, angle, and movement.
    """
    cfg = SHOT_CONFIGS.get(shot_size, SHOT_CONFIGS["medium"])
    dist = cfg["dist"]
    height = cfg["height"]
    lens = cfg["lens"]

    # Resolution adjustment
    if aspect_ratio == "9:16":
        sc.render.resolution_x = 1080
        sc.render.resolution_y = 1920
        # Portrait needs slightly more distance to keep two characters in frame.
        dist *= 1.25
    else:
        sc.render.resolution_x = 1920
        sc.render.resolution_y = 1080

    # Angle height modifiers
    tgt_x, tgt_y, tgt_z = target_pos
    if angle == "low_angle":
        cam_z = 0.6
        dist *= 0.95
    elif angle == "high_angle":
        cam_z = 2.6
    elif angle == "birds_eye":
        cam_z = 4.2
        dist = 2.0
    elif angle == "over_the_shoulder":
        cam_z = 1.45
        # Offset camera slightly to one side of target
        tgt_x += 0.35
    else:
        cam_z = height

    cam_data = bpy.data.cameras.new("CinematicCamera")
    cam_data.lens = lens
    cam_obj = bpy.data.objects.new("CinematicCamera", cam_data)
    sc.collection.objects.link(cam_obj)
    sc.camera = cam_obj

    # Initial start position
    cam_start_x = tgt_x
    cam_start_y = tgt_y - dist
    cam_start_z = cam_z
    cam_obj.location = (cam_start_x, cam_start_y, cam_start_z)

    # Calculate look-at rotation
    def look_at(obj, loc, target, roll=0.0):
        obj.location = loc
        dir_vec = Vector(target) - Vector(loc)
        rot_quat = dir_vec.to_track_quat("-Z", "Y")
        if abs(roll) > 0.001:
            rot_quat = rot_quat @ Quaternion((0.0, 0.0, 1.0), math.radians(roll))
        obj.rotation_euler = rot_quat.to_euler()

    roll_deg = dutch_degrees if abs(dutch_degrees) > 0.01 else (4.0 if angle == "dutch" else 0.0)
    look_at(cam_obj, (cam_start_x, cam_start_y, cam_start_z), target_pos, roll_deg)
    cam_obj.keyframe_insert("location", frame=f0)
    cam_obj.keyframe_insert("rotation_euler", frame=f0)

    # Handle Camera Movement
    if movement in ("dolly_in", "push_in"):
        # Smoothly push in 20% closer
        end_dist = dist * 0.82
        end_y = tgt_y - end_dist
        end_loc = (cam_start_x, end_y, cam_start_z + 0.05)
        look_at(cam_obj, end_loc, target_pos, roll_deg)
        cam_obj.keyframe_insert("location", frame=f1)
        cam_obj.keyframe_insert("rotation_euler", frame=f1)
    elif movement in ("dolly_out", "pull_out"):
        end_dist = dist * 1.25
        end_y = tgt_y - end_dist
        end_loc = (cam_start_x, end_y, cam_start_z - 0.05)
        look_at(cam_obj, end_loc, target_pos, roll_deg)
        cam_obj.keyframe_insert("location", frame=f1)
        cam_obj.keyframe_insert("rotation_euler", frame=f1)
    elif movement == "tracking":
        # Slow pan sideways
        end_loc = (cam_start_x + 0.6, cam_start_y, cam_start_z)
        look_at(cam_obj, end_loc, (tgt_x + 0.4, tgt_y, tgt_z), roll_deg)
        cam_obj.keyframe_insert("location", frame=f1)
        cam_obj.keyframe_insert("rotation_euler", frame=f1)
    elif movement == "shake":
        # Sudden shock camera shake
        import random
        rnd = random.Random(7)
        for f in range(f0, min(f1, f0 + 15), 2):
            dx = rnd.uniform(-0.04, 0.04)
            dz = rnd.uniform(-0.04, 0.04)
            cam_obj.location = (cam_start_x + dx, cam_start_y, cam_start_z + dz)
            cam_obj.keyframe_insert("location", frame=f)

    return {
        "camera": cam_obj,
        "lens": lens,
        "shot_size": shot_size,
        "movement": movement,
    }

