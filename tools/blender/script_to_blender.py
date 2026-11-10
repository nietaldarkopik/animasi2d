# script_to_blender.py — Autonomous Cartoon Production Scene & Animation Generator
# Project: Cartoon Maker AI (animasi2d)

import argparse
import json
import math
import os
import re
import sys
from typing import Dict, List, Any, Optional, Tuple

_TOOLS_DIR = os.path.abspath(os.path.dirname(__file__))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)

from director.scene_director import SceneDirector
from blender_bridge import execute_blender_code

def process_naskah_or_prompt(
    source_path_or_text: str,
    output_blend: Optional[str] = None,
    output_render: Optional[str] = None,
    render_video: bool = False,
    execute_via_bridge: bool = True,
    scene_idx: int = 0,
    aspect_ratio: str = "16:9",
) -> Dict[str, Any]:
    """
    Main entry point: takes naskah JSON file or prompt text, analyzes story through AI Director,
    builds full 3D environment, props, characters, lighting, cinematography, and renders via Blender MCP / CLI.
    """
    if os.path.isfile(source_path_or_text):
        with open(source_path_or_text, "r", encoding="utf-8") as f:
            script_data = json.load(f)
    else:
        # Prompt text directly
        from director.scene_director import LOCATION_MAP
        # Parse dialogue or action prompt
        chunks = [c.strip() for c in re.split(r"[\n|]+", source_path_or_text) if c.strip()]
        dialogue = []
        for chunk in chunks:
            match = re.match(r"^([A-Za-z0-9_]+)\s*[:\-]\s*(.*)$", chunk)
            if match:
                dialogue.append({"who": match.group(1).capitalize(), "text": match.group(2).strip()})
        if not dialogue:
            dialogue = [{"who": "Uki", "text": source_path_or_text}]

        # Detect location keyword in prompt
        loc = "Ruang tamu"
        for k in LOCATION_MAP:
            if k in source_path_or_text.lower():
                loc = k.capitalize()
                break

        script_data = {
            "title": "Prompt Production",
            "scenes": [
                {
                    "name": "Prompt Scene",
                    "location": loc,
                    "time": "siang",
                    "dialog": dialogue,
                }
            ],
        }

    # 1. AI Director Script Analysis
    director = SceneDirector(fps=24, aspect_ratio=aspect_ratio)
    plan = director.analyze_script(script_data)

    # 2. Generate Python Code for Blender MCP
    tools_dir_esc = _TOOLS_DIR.replace("\\", "\\\\")
    plan_json_esc = json.dumps(plan, ensure_ascii=False)

    lines = [
        "# Autonomous Cartoon Production Scene Builder (Blender 5.2)",
        "import bpy, sys, os, json",
        f"tools_dir = r'{tools_dir_esc}'",
        "if tools_dir not in sys.path:",
        "    sys.path.insert(0, tools_dir)",
        "",
        "# Reset & clean scene",
        "if bpy.app.background:",
        "    try: bpy.ops.wm.read_factory_settings(use_empty=True)",
        "    except Exception: pass",
        "else:",
        "    try: bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)",
        "    except Exception: pass",
        "for ob in list(bpy.context.scene.objects):",
        "    try: bpy.data.objects.remove(ob, do_unlink=True)",
        "    except Exception: pass",
        "",
        "sc = bpy.context.scene",
        "# Set EEVEE engine",
        "for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):",
        "    try: sc.render.engine = eng; break",
        "    except Exception: pass",
        "",
        "# Load Plan & Build Scene",
        f"plan_data = json.loads({repr(plan_json_esc)})",
        "from core.scene_manager import build_scene_from_plan",
        f"res_build = build_scene_from_plan(sc, plan_data, scene_idx={scene_idx}, quality={'final' if render_video else 'preview'!r})",
        "",
    ]

    # Save .blend file
    if output_blend:
        blend_esc = os.path.abspath(output_blend).replace("\\", "\\\\")
        lines.extend([
            f"os.makedirs(os.path.dirname(r'{blend_esc}'), exist_ok=True)",
            f"bpy.ops.wm.save_as_mainfile(filepath=r'{blend_esc}')",
            f"print('[✓] Blend file saved: {blend_esc}')",
        ])

    # Render Preview JPG or Full MP4
    if output_render:
        rend_esc = os.path.abspath(output_render).replace("\\", "\\\\")
        lines.append(f"os.makedirs(os.path.dirname(r'{rend_esc}'), exist_ok=True)")
        if render_video:
            lines.extend([
                "try: sc.render.image_settings.media_type = 'VIDEO'",
                "except Exception: pass",
                "sc.render.image_settings.file_format = 'FFMPEG'",
                "sc.render.image_settings.color_mode = 'RGB'",
                "sc.render.ffmpeg.format = 'MPEG4'",
                "sc.render.ffmpeg.codec = 'H264'",
                "sc.render.ffmpeg.constant_rate_factor = 'MEDIUM'",
                f"rend_target = r'{rend_esc}'",
                "sc.render.filepath = rend_target",
                "print('[*] Rendering full animation video...')",
                "bpy.ops.render.render(animation=True)",
                "# Handle frame number suffix if Blender appends it",
                "if not os.path.exists(rend_target):",
                "    out_d = os.path.dirname(rend_target)",
                "    base_no_ext = os.path.splitext(os.path.basename(rend_target))[0]",
                "    for f in os.listdir(out_d):",
                "        if f.startswith(base_no_ext) and f.endswith('.mp4') and f != os.path.basename(rend_target):",
                "            cand_p = os.path.join(out_d, f)",
                "            try:",
                "                if os.path.exists(rend_target): os.remove(rend_target)",
                "                os.rename(cand_p, rend_target)",
                "                break",
                "            except Exception: pass",
                f"print('[✓] Animation video finished: {rend_esc}')",
            ])
        else:
            lines.extend([
                "sc.frame_set(sc.frame_start + 15)",
                "sc.render.image_settings.file_format = 'JPEG'",
                "sc.render.image_settings.color_mode = 'RGB'",
                "sc.render.image_settings.quality = 90",
                f"rend_target = r'{rend_esc}'",
                "sc.render.filepath = rend_target",
                "print('[*] Rendering still preview frame...')",
                "bpy.ops.render.render(write_still=True)",
                "if not os.path.exists(rend_target):",
                "    out_d = os.path.dirname(rend_target)",
                "    base_no_ext = os.path.splitext(os.path.basename(rend_target))[0]",
                "    for f in os.listdir(out_d):",
                "        if f.startswith(base_no_ext) and (f.endswith('.jpg') or f.endswith('.jpeg')) and f != os.path.basename(rend_target):",
                "            cand_p = os.path.join(out_d, f)",
                "            try:",
                "                if os.path.exists(rend_target): os.remove(rend_target)",
                "                os.rename(cand_p, rend_target)",
                "                break",
                "            except Exception: pass",
                f"print('[✓] Still render finished: {rend_esc}')",
            ])

    lines.append("\nresult = {'status': 'ok', 'total_frames': sc.frame_end, 'scene_name': res_build['scene_name']}")
    py_code = "\n".join(lines)

    result = {
        "status": "ready",
        "plan": plan,
        "python_code": py_code,
    }

    if execute_via_bridge:
        exec_res = execute_blender_code(py_code, fallback_cli=True)
        result["execution"] = exec_res

    return result

