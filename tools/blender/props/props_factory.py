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



def create_classroom_props(sc: bpy.types.Scene) -> Dict[str, Any]:
    """Build a recognizable classroom set: whiteboard, teacher desk, student desks and chairs."""
    root = bpy.data.objects.new("Prop_ClassroomSet", None)
    sc.collection.objects.link(root)

    desk_mat = create_wood_material("ClassroomDesk", color=(0.58, 0.38, 0.22, 1.0))
    metal_mat = create_metal_material("ClassroomLegs", color=(0.32, 0.36, 0.42, 1.0))
    board_mat = create_toon_material(
        "WhiteboardSurface",
        base_color=(0.58, 0.63, 0.62, 1.0),
        shadow_color=(0.30, 0.36, 0.39, 1.0),
    )
    frame_mat = create_wood_material("WhiteboardFrame", color=(0.35, 0.24, 0.16, 1.0))
    chair_mat = create_toon_material("ClassroomChair", base_color=(0.18, 0.38, 0.62, 1.0))

    # Whiteboard sits on the back wall and faces the camera.
    board_frame = _create_box_mesh("ClassroomWhiteboardFrame", 2.8, 0.12, 1.35)
    board_frame.location = (-1.3, 4.72, 1.55)
    board_frame.data.materials.append(frame_mat)
    sc.collection.objects.link(board_frame)
    board_frame.parent = root

    board = _create_box_mesh("ClassroomWhiteboard", 2.6, 0.035, 1.13)
    board.location = (-1.3, 4.645, 1.58)
    board.data.materials.append(board_mat)
    sc.collection.objects.link(board)
    board.parent = root

    # Readable academic writing gives the board visual purpose in medium and
    # wide shots. Text lies just in front of the board and faces the room.
    ink_blue = create_toon_material(
        "WhiteboardInkBlue", base_color=(0.035, 0.12, 0.22, 1.0)
    )
    ink_red = create_toon_material(
        "WhiteboardInkRed", base_color=(0.58, 0.12, 0.16, 1.0)
    )

    def add_board_text(name, body, x, z, size, material, align="CENTER"):
        curve = bpy.data.curves.new(name, type="FONT")
        curve.body = body
        curve.size = size
        curve.align_x = align
        curve.align_y = "CENTER"
        curve.extrude = 0.001
        obj = bpy.data.objects.new(name, curve)
        sc.collection.objects.link(obj)
        obj.location = (x, 4.615, z)
        obj.rotation_euler = (math.radians(90), 0, 0)
        obj.data.materials.append(material)
        obj.parent = root
        return obj

    board_title = add_board_text(
        "Board_Title", "FISIKA  /  MATEMATIKA", -1.3, 2.48, 0.17, ink_blue
    )
    board_formula_1 = add_board_text(
        "Board_Formula_1", "v = s / t", -2.48, 2.12, 0.12, ink_blue, align="LEFT"
    )
    board_formula_2 = add_board_text(
        "Board_Formula_2", "F = m x a", -2.48, 1.88, 0.11, ink_red, align="LEFT"
    )
    board_formula_3 = add_board_text(
        "Board_Formula_3", "x² + y² = r²", -2.48, 1.64, 0.085, ink_blue, align="LEFT"
    )

    # A slim marker rail and two markers add small, useful classroom details.
    marker_rail = _create_box_mesh("WhiteboardMarkerRail", 1.15, 0.10, 0.055)
    marker_rail.location = (-1.3, 4.56, 1.50)
    marker_rail.data.materials.append(frame_mat)
    sc.collection.objects.link(marker_rail)
    marker_rail.parent = root

    marker_white = create_toon_material(
        "WhiteboardMarkerBody", base_color=(0.88, 0.88, 0.82, 1.0)
    )
    for idx, (mx, marker_mat) in enumerate(((-1.62, ink_blue), (-1.28, ink_red))):
        marker = _create_box_mesh(f"WhiteboardMarker_{idx}", 0.055, 0.055, 0.22)
        marker.location = (mx, 4.52, 1.63)
        marker.rotation_euler[1] = math.radians(90)
        marker.data.materials.append(marker_white)
        sc.collection.objects.link(marker)
        marker.parent = root

    # A few neatly arranged books and a notebook make the teacher desk feel used.
    book_mats = [
        create_toon_material("ClassroomBookNavy", base_color=(0.12, 0.22, 0.38, 1.0)),
        create_toon_material("ClassroomBookRust", base_color=(0.62, 0.24, 0.16, 1.0)),
        create_toon_material("ClassroomBookSage", base_color=(0.28, 0.43, 0.34, 1.0)),
    ]
    for idx, mat in enumerate(book_mats):
        book = _create_box_mesh(f"TeacherDesk_Book_{idx}", 0.22, 0.16, 0.035)
        book.location = (-2.48 + idx * 0.025, 3.48 + idx * 0.015, 0.91 + idx * 0.04)
        book.rotation_euler[2] = math.radians(-8 + idx * 7)
        book.data.materials.append(mat)
        sc.collection.objects.link(book)
        book.parent = root

    notebook = _create_box_mesh("TeacherDesk_Notebook", 0.28, 0.22, 0.018)
    notebook.location = (-1.72, 3.48, 0.91)
    notebook.data.materials.append(create_toon_material(
        "ClassroomNotebook", base_color=(0.88, 0.84, 0.70, 1.0)
    ))
    sc.collection.objects.link(notebook)
    notebook.parent = root

    # Teacher desk, kept to one side so the main acting area remains clear.
    teacher_desk = _create_box_mesh("TeacherDeskTop", 1.55, 0.72, 0.12)
    teacher_desk.location = (-2.15, 3.55, 0.82)
    teacher_desk.data.materials.append(desk_mat)
    sc.collection.objects.link(teacher_desk)
    teacher_desk.parent = root

    teacher_front = _create_box_mesh("TeacherDeskFront", 1.42, 0.08, 0.62)
    teacher_front.location = (-2.15, 3.86, 0.36)
    teacher_front.data.materials.append(desk_mat)
    sc.collection.objects.link(teacher_front)
    teacher_front.parent = root

    student_desks = []
    student_chairs = []
    for row, y in enumerate((2.65, 3.75)):
        for col, x in enumerate((-1.65, 0.0, 1.65)):
            desk_top = _create_box_mesh(f"StudentDeskTop_{row}_{col}", 1.05, 0.58, 0.10)
            desk_top.location = (x, y, 0.76)
            desk_top.data.materials.append(desk_mat)
            sc.collection.objects.link(desk_top)
            desk_top.parent = root
            student_desks.append(desk_top)

            for leg_x in (-0.43, 0.43):
                for leg_y in (-0.22, 0.22):
                    leg = _create_box_mesh(f"DeskLeg_{row}_{col}_{leg_x}_{leg_y}", 0.045, 0.045, 0.72)
                    leg.location = (x + leg_x, y + leg_y, 0.0)
                    leg.data.materials.append(metal_mat)
                    sc.collection.objects.link(leg)
                    leg.parent = root

            chair_seat = _create_box_mesh(f"ChairSeat_{row}_{col}", 0.48, 0.46, 0.09)
            chair_seat.location = (x, y - 0.58, 0.43)
            chair_seat.data.materials.append(chair_mat)
            sc.collection.objects.link(chair_seat)
            chair_seat.parent = root
            student_chairs.append(chair_seat)

            for leg_x in (-0.18, 0.18):
                for leg_y in (-0.16, 0.16):
                    chair_leg = _create_box_mesh(f"ChairLeg_{row}_{col}_{leg_x}_{leg_y}", 0.035, 0.035, 0.42)
                    chair_leg.location = (x + leg_x, y - 0.58 + leg_y, 0.0)
                    chair_leg.data.materials.append(metal_mat)
                    sc.collection.objects.link(chair_leg)
                    chair_leg.parent = root

            chair_back = _create_box_mesh(f"ChairBack_{row}_{col}", 0.48, 0.08, 0.52)
            chair_back.location = (x, y - 0.78, 0.70)
            chair_back.data.materials.append(chair_mat)
            sc.collection.objects.link(chair_back)
            chair_back.parent = root

    return {
        "root": root,
        "whiteboard": board,
        "teacher_desk": teacher_desk,
        "student_desks": student_desks,
        "student_chairs": student_chairs,
    }
