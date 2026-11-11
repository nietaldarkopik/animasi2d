# scene_manager.py — Master 2.5D Scene Builder for Blender 5.2
import bpy, os, sys, time
from typing import Dict, Any, Tuple

_BLENDER_TOOLS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BLENDER_TOOLS_DIR not in sys.path:
    sys.path.insert(0, _BLENDER_TOOLS_DIR)

from environment.room_builder import build_interior_room
from environment.exterior_builder import build_exterior
from environment.lighting_presets import apply_lighting
from props.props_factory import (
    create_bed, create_wardrobe, create_bathroom_set,
    create_kitchen_props, create_living_props, create_classroom_props,
)
from cinematography.camera_rig import create_cinematic_camera
from core.cinematic_render import configure_cinematic_render
from char_lib import make_character, make_silhouette, char_reset

KARAKTER_ROOT = os.path.abspath(os.path.join(_BLENDER_TOOLS_DIR, "..", "..", "karakter"))


def _actor_position(name: str, actors: list, positions: Dict[str, Tuple[float, float, float]]):
    """Case-insensitive actor position lookup."""
    key = str(name or "").strip().lower()
    for actor in actors:
        if str(actor).strip().lower() == key:
            return positions[actor]
    return None


def _build_shot_cameras(sc, scene_data, plan, actors, positions, f0, f1):
    """Create a camera for every planned shot and switch cameras with timeline markers."""
    shots = scene_data.get("shots") or [{
        "shot_id": "fallback_establish",
        "shot_size": "medium_wide",
        "angle": "eye_level",
        "movement": "static",
        "start_f": f0,
        "end_f": f1,
        "target": "center",
    }]

    cameras = []
    # Avoid stale camera-cut markers when a scene is rebuilt in the same file.
    for marker in list(sc.timeline_markers):
        if marker.name.startswith("SHOT_"):
            sc.timeline_markers.remove(marker)

    for index, shot in enumerate(shots):
        shot_start = max(f0, int(shot.get("start_f", f0)))
        shot_end = min(f1, max(shot_start + 1, int(shot.get("end_f", f1))))
        target_name = shot.get("speaker") or shot.get("target") or "center"
        target = None if shot.get("focus") == "environment" else _actor_position(target_name, actors, positions)

        if target is None:
            # Establishing/environment shots frame the room; other untargeted
            # shots use the center of the acting area.
            target = (0.0, 2.0, 1.15) if shot.get("focus") == "environment" else (0.0, 1.2, 1.05)
        else:
            # Aim close-ups at the face; medium shots retain upper-body context.
            shot_size = shot.get("shot_size")
            # Keep dialogue framing around the face/upper torso. Over-the-shoulder
            # shots were aimed too low and cropped the speaker's head at 16:9.
            if shot_size in ("close_up", "extreme_close_up", "medium_close_up"):
                # Raise the look target so the actor sits slightly lower in frame,
                # preserving visible headroom during close-up push-ins.
                target_z = 1.78
            elif shot_size == "over_the_shoulder":
                target_z = 1.48
            else:
                target_z = 1.38
            target = (target[0], target[1], target_z)

        info = create_cinematic_camera(
            sc,
            target_pos=target,
            shot_size=shot.get("shot_size", "medium"),
            angle=shot.get("angle", "eye_level"),
            movement=shot.get("movement", "static"),
            f0=shot_start,
            f1=shot_end,
            dutch_degrees=float(shot.get("dutch_degrees", 0.0)),
            aspect_ratio=plan.get("aspect_ratio", "16:9"),
        )
        camera = info["camera"]
        camera.name = "Camera_" + str(shot.get("shot_id", index + 1))
        marker = sc.timeline_markers.new("SHOT_" + str(index + 1).zfill(2), frame=shot_start)
        marker.camera = camera
        cameras.append(info)

    if cameras:
        sc.camera = cameras[0]["camera"]
    return cameras


