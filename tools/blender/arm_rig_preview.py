"""
Arum 2D arm-rig prototype preview.
Builds a subdivided sprite card, armature bones and automatic 2D weights
from the neutral standing sprite. This is an isolated test scene; it does
not alter the production character pipeline yet.

Run:
  blender --background --python tools/blender/arm_rig_preview.py -- \
    --character-root karakter/arum \
    --output tools/blender/output/arum_arm_rig_test.blend \
    --preview tools/blender/output/arum_arm_rig_test.png
"""
import bpy
import os
import sys
import math
import argparse
from mathutils import Vector

def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--character-root", default="karakter/arum")
    p.add_argument("--output", default="tools/blender/output/arum_arm_rig_test.blend")
    p.add_argument("--preview", default="tools/blender/output/arum_arm_rig_test.png")
    p.add_argument("--segments-x", type=int, default=80)
    p.add_argument("--segments-y", type=int, default=140)
    return p.parse_args(argv)

def inside_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside

def point_segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    t = 0.0 if denom < 1e-9 else max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy) / denom))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px-qx, py-qy)

def main():
    a = args()
    root = os.path.abspath(a.character_root)
    image_path = os.path.join(root, "arum_badan_diam.png")
    if not os.path.isfile(image_path):
        raise FileNotFoundError(image_path)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.cameras, bpy.data.materials):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)

    W, H = 800.0, 1400.0
    feet_y = 1375.0
    scale = 1.9 / 1300.0
    nx, nz = max(20, a.segments_x), max(30, a.segments_y)

    # Dense UV card so armature deformation can bend the sprite smoothly.
    verts, faces, uv_faces = [], [], []
    for iz in range(nz + 1):
        v = iz / nz
        py = H * (1.0 - v)
        z = (feet_y - py) * scale
        for ix in range(nx + 1):
            u = ix / nx
            px = W * u
            x = (px - 400.0) * scale
            verts.append((x, 0.0, z))
    row = nx + 1
    for iz in range(nz):
        for ix in range(nx):
            i = iz * row + ix
            faces.append((i, i+1, i+1+row, i+row))
            uv_faces.append(((ix/nx, iz/nz), ((ix+1)/nx, iz/nz),
                             ((ix+1)/nx, (iz+1)/nz), (ix/nx, (iz+1)/nz)))
    mesh = bpy.data.meshes.new("ARUM_RIGGED_BODY_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, coords in zip(mesh.polygons, uv_faces):
        for loop_index, coord in zip(poly.loop_indices, coords):
            uv.data[loop_index].uv = coord
    body = bpy.data.objects.new("ARUM_RIGGED_BODY", mesh)
    bpy.context.collection.objects.link(body)

    mat = bpy.data.materials.new("ARUM_BODY_SPRITE")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path, check_existing=True)
    tex.interpolation = "Linear"
    emission = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    mat.node_tree.links.new(tex.outputs["Color"], emission.inputs["Color"])
    mat.node_tree.links.new(tex.outputs["Alpha"], mix.inputs[0])
    mat.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
    mat.node_tree.links.new(emission.outputs[0], mix.inputs[2])
    mat.node_tree.links.new(mix.outputs[0], output.inputs["Surface"])
    try:
        mat.surface_render_method = "DITHERED"
    except Exception:
        pass
    body.data.materials.append(mat)

    # Image-space joint positions (origin top-left); tuned to the neutral Arum sprite.
    joints = {
        "ARM_L_UPPER": ((285, 365), (255, 555)),
        "ARM_L_FORE":  ((255, 555), (238, 735)),
        "ARM_L_HAND":  ((238, 735), (244, 790)),
        "ARM_R_UPPER": ((515, 365), (545, 555)),
        "ARM_R_FORE":  ((545, 555), (562, 735)),
        "ARM_R_HAND":  ((562, 735), (556, 790)),
    }
    armature_data = bpy.data.armatures.new("ARUM_ARMATURE_DATA")
    armature = bpy.data.objects.new("ARUM_ARMATURE", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, tail) in joints.items():
        bone = armature_data.edit_bones.new(name)
        bone.head = ((head[0]-400)*scale, -0.005, (feet_y-head[1])*scale)
        bone.tail = ((tail[0]-400)*scale, -0.005, (feet_y-tail[1])*scale)
        bone.use_deform = True
        if "FORE" in name:
            bone.parent = armature_data.edit_bones.get(name.replace("FORE", "UPPER"))
            bone.use_connect = False
        elif "HAND" in name:
            bone.parent = armature_data.edit_bones.get(name.replace("HAND", "FORE"))
            bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    # Restrict influence to arm silhouettes so the torso/skirt remain rigid.
    polygons = {
        "L": [(278,320),(316,335),(337,385),(321,445),(300,505),(284,585),(270,665),(258,745),(235,805),(207,790),(204,730),(220,650),(232,565),(244,475),(250,390)],
        "R": [(522,320),(484,335),(463,385),(479,445),(500,505),(516,585),(530,665),(542,745),(565,805),(593,790),(596,730),(580,650),(568,565),(556,475),(550,390)],
    }
    groups = {name: body.vertex_groups.new(name=name) for name in joints}
    for index, co in enumerate(verts):
        px = co[0] / scale + 400.0
        py = feet_y - co[2] / scale
        side = "L" if inside_polygon(px, py, polygons["L"]) else ("R" if inside_polygon(px, py, polygons["R"]) else None)
        if not side:
            continue
        candidates = []
        for suffix in ("UPPER", "FORE", "HAND"):
            name = f"ARM_{side}_{suffix}"
            (p1, p2) = joints[name]
            d = point_segment_distance(px, py, p1[0], p1[1], p2[0], p2[1])
            candidates.append((name, d))
        candidates.sort(key=lambda item: item[1])
        # Smooth blend between the nearest two segments around the elbow/wrist.
        near = candidates[:2]
        weights = [math.exp(-d / 28.0) for _, d in near]
        total = sum(weights) or 1.0
        for (name, _), weight in zip(near, weights):
            groups[name].add([index], weight / total, "REPLACE")

    modifier = body.modifiers.new("ARUM_ARMATURE_DEFORM", "ARMATURE")
    modifier.object = armature
    modifier.use_vertex_groups = True
    body.parent = armature

    # Test animation: lift both arms gradually, hold, then return to rest.
    armature.animation_data_create()
    for name in joints:
        pb = armature.pose.bones.get(name)
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.keyframe_insert(data_path="rotation_euler", frame=1)
    # Opposite Y rotations create mirrored arm raises in the sprite plane.
    for frame, left_upper, left_fore, right_upper, right_fore in [
        (1, 0.0, 0.0, 0.0, 0.0),
        (18, -0.32, -0.22, 0.32, 0.22),
        (36, -0.55, -0.48, 0.55, 0.48),
        (54, -0.55, -0.48, 0.55, 0.48),
        (72, 0.0, 0.0, 0.0, 0.0),
    ]:
        for name, value in [
            ("ARM_L_UPPER", left_upper), ("ARM_L_FORE", left_fore),
            ("ARM_R_UPPER", right_upper), ("ARM_R_FORE", right_fore),
        ]:
            pb = armature.pose.bones[name]
            pb.rotation_euler[2] = value
            pb.keyframe_insert(data_path="rotation_euler", frame=frame)
    for name in ("ARM_L_HAND", "ARM_R_HAND"):
        pb = armature.pose.bones[name]
        for frame, angle in ((1, 0.0), (36, 0.10), (48, -0.10), (60, 0.10), (72, 0.0)):
            pb.rotation_euler[2] = angle
            pb.keyframe_insert(data_path="rotation_euler", frame=frame)
    try:
        action = armature.animation_data.action
        for curve in action.fcurves:
            for point in curve.keyframe_points:
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"
    except Exception:
        pass

    # Camera and render.
    cam_data = bpy.data.cameras.new("ARUM_RIG_CAMERA")
    cam = bpy.data.objects.new("ARUM_RIG_CAMERA", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0, -6, 0.95)
    target = Vector((0, 0, 0.95))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.12
    bpy.context.scene.camera = cam

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 800
    sc.render.resolution_y = 1400
    sc.render.resolution_percentage = 70
    sc.render.fps = 24
    sc.frame_start, sc.frame_end = 1, 72
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = True
    sc.world.color = (0, 0, 0)
    sc.frame_set(36)

    output = os.path.abspath(a.output)
    preview = os.path.abspath(a.preview)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    os.makedirs(os.path.dirname(preview), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output)
    sc.render.filepath = preview
    bpy.ops.render.render(write_still=True)
    print("[Arum Arm Rig] Blend:", output)
    print("[Arum Arm Rig] Preview:", preview)
    print("[Arum Arm Rig] Bones:", ", ".join(joints.keys()))
    print("[Arum Arm Rig] Test animation: rest -> raise -> hold -> return (72 frames)")

if __name__ == "__main__":
    main()
