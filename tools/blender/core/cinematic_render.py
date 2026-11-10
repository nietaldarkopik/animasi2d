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

    scene.render.engine = "BLENDER_EEVEE_NEXT"
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

    # Blender 5.x uses EEVEE Next. Keep the sample setting version-safe.
    try:
        eevee = scene.eevee
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = 16 if preview else 64
    except (AttributeError, TypeError):
        pass

    # AgX gives a more filmic highlight roll-off than the default Standard view.
    try:
        scene.view_settings.view_transform = "AgX"
        look_prop = scene.view_settings.bl_rna.properties.get("look")
        if look_prop:
            available = {item.identifier for item in look_prop.enum_items}
            for candidate in ("AgX - Medium High Contrast", "AgX - Medium High Contrast"):
                if candidate in available:
                    scene.view_settings.look = candidate
                    break
    except (AttributeError, TypeError):
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