def build_scene_from_plan(
    sc: bpy.types.Scene,
    plan: Dict[str, Any],
    scene_idx: int = 0,
    quality: str = "final",
) -> Dict[str, Any]:
    """Build environment, lighting, props, per-shot cameras and 2.5D actors."""
    profile = {}
    _build_started = time.perf_counter()
    _stage_started = _build_started

    def _mark_stage(name):
        nonlocal _stage_started
        elapsed = time.perf_counter() - _stage_started
        profile[name] = round(elapsed, 4)
        print("[Profile] {}: {:.3f}s".format(name, elapsed), flush=True)
        _stage_started = time.perf_counter()

    char_reset()
    scene_data = plan["scenes"][scene_idx]
    env_type = scene_data.get("environment_type", "living_room")
    time_of_day = scene_data.get("time_of_day", "siang")
    mood = scene_data.get("mood", "normal")
    flicker = scene_data.get("flicker_lighting", False)
    f0 = int(scene_data.get("start_frame", 1))
    f1 = max(f0, int(scene_data.get("end_frame", f0 + 100)) - 1)  # storyboard end_frame is exclusive; Blender frame_end is inclusive
    sc.frame_start = f0
    sc.frame_end = f1

    render_settings = configure_cinematic_render(
        sc,
        aspect_ratio=plan.get("aspect_ratio", "16:9"),
        quality=quality,
        fps=int(plan.get("fps", 24)),
    )
    _mark_stage("render_configuration")

    lighting = apply_lighting(
        sc, time_of_day=time_of_day, mood=mood,
        flicker=flicker, f0=f0, f1=f1,
    )
    _mark_stage("lighting")

    if env_type in ("street", "park", "school_yard"):
        env = build_exterior(sc, exterior_type=env_type)
    else:
        env = build_interior_room(sc, room_type=env_type)
    _mark_stage("environment")

    props_created = {}
    _props_started = time.perf_counter()
    props_needed = scene_data.get("props", [])
    if "bed" in props_needed:
        _prop_started = time.perf_counter()
        props_created["bed"] = create_bed(sc, loc=(-2.0, 2.4, 0))
        profile["prop_bed"] = round(time.perf_counter() - _prop_started, 4)
        print("[Profile] prop_bed: {:.3f}s".format(profile["prop_bed"]), flush=True)
    if "wardrobe" in props_needed:
        _prop_started = time.perf_counter()
        props_created["wardrobe"] = create_wardrobe(sc, loc=(2.0, 2.6, 0))
        profile["prop_wardrobe"] = round(time.perf_counter() - _prop_started, 4)
        print("[Profile] prop_wardrobe: {:.3f}s".format(profile["prop_wardrobe"]), flush=True)
    if "bathroom_set" in props_needed:
        _prop_started = time.perf_counter()
        props_created["bathroom_set"] = create_bathroom_set(sc)
        profile["prop_bathroom_set"] = round(time.perf_counter() - _prop_started, 4)
        print("[Profile] prop_bathroom_set: {:.3f}s".format(profile["prop_bathroom_set"]), flush=True)
    if "kitchen_set" in props_needed:
        _prop_started = time.perf_counter()
        props_created["kitchen_set"] = create_kitchen_props(sc)
        profile["prop_kitchen_set"] = round(time.perf_counter() - _prop_started, 4)
        print("[Profile] prop_kitchen_set: {:.3f}s".format(profile["prop_kitchen_set"]), flush=True)
    if "living_set" in props_needed:
        _prop_started = time.perf_counter()
        props_created["living_set"] = create_living_props(sc)
        profile["prop_living_set"] = round(time.perf_counter() - _prop_started, 4)
        print("[Profile] prop_living_set: {:.3f}s".format(profile["prop_living_set"]), flush=True)
    if "classroom_set" in props_needed or env_type == "classroom":
        _prop_started = time.perf_counter()
        props_created["classroom_set"] = create_classroom_props(sc)
        profile["prop_classroom_set"] = round(time.perf_counter() - _prop_started, 4)
        print("[Profile] prop_classroom_set: {:.3f}s".format(profile["prop_classroom_set"]), flush=True)

    profile["props_total"] = round(time.perf_counter() - _props_started, 4)
    _mark_stage("props_total")

    actors = scene_data.get("actors") or ["Uki"]
    num_actors = len(actors)
    positions = {}
    if num_actors == 1:
        positions[actors[0]] = (0.0, 0.65, 0.0)
    elif num_actors == 2:
        positions[actors[0]] = (-0.78, 0.65, 0.0)
        positions[actors[1]] = (0.78, 0.65, 0.0)
    else:
        for index, actor in enumerate(actors):
            x = (index - (num_actors - 1) / 2.0) * 0.82
            positions[actor] = (x, 0.65, 0.0)

    camera_infos = _build_shot_cameras(sc, scene_data, plan, actors, positions, f0, f1)
    _mark_stage("camera_rig")
    cam = camera_infos[0]["camera"] if camera_infos else sc.camera

    actor_objs = {}
    known_chars = {"uki", "arum", "seni", "riska"}
    shots = scene_data.get("shots", [])

    for actor in actors:
        _actor_started = time.perf_counter()
        clean_name = str(actor).lower().strip()
        exprs = [(f0, "netral")]
        poses = [(f0, "diam")]
        speak = []
        actor_actions = []
        # Prefer explicit Director action cues. Legacy storyboards still use
        # the previous keyword heuristics as a backward-compatible fallback.
        action_items = scene_data.get("action_timeline") or []
        if not action_items:
            action_items = [
                {
                    "actor": shot.get("speaker"),
                    "emotion": shot.get("action", {}).get("emotion"),
                    "pose": shot.get("action", {}).get("pose"),
                    "start_frame": shot.get("start_f", f0),
                    "end_frame": shot.get("end_f", f0 + 24),
                    "speech": bool(shot.get("speaker")),
                    "dialogue_text": shot.get("text", ""),
                }
                for shot in shots
            ]

        for cue in action_items:
            speaker = str(cue.get("actor", "")).lower().strip()
            if speaker != clean_name:
                continue

            text_line = str(cue.get("dialogue_text", "")).lower()
            start_f = int(cue.get("start_frame", f0))
            end_f = int(cue.get("end_frame", start_f + 24))
            actor_actions.append(cue)
            planned_emotion = cue.get("emotion")
            planned_pose = cue.get("pose")

            if planned_emotion and planned_pose:
                emotion, pose = planned_emotion, planned_pose
            elif any(word in text_line for word in ("hah", "astaga", "kaget", "serius?!", "apa?!")):
                emotion, pose = "kaget", "angkat"
            elif any(word in text_line for word in ("haha", "lucu", "berhasil", "senang", "hore")):
                emotion, pose = "senang", "jempol"
            elif any(word in text_line for word in ("takut", "hantu", "jangan", "tolong")):
                emotion, pose = "takut", "pelipis"
            elif any(word in text_line for word in ("marah", "berani", "cukup")):
                emotion, pose = "marah", "pinggang"
            elif any(word in text_line for word in ("periksa", "cek", "papan tulis", "belakang", "lihat", "perhatikan", "itu", "coba kita")):
                emotion, pose = "bingung", "tunjuk"
            elif any(word in text_line for word in ("tenang", "ikuti aku", "sebentar")):
                emotion, pose = "netral", "angkat"
            else:
                emotion, pose = "netral", "diam"

            # The available sprite library contains these expression/pose names.
            valid_exprs = {"netral", "senang", "kaget", "sinis", "sedih", "marah", "bingung", "mengantuk", "sombong", "malu"}
            valid_poses = {"diam", "tunjuk", "angkat", "lambai", "pinggang", "pelipis", "dagu", "jempol", "silang"}
            exprs.append((start_f, emotion if emotion in valid_exprs else "netral"))
            poses.append((start_f, pose if pose in valid_poses else "diam"))
            if cue.get("speech", True):
                speak.append((start_f + 2, max(start_f + 2, end_f - 2)))
            reset_frame = max(start_f, end_f - 1)
            exprs.append((reset_frame, "netral"))
            poses.append((reset_frame, "diam"))

        # _at() in char_lib expects chronologically ordered expression keys.
        exprs.sort(key=lambda item: item[0])
        poses.sort(key=lambda item: item[0])
        location = positions.get(actor, (0.0, 0.65, 0.0))
        if clean_name in known_chars:
            char_dir = os.path.join(KARAKTER_ROOT, clean_name)
            actor_objs[actor] = make_character(
                sc, cam, char_dir, clean_name, location,
                exprs=exprs, poses=poses, speak=speak, actions=actor_actions,
                f0=f0, f1=f1, blink_seed=sum(ord(ch) for ch in clean_name),
            )
        else:
            actor_objs[actor] = make_silhouette(
                sc, cam, os.path.join(KARAKTER_ROOT, "uki"),
                clean_name, location, pose="diam",
            )
        profile["actor_" + clean_name] = round(time.perf_counter() - _actor_started, 4)
        print("[Profile] actor {}: {:.3f}s".format(clean_name, profile["actor_" + clean_name]), flush=True)

    _mark_stage("actors_total")
    sc.frame_set(f0)
    _mark_stage("initial_frame_evaluation")
    profile["scene_build_total"] = round(time.perf_counter() - _build_started, 4)
    print("[Profile] scene_build_total: {:.3f}s".format(profile["scene_build_total"]), flush=True)
    return {
        "scene_name": scene_data.get("name", f"Scene {scene_idx + 1}"),
        "environment": env,
        "props": props_created,
        "lighting": lighting,
        "camera": camera_infos[0] if camera_infos else {},
        "cameras": camera_infos,
        "render_settings": render_settings,
        "actors": actor_objs,
        "f0": f0,
        "f1": f1,
        "profiling": profile,
    }
