# material_factory.py — Toon & Stylized Materials for Blender 5.2 EEVEE
import bpy
from typing import Tuple, Dict

_MAT_CACHE: Dict[str, bpy.types.Material] = {}

def clear_cache():
    _MAT_CACHE.clear()

def create_toon_material(
    name: str,
    base_color: Tuple[float, float, float, float] = (0.8, 0.8, 0.8, 1.0),
    shadow_color: Tuple[float, float, float, float] = None,
    specular: float = 0.2,
    roughness: float = 0.6,
    emission: float = 0.0,
) -> bpy.types.Material:
    """Create a softly stylized, physically lit material for EEVEE.

    Room and prop surfaces must receive real key/fill/rim lighting. The former
    emission-only ShaderToRGB output looked flat because it bypassed scene lights.
    """
    key = f"TOON_{name}_{base_color}_{shadow_color}_{emission}_{roughness}"
    if key in _MAT_CACHE:
        try:
            m = _MAT_CACHE[key]
            if m.name in bpy.data.materials:
                return m
        except ReferenceError:
            pass

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = max(0.05, min(1.0, roughness))
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = max(0.0, min(1.0, specular * 0.15))
    if emission > 0:
        emission_socket = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emission_socket:
            emission_socket.default_value = base_color
        strength_socket = bsdf.inputs.get("Emission Strength")
        if strength_socket:
            strength_socket.default_value = emission
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    _MAT_CACHE[key] = mat
    return mat

def create_wood_material(name: str, color: Tuple[float, float, float, float] = (0.50, 0.32, 0.18, 1.0)) -> bpy.types.Material:
    shadow = (color[0] * 0.6, color[1] * 0.55, color[2] * 0.7, 1.0)
    return create_toon_material(f"Wood_{name}", base_color=color, shadow_color=shadow)

def create_tile_material(name: str, color: Tuple[float, float, float, float] = (0.85, 0.90, 0.92, 1.0)) -> bpy.types.Material:
    shadow = (color[0] * 0.7, color[1] * 0.75, color[2] * 0.88, 1.0)
    return create_toon_material(f"Tile_{name}", base_color=color, shadow_color=shadow)

def create_metal_material(name: str, color: Tuple[float, float, float, float] = (0.75, 0.78, 0.82, 1.0)) -> bpy.types.Material:
    shadow = (0.45, 0.48, 0.55, 1.0)
    return create_toon_material(f"Metal_{name}", base_color=color, shadow_color=shadow, specular=0.8)

def create_mirror_material(name: str = "Mirror") -> bpy.types.Material:
    """Stylized mirror with shiny soft reflection tint."""
    return create_toon_material(f"Mirror_{name}", base_color=(0.92, 0.95, 0.98, 1.0), shadow_color=(0.60, 0.65, 0.75, 1.0), emission=0.25)

def create_glass_material(name: str = "Glass") -> bpy.types.Material:
    """Semi-transparent stylized toon glass."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new

    tr = N('ShaderNodeBsdfTransparent')
    em = N('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.85, 0.92, 1.0, 1.0)
    em.inputs['Strength'].default_value = 0.5

    mx = N('ShaderNodeMixShader')
    mx.inputs['Fac'].default_value = 0.25
    L(tr.outputs['BSDF'], mx.inputs[1])
    L(em.outputs['Emission'], mx.inputs[2])

    out = N('ShaderNodeOutputMaterial')
    L(mx.outputs['Shader'], out.inputs['Surface'])
    try:
        mat.surface_render_method = 'DITHERED'
    except Exception:
        pass
    return mat

