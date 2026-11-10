# props_factory.py — Procedural 3D Cartoon Props for Blender 5.2 EEVEE
import bpy, math
from typing import Dict, Any, Tuple
from core.material_factory import (
    create_toon_material,
    create_wood_material,
    create_metal_material,
    create_mirror_material,
)
from environment.room_builder import _create_box_mesh
from environment.exterior_builder import _create_cylinder_mesh

def create_bed(sc: bpy.types.Scene, loc: Tuple[float, float, float] = (-2.0, 2.5, 0)) -> bpy.types.Object:
    root = bpy.data.objects.new("Prop_Bed", None)
    root.location = loc
    sc.collection.objects.link(root)

    wood_mat = create_wood_material("BedFrame", color=(0.48, 0.30, 0.18, 1.0))
    mattr_mat = create_toon_material("Mattress", base_color=(0.95, 0.95, 0.98, 1.0))
    sheet_mat = create_toon_material("Blanket", base_color=(0.35, 0.55, 0.82, 1.0))
    pillow_mat = create_toon_material("Pillow", base_color=(0.98, 0.98, 0.95, 1.0))

    # Frame & Legs
    frame = _create_box_mesh("BedFrame", 1.5, 2.1, 0.3)
    frame.location = (0, 0, 0.1)
    frame.data.materials.append(wood_mat)
    sc.collection.objects.link(frame)
    frame.parent = root

    headboard = _create_box_mesh("Headboard", 1.5, 0.1, 0.9)
    headboard.location = (0, 1.0, 0.1)
    headboard.data.materials.append(wood_mat)
    sc.collection.objects.link(headboard)
    headboard.parent = root

    # Mattress
    mattress = _create_box_mesh("Mattress", 1.4, 1.95, 0.25)
    mattress.location = (0, -0.05, 0.4)
    mattress.data.materials.append(mattr_mat)
    sc.collection.objects.link(mattress)
    mattress.parent = root

    # Blanket
    blanket = _create_box_mesh("Blanket", 1.42, 1.3, 0.26)
    blanket.location = (0, -0.38, 0.41)
    blanket.data.materials.append(sheet_mat)
    sc.collection.objects.link(blanket)
    blanket.parent = root

    # Pillow
    pillow = _create_box_mesh("Pillow", 0.7, 0.45, 0.12)
    pillow.location = (0, 0.7, 0.65)
    pillow.data.materials.append(pillow_mat)
    sc.collection.objects.link(pillow)
    pillow.parent = root

    return root

def create_wardrobe(sc: bpy.types.Scene, loc: Tuple[float, float, float] = (2.2, 2.8, 0), interactive: bool = True) -> Dict[str, Any]:
    root = bpy.data.objects.new("Prop_Wardrobe", None)
    root.location = loc
    sc.collection.objects.link(root)

    wood_mat = create_wood_material("WardrobeBody", color=(0.40, 0.25, 0.14, 1.0))
    door_mat = create_wood_material("WardrobeDoor", color=(0.50, 0.32, 0.18, 1.0))
    handle_mat = create_metal_material("WardrobeHandle", color=(0.85, 0.85, 0.85, 1.0))

    body = _create_box_mesh("WardrobeBody", 1.2, 0.65, 2.2)
    body.location = (0, 0, 0)
    body.data.materials.append(wood_mat)
    sc.collection.objects.link(body)
    body.parent = root

    # Interactive door on left
    door_left = _create_box_mesh("DoorLeft", 0.58, 0.04, 2.1)
    door_left.location = (-0.29, -0.34, 0.05)
    door_left.data.materials.append(door_mat)
    sc.collection.objects.link(door_left)
    door_left.parent = root

    handle = _create_cylinder_mesh("HandleLeft", 0.02, 0.15)
    handle.location = (-0.08, -0.38, 1.0)
    handle.data.materials.append(handle_mat)
    sc.collection.objects.link(handle)
    handle.parent = door_left

    return {"root": root, "door": door_left}

