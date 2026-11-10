# script_to_blender.py — Naskah / Prompt to Blender 2.5D Animation Generator
# Project: Cartoon Maker AI (animasi2d)

import argparse
import json
import math
import os
import re
import sys
from typing import Dict, List, Any, Optional, Tuple

# Windows console/pipe default cp1252 tidak bisa mencetak karakter seperti ✓
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CHAR_LIB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "char_lib.py"))
KARAKTER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "karakter"))

# Available known characters in folder
KNOWN_CHARACTERS = {"uki", "arum", "seni", "riska"}

# Emotion keyword rules (Indonesian)
EMOTION_PATTERNS = [
    (r"\b(haha|hehe|hihi|lucu|senang|gembira|alhamdulillah|lulus|hebat|berhasil|hore|yeay|asyik)\b", "senang"),
    (r"\b(hah|astaga|ya ampun|ya tuhan|benarkah|masa sih|kaget|terkejut)\b|\?!|!\?", "kaget"),
    (r"\b(aduh|maaf|kecewa|sedih|hiks|sayang sekali)\b", "sedih"),
    (r"\b(kesal|marah|jangan|benci|ribut)\b", "marah"),
    (r"\b(sinis|curiga|hmm|cih|rupanya)\b", "sinis"),
    (r"\b(bingung|penasaran|gimana|kenapa|kok bisa|merenung)\b", "bingung"),
    (r"\b(mengantuk|ngantuk|lelah|capek|tidur|hoam)\b", "mengantuk"),
    (r"\b(sombong|gampang|kecil itu|mudah|tenang saja|hebat kan)\b", "sombong"),
    (r"\b(malu|segan|tersipu)\b", "malu"),
]

# Pose keyword rules (Indonesian)
POSE_PATTERNS = [
    (r"\b(tunjuk|menunjuk|lihat|di depan|kelihatan|di sana|itu)\b", "tunjuk"),
    (r"\b(angkat|angkat tangan|bersorak|hore|kemenangan|dua tangan)\b", "angkat"),
    (r"\b(lambai|melambai|halo|dadah|selamat jalan)\b", "lambai"),
    (r"\b(pinggang|kacak pinggang|berkacak|siap)\b", "pinggang"),
    (r"\b(pelipis|pusing|aduh|panik|terlambat|kesiangan)\b", "pelipis"),
    (r"\b(dagu|berpikir|merenung|sebentar|ide)\b", "dagu"),
    (r"\b(jempol|mantap|setuju|bagus|sip|oke)\b", "jempol"),
    (r"\b(silang|menyilang|tegas|diam diam)\b", "silang"),
]

def detect_emotion(text: str) -> str:
    """Classify emotion into one of the 10 character expression keys."""
    t = f" {text.lower()} "
    for pattern, emotion in EMOTION_PATTERNS:
        if re.search(pattern, t):
            return emotion
    return "netral"

def detect_pose(text: str, emotion: str) -> str:
    """Classify body pose into one of the 9 character pose keys."""
    t = f" {text.lower()} "
    for pattern, pose in POSE_PATTERNS:
        if re.search(pattern, t):
            return pose
    if emotion == "kaget":
        return "angkat"
    if emotion == "senang":
        return "jempol"
    if emotion == "sedih":
        return "pelipis"
    return "diam"

def parse_action_tags(text: str) -> Tuple[str, List[Tuple[str, str]]]:
    """Extract action tags like (Uki melambai) and return clean text + actions."""
    actions = []
    def _repl(m):
        content = m.group(1).strip()
        parts = content.split(" ", 1)
        if len(parts) == 2:
            who, act = parts[0].lower(), parts[1].lower()
            actions.append((who, act))
        return ""
    clean = re.sub(r"\((.*?)\)", _repl, text).strip()
    return clean, actions

