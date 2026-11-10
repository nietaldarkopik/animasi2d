# scene_manager.py — Master 3D Scene Builder for Blender 5.2
import bpy, os, sys, math
from typing import Dict, Any, List, Optional

# Add parent path so imports resolve
_BLENDER_TOOLS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BLENDER_TOOLS_DIR not in sys.path:
    sys.path.insert(0, _BLENDER_TOOLS_DIR)

from environment.room_builder import build_interior_room
from environment.exterior_builder import build_exterior
from environment.lighting_presets import apply_lighting
from props.props_factory import create_bed, create_wardrobe, create_bathroom_set, create_kitchen_props, create_living_props
from cinematography.camera_rig import create_cinematic_camera
from director.scene_director import SceneDirector
from char_lib import make_character, make_silhouette, char_reset

KARAKTER_ROOT = os.path.abspath(os.path.join(_BLENDER_TOOLS_DIR, "..", "..", "karakter"))

def build_scene_from_plan(
    sc: bpy.types.Scene,
    plan: Dict[str, Any],
    scene_idx: int = 0,
) -> Dict[str, Any]:
    """
    Builds the complete 3D scene (environment, props, lighting, characters, and camera)
    based on the AI Director's structured plan.
    """
    char_reset()
    scene_data = plan["scenes"][scene_idx]
    env_type = scene_data["environment_type"]
    time_of_day = scene_data["time_of_day"]
    mood = scene_data["mood"]
    flicker = scene_data.get("flicker_lighting", False)
    f0 = scene_data["start_frame"]
    f1 = scene_data["end_frame"]
    sc.frame_start = f0
    sc.frame_end = f1

    # 1. Lighting Setup
    lighting = apply_lighting(sc, time_of_day=time_of_day, mood=mood, flicker=flicker, f0=f0, f1=f1)

    # 2. Environment Setup (Interior vs Exterior)
    if env_type in ("street", "park", "school_yard"):
        env = build_exterior(sc, exterior_type=env_type)
    else:
        env = build_interior_room(sc, room_type=env_type)

    # 3. Props Setup
    props_created = {}
    props_needed = scene_data.get("props", [])

    if "bed" in props_needed:
        props_created["bed"] = create_bed(sc, loc=(-2.0, 2.4, 0))
    if "wardrobe" in props_needed:
        props_created["wardrobe"] = create_wardrobe(sc, loc=(2.0, 2.6, 0))
    if "bathroom_set" in props_needed:
        props_created["bathroom_set"] = create_bathroom_set(sc)
    if "kitchen_set" in props_needed:
        props_created["kitchen_set"] = create_kitchen_props(sc)
    if "living_set" in props_needed:
        props_created["living_set"] = create_living_props(sc)

    # 4. Cinematic Camera Setup
    first_shot = scene_data["shots"][0] if scene_data["shots"] else {"shot_size": "medium_wide", "angle": "eye_level", "movement": "dolly_in"}
    cam_info = create_cinematic_camera(
        sc,
        target_pos=(0, 1.2, 1.4),
        shot_size=first_shot.get("shot_size", "medium_wide"),
        angle=first_shot.get("angle", "eye_level"),
        movement=first_shot.get("movement", "dolly_in"),
        f0=f0,
        f1=f1,
        aspect_ratio=plan.get("aspect_ratio", "16:9"),
    )
    cam = cam_info["camera"]

    # 5. Characters Setup & Keyframe Staging
    actors = scene_data.get("actors", ["Uki"])
    actor_objs = {}
    num_actors = len(actors)

    # Spatial staging: distribute characters naturally in midground
    pos_map = {}
    if num_actors == 1:
        pos_map[actors[0]] = (0.0, 1.2, 0.0)
    elif num_actors == 2:
        pos_map[actors[0]] = (-0.75, 1.2, 0.0)
        pos_map[actors[1]] = (0.75, 1.2, 0.0)
    else:
        for i, a in enumerate(actors):
            x = (i - (num_actors - 1) / 2.0) * 0.9
            pos_map[a] = (x, 1.2, 0.0)

    # Build dialogue keyframes per actor
    dialogue_list = scene_data.get("dialogue", [])
    known_chars = {"uki", "arum", "seni", "riska"}

    for a in actors:
        clean_name = a.lower().strip()
        exprs = [(f0, "netral")]
        poses = [(f0, "diam")]
        speak = []
        u_ranges = []

        # Find dialogue spoken by this actor
        for sh in scene_data["shots"]:
            spk = sh.get("speaker")
            if spk and spk.lower().strip() == clean_name:
                txt = sh.get("text", "")
                st_f = sh["start_f"]
                en_f = sh["end_f"]

                # Detect emotion & pose
                emo = "netral"
                if any(w in txt.lower() for w in ["hah", "astaga", "kaget", "apa"]):
                    emo = "kaget"
                elif any(w in txt.lower() for w in ["haha", "lucu", "alhamdulillah", "bagus"]):
                    emo = "senang"
                elif any(w in txt.lower() for w in ["aduh", "takut", "hantu", "mati"]):
                    emo = "sedih"
                elif any(w in txt.lower() for w in ["tenang", "duet", "les vokal"]):
                    emo = "sombong"

                pose = "diam"
                if any(w in txt.lower() for w in ["tunjuk", "lihat", "itu"]):
                    pose = "tunjuk"
                elif any(w in txt.lower() for w in ["mikrofon", "bawa", "pegang"]):
                    pose = "angkat"
                elif any(w in txt.lower() for w in ["kaget", "semalam"]):
                    pose = "pelipis"
                elif any(w in txt.lower() for w in ["jimat", "tenang"]):
                    pose = "pinggang"

                exprs.append((st_f, emo))
                poses.append((st_f, pose))
                speak.append((st_f + 2, en_f - 2))

                # Return to neutral after speaking
                exprs.append((en_f + 6, "netral"))
                poses.append((en_f + 6, "diam"))

        loc = pos_map.get(a, (0, 1.2, 0))

        if clean_name in known_chars:
            char_dir = os.path.join(KARAKTER_ROOT, clean_name)
            char_res = make_character(
                sc,
                cam,
                char_dir,
                clean_name,
                loc,
                exprs=exprs,
                poses=poses,
                speak=speak,
                f0=f0,
                f1=f1,
                u_ranges=u_ranges,
            )
            actor_objs[a] = char_res
        else:
            # Secondary character silhouette
            fallback_dir = os.path.join(KARAKTER_ROOT, "uki")
            sil_res = make_silhouette(
                sc,
                cam,
                fallback_dir,
                clean_name,
                loc,
                pose="diam",
            )
            actor_objs[a] = sil_res

    return {
        "scene_name": scene_data["name"],
        "environment": env,
        "props": props_created,
        "lighting": lighting,
        "camera": cam_info,
        "actors": actor_objs,
        "f0": f0,
        "f1": f1,
    }