def create_bathroom_set(sc: bpy.types.Scene) -> Dict[str, Any]:
    """Builds complete set of bathroom props: sink, mirror, shower, bucket, dipper, towel, mat."""
    root = bpy.data.objects.new("Prop_BathroomSet", None)
    sc.collection.objects.link(root)

    ceramic_mat = create_toon_material("CeramicWhite", base_color=(0.95, 0.96, 0.98, 1.0))
    metal_mat = create_metal_material("ChromeFaucet")
    plastic_blue = create_toon_material("PlasticBlue", base_color=(0.18, 0.52, 0.85, 1.0))
    cloth_mat = create_toon_material("ClothTowel", base_color=(0.88, 0.45, 0.55, 1.0))

    # 1. Wastafel (Sink)
    sink_stand = _create_box_mesh("SinkStand", 0.3, 0.3, 0.8)
    sink_stand.location = (-1.8, 2.6, 0)
    sink_stand.data.materials.append(ceramic_mat)
    sc.collection.objects.link(sink_stand)
    sink_stand.parent = root

    sink_bowl = _create_box_mesh("SinkBowl", 0.65, 0.5, 0.2)
    sink_bowl.location = (-1.8, 2.6, 0.8)
    sink_bowl.data.materials.append(ceramic_mat)
    sc.collection.objects.link(sink_bowl)
    sink_bowl.parent = root

    faucet = _create_box_mesh("Faucet", 0.06, 0.15, 0.2)
    faucet.location = (-1.8, 2.78, 1.0)
    faucet.data.materials.append(metal_mat)
    sc.collection.objects.link(faucet)
    faucet.parent = root

    # 2. Cermin (Mirror)
    mirror = _create_box_mesh("BathroomMirror", 0.7, 0.04, 0.9)
    mirror.location = (-1.8, 2.92, 1.25)
    mirror.data.materials.append(create_mirror_material("BathMirror"))
    sc.collection.objects.link(mirror)
    mirror.parent = root

    # 3. Shower (Shower head & pipe)
    pipe = _create_cylinder_mesh("ShowerPipe", 0.02, 1.6)
    pipe.location = (1.8, 2.9, 0.8)
    pipe.data.materials.append(metal_mat)
    sc.collection.objects.link(pipe)
    pipe.parent = root

    head = _create_cylinder_mesh("ShowerHead", 0.09, 0.04)
    head.location = (1.8, 2.7, 2.3)
    head.rotation_euler = (math.radians(30), 0, 0)
    head.data.materials.append(metal_mat)
    sc.collection.objects.link(head)
    head.parent = root

    # 4. Ember Air (Bucket)
    bucket = _create_cylinder_mesh("Bucket", 0.22, 0.42, 12)
    bucket.location = (1.5, 2.4, 0)
    bucket.data.materials.append(plastic_blue)
    sc.collection.objects.link(bucket)
    bucket.parent = root

    # 5. Gayung (Dipper)
    dipper = _create_cylinder_mesh("Dipper", 0.09, 0.12, 12)
    dipper.location = (1.5, 2.4, 0.43)
    dipper.data.materials.append(create_toon_material("PlasticRed", base_color=(0.85, 0.25, 0.22, 1.0)))
    sc.collection.objects.link(dipper)
    dipper.parent = root

    # 6. Handuk (Towel hanging)
    bar = _create_box_mesh("TowelBar", 0.5, 0.08, 0.03)
    bar.location = (-0.5, 2.92, 1.4)
    bar.data.materials.append(metal_mat)
    sc.collection.objects.link(bar)
    bar.parent = root

    towel = _create_box_mesh("Towel", 0.4, 0.04, 0.65)
    towel.location = (-0.5, 2.89, 0.75)
    towel.data.materials.append(cloth_mat)
    sc.collection.objects.link(towel)
    towel.parent = root

    # 7. Keset (Bathroom Mat)
    mat = _create_box_mesh("BathMat", 0.8, 0.5, 0.02)
    mat.location = (0, 0.5, 0.01)
    mat.data.materials.append(create_toon_material("MatBrown", base_color=(0.45, 0.35, 0.25, 1.0)))
    sc.collection.objects.link(mat)
    mat.parent = root

    return {
        "root": root,
        "sink": sink_bowl,
        "mirror": mirror,
        "shower": head,
        "bucket": bucket,
        "dipper": dipper,
        "towel": towel,
        "mat": mat,
    }

