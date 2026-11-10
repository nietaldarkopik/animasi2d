# cinematic_render.py — Production render defaults for Blender 5.2
"""Consistent, hardware-conscious render configuration for the cartoon pipeline."""

import bpy
from typing import Dict, Any


def configure_cinematic_render(
    scene: bpy.types.Scene,
    aspect_ratio: str = "16:9",
    quality: str = "final",
    fps: int = 24,
) -> Dict[str, Any]:
    """Configure EEVEE, framing, color management and output settings.

    quality='preview' is intended for quick blocking tests on modest GPUs.
    quality='final' keeps the output crisp without enabling expensive effects
    that are not supported consistently across Blender versions.
    """
    portrait = str(aspect_ratio).strip() == "9:16"
    quality_key = str(quality).strip().lower()
    preview = quality_key in ("preview", "draft", "low")

    # Blender MCP may expose legacy EEVEE even when the desktop app is newer.
    # Prefer the engine confirmed by this runtime; legacy EEVEE is first because
    # this MCP runtime reports BLENDER_EEVEE, not BLENDER_EEVEE_NEXT.
    available_engines = []
    try:
        engine_prop = scene.render.bl_rna.properties.get("engine")
        if engine_prop:
            available_engines = [item.identifier for item in engine_prop.enum_items]
    except Exception:
        pass

    selected_engine = None
    for candidate in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES", "BLENDER_WORKBENCH"):
        if available_engines and candidate not in available_engines:
            continue
        try:
            scene.render.engine = candidate
            selected_engine = candidate
            break
        except (TypeError, ValueError):
            continue

    if selected_engine is None:
        raise RuntimeError(
            "No supported Blender render engine found. "
            f"Available engines: {available_engines or 'could not be queried'}"
        )

    print(f"[Blender] Selected render engine: {selected_engine}")
    scene.render.resolution_x = 1080 if portrait else 1920
    scene.render.resolution_y = 1920 if portrait else 1080
    scene.render.resolution_percentage = 55 if preview else 100
    scene.render.fps = max(1, int(fps))
    scene.render.fps_base = 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True

    # Enable legacy EEVEE quality features only when exposed by this runtime.
    try:
        eevee = scene.eevee
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = 16 if preview else 64
        if hasattr(eevee, "use_gtao"):
            eevee.use_gtao = True
        if hasattr(eevee, "gtao_distance"):
            eevee.gtao_distance = 3.0
        if hasattr(eevee, "gtao_factor"):
            eevee.gtao_factor = 1.25
        if hasattr(eevee, "use_soft_shadows"):
            eevee.use_soft_shadows = True
        if hasattr(eevee, "use_shadow_high_bitdepth"):
            eevee.use_shadow_high_bitdepth = True
    except (AttributeError, TypeError, ValueError):
        pass

    # Select the best available contrast transform instead of assuming AgX
    # exists in the engine/runtime exposed through Blender MCP.
    try:
        transform_prop = scene.view_settings.bl_rna.properties.get("view_transform")
        transforms = {item.identifier for item in transform_prop.enum_items} if transform_prop else set()
        for candidate in ("AgX", "Filmic", "Standard"):
            if candidate in transforms:
                scene.view_settings.view_transform = candidate
                break

        look_prop = scene.view_settings.bl_rna.properties.get("look")
        looks = {item.identifier for item in look_prop.enum_items} if look_prop else set()
        for candidate in ("AgX - Medium High Contrast", "Medium High Contrast", "High Contrast"):
            if candidate in looks:
                scene.view_settings.look = candidate
                break
    except (AttributeError, TypeError, ValueError):
        pass

    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = "//render/frame_"
    return {
        "engine": scene.render.engine,
        "resolution": (scene.render.resolution_x, scene.render.resolution_y),
        "percentage": scene.render.resolution_percentage,
        "fps": scene.render.fps,
        "quality": "preview" if preview else "final",
    }
