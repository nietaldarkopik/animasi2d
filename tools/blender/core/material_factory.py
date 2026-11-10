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
    """Create a 2-step toon shaded material with crisp light/shadow transition."""
    key = f"TOON_{name}_{base_color}_{shadow_color}_{emission}"
    if key in _MAT_CACHE:
        try:
            m = _MAT_CACHE[key]
            if m.name in bpy.data.materials:
                return m
        except ReferenceError:
            pass

    if shadow_color is None:
        shadow_color = (
            base_color[0] * 0.65,
            base_color[1] * 0.68,
            base_color[2] * 0.85,
            base_color[3],
        )

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new

    # Diffuse -> ShaderToRGB -> ColorRamp -> Multiply with Base -> Output
    df = N('ShaderNodeBsdfDiffuse')
    s2r = N('ShaderNodeShaderToRGB')
    L(df.outputs[0], s2r.inputs[0])

    ramp = N('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = shadow_color
    ramp.color_ramp.elements[1].position = 0.12
    ramp.color_ramp.elements[1].color = base_color
    L(s2r.outputs[0], ramp.inputs[0])

    mix = N('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MIX'
    mix.inputs[0].default_value = 1.0
    L(ramp.outputs['Color'], mix.inputs[6])
    L(ramp.outputs['Color'], mix.inputs[7])

    em = N('ShaderNodeEmission')
    L(mix.outputs[2], em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0 + emission

    out = N('ShaderNodeOutputMaterial')
    L(em.outputs['Emission'], out.inputs['Surface'])

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