def create_kitchen_props(sc: bpy.types.Scene) -> Dict[str, Any]:
    """Builds kitchen counter, stove, pan, fridge, and ventilation."""
    root = bpy.data.objects.new("Prop_KitchenSet", None)
    sc.collection.objects.link(root)

    counter_mat = create_wood_material("CounterWood", color=(0.85, 0.85, 0.85, 1.0))
    metal_mat = create_metal_material("KitchenMetal")
    dark_mat = create_toon_material("DarkMetal", base_color=(0.20, 0.20, 0.22, 1.0))

    # Kitchen Counter
    counter = _create_box_mesh("Counter", 2.4, 0.7, 0.85)
    counter.location = (0, 2.6, 0)
    counter.data.materials.append(counter_mat)
    sc.collection.objects.link(counter)
    counter.parent = root

    # Stove on top
    stove = _create_box_mesh("Stove", 0.7, 0.5, 0.08)
    stove.location = (-0.5, 2.6, 0.85)
    stove.data.materials.append(dark_mat)
    sc.collection.objects.link(stove)
    stove.parent = root

    # Pan
    pan = _create_cylinder_mesh("Pan", 0.16, 0.08, 12)
    pan.location = (-0.5, 2.6, 0.93)
    pan.data.materials.append(metal_mat)
    sc.collection.objects.link(pan)
    pan.parent = root

    # Fridge
    fridge = _create_box_mesh("Fridge", 0.75, 0.75, 1.85)
    fridge.location = (-2.0, 2.6, 0)
    fridge.data.materials.append(create_toon_material("FridgeMat", base_color=(0.92, 0.92, 0.94, 1.0)))
    sc.collection.objects.link(fridge)
    fridge.parent = root

    # Ventilation grid on top wall
    vent = _create_box_mesh("Ventilation", 0.6, 0.06, 0.4)
    vent.location = (0.6, 2.92, 2.3)
    vent.data.materials.append(dark_mat)
    sc.collection.objects.link(vent)
    vent.parent = root

    # Radio (Dangdut radio on counter)
    radio = _create_box_mesh("Radio", 0.35, 0.18, 0.22)
    radio.location = (0.6, 2.6, 0.85)
    radio.data.materials.append(create_toon_material("RadioRed", base_color=(0.75, 0.25, 0.20, 1.0)))
    sc.collection.objects.link(radio)
    radio.parent = root

    return {
        "root": root,
        "counter": counter,
        "stove": stove,
        "pan": pan,
        "fridge": fridge,
        "vent": vent,
        "radio": radio,
    }

def create_living_props(sc: bpy.types.Scene) -> Dict[str, Any]:
    """Builds sofa, coffee table, and TV stand."""
    root = bpy.data.objects.new("Prop_LivingSet", None)
    sc.collection.objects.link(root)

    sofa_mat = create_toon_material("SofaFabric", base_color=(0.35, 0.60, 0.65, 1.0))
    wood_mat = create_wood_material("TableWood", color=(0.45, 0.28, 0.16, 1.0))

    # Sofa
    sofa_base = _create_box_mesh("SofaBase", 2.2, 0.9, 0.45)
    sofa_base.location = (0, 2.6, 0)
    sofa_base.data.materials.append(sofa_mat)
    sc.collection.objects.link(sofa_base)
    sofa_base.parent = root

    sofa_back = _create_box_mesh("SofaBack", 2.2, 0.25, 0.6)
    sofa_back.location = (0, 2.95, 0.45)
    sofa_back.data.materials.append(sofa_mat)
    sc.collection.objects.link(sofa_back)
    sofa_back.parent = root

    # Coffee Table
    table = _create_box_mesh("CoffeeTable", 1.2, 0.6, 0.4)
    table.location = (0, 1.4, 0)
    table.data.materials.append(wood_mat)
    sc.collection.objects.link(table)
    table.parent = root

    return {"root": root, "sofa": sofa_base, "table": table}

