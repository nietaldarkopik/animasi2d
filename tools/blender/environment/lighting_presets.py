# lighting_presets.py — Cinematic Three-Point Toon Lighting for Blender 5.2
import bpy
import math
import random
from typing import Dict, Any


LIGHTING_CONFIGS: Dict[str, Dict[str, Any]] = {
    "pagi": {
        "world": (0.30, 0.40, 0.58, 1.0), "world_strength": 0.24,
        "key": (1.0, 0.78, 0.58), "fill": (0.42, 0.58, 0.90), "rim": (1.0, 0.82, 0.62),
        "key_power": 460.0, "fill_power": 115.0, "rim_power": 520.0,
    },
    "siang": {
        "world": (0.38, 0.48, 0.62, 1.0), "world_strength": 0.28,
        "key": (1.0, 0.88, 0.72), "fill": (0.48, 0.64, 0.92), "rim": (1.0, 0.91, 0.78),
        "key_power": 500.0, "fill_power": 145.0, "rim_power": 560.0,
    },
    "sore": {
        "world": (0.30, 0.16, 0.20, 1.0), "world_strength": 0.20,
        "key": (1.0, 0.40, 0.18), "fill": (0.40, 0.30, 0.66), "rim": (1.0, 0.55, 0.25),
        "key_power": 480.0, "fill_power": 100.0, "rim_power": 580.0,
    },
    "malam": {
        "world": (0.025, 0.038, 0.09, 1.0), "world_strength": 0.10,
        "key": (0.32, 0.48, 1.0), "fill": (0.16, 0.24, 0.50), "rim": (0.42, 0.58, 1.0),
        "key_power": 390.0, "fill_power": 65.0, "rim_power": 520.0,
    },
    "mystery": {
        "world": (0.008, 0.014, 0.045, 1.0), "world_strength": 0.025,
        "key": (0.38, 0.55, 1.0), "fill": (0.12, 0.18, 0.38), "rim": (0.58, 0.24, 1.0),
        "key_power": 300.0, "fill_power": 35.0, "rim_power": 450.0,
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
    try:
        data.use_shadow = True
        if hasattr(data, "use_contact_shadow"):
            data.use_contact_shadow = True
    except (AttributeError, TypeError):
        pass
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
    """Create motivated key, restrained fill, colored rim and optional practical light."""
    _remove_previous_cinematic_lights(sc)

    preset = "mystery" if mood == "mystery" else str(time_of_day).lower()
    cfg = LIGHTING_CONFIGS.get(preset, LIGHTING_CONFIGS["siang"])

    world = bpy.data.worlds.get("CINE_World_" + preset) or bpy.data.worlds.new("CINE_World_" + preset)
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = cfg["world"]
        background.inputs["Strength"].default_value = cfg["world_strength"]
    sc.world = world

    # Light the acting area at face height; the lower fill preserves readable toon shadows.
    target = (0.0, 0.8, 1.48)
    key = _area_light(
        sc, "CINE_LIGHT_Key", cfg["key"], cfg["key_power"],
        (-3.8, -3.4, 4.5), target, 3.0,
    )
    fill = _area_light(
        sc, "CINE_LIGHT_Fill", cfg["fill"], cfg["fill_power"],
        (3.6, -2.2, 2.7), target, 4.5,
    )
    rim = _area_light(
        sc, "CINE_LIGHT_Rim", cfg["rim"], cfg["rim_power"],
        (0.0, 4.0, 4.0), target, 2.2,
    )

    practical = None
    if flicker or mood == "mystery":
        data = bpy.data.lights.new("CINE_LIGHT_Practical", "POINT")
        data.color = (1.0, 0.42, 0.16) if flicker else (0.30, 0.48, 1.0)
        data.energy = 145.0 if flicker else 75.0
        try:
            data.shadow_soft_size = 0.45
            data.use_shadow = True
        except (AttributeError, TypeError):
            pass
        practical = bpy.data.objects.new("CINE_LIGHT_Practical", data)
        sc.collection.objects.link(practical)
        practical.location = (1.7, 1.6, 2.1)

        if flicker:
            # The practical light stays steady for long intervals. Use only
            # a few soft dips per scene to avoid a strobe-like effect.
            rng = random.Random(42)
            first_frame = max(1, int(f0))
            last_frame = int(f1)
            base_energy = 145.0
            data.energy = base_energy
            data.keyframe_insert("energy", frame=first_frame)

            event_count = 0
            frame = first_frame + rng.randint(120, 156)  # 5-6.5 seconds at 24 FPS
            while frame < last_frame - 18:
                # Fade down and back over about half a second.
                data.energy = rng.choice((112.0, 120.0, 128.0))
                data.keyframe_insert("energy", frame=frame)

                data.energy = rng.choice((78.0, 88.0, 98.0))
                data.keyframe_insert("energy", frame=frame + 5)

                data.energy = base_energy
                data.keyframe_insert("energy", frame=frame + 12)
                event_count += 1
                frame += rng.randint(144, 192)  # next event after 6-8 seconds

            data.energy = base_energy
            data.keyframe_insert("energy", frame=last_frame)
            print(
                "[Lighting] Soft flicker enabled: {} events, frames {}-{}, base energy {}".format(
                    event_count, first_frame, last_frame, base_energy
                ),
                flush=True,
            )

    return {
        "world": world,
        "key": key,
        "fill": fill,
        "rim": rim,
        "practical": practical,
        "preset": preset,
    }