def build_scene_animation_plan(scene_data: Dict[str, Any], fps: int = 24) -> Dict[str, Any]:
    """Convert scene dialogue and narrative into timed keyframes for characters."""
    dialogue_list = scene_data.get("dialog", [])
    if not dialogue_list and "text" in scene_data:
        dialogue_list = [{"who": scene_data.get("who", "Uki"), "text": scene_data["text"]}]

    # Collect actors
    actors = set()
    for d in dialogue_list:
        w = d.get("who", "Uki").strip()
        actors.add(w)

    current_frame = 15  # 15 frame safety lead-in
    char_plans = {
        w: {
            "exprs": [(1, "netral")],
            "poses": [(1, "diam")],
            "speak": [],
            "u_ranges": [],
        }
        for w in actors
    }

    for d in dialogue_list:
        speaker = d.get("who", "Uki").strip()
        raw_text = d.get("text", "").strip()
        clean_text, action_tags = parse_action_tags(raw_text)

        # Estimate duration: ~14 characters per second, min 1.5s
        duration_sec = max(1.5, len(clean_text) / 14.0)
        frames_count = int(duration_sec * fps)

        emotion = detect_emotion(clean_text)
        pose = detect_pose(clean_text, emotion)

        # Override by explicit actions if present
        for who, act in action_tags:
            for w in actors:
                if who in w.lower():
                    act_emo = detect_emotion(act)
                    act_pose = detect_pose(act, act_emo)
                    if act_emo != "netral":
                        emotion = act_emo
                    if act_pose != "diam":
                        pose = act_pose

        start_f = current_frame
        end_f = current_frame + frames_count

        char_plans[speaker]["exprs"].append((start_f, emotion))
        char_plans[speaker]["poses"].append((start_f, pose))
        char_plans[speaker]["speak"].append((start_f + 2, end_f - 2))

        # Detect round-mouth / u vowels for u_ranges
        for m in re.finditer(r"\b\w*[uou]\w*\b", clean_text.lower()):
            idx = m.start() / max(1, len(clean_text))
            uf = int(start_f + idx * frames_count)
            char_plans[speaker]["u_ranges"].append((uf, uf + 4))

        # Settle back to neutral/calm ~10 frames after speaking
        char_plans[speaker]["exprs"].append((end_f + 8, "netral"))
        char_plans[speaker]["poses"].append((end_f + 8, "diam"))

        current_frame = end_f + int(0.5 * fps)  # 0.5s pause between lines

    total_frames = current_frame + 20
    return {
        "actors": list(actors),
        "plans": char_plans,
        "total_frames": total_frames,
        "fps": fps,
        "location": scene_data.get("location", "Studio"),
        "time": scene_data.get("time", "siang"),
    }

