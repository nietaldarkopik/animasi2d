# lighting_presets.py — Cinematic & Toon Lighting Presets
import bpy, math
from typing import Dict, Any, Tuple

LIGHTING_CONFIGS: Dict[str, Dict[str, Any]] = {
    "pagi": {
        "sky_color": (0.68, 0.82, 1.0, 1.0),
        "sky_energy": 0.9,
        "sun_color": (1.0, 0.92, 0.80),
        "sun_energy": 3.2,
        "sun_rot": (math.radians(35), 0, math.radians(-30)),
        "fill_color": (0.50, 0.65, 0.85),
        "fill_energy": 1.2,
    },
    "siang": {
        "sky_color": (0.58, 0.78, 1.0, 1.0),
        "sky_energy": 1.0,
        "sun_color": (1.0, 0.98, 0.92),
        "sun_energy": 3.8,
        "sun_rot": (math.radians(58), 0, math.radians(-25)),
        "fill_color": (0.60, 0.70, 0.85),
        "fill_energy": 1.5,
    },
    "sore": {
        "sky_color": (0.92, 0.58, 0.40, 1.0),
        "sky_energy": 0.85,
        "sun_color": (1.0, 0.55, 0.25),
        "sun_energy": 3.5,
        "sun_rot": (math.radians(22), 0, math.radians(-45)),
        "fill_color": (0.55, 0.38, 0.65),
        "fill_energy": 1.2,
    },
    "malam": {
        "sky_color": (0.08, 0.10, 0.20, 1.0),
        "sky_energy": 0.4,
        "sun_color": (0.45, 0.60, 0.85),
        "sun_energy": 1.2,
        "sun_rot": (math.radians(45), 0, math.radians(60)),
        "fill_color": (0.15, 0.18, 0.35),
        "fill_energy": 0.6,
    },
    "mystery": {
        "sky_color": (0.05, 0.07, 0.14, 1.0),
        "sky_energy": 0.25,
        "sun_color": (0.40, 0.55, 0.80),
        "sun_energy": 1.0,
        "sun_rot": (math.radians(30), 0, math.radians(70)),
        "fill_color": (0.12, 0.14, 0.28),
        "fill_energy": 0.4,
    },
}

def apply_lighting(
    sc: bpy.types.Scene,
    time_of_day: str = "siang",
    mood: str = "normal",
    flicker: bool = False,
    f0: int = 1,
    f1: int = 100,
) -> Dict[str, Any]:
    """Sets up world background, sun key light, and ambient fill for the scene."""
    cfg_key = "mystery" if mood == "mystery" else time_of_day.lower()
    cfg = LIGHTING_CONFIGS.get(cfg_key, LIGHTING_CONFIGS["siang"])

    # Setup world
    w = bpy.data.worlds.new(f"World_{cfg_key}")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = cfg["sky_color"]
        bg.inputs[1].default_value = cfg["sky_energy"]

    # Sun Key Light
    ld_sun = bpy.data.lights.new(f"Sun_{cfg_key}", "SUN")
    ld_sun.color = cfg["sun_color"]
    ld_sun.energy = cfg["sun_energy"]
    lo_sun = bpy.data.objects.new(f"Sun_{cfg_key}", ld_sun)
    sc.collection.objects.link(lo_sun)
    lo_sun.rotation_euler = cfg["sun_rot"]

    # Soft Fill Light
    ld_fill = bpy.data.lights.new(f"Fill_{cfg_key}", "SUN")
    ld_fill.color = cfg["fill_color"]
    ld_fill.energy = cfg["fill_energy"]
    lo_fill = bpy.data.objects.new(f"Fill_{cfg_key}", ld_fill)
    sc.collection.objects.link(lo_fill)
    lo_fill.rotation_euler = (math.radians(30), 0, math.radians(135))

    # Optional Flickering Light (for mystery or broken lamp scenes)
    lamp_obj = None
    if flicker:
        ld_point = bpy.data.lights.new("FlickerLamp", "POINT")
        ld_point.color = (1.0, 0.85, 0.65)
        ld_point.energy = 80.0
        lamp_obj = bpy.data.objects.new("FlickerLamp", ld_point)
        lamp_obj.location = (0, 1.0, 2.2)
        sc.collection.objects.link(lamp_obj)

        # Animate flicker keyframes
        import random
        rnd = random.Random(42)
        for f in range(f0, f1 + 1, 3):
            # Sudden dips in energy
            val = 80.0 if rnd.random() > 0.3 else rnd.choice([0.0, 15.0, 40.0])
            ld_point.energy = val
            ld_point.keyframe_insert("energy", frame=f)

    return {
        "world": w,
        "sun": lo_sun,
        "fill": lo_fill,
        "flicker_lamp": lamp_obj,
    }

