# lighting_presets.py — Cinematic Three-Point Toon Lighting for Blender 5.2
import bpy
import math
import random
from typing import Dict, Any


LIGHTING_CONFIGS: Dict[str, Dict[str, Any]] = {
    "pagi": {
        "world": (0.38, 0.52, 0.72, 1.0), "world_strength": 0.38,
        "key": (1.0, 0.78, 0.55), "fill": (0.48, 0.66, 1.0), "rim": (1.0, 0.88, 0.68),
        "key_power": 520.0, "fill_power": 210.0, "rim_power": 420.0,
    },
    "siang": {
        "world": (0.48, 0.60, 0.76, 1.0), "world_strength": 0.42,
        "key": (1.0, 0.92, 0.78), "fill": (0.62, 0.76, 1.0), "rim": (1.0, 0.96, 0.86),
        "key_power": 600.0, "fill_power": 240.0, "rim_power": 480.0,
    },
    "sore": {
        "world": (0.42, 0.25, 0.30, 1.0), "world_strength": 0.30,
        "key": (1.0, 0.43, 0.20), "fill": (0.50, 0.35, 0.72), "rim": (1.0, 0.62, 0.32),
        "key_power": 560.0, "fill_power": 170.0, "rim_power": 500.0,
    },
    "malam": {
        "world": (0.035, 0.055, 0.12, 1.0), "world_strength": 0.16,
        "key": (0.36, 0.52, 1.0), "fill": (0.24, 0.32, 0.62), "rim": (0.48, 0.66, 1.0),
        "key_power": 360.0, "fill_power": 110.0, "rim_power": 320.0,
    },
    "mystery": {
        "world": (0.012, 0.018, 0.055, 1.0), "world_strength": 0.10,
        "key": (0.22, 0.42, 0.92), "fill": (0.12, 0.18, 0.40), "rim": (0.45, 0.20, 0.72),
        "key_power": 300.0, "fill_power": 70.0, "rim_power": 360.0,
    },
}


def _remove_previous_cinematic_lights(sc):
    for obj in list(sc.objects):
        if obj.name.startswith("CINE_LIGHT_"):
            data = obj.data if obj.type == "LIGHT" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if data and data.users == 0:
                bpy.data.lights.remove(data)


def _area_light(sc, name, color, power, location, target, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    sc.collection.objects.link(obj)
    obj.location = location
    direction = (target[0] - location[0], target[1] - location[1], target[2] - location[2])
    from mathutils import Vector
    obj.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
    return obj


def apply_lighting(
    sc: bpy.types.Scene,
    time_of_day: str = "siang",
    mood: str = "normal",
    flicker: bool = False,
    f0: int = 1,
    f1: int = 100,
) -> Dict[str, Any]:
    """Create motivated key, fill, rim and optional practical/flickering lights."""
    _remove_previous_cinematic_lights(sc)

    preset = "mystery" if mood == "mystery" else str(time_of_day).lower()
    cfg = LIGHTING_CONFIGS.get(preset, LIGHTING_CONFIGS["siang"])

    world = bpy.data.worlds.new("CINE_World_" + preset)
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = cfg["world"]
        background.inputs["Strength"].default_value = cfg["world_strength"]
    sc.world = world

    # Character action area is staged around x=0, y=0.65, z=1.0.
    target = (0.0, 0.8, 1.05)
    key = _area_light(
        sc, "CINE_LIGHT_Key", cfg["key"], cfg["key_power"],
        (-3.5, -3.8, 4.8), target, 4.0,
    )
    fill = _area_light(
        sc, "CINE_LIGHT_Fill", cfg["fill"], cfg["fill_power"],
        (3.8, -2.6, 2.8), target, 5.0,
    )
    rim = _area_light(
        sc, "CINE_LIGHT_Rim", cfg["rim"], cfg["rim_power"],
        (0.0, 4.0, 4.2), target, 3.0,
    )

    practical = None
    if flicker or mood == "mystery":
        data = bpy.data.lights.new("CINE_LIGHT_Practical", "POINT")
        data.color = (1.0, 0.48, 0.18) if flicker else (0.28, 0.42, 1.0)
        data.energy = 180.0 if flicker else 90.0
        try:
            data.shadow_soft_size = 0.35
        except (AttributeError, TypeError):
            pass
        practical = bpy.data.objects.new("CINE_LIGHT_Practical", data)
        sc.collection.objects.link(practical)
        practical.location = (1.7, 1.6, 2.1)

        if flicker:
            rng = random.Random(42)
            for frame in range(max(1, int(f0)), int(f1) + 1, 3):
                data.energy = rng.choice((0.0, 18.0, 70.0, 180.0))
                data.keyframe_insert("energy", frame=frame)

    return {
        "world": world,
        "key": key,
        "fill": fill,
        "rim": rim,
        "practical": practical,
        "preset": preset,
    }