def generate_blender_python_script(
    plan: Dict[str, Any],
    char_lib_path: str = CHAR_LIB_PATH,
    karakter_root: str = KARAKTER_ROOT,
    blend_output: Optional[str] = None,
    render_output: Optional[str] = None,
    render_video: bool = False,
) -> str:
    """Generates standalone Python code that executes inside Blender."""
    total_frames = plan["total_frames"]
    fps = plan["fps"]
    actors = plan["actors"]
    location = plan.get("location", "Studio")
    time_of_day = plan.get("time", "siang")

    char_lib_esc = char_lib_path.replace("\\", "\\\\")
    karakter_root_esc = karakter_root.replace("\\", "\\\\")

    # Character positioning logic
    pos_map = {}
    if len(actors) == 1:
        pos_map[actors[0]] = (0.0, 0.0, 0.0)
    elif len(actors) == 2:
        pos_map[actors[0]] = (-0.75, 0.0, 0.0)
        pos_map[actors[1]] = (0.75, 0.0, 0.0)
    else:
        for i, a in enumerate(actors):
            x = (i - (len(actors) - 1) / 2.0) * 0.9
            pos_map[a] = (x, 0.0, 0.0)

    # Lighting color based on time of day
    if time_of_day == "pagi":
        sky_col = (0.65, 0.82, 1.0, 1.0)
        sun_energy = 3.2
    elif time_of_day == "sore":
        sky_col = (0.95, 0.65, 0.45, 1.0)
        sun_energy = 2.5
    elif time_of_day == "malam":
        sky_col = (0.10, 0.12, 0.25, 1.0)
        sun_energy = 1.0
    else:
        sky_col = (0.55, 0.75, 1.0, 1.0)
        sun_energy = 3.0

    lines = [
        "# Auto-generated Blender 2.5D Animation Script",
        "import bpy, math, os, time",
        "from mathutils import Vector",
        f"exec(open(r'{char_lib_esc}', encoding='utf-8').read())",
        "if bpy.app.background:",
        "    try:",
        "        bpy.ops.wm.read_factory_settings(use_empty=True)",
        "    except Exception:",
        "        pass",
        "else:",
        "    try:",
        "        bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)",
        "    except Exception:",
        "        pass",
        "for ob in list(bpy.context.scene.objects):",
        "    try:",
        "        bpy.data.objects.remove(ob, do_unlink=True)",
        "    except Exception:",
        "        pass",
        "char_reset()",
        "",
        "sc = bpy.context.scene",
        "sc.frame_start = 1",
        f"sc.frame_end = {total_frames}",
        f"sc.render.fps = {fps}",
        "sc.render.resolution_x = 1280",
        "sc.render.resolution_y = 720",
        "sc.render.resolution_percentage = 100",
        "",
        "# Set EEVEE render engine",
        "for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):",
        "    try:",
        "        sc.render.engine = eng",
        "        break",
        "    except Exception:",
        "        pass",
        "sc.view_settings.view_transform = 'Standard'",
        "",
        "# World & Sky lighting",
        "w = bpy.data.worlds.new('World_Anim')",
        "sc.world = w",
        "w.use_nodes = True",
        "bg_node = w.node_tree.nodes.get('Background')",
        "if bg_node:",
        f"    bg_node.inputs[0].default_value = {sky_col}",
        "    bg_node.inputs[1].default_value = 0.85",
        "",
        "# Camera setup",
        "cd = bpy.data.cameras.new('Cam_Anim')",
        "cam = bpy.data.objects.new('Cam_Anim', cd)",
        "sc.collection.objects.link(cam)",
        "sc.camera = cam",
        "cd.lens = 42",
        "cam.location = (0.0, -3.8, 1.35)",
        "cam.rotation_euler = (math.radians(88), 0, 0)",
        "",
        "# Sun Light",
        "ld = bpy.data.lights.new('Sun', 'SUN')",
        f"ld.energy = {sun_energy}",
        "lo = bpy.data.objects.new('Sun', ld)",
        "sc.collection.objects.link(lo)",
        "lo.rotation_euler = (math.radians(52), 0, math.radians(-28))",
        "",
        "# Floor plane (direct mesh, no bpy.ops)",
        "me_fl = bpy.data.meshes.new('Studio_Floor')",
        "me_fl.from_pydata([(-8, -6, 0), (8, -6, 0), (8, 6, 0), (-8, 6, 0)], [], [(0, 1, 2, 3)])",
        "fl = bpy.data.objects.new('Studio_Floor', me_fl)",
        "sc.collection.objects.link(fl)",
        "fl.location = (0, 0, 0)",
        "fm = bpy.data.materials.new('Mat_Floor')",
        "try: fm.use_nodes = True",
        "except Exception: pass",
        "try: fm.node_tree.nodes['Principled BSDF'].inputs[0].default_value = (0.35, 0.40, 0.45, 1)",
        "except Exception: pass",
        "fl.data.materials.append(fm)",
        "",
        "# Backdrop wall (direct mesh, no bpy.ops)",
        "me_wl = bpy.data.meshes.new('Studio_Backdrop')",
        "me_wl.from_pydata([(-8, 0, -2.5), (8, 0, -2.5), (8, 0, 2.5), (-8, 0, 2.5)], [], [(0, 1, 2, 3)])",
        "wl = bpy.data.objects.new('Studio_Backdrop', me_wl)",
        "sc.collection.objects.link(wl)",
        "wl.location = (0, 3.5, 2.5)",
        "wm = bpy.data.materials.new('Mat_Wall')",
        "try: wm.use_nodes = True",
        "except Exception: pass",
        "try: wm.node_tree.nodes['Principled BSDF'].inputs[0].default_value = (0.85, 0.82, 0.78, 1)",
        "except Exception: pass",
        "wl.data.materials.append(wm)",
        "",
        f"KARAKTER_ROOT = r'{karakter_root_esc}'",
        "chars_built = {}",
    ]

    for a in actors:
        clean_name = a.lower().replace(" ", "_")
        plan_a = plan["plans"][a]
        loc = pos_map[a]
        is_known = clean_name in KNOWN_CHARACTERS

        lines.append(f"\n# Actor: {a}")
        lines.append(f"exprs_{clean_name} = {plan_a['exprs']}")
        lines.append(f"poses_{clean_name} = {plan_a['poses']}")
        lines.append(f"speak_{clean_name} = {plan_a['speak']}")
        lines.append(f"u_ranges_{clean_name} = {plan_a['u_ranges']}")

        if is_known:
            lines.append(f"char_dir_{clean_name} = os.path.join(KARAKTER_ROOT, '{clean_name}')")
            lines.append(
                f"chars_built['{clean_name}'] = make_character("
                f"sc, cam, char_dir_{clean_name}, '{clean_name}', {loc}, "
                f"exprs=exprs_{clean_name}, poses=poses_{clean_name}, speak=speak_{clean_name}, "
                f"f0=1, f1={total_frames}, u_ranges=u_ranges_{clean_name})"
            )
        else:
            # Fallback to silhouette using Uki's base mesh
            lines.append(f"char_dir_fallback = os.path.join(KARAKTER_ROOT, 'uki')")
            lines.append(
                f"chars_built['{clean_name}'] = make_silhouette("
                f"sc, cam, char_dir_fallback, '{clean_name}', {loc}, "
                f"pose='diam', color=(0.08, 0.07, 0.12))"
            )

    # Optional blend save
    if blend_output:
        blend_esc = os.path.abspath(blend_output).replace("\\", "\\\\")
        lines.extend([
            f"\nos.makedirs(os.path.dirname(r'{blend_esc}'), exist_ok=True)",
            f"bpy.ops.wm.save_as_mainfile(filepath=r'{blend_esc}')",
            f"print('[✓] Blend file saved: {blend_esc}')",
        ])

    # Optional render still or video
    if render_output:
        rend_esc = os.path.abspath(render_output).replace("\\", "\\\\")
        lines.append(f"\nos.makedirs(os.path.dirname(r'{rend_esc}'), exist_ok=True)")
        if render_video:
            lines.extend([
                "if hasattr(sc.render.image_settings, 'media_type'):",
                "    sc.render.image_settings.media_type = 'VIDEO'  # Blender 5.x",
                "sc.render.image_settings.file_format = 'FFMPEG'",
                "sc.render.ffmpeg.audio_codec = 'NONE'",
                "sc.render.ffmpeg.format = 'MPEG4'",
                "sc.render.ffmpeg.codec = 'H264'",
                "sc.render.ffmpeg.constant_rate_factor = 'MEDIUM'",
                f"sc.render.filepath = r'{rend_esc}'",
                "print('[*] Rendering full animation video...')",
                "bpy.ops.render.render(animation=True)",
                f"print('[✓] Animation video finished: {rend_esc}')",
            ])
        else:
            lines.extend([
                "sc.frame_set(25)",
                "if hasattr(sc.render.image_settings, 'media_type'):",
                "    sc.render.image_settings.media_type = 'IMAGE'",
                "sc.render.image_settings.file_format = 'JPEG'",
                "sc.render.image_settings.quality = 90",
                f"sc.render.filepath = r'{rend_esc}'",
                "print('[*] Rendering still preview frame...')",
                "bpy.ops.render.render(write_still=True)",
                f"print('[✓] Still render finished: {rend_esc}')",
            ])

    lines.append("\nresult = {'status': 'ok', 'total_frames': sc.frame_end, 'actors': list(chars_built.keys())}")
    return "\n".join(lines)

