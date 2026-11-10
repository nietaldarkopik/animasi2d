# exterior_builder.py — Procedural 3D Exterior Architecture for Blender 5.2
import bpy, math
from typing import Dict, Any, Tuple
from core.material_factory import create_toon_material, create_wood_material, create_metal_material
from environment.room_builder import _create_box_mesh

def _create_cylinder_mesh(name: str, radius: float, height: float, segments: int = 16) -> bpy.types.Object:
    verts = []
    # bottom center and top center
    verts.append((0, 0, 0))
    verts.append((0, 0, height))
    # circumference
    for i in range(segments):
        ang = 2 * math.pi * i / segments
        x = radius * math.cos(ang)
        y = radius * math.sin(ang)
        verts.append((x, y, 0))
        verts.append((x, y, height))

    faces = []
    for i in range(segments):
        i_next = (i + 1) % segments
        b1 = 2 + i * 2
        t1 = 3 + i * 2
        b2 = 2 + i_next * 2
        t2 = 3 + i_next * 2
        # quad side
        faces.append((b1, b2, t2, t1))
        # bottom fan
        faces.append((0, b2, b1))
        # top fan
        faces.append((1, t1, t2))

    me = bpy.data.meshes.new(f"Mesh_{name}")
    me.from_pydata(verts, [], faces)
    return bpy.data.objects.new(name, me)

def build_exterior(
    sc: bpy.types.Scene,
    exterior_type: str = "street",
) -> Dict[str, Any]:
    """
    Builds a 3D outdoor environment with ground, sidewalks/roads/grass, and backdrop structures.
    exterior_type: 'street', 'park', 'school_yard'
    """
    root = bpy.data.objects.new(f"Exterior_{exterior_type}", None)
    sc.collection.objects.link(root)

    if exterior_type == "park":
        # Grass ground
        grass_mat = create_toon_material("ParkGrass", base_color=(0.35, 0.68, 0.28, 1.0))
        ground = _create_box_mesh("Ground", 18.0, 14.0, 0.1)
        ground.location = (0, 3.0, -0.1)
        ground.data.materials.append(grass_mat)
        sc.collection.objects.link(ground)
        ground.parent = root

        # Pathway
        path_mat = create_toon_material("ParkPath", base_color=(0.82, 0.78, 0.68, 1.0))
        pathway = _create_box_mesh("Path", 3.0, 14.0, 0.12)
        pathway.location = (0, 3.0, -0.09)
        pathway.data.materials.append(path_mat)
        sc.collection.objects.link(pathway)
        pathway.parent = root

        # Stylized cartoon tree
        trunk_mat = create_wood_material("TreeTrunk", color=(0.42, 0.28, 0.16, 1.0))
        leaf_mat = create_toon_material("TreeLeaves", base_color=(0.28, 0.62, 0.22, 1.0))

        for tx, ty in [(-3.8, 4.0), (4.2, 5.0)]:
            trunk = _create_cylinder_mesh(f"Trunk_{tx}", 0.25, 2.2, 8)
            trunk.location = (tx, ty, 0)
            trunk.data.materials.append(trunk_mat)
            sc.collection.objects.link(trunk)
            trunk.parent = root

            leaves = _create_box_mesh(f"Leaves_{tx}", 1.8, 1.8, 1.8, center_bottom=False)
            leaves.location = (tx, ty, 2.8)
            leaves.data.materials.append(leaf_mat)
            sc.collection.objects.link(leaves)
            leaves.parent = root

    elif exterior_type == "school_yard":
        # Concrete ground
        ground_mat = create_toon_material("SchoolGround", base_color=(0.65, 0.68, 0.70, 1.0))
        ground = _create_box_mesh("Ground", 20.0, 16.0, 0.1)
        ground.location = (0, 4.0, -0.1)
        ground.data.materials.append(ground_mat)
        sc.collection.objects.link(ground)
        ground.parent = root

        # School Building facade in background
        facade_mat = create_toon_material("SchoolFacade", base_color=(0.92, 0.88, 0.82, 1.0))
        facade = _create_box_mesh("SchoolBuilding", 20.0, 1.5, 6.0)
        facade.location = (0, 8.5, 0)
        facade.data.materials.append(facade_mat)
        sc.collection.objects.link(facade)
        facade.parent = root

        # Entrance gate pillars
        pillar_mat = create_toon_material("GatePillar", base_color=(0.45, 0.48, 0.52, 1.0))
        for px in [-2.5, 2.5]:
            p = _create_box_mesh(f"Pillar_{px}", 0.6, 0.6, 2.8)
            p.location = (px, 2.5, 0)
            p.data.materials.append(pillar_mat)
            sc.collection.objects.link(p)
            p.parent = root

    else: # street
        # Asphalt road
        road_mat = create_toon_material("Asphalt", base_color=(0.28, 0.30, 0.34, 1.0))
        road = _create_box_mesh("Road", 20.0, 8.0, 0.1)
        road.location = (0, 1.0, -0.1)
        road.data.materials.append(road_mat)
        sc.collection.objects.link(road)
        road.parent = root

        # Sidewalk
        walk_mat = create_toon_material("Sidewalk", base_color=(0.75, 0.76, 0.78, 1.0))
        walk = _create_box_mesh("Sidewalk", 20.0, 3.5, 0.22)
        walk.location = (0, 5.0, -0.05)
        walk.data.materials.append(walk_mat)
        sc.collection.objects.link(walk)
        walk.parent = root

        # Backdrop houses/shops
        shop_mat1 = create_toon_material("Shop1", base_color=(0.88, 0.80, 0.72, 1.0))
        shop_mat2 = create_toon_material("Shop2", base_color=(0.72, 0.82, 0.88, 1.0))
        b1 = _create_box_mesh("Building1", 9.0, 2.0, 5.0)
        b1.location = (-5.0, 7.5, 0)
        b1.data.materials.append(shop_mat1)
        sc.collection.objects.link(b1)
        b1.parent = root

        b2 = _create_box_mesh("Building2", 9.0, 2.0, 5.5)
        b2.location = (5.0, 7.5, 0)
        b2.data.materials.append(shop_mat2)
        sc.collection.objects.link(b2)
        b2.parent = root

    return {
        "root": root,
        "exterior_type": exterior_type,
    }

