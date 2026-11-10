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

            # Collect characters
            dialogue_list = sc.get("dialog", [])
            actors = list(dict.fromkeys([d.get("who", "Uki").strip() for d in dialogue_list]))
            if not actors:
                actors = ["Uki"]

            # Plan shots for this scene
            shots = []
            scene_start_f = global_frame

            # Shot 1: Establishing Shot
            shots.append({
                "shot_id": f"sc{s_idx + 1}_sh1_establish",
                "shot_size": "wide",
                "angle": "eye_level",
                "movement": "dolly_in",
                "duration_frames": 48, # 2 seconds
                "target": actors[0] if actors else "center",
                "focus": "environment",
                "start_f": global_frame,
                "end_f": global_frame + 48,
            })
            global_frame += 48

            # Shots for dialogue exchanges
            for d_idx, d in enumerate(dialogue_list):
                speaker = d.get("who", "Uki")
                text = d.get("text", "")
                dur_sec = max(1.8, len(text) / 14.0)
                dur_frames = int(dur_sec * self.fps)

                # Alternate cinematography rhythm
                if "kaget" in text.lower() or "hah" in text.lower() or "astaga" in text.lower():
                    shot_size = "close_up"
                    angle = "dutch"
                    movement = "shake"
                elif d_idx % 2 == 0:
                    shot_size = "medium"
                    angle = "eye_level"
                    movement = "static"
                else:
                    shot_size = "over_the_shoulder"
                    angle = "eye_level"
                    movement = "push_in"

                shots.append({
                    "shot_id": f"sc{s_idx + 1}_sh{d_idx + 2}_dlg",
                    "shot_size": shot_size,
                    "angle": angle,
                    "movement": movement,
                    "duration_frames": dur_frames,
                    "speaker": speaker,
                    "text": text,
                    "target": speaker,
                    "start_f": global_frame,
                    "end_f": global_frame + dur_frames,
                })
                global_frame += dur_frames

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
                "start_frame": scene_start_f,
                "end_frame": scene_end_f,
            })

        return {
            "title": title,
            "theme": theme,
            "fps": self.fps,
            "aspect_ratio": self.aspect_ratio,
            "total_frames": global_frame + 24,
            "scenes": planned_scenes,
        }