def parse_prompt_text(text: str) -> Dict[str, Any]:
    """Parse flexible text prompt (dialogue lines, pipe separated, or action description)."""
    # Check if lines have "Name: Dialogue" format
    dialogue = []
    # Split by newlines or pipes if multiple turns
    chunks = [c.strip() for c in re.split(r"[\n|]+", text) if c.strip()]
    
    # Try parsing dialogue syntax: "Name: text"
    has_dialogue_format = False
    for chunk in chunks:
        match = re.match(r"^([A-Za-z0-9_]+)\s*[:\-]\s*(.*)$", chunk)
        if match:
            has_dialogue_format = True
            who = match.group(1).capitalize()
            txt = match.group(2).strip()
            dialogue.append({"who": who, "text": txt})
    
    if has_dialogue_format and dialogue:
        return {
            "name": "Prompt Dialogue Scene",
            "location": "Studio",
            "dialog": dialogue,
        }

    # Otherwise, it's a descriptive action prompt (e.g. "Arum kaget melihat Uki melambaikan tangan")
    # Detect all character names mentioned in the text
    found_actors = []
    text_lower = text.lower()
    for char_name in ["uki", "arum", "seni", "riska"]:
        if re.search(r"\b" + char_name + r"\b", text_lower):
            found_actors.append(char_name.capitalize())

    if not found_actors:
        found_actors = ["Uki"]

    # Build dialogue turns or action steps for all found actors
    dialogue = []
    # Split text by conjunctions or clauses if multiple characters are mentioned
    clauses = [c.strip() for c in re.split(r"\b(lalu|kemudian|sedangkan|dan|sementara)\b", text, flags=re.I) if c.strip() and c.lower() not in ("lalu", "kemudian", "sedangkan", "dan", "sementara")]
    
    if len(clauses) > 1 and len(found_actors) > 1:
        for clause in clauses:
            # Attribute to character mentioned in clause, or default to first actor
            cl_actor = found_actors[0]
            for a in found_actors:
                if a.lower() in clause.lower():
                    cl_actor = a
                    break
            dialogue.append({"who": cl_actor, "text": clause})
    else:
        for a in found_actors:
            dialogue.append({"who": a, "text": text})

    return {
        "name": "Prompt Action Scene",
        "location": "Studio",
        "dialog": dialogue,
    }

