# room_builder.py — Procedural 3D Interior Architecture for Blender 5.2
import bpy, math
from typing import Dict, Any, Tuple
from core.material_factory import create_toon_material, create_wood_material, create_tile_material, create_glass_material

def _create_box_mesh(name: str, width: float, depth: float, height: float, center_bottom: bool = True) -> bpy.types.Object:
    """Create a box mesh with origin at center or bottom center."""
    w2, d2, h = width / 2.0, depth / 2.0, height
    z0 = 0.0 if center_bottom else -h / 2.0
    z1 = h if center_bottom else h / 2.0

    verts = [
        (-w2, -d2, z0), (w2, -d2, z0), (w2, d2, z0), (-w2, d2, z0),
        (-w2, -d2, z1), (w2, -d2, z1), (w2, d2, z1), (-w2, d2, z1)
    ]
    faces = [
        (0, 1, 2, 3), # bottom
        (4, 5, 6, 7), # top
        (0, 1, 5, 4), # front
        (2, 3, 7, 6), # back
        (0, 3, 7, 4), # left
        (1, 2, 6, 5), # right
    ]
    me = bpy.data.meshes.new(f"Mesh_{name}")
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)

    # Small bevels catch highlights and remove the overly sharp primitive look.
    bevel = obj.modifiers.new("Soft_Edges", "BEVEL")
    bevel.width = min(0.025, max(0.004, min(width, depth, height) * 0.06))
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    try:
        normal = obj.modifiers.new("Weighted_Normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    except (AttributeError, TypeError):
        pass
    return obj

def build_interior_room(
    sc: bpy.types.Scene,
    room_type: str = "bedroom",
    width: float = 7.0,
    depth: float = 6.0,
    height: float = 3.2,
) -> Dict[str, Any]:
    """
    Builds a solid 3D room with floor, walls, baseboards, window, and door opening.
    room_type: 'bedroom', 'living_room', 'bathroom', 'kitchen', 'classroom', 'corridor'
    """
    root = bpy.data.objects.new(f"Room_{room_type}", None)
    sc.collection.objects.link(root)

    # Palette based on room type
    if room_type == "bathroom":
        floor_mat = create_tile_material("BathroomFloor", color=(0.78, 0.85, 0.90, 1.0))
        wall_mat = create_tile_material("BathroomWall", color=(0.90, 0.94, 0.96, 1.0))
        trim_mat = create_toon_material("BathroomTrim", base_color=(0.55, 0.65, 0.72, 1.0))
    elif room_type == "kitchen":
        floor_mat = create_tile_material("KitchenFloor", color=(0.82, 0.82, 0.82, 1.0))
        wall_mat = create_toon_material("KitchenWall", base_color=(0.95, 0.92, 0.86, 1.0))
        trim_mat = create_wood_material("KitchenTrim", color=(0.40, 0.28, 0.18, 1.0))
    elif room_type == "corridor":
        floor_mat = create_wood_material("CorridorFloor", color=(0.55, 0.40, 0.28, 1.0))
        wall_mat = create_toon_material("CorridorWall", base_color=(0.90, 0.88, 0.82, 1.0))
        trim_mat = create_wood_material("CorridorTrim", color=(0.35, 0.22, 0.12, 1.0))
        width = 4.0 # narrower
    elif room_type == "living_room":
        floor_mat = create_wood_material("LivingFloor", color=(0.58, 0.42, 0.28, 1.0))
        wall_mat = create_toon_material("LivingWall", base_color=(0.92, 0.90, 0.84, 1.0))
        trim_mat = create_wood_material("LivingTrim", color=(0.38, 0.24, 0.14, 1.0))
    elif room_type == "classroom":
        floor_mat = create_tile_material("ClassroomFloor", color=(0.66, 0.69, 0.66, 1.0))
        wall_mat = create_toon_material("ClassroomWall", base_color=(0.86, 0.90, 0.84, 1.0))
        trim_mat = create_wood_material("ClassroomTrim", color=(0.34, 0.24, 0.16, 1.0))
    else: # bedroom
        floor_mat = create_wood_material("BedFloor", color=(0.60, 0.45, 0.30, 1.0))
        wall_mat = create_toon_material("BedWall", base_color=(0.88, 0.90, 0.94, 1.0))
        trim_mat = create_wood_material("BedTrim", color=(0.42, 0.26, 0.15, 1.0))

    # 1. Floor
    fl = _create_box_mesh("Floor", width, depth, 0.1)
    fl.location = (0, depth / 2.0 - 1.0, -0.1)
    fl.data.materials.append(floor_mat)
    sc.collection.objects.link(fl)
    fl.parent = root

    # 2. Back wall
    bw = _create_box_mesh("Wall_Back", width, 0.2, height)
    bw.location = (0, depth - 1.0, 0)
    bw.data.materials.append(wall_mat)
    sc.collection.objects.link(bw)
    bw.parent = root

    # 3. Left wall
    lw = _create_box_mesh("Wall_Left", 0.2, depth, height)
    lw.location = (-width / 2.0, depth / 2.0 - 1.0, 0)
    lw.data.materials.append(wall_mat)
    sc.collection.objects.link(lw)
    lw.parent = root

    # 4. Right wall
    rw = _create_box_mesh("Wall_Right", 0.2, depth, height)
    rw.location = (width / 2.0, depth / 2.0 - 1.0, 0)
    rw.data.materials.append(wall_mat)
    sc.collection.objects.link(rw)
    rw.parent = root

    # 5. Baseboards (Trim)
    base_back = _create_box_mesh("Trim_Back", width, 0.04, 0.15)
    base_back.location = (0, depth - 1.0 - 0.11, 0)
    base_back.data.materials.append(trim_mat)
    sc.collection.objects.link(base_back)
    base_back.parent = root

    # 6. Window on Back Wall (except for corridor/bathroom if small)
    if room_type in ("bedroom", "living_room", "kitchen", "classroom"):
        win_frame = _create_box_mesh("Window_Frame", 1.8, 0.08, 1.4)
        win_frame.location = (width * 0.22, depth - 1.0 - 0.12, 1.2)
        win_frame.data.materials.append(trim_mat)
        sc.collection.objects.link(win_frame)
        win_frame.parent = root

        win_glass = _create_box_mesh("Window_Glass", 1.6, 0.02, 1.2)
        win_glass.location = (width * 0.22, depth - 1.0 - 0.14, 1.3)
        win_glass.data.materials.append(create_glass_material("WindowGlass"))
        sc.collection.objects.link(win_glass)
        win_glass.parent = root

    # 7. Interior Door (on Left or Right Wall)
    door_frame = _create_box_mesh("Door_Frame", 0.12, 1.1, 2.2)
    door_frame.location = (-width / 2.0 + 0.12, 0.6, 0)
    door_frame.data.materials.append(trim_mat)
    sc.collection.objects.link(door_frame)
    door_frame.parent = root

    door_leaf = _create_box_mesh("Door_Leaf", 0.04, 0.95, 2.1)
    door_leaf.location = (-width / 2.0 + 0.12, 0.6, 0)
    door_leaf.data.materials.append(create_wood_material("DoorLeaf", color=(0.48, 0.30, 0.18, 1.0)))
    sc.collection.objects.link(door_leaf)
    door_leaf.parent = root

    return {
        "root": root,
        "floor": fl,
        "walls": [bw, lw, rw],
        "door": door_leaf,
        "room_type": room_type,
        "dimensions": (width, depth, height),
    }

