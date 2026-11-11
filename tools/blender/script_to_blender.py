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
    render_quality: str = "final",
    upscale_output: bool = False,
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
        "import time",
        "_module_profile_started = time.perf_counter()",
        "# Reload scene_manager: Blender MCP is persistent and may cache an older module version",
        "import importlib, inspect",
        "# Reload material factory first; room_builder and props_factory import its functions by value.",
        "import core.material_factory as material_factory",
        "material_factory = importlib.reload(material_factory)",
        "material_factory.clear_cache()",
        "print('[Blender] material_factory loaded from:', material_factory.__file__)",
        "# Reload all changed scene dependencies before scene_manager; MCP Python is persistent",
        "import environment.room_builder as room_builder",
        "room_builder = importlib.reload(room_builder)",
        "print('[Blender] room_builder loaded from:', room_builder.__file__)",
        "import props.props_factory as props_factory",
        "props_factory = importlib.reload(props_factory)",
        "print('[Blender] props_factory loaded from:', props_factory.__file__)",
        "print('[Blender] create_classroom_props available:', hasattr(props_factory, 'create_classroom_props'))",
        "import environment.lighting_presets as lighting_presets",
        "lighting_presets = importlib.reload(lighting_presets)",
        "print('[Blender] lighting_presets loaded from:', lighting_presets.__file__)",
        "import cinematography.camera_rig as camera_rig",
        "camera_rig = importlib.reload(camera_rig)",
        "print('[Blender] camera_rig loaded from:', camera_rig.__file__)",
        "# Reload character library too; scene_manager imports make_character by value.",
        "import char_lib as character_library",
        "character_library = importlib.reload(character_library)",
        "character_library.char_reset()",
        "print('[Blender] char_lib loaded from:', character_library.__file__)",
        "import core.cinematic_render as cinematic_render",
        "cinematic_render = importlib.reload(cinematic_render)",
        "print('[Blender] cinematic_render loaded from:', cinematic_render.__file__)",
        "import core.scene_manager as scene_manager",
        "scene_manager = importlib.reload(scene_manager)",
        "build_scene_from_plan = scene_manager.build_scene_from_plan",
        "print('[Blender] scene_manager loaded from:', scene_manager.__file__)",
        "print('[Blender] build_scene_from_plan signature:', inspect.signature(build_scene_from_plan))",
        f"_build_kwargs = {{'scene_idx': {scene_idx}}}",
        f"if 'quality' in inspect.signature(build_scene_from_plan).parameters: _build_kwargs['quality'] = {render_quality if render_video else 'preview'!r}",
        "_module_reload_seconds = time.perf_counter() - _module_profile_started",
        "print('[Profile] module_reload_and_setup: {:.3f}s'.format(_module_reload_seconds), flush=True)",
        "res_build = build_scene_from_plan(sc, plan_data, **_build_kwargs)",
        "_pipeline_profile = {'module_reload_and_setup': round(_module_reload_seconds, 4), 'scene_build': res_build.get('profiling', {}), 'frame_render': [], 'frame_qc': []}",
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
            frames_dir = os.path.splitext(os.path.abspath(output_render))[0] + "_frames"
            frames_esc = frames_dir.replace("\\", "\\\\")
            lines.extend([
                f"frames_dir = r'{frames_esc}'",
                "os.makedirs(frames_dir, exist_ok=True)",
                "sc.render.image_settings.file_format = 'PNG'",
                "sc.render.image_settings.color_mode = 'RGBA'",
                "sc.render.image_settings.color_depth = '8'",
                "sc.render.use_file_extension = True",
                "qc_report = {'total_frames': sc.frame_end - sc.frame_start + 1, 'passed': [], 'failed': []}",
                "_qc_path = os.path.join(frames_dir, 'qc_report.json')",
                "if os.path.isfile(_qc_path):",
                "    try:",
                "        with open(_qc_path, 'r', encoding='utf-8') as _qf: _old_qc = json.load(_qf)",
                "        if _old_qc.get('total_frames') == qc_report['total_frames']: qc_report = _old_qc",
                "    except Exception: pass",
                "print('[*] Frame render started:', qc_report['total_frames'], 'frames; resume enabled', flush=True)",
                "_frame_loop_started = time.perf_counter()",
                "for _frame in range(sc.frame_start, sc.frame_end + 1):",
                "    _prepare_started = time.perf_counter()",
                "    sc.frame_set(_frame)",
                "    _pipeline_profile.setdefault('frame_prepare', []).append({'frame': _frame, 'seconds': round(time.perf_counter() - _prepare_started, 4)})",
                "    _frame_path = os.path.join(frames_dir, 'frame_{:06d}.png'.format(_frame))",
                "    if _frame in qc_report.get('passed', []) and os.path.isfile(_frame_path) and os.path.getsize(_frame_path) > 1024:",
                "        print('[Resume] Existing QC-passed frame {}/{} skipped'.format(_frame - sc.frame_start + 1, qc_report['total_frames']), flush=True)",
                "        continue",
                "    if _frame in qc_report.get('passed', []): qc_report['passed'].remove(_frame)",
                "    if _frame in qc_report.get('failed', []): qc_report['failed'].remove(_frame)",
                "    _passed = False",
                "    for _attempt in range(1, 3):",
                "        print('[Render] Frame {}/{} attempt {}'.format(_frame - sc.frame_start + 1, qc_report['total_frames'], _attempt), flush=True)",
                "        _render_started = time.perf_counter()",
                "        bpy.ops.render.render()",
                "        _render_seconds = time.perf_counter() - _render_started",
                "        _pipeline_profile['frame_render'].append({'frame': _frame, 'attempt': _attempt, 'seconds': round(_render_seconds, 4)})",
                "        print('[Profile] frame_render {}: {:.3f}s'.format(_frame, _render_seconds), flush=True)",
                "        _img = bpy.data.images.get('Render Result')",
                "        if _img is None:",
                "            continue",
                "        _save_started = time.perf_counter()",
                "        _img.save_render(filepath=_frame_path, scene=sc)",
                "        _save_seconds = time.perf_counter() - _save_started",
                "        _pipeline_profile.setdefault('frame_save', []).append({'frame': _frame, 'seconds': round(_save_seconds, 4)})",
                "        if not os.path.isfile(_frame_path) or os.path.getsize(_frame_path) < 1024:",
                "            continue",
                "        _qc_started = time.perf_counter()",
                "        _qc_img = None",
                "        try:",
                "            _qc_img = bpy.data.images.load(_frame_path, check_existing=False)",
                "            _w, _h = _qc_img.size",
                "            _px = _qc_img.pixels",
                "            _count = max(1, _w * _h)",
                "            _stride = max(1, _count // 5000)",
                "            _samples = []",
                "            if len(_px) < _count * 4: raise RuntimeError('PNG pixel buffer is incomplete')",
                "            from array import array",
                "            _pixel_buffer = array('f', [0.0]) * (_count * 4)",
                "            _px.foreach_get(_pixel_buffer)",
                "            for _p in range(0, _count, _stride):",
                "                _i = _p * 4",
                "                _samples.append(0.2126 * _pixel_buffer[_i] + 0.7152 * _pixel_buffer[_i + 1] + 0.0722 * _pixel_buffer[_i + 2])",
                "            _mean = sum(_samples) / max(1, len(_samples))",
                "        except Exception as _qc_error:",
                "            print('[QC] Cannot inspect saved PNG:', _qc_error, flush=True)",
                "            _mean, _var, _max = 0.0, 0.0, 0.0",
                "            _samples = []",
                "        finally:",
                "            if _qc_img is not None: bpy.data.images.remove(_qc_img)",
                "        _var = sum((_v - _mean) ** 2 for _v in _samples) / max(1, len(_samples))",
                "        _max = max(_samples) if _samples else 0.0",
                "        _black = (_mean < 0.002 and _max < 0.01)",
                "        _blank = (_var < 0.000001)",
                "        _qc_seconds = time.perf_counter() - _qc_started",
                "        _pipeline_profile['frame_qc'].append({'frame': _frame, 'seconds': round(_qc_seconds, 4)})",
                "        if not _black and not _blank:",
                "            _passed = True",
                "            break",
                "        print('[QC] Frame {} suspicious: mean={:.5f}, variance={:.8f}; retrying'.format(_frame, _mean, _var), flush=True)",
                "    if _passed:",
                "        qc_report['passed'].append(_frame)",
                "    else:",
                "        qc_report['failed'].append(_frame)",
                "        print('[QC] FAILED frame:', _frame, flush=True)",
                "    with open(os.path.join(frames_dir, 'qc_report.json'), 'w', encoding='utf-8') as _qf:",
                "        json.dump(qc_report, _qf, indent=2)",
                "if qc_report['failed']:",
                "    raise RuntimeError('Frame QC failed: {}'.format(qc_report['failed']))",
                "_pipeline_profile['frame_loop_total_seconds'] = round(time.perf_counter() - _frame_loop_started, 4)",
                "_pipeline_profile['frame_render_total_seconds'] = round(sum(x['seconds'] for x in _pipeline_profile['frame_render']), 4)",
                "_pipeline_profile['frame_qc_total_seconds'] = round(sum(x['seconds'] for x in _pipeline_profile['frame_qc']), 4)",
                "_pipeline_profile['frame_prepare_total_seconds'] = round(sum(x['seconds'] for x in _pipeline_profile.get('frame_prepare', [])), 4)",
                "_pipeline_profile['frame_save_total_seconds'] = round(sum(x['seconds'] for x in _pipeline_profile.get('frame_save', [])), 4)",
                "_pipeline_profile['frames_rendered'] = len(_pipeline_profile['frame_render'])",
                "with open(os.path.join(frames_dir, 'profile_report.json'), 'w', encoding='utf-8') as _pf:",
                "    json.dump(_pipeline_profile, _pf, indent=2, ensure_ascii=False)",
                "print('[Profile] Frame render total: {:.3f}s; QC total: {:.3f}s'.format(_pipeline_profile['frame_render_total_seconds'], _pipeline_profile['frame_qc_total_seconds']), flush=True)",
                "print('[✓] All frame QC passed. Ready for FFmpeg encoding.', flush=True)",
                f"print('[Frames] {frames_esc}')",
                f"print('[Profile] {frames_esc}\\\\profile_report.json')",
            ])
        else:
            lines.extend([
                "# Preview the first dialogue reaction rather than the opening establishing shot.",
                f"_preview_scene_idx = max(0, min({scene_idx}, len(plan_data.get('scenes', [])) - 1))",
                "_preview_scene = plan_data['scenes'][_preview_scene_idx] if plan_data.get('scenes') else {}",
                "_dialogue_shots = [shot for shot in _preview_scene.get('shots', []) if shot.get('speaker')]",
                "if _dialogue_shots:",
                "    _first_dialogue = _dialogue_shots[0]",
                "    _dialogue_start = int(_first_dialogue.get('start_f', sc.frame_start))",
                "    _dialogue_end = int(_first_dialogue.get('end_f', _dialogue_start + 1))",
                "    _dialogue_len = max(1, _dialogue_end - _dialogue_start)",
                "    _preview_frame = _dialogue_start + min(8, max(2, _dialogue_len // 3))",
                "else:",
                "    _preview_frame = sc.frame_start + max(1, (sc.frame_end - sc.frame_start) // 2)",
                "_preview_frame = min(sc.frame_end, max(sc.frame_start, _preview_frame))",
                "sc.frame_set(_preview_frame)",
                "print('[Blender] Still preview frame:', _preview_frame)",
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
        if render_video and exec_res.get("status") == "ok" and output_render:
            try:
                expected_frames_dir = os.path.splitext(os.path.abspath(output_render))[0] + "_frames"
                if not os.path.isfile(os.path.join(expected_frames_dir, "qc_report.json")):
                    raise RuntimeError("Blender execution returned without a completed QC report; FFmpeg encoding skipped.")
                scene_data = plan.get("scenes", [])[scene_idx]
                fps = int(plan.get("fps", 24))
                frame_start = int(scene_data.get("start_frame", 1))
                frame_end = int(scene_data.get("end_frame", frame_start + 100))
                frames_dir = os.path.splitext(os.path.abspath(output_render))[0] + "_frames"
                encode_result = _encode_frames_ffmpeg(
                    frames_dir, os.path.abspath(output_render), fps, frame_start, frame_end,
                    upscale_size=((1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)) if upscale_output else None,
                )
                result["encoding"] = encode_result
                _profile_path = os.path.join(frames_dir, "profile_report.json")
                if os.path.isfile(_profile_path):
                    with open(_profile_path, "r", encoding="utf-8") as _pf:
                        _saved_profile = json.load(_pf)
                    _saved_profile["encoding"] = encode_result
                    with open(_profile_path, "w", encoding="utf-8") as _pf:
                        json.dump(_saved_profile, _pf, indent=2, ensure_ascii=False)
                    print("[Profile] Complete report updated:", _profile_path)
            except Exception as encode_error:
                result["encoding"] = {"status": "error", "message": str(encode_error)}
                print("[✗] FFmpeg encoding failed:", encode_error)

    return result

def _encode_frames_ffmpeg(
    frames_dir: str, output_path: str, fps: int, frame_start: int, frame_end: int,
    upscale_size: Optional[Tuple[int, int]] = None,
) -> Dict[str, Any]:
    """Encode QC-passed PNG frames into H.264 MP4."""
    import shutil
    import subprocess
    import time

    qc_path = os.path.join(frames_dir, "qc_report.json")
    if not os.path.isfile(qc_path):
        raise FileNotFoundError("QC report not found: " + qc_path)
    with open(qc_path, "r", encoding="utf-8") as qf:
        qc = json.load(qf)
    expected = frame_end - frame_start + 1
    if qc.get("failed") or len(qc.get("passed", [])) != expected:
        raise RuntimeError("Frame QC incomplete; encoding cancelled.")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            raise FileNotFoundError("FFmpeg not found in PATH. Install FFmpeg or add it to PATH.")

    input_pattern = os.path.join(frames_dir, "frame_%06d.png")
    cmd = [
        ffmpeg, "-y", "-framerate", str(fps),
        "-start_number", str(frame_start), "-i", input_pattern,
        "-frames:v", str(expected), "-c:v", "libx264",
        "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart"
    ]
    if upscale_size:
        width, height = upscale_size
        cmd.extend(["-vf", f"scale={width}:{height}:flags=lanczos"])
        print(f"[*] Upscaling frames to {width}x{height} with Lanczos")
    cmd.append(output_path)
    print("[*] FFmpeg encoding:", expected, "QC-passed frames")
    encode_started = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    encode_seconds = time.perf_counter() - encode_started
    if proc.returncode != 0 or not os.path.isfile(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("FFmpeg failed: " + (proc.stderr or proc.stdout)[-3000:])
    return {
        "status": "ok",
        "output": output_path,
        "size_bytes": os.path.getsize(output_path),
        "frames": expected,
        "fps": fps,
        "duration_seconds": round(encode_seconds, 4),
    }

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
    parser.add_argument("--render-quality", choices=["draft", "standard", "final"], default="final", help="Video render quality preset (draft=50%, standard=75%, final=100%)")
    parser.add_argument("--upscale", action="store_true", help="Upscale rendered frames to project resolution using FFmpeg Lanczos")
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
        render_quality=args.render_quality,
        upscale_output=args.upscale,
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
    if "encoding" in res:
        enc = res["encoding"]
        print("\n[FFmpeg Encoding]", enc.get("status"))
        if enc.get("status") == "ok":
            print("  Output:", enc.get("output"))
            print("  Frames:", enc.get("frames"), "| FPS:", enc.get("fps"))
            print("  Size:", enc.get("size_bytes"), "bytes")
        else:
            print("  Error:", enc.get("message"))