def process_naskah_or_prompt(
    source_path_or_text: str,
    output_blend: Optional[str] = None,
    output_render: Optional[str] = None,
    render_video: bool = False,
    execute_via_bridge: bool = True,
) -> Dict[str, Any]:
    """Main entry: takes naskah file or text prompt, plans animation, generates script, and executes."""
    # Check if input is a JSON script file
    if os.path.isfile(source_path_or_text):
        with open(source_path_or_text, "r", encoding="utf-8") as f:
            data = json.load(f)
        scenes = data.get("scenes", [])
        if scenes:
            scene_data = scenes[0]  # First scene
        else:
            scene_data = data
    else:
        scene_data = parse_prompt_text(source_path_or_text)

    plan = build_scene_animation_plan(scene_data)
    py_code = generate_blender_python_script(
        plan,
        blend_output=output_blend,
        render_output=output_render,
        render_video=render_video,
    )

    result = {
        "status": "ready",
        "plan": plan,
        "python_code": py_code,
    }

    if execute_via_bridge:
        from blender_bridge import execute_blender_code
        exec_res = execute_blender_code(py_code, fallback_cli=True)
        result["execution"] = exec_res

    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Script to Blender Animator")
    parser.add_argument("--script", type=str, help="Path to JSON naskah file")
    parser.add_argument("--prompt", type=str, help="Text prompt to animate")
    parser.add_argument("--save-blend", type=str, help="Save resulting .blend file")
    parser.add_argument("--render-still", type=str, help="Render preview JPG at frame 25")
    parser.add_argument("--render-video", type=str, help="Render full MP4 video")
    parser.add_argument("--no-exec", action="store_true", help="Only output generated Python code")
    args = parser.parse_args()

    target = args.script or args.prompt
    if not target:
        print("Usage: python script_to_blender.py --script <file.json> OR --prompt <text>")
        sys.exit(1)

    rend = args.render_video or args.render_still
    is_vid = bool(args.render_video)

    res = process_naskah_or_prompt(
        target,
        output_blend=args.save_blend,
        output_render=rend,
        render_video=is_vid,
        execute_via_bridge=not args.no_exec,
    )

    print("\nPlan Summary:")
    print("Actors:", res["plan"]["actors"])
    print("Total Frames:", res["plan"]["total_frames"])
    if "execution" in res:
        print("Execution Status:", res["execution"].get("status"))
        if res["execution"].get("message"):
            print("MESSAGE:\n", str(res["execution"]["message"])[-1500:])
        if res["execution"].get("stdout"):
            print("STDOUT:\n", res["execution"]["stdout"][-800:])
        if res["execution"].get("stderr"):
            print("STDERR:\n", res["execution"]["stderr"][-800:])
        if res["execution"].get("status") != "ok":
            sys.exit(1)