def _ffmpeg_concat(clip_paths: List[str], output_path: str) -> bool:
    """Concatenate MP4 clips with FFmpeg into a single output file."""
    import subprocess, tempfile
    if not clip_paths:
        return False
    if len(clip_paths) == 1:
        import shutil
        shutil.copy2(clip_paths[0], output_path)
        return True

    # Write FFmpeg concat list file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as tf:
        list_path = tf.name
        for cp in clip_paths:
            tf.write(f"file '{cp.replace(chr(39), chr(92)+chr(39))}'\n")

    try:
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', list_path,
            '-c', 'copy',
            output_path
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode == 0 and os.path.isfile(output_path) and os.path.getsize(output_path) > 1000:
            print(f"[✓] FFmpeg concat OK → {output_path}")
            return True
        else:
            print(f"[✗] FFmpeg concat failed: {r.stderr[-400:]}")
            return False
    except Exception as e:
        print(f"[✗] FFmpeg exception: {e}")
        return False
    finally:
        try:
            os.remove(list_path)
        except Exception:
            pass


def produce_all_scenes(
    script_path: str,
    output_blend: Optional[str] = None,
    output_video: Optional[str] = None,
    aspect_ratio: str = "16:9",
    execute_via_bridge: bool = True,
) -> Dict[str, Any]:
    """
    Render ALL scenes in a script JSON, then FFmpeg-concatenate into one final MP4.
    Returns: {status, scene_clips, final_video, scene_results}
    """
    with open(script_path, 'r', encoding='utf-8') as f:
        script_data = json.load(f)

    director = SceneDirector(fps=24, aspect_ratio=aspect_ratio)
    plan = director.analyze_script(script_data)
    total_scenes = len(plan['scenes'])
    print(f"[AI Director] {plan['title']} — {total_scenes} adegan ditemukan.")

    output_dir = os.path.dirname(output_video) if output_video else os.path.join(_TOOLS_DIR, 'output')
    base_name = os.path.splitext(os.path.basename(output_video))[0] if output_video else 'scene'
    os.makedirs(output_dir, exist_ok=True)

    scene_clips: List[str] = []
    scene_results: List[Dict] = []

    for idx in range(total_scenes):
        scene_name = plan['scenes'][idx].get('name', f'Scene_{idx}')
        clip_path = os.path.join(output_dir, f"{base_name}_scene{idx:02d}.mp4")
        blend_path = os.path.join(output_dir, f"{base_name}_scene{idx:02d}.blend") if output_blend else None

        print(f"\n[Scene {idx+1}/{total_scenes}] Membangun: {scene_name}")
        try:
            res = process_naskah_or_prompt(
                script_path,
                output_blend=blend_path,
                output_render=clip_path,
                render_video=True,
                execute_via_bridge=execute_via_bridge,
                scene_idx=idx,
                aspect_ratio=aspect_ratio,
            )
            exec_status = res.get('execution', {}).get('status', 'unknown')
            clip_ok = os.path.isfile(clip_path) and os.path.getsize(clip_path) > 1000
            print(f"  → Eksekusi: {exec_status} | Clip: {'OK' if clip_ok else 'MISSING'}")
            if clip_ok:
                scene_clips.append(clip_path)
            scene_results.append({'scene': scene_name, 'idx': idx, 'status': exec_status, 'clip': clip_path if clip_ok else None})
        except Exception as e:
            print(f"  → ERROR: {e}")
            scene_results.append({'scene': scene_name, 'idx': idx, 'status': 'error', 'error': str(e)})

    # Save first scene's .blend as the main blend file
    if output_blend and total_scenes > 0:
        first_blend = os.path.join(output_dir, f"{base_name}_scene00.blend")
        if os.path.isfile(first_blend) and first_blend != output_blend:
            try:
                import shutil
                shutil.copy2(first_blend, output_blend)
                print(f"[✓] Main .blend saved: {output_blend}")
            except Exception:
                pass

    # FFmpeg concat all scene clips → final video
    final_ok = False
    if output_video and scene_clips:
        final_ok = _ffmpeg_concat(scene_clips, output_video)

    return {
        'status': 'done' if final_ok else ('partial' if scene_clips else 'failed'),
        'total_scenes': total_scenes,
        'scene_clips': scene_clips,
        'final_video': output_video if final_ok else None,
        'scene_results': scene_results,
        'plan': plan,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Autonomous Cartoon Production Generator")
    parser.add_argument("--script", type=str, help="Path to JSON naskah file")
    parser.add_argument("--prompt", type=str, help="Text prompt to animate")
    parser.add_argument("--scene-idx", type=int, default=0, help="Index of scene to build (default 0, or use --all-scenes)")
    parser.add_argument("--all-scenes", action="store_true", help="Render ALL scenes and FFmpeg-concat into one MP4")
    parser.add_argument("--save-blend", type=str, help="Save resulting .blend file")
    parser.add_argument("--render-still", type=str, help="Render preview JPG (single scene only)")
    parser.add_argument("--render-video", type=str, help="Render full MP4 video")
    parser.add_argument("--aspect-ratio", type=str, default="16:9", choices=["16:9", "9:16"])
    parser.add_argument("--no-exec", action="store_true", help="Only output generated Python code, don't execute")
    args = parser.parse_args()

    target = args.script or args.prompt
    if not target:
        print("Usage: python script_to_blender.py --script <file.json> OR --prompt <text>")
        sys.exit(1)

    # --- MULTI-SCENE MODE ---
    if args.all_scenes and args.script:
        result = produce_all_scenes(
            script_path=args.script,
            output_blend=args.save_blend,
            output_video=args.render_video,
            aspect_ratio=args.aspect_ratio,
            execute_via_bridge=not args.no_exec,
        )
        print(f"\n[Produksi Selesai] Status: {result['status']}")
        print(f"  Scenes berhasil dirender: {len(result['scene_clips'])}/{result['total_scenes']}")
        if result['final_video']:
            print(f"  Video final: {result['final_video']}")
        for sr in result['scene_results']:
            status_icon = '✓' if sr.get('clip') else '✗'
            print(f"  [{status_icon}] Scene {sr['idx']}: {sr['scene']} — {sr['status']}")
        sys.exit(0 if result['status'] in ('done', 'partial') else 1)

    # --- SINGLE SCENE MODE ---
    rend = args.render_video or args.render_still
    is_vid = bool(args.render_video)

    res = process_naskah_or_prompt(
        target,
        output_blend=args.save_blend,
        output_render=rend,
        render_video=is_vid,
        execute_via_bridge=not args.no_exec,
        scene_idx=args.scene_idx,
        aspect_ratio=args.aspect_ratio,
    )

    print("\n[AI Director Plan]")
    print("Title:", res["plan"]["title"])
    print("Scenes:", len(res["plan"]["scenes"]))
    for sc in res["plan"]["scenes"]:
        print(f"  - {sc['name']} | Env: {sc['environment_type']} ({sc['time_of_day']}, {sc['mood']}) | Props: {sc['props']} | Actors: {sc['actors']}")
    if "execution" in res:
        print("\nExecution Status:", res["execution"].get("status"))
        if res["execution"].get("stdout"):
            print("STDOUT:\n", res["execution"]["stdout"][-800:])
        if res["execution"].get("stderr"):
            print("STDERR:\n", res["execution"]["stderr"][-4000:])
        # MCP may return diagnostics under message/raw rather than stderr.
        for key in ("message", "error", "traceback", "raw"):
            value = res["execution"].get(key)
            if value:
                print(f"EXECUTION {key.upper()}:\n", str(value)[-8000:])
