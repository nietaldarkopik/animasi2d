# scene_director.py — AI Director for Autonomous Cartoon Production
import json, os, re
from typing import Dict, List, Any, Optional

LOCATION_MAP = {
    "kamar tidur": "bedroom",
    "kamar": "bedroom",
    "bedroom": "bedroom",
    "ruang tamu": "living_room",
    "living room": "living_room",
    "dapur": "kitchen",
    "kitchen": "kitchen",
    "kamar mandi": "bathroom",
    "toilet": "bathroom",
    "bathroom": "bathroom",
    "koridor": "corridor",
    "lorong": "corridor",
    "corridor": "corridor",
    "kelas": "classroom",
    "ruang kelas": "classroom",
    "lab": "classroom",
    "lab komputer": "classroom",
    "jalan": "street",
    "jalan raya": "street",
    "street": "street",
    "taman": "park",
    "park": "park",
    "sekolah": "school_yard",
    "halaman": "school_yard",
    "halaman sekolah": "school_yard",
}

class SceneDirector:
    def __init__(self, fps: int = 24, aspect_ratio: str = "16:9"):
        self.fps = fps
        self.aspect_ratio = aspect_ratio

    def map_location(self, loc_text: str) -> str:
        clean = loc_text.strip().lower()
        for k in sorted(LOCATION_MAP.keys(), key=len, reverse=True):
            if k in clean:
                return LOCATION_MAP[k]
        return "living_room" # sensible default

    def infer_action(self, speaker: str, text: str, start_f: int, end_f: int) -> Dict[str, Any]:
        """Create a deterministic, editable character action cue for one shot."""
        line = str(text or "").lower()
        # Detect a reaction only when the line is actually an exclamation/recoil.
        # Words such as "bikin kaget" inside an explanation must not trigger a full-shot flinch.
        opening = line.lstrip(" \"'“”")
        startled = (
            re.match(r"^(hah+\s*[?!,]|astaga\b|waduh\b|serius\s*[?!]|apa\s*[?!])", opening) is not None
            or any(w in line for w in ("aku terkejut", "spontan mundur", "kaget sekali"))
        )
        inspect = any(w in line for w in ("mengamati", "ngintip", "memeriksa", "periksa", "cek", "lihat", "mengintip"))
        approach = any(w in line for w in ("harus cek", "ke sana", "mendekat", "ikuti aku", "ayo"))
        explain = (
            opening.startswith(("iya,", "iya ", "karena", "soalnya", "begini"))
            or any(w in line for w in ("embernya tadi", "tadi bocor", "bikin kaget aja"))
        )

        if explain:
            action, emotion, pose, gaze, movement = "explain", "netral", "angkat", "listener", "subtle_gesture"
        elif startled:
            action, emotion, pose, gaze, movement = "startled_reaction", "kaget", "angkat", "speaker", "quick_recoil"
        elif approach:
            action, emotion, pose, gaze, movement = "approach_target", "bingung", "tunjuk", "story_target", "step_forward"
        elif inspect:
            action, emotion, pose, gaze, movement = "inspect_environment", "bingung", "pelipis", "story_target", "lean_forward"
        elif "?" in line:
            action, emotion, pose, gaze, movement = "question", "bingung", "dagu", "listener", "hold"
        else:
            action, emotion, pose, gaze, movement = "speak", "netral", "diam", "camera", "hold"

        return {
            "actor": str(speaker or "Uki").strip(),
            "action": action,
            "emotion": emotion,
            "pose": pose,
            "gaze_target": gaze,
            "movement": movement,
            "start_frame": int(start_f),
            "end_frame": int(end_f),
            "speech": bool(text),
            "dialogue_text": str(text or ""),
        }

    def analyze_script(self, script_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Translates raw script JSON into fully orchestrated 3D Scene Plans
        with environments, props, cinematography, and character staging.
        """
        title = script_data.get("title", "Film Kartun")
        theme = script_data.get("theme", "")
        raw_scenes = script_data.get("scenes", [])
        if not raw_scenes and "dialog" in script_data:
            raw_scenes = [script_data]

        planned_scenes = []
        global_frame = 1

        for s_idx, sc in enumerate(raw_scenes):
            scene_name = sc.get("name", f"Scene {s_idx + 1}")
            loc_raw = sc.get("location", "Ruang tamu")
            loc_type = self.map_location(loc_raw)
            time_of_day = sc.get("time", "siang").lower()

            # Mood classification
            full_text = " ".join([d.get("text", "") for d in sc.get("dialog", [])]).lower()
            if any(w in full_text for w in ["hantu", "gaib", "takut", "misterius", "suara", "aneh", "cermin"]):
                mood = "mystery"
            elif any(w in full_text for w in ["hore", "lucu", "alhamdulillah", "berhasil", "senang"]):
                mood = "cheerful"
            else:
                mood = "normal"

            # Determine required props based on location & story
            props = []
            if loc_type == "bedroom":
                props.extend(["bed", "wardrobe"])
            elif loc_type == "bathroom":
                props.extend(["bathroom_set"]) # sink, mirror, shower, bucket, dipper, towel
            elif loc_type == "kitchen":
                props.extend(["kitchen_set"]) # counter, stove, pan, fridge, vent, radio
            elif loc_type == "living_room":
                props.extend(["living_set"]) # sofa, table
            elif loc_type == "classroom":
                props.extend(["classroom_set"]) # whiteboard, teacher desk, student desks and chairs

            # Collect characters
            dialogue_list = sc.get("dialog", [])
            actors = list(dict.fromkeys([str(d.get("who") or "Uki").strip() for d in dialogue_list]))
            if not actors:
                actors = ["Uki"]

            # Plan shots for this scene
            shots = []
            action_timeline = []
            scene_start_f = global_frame

            # Shot 1: Establishing Shot
            establish_start = global_frame
            establish_end = establish_start + 36
            establish_shot = {
                "shot_id": f"sc{s_idx + 1}_sh1_establish",
                "shot_size": "wide",
                "angle": "eye_level",
                "movement": "dolly_in",
                "duration_frames": 36,
                "target": actors[0] if actors else "center",
                "focus": "environment",
                "start_f": establish_start,
                "end_f": establish_end,
            }
            establish_shot["action"] = {
                "actor": actors[0] if actors else "Uki",
                "action": "establish_presence",
                "emotion": "netral",
                "pose": "diam",
                "gaze_target": "environment",
                "movement": "hold",
                "start_frame": establish_start,
                "end_frame": establish_end,
                "speech": False,
                "dialogue_text": "",
            }
            shots.append(establish_shot)
            action_timeline.append(establish_shot["action"])
            global_frame = establish_end

            # Shots for dialogue exchanges
            for d_idx, d in enumerate(dialogue_list):
                speaker = d.get("who", "Uki")
                text = d.get("text", "")
                dur_sec = max(1.8, len(text) / 14.0)
                dur_frames = int(dur_sec * self.fps)

                # Choose coverage from the dramatic beat, not dialogue index alone.
                line = text.lower()
                startled = any(w in line for w in ("hah", "astaga", "serius?!", "apa?!", "tidak mungkin"))
                emotional = any(w in line for w in ("takut", "sedih", "marah", "jangan", "tolong", "rahasia"))
                reveal = any(w in line for w in ("ternyata", "sebenarnya", "ketahuan", "rahasia", "bukan"))
                question = "?" in text

                if startled:
                    shot_size = "close_up"
                    angle = "dutch"
                    movement = "push_in"
                elif reveal or emotional:
                    shot_size = "medium_close_up"
                    angle = "eye_level"
                    movement = "dolly_in"
                elif any(w in line for w in ("periksa", "cek", "coba kita", "ikuti aku", "lihat ke")):
                    shot_size = "medium"
                    angle = "over_the_shoulder"
                    movement = "tracking"
                elif question:
                    shot_size = "medium"
                    angle = "over_the_shoulder" if d_idx > 0 else "eye_level"
                    movement = "static"
                elif d_idx > 0 and str(dialogue_list[d_idx - 1].get("who") or "").strip().lower() != str(speaker or "").strip().lower():
                    shot_size = "over_the_shoulder"
                    angle = "eye_level"
                    movement = "static"
                else:
                    shot_size = "medium"
                    angle = "eye_level"
                    movement = "static"

                shot_start = global_frame
                shot_end = shot_start + dur_frames
                shot = {
                    "shot_id": f"sc{s_idx + 1}_sh{d_idx + 2}_dlg",
                    "shot_size": shot_size,
                    "angle": angle,
                    "movement": movement,
                    "duration_frames": dur_frames,
                    "speaker": speaker,
                    "text": text,
                    "target": speaker,
                    "start_f": shot_start,
                    "end_f": shot_end,
                }
                shot["action"] = self.infer_action(speaker, text, shot_start, shot_end)
                shots.append(shot)
                action_timeline.append(shot["action"])
                global_frame = shot_end

            scene_end_f = global_frame

            planned_scenes.append({
                "scene_index": s_idx,
                "name": scene_name,
                "location_raw": loc_raw,
                "environment_type": loc_type,
                "time_of_day": time_of_day,
                "mood": mood,
                "flicker_lighting": (mood == "mystery" and loc_type in ("bathroom", "corridor")),
                "props": props,
                "actors": actors,
                "dialogue": dialogue_list,
                "shots": shots,
                "action_timeline": action_timeline,
                "start_frame": scene_start_f,
                "end_frame": scene_end_f,
                "frame_count": scene_end_f - scene_start_f,
            })

        return {
            "title": title,
            "theme": theme,
            "fps": self.fps,
            "aspect_ratio": self.aspect_ratio,
            "total_frames": global_frame - 1,
            "duration_seconds": round((global_frame - 1) / max(1, self.fps), 3),
            "frame_range": {"start": 1, "end_exclusive": global_frame},
            "scenes": planned_scenes,
        }
