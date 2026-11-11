# char_lib.py — Universal 2.5D Anime Character Rig & Animator for Blender (EEVEE)
# Project: Cartoon Maker AI (animasi2d)
# Supports characters in: C:\wamp64\www\animasi2d\karakter\<nama>\ (character.json + PNGs)

import bpy, json, math, os, random
from typing import Any, Dict, List, Tuple, Optional

# Default root folder for characters in animasi2d
_this_dir = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else r"C:\wamp64\www\animasi2d\tools\blender"
DEFAULT_KARAKTER_ROOT = os.path.abspath(
    os.path.join(_this_dir, "..", "..", "karakter")
)
if not os.path.isdir(DEFAULT_KARAKTER_ROOT):
    DEFAULT_KARAKTER_ROOT = r"C:\wamp64\www\animasi2d\karakter"

CHAR_H_M = 1.9  # Standard character height in 3D world (meters)
_prefs = bpy.context.preferences.edit
_img = {}
_mat = {}

def char_reset():
    """Clear cached image and material references (call after wm.read_factory_settings)."""
    _img.clear()
    _mat.clear()

# Backward-compat alias
uki_reset = char_reset

def _interp(k):
    _prefs.keyframe_new_interpolation_type = k

def _image(path):
    im = _img.get(path)
    try:
        if im is not None:
            im.name
            return im
    except ReferenceError:
        pass
    im = bpy.data.images.load(path)
    _img[path] = im
    return im

def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt

def _cardmat(path):
    """Three-step scene-lit toon card material with PNG alpha."""
    k = ('c', path)
    if k in _mat:
        return _mat[k]
    m, nt = _new_mat('CHAR_' + os.path.basename(path))
    N = nt.nodes.new
    L = nt.links.new
    tx = N('ShaderNodeTexImage')
    tx.image = _image(path)
    tx.interpolation = 'Linear'
    df = N('ShaderNodeBsdfDiffuse')
    s2r = N('ShaderNodeShaderToRGB')
    L(df.outputs[0], s2r.inputs[0])
    rp = N('ShaderNodeValToRGB')
    rp.color_ramp.interpolation = 'CONSTANT'
    # Three-step cel shading: cool shadow, soft midtone, clean key-lit highlight.
    # The diffuse response is evaluated against the scene lights, so sprite cards
    # pick up the same key/fill direction as the 3D classroom.
    ramp = rp.color_ramp
    ramp.elements[0].position = 0.0
    ramp.elements[0].color = (0.48, 0.46, 0.66, 1)
    ramp.elements[1].position = 0.48
    ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    mid = ramp.elements.new(0.20)
    mid.color = (0.72, 0.70, 0.85, 1)
    L(s2r.outputs[0], rp.inputs[0])
    mul = N('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1
    L(tx.outputs['Color'], mul.inputs[6])
    L(rp.outputs[0], mul.inputs[7])
    em = N('ShaderNodeEmission')
    em.inputs[1].default_value = 1.0
    L(mul.outputs[2], em.inputs[0])
    tr = N('ShaderNodeBsdfTransparent')
    mx = N('ShaderNodeMixShader')
    L(tx.outputs['Alpha'], mx.inputs[0])
    L(tr.outputs[0], mx.inputs[1])
    L(em.outputs[0], mx.inputs[2])
    o = N('ShaderNodeOutputMaterial')
    L(mx.outputs[0], o.inputs[0])
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    _mat[k] = m
    return m

def _silmat(path, color):
    k = ('s', path, tuple(color))
    if k in _mat:
        return _mat[k]
    m, nt = _new_mat('CHAR_SIL')
    N = nt.nodes.new
    L = nt.links.new
    tx = N('ShaderNodeTexImage')
    tx.image = _image(path)
    tx.interpolation = 'Linear'
    em = N('ShaderNodeEmission')
    em.inputs[0].default_value = (color[0], color[1], color[2], 1)
    tr = N('ShaderNodeBsdfTransparent')
    mx = N('ShaderNodeMixShader')
    L(tx.outputs['Alpha'], mx.inputs[0])
    L(tr.outputs[0], mx.inputs[1])
    L(em.outputs[0], mx.inputs[2])
    o = N('ShaderNodeOutputMaterial')
    L(mx.outputs[0], o.inputs[0])
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    _mat[k] = m
    return m

def _rim_plane(sc, name, image_path, wpx, hpx, loc, parent, S, color):
    """Slightly enlarged alpha silhouette behind a sprite card for a restrained rim edge."""
    obj = _plane(sc, name, _silmat(image_path, color), wpx, hpx, loc, parent, S)
    obj.location.y += 0.012
    obj.scale = (1.009, 1.009, 1.0)
    return obj


def _shadowmat():
    if 'shadow' in _mat:
        return _mat['shadow']
    m, nt = _new_mat('CHAR_SHADOW')
    N = nt.nodes.new
    L = nt.links.new
    em = N('ShaderNodeEmission')
    em.inputs[0].default_value = (0.02, 0.012, 0.03, 1)
    tr = N('ShaderNodeBsdfTransparent')
    mx = N('ShaderNodeMixShader')
    mx.inputs[0].default_value = 0.38
    L(tr.outputs[0], mx.inputs[1])
    L(em.outputs[0], mx.inputs[2])
    o = N('ShaderNodeOutputMaterial')
    L(mx.outputs[0], o.inputs[0])
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    _mat['shadow'] = m
    return m

def _empty(sc, name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    sc.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o

def _plane(sc, name, mat, wpx, hpx, loc, parent, S):
    w = wpx * S
    h = hpx * S
    me = bpy.data.meshes.new(name)
    me.from_pydata(
        [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)],
        [],
        [(0, 1, 2, 3)],
    )
    uv = me.uv_layers.new()
    for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[i].uv = c
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    o.location = loc
    o.parent = parent
    return o

def _vis(objs, keys):
    """keys: [(frame, visible)] -> keyframe hide_render/hide_viewport (CONSTANT)."""
    if not isinstance(objs, (list, tuple)):
        objs = [objs]
    keys = sorted(keys, key=lambda k: k[0])
    out = []
    last = None
    for f, v in keys:
        if v != last:
            out.append((max(1, int(f)), bool(v)))
            last = v
    _interp('CONSTANT')
    for o in objs:
        for f, v in out:
            o.hide_render = not v
            o.hide_viewport = not v
            o.keyframe_insert('hide_render', frame=f)
            o.keyframe_insert('hide_viewport', frame=f)
    _interp('BEZIER')

def char_show(res, keys):
    """Show/hide entire character at keyframes: keys=[(frame, bool)]."""
    objs = [res['root']] + list(res['root'].children_recursive)
    _vis(objs, keys)

uki_show = char_show

def _schedule(objs, lst):
    """objs: {name: object}; lst: [(frame, name)] -> keyframes visibility."""
    lst = sorted(lst, key=lambda x: x[0])
    for name, o in objs.items():
        _vis(o, [(f, n == name) for f, n in lst])

def _at(lst, f):
    cur = lst[0][1]
    for ff, n in lst:
        if ff <= f:
            cur = n
    return cur

def _pop(ob, frames, amp=1.05):
    """Pop scale 1 -> amp -> 1 over ~4 frames on change."""
    d = {}
    for f in frames:
        for ff, s in ((f - 1, 1.0), (f + 1, amp), (f + 3, 1.0)):
            if ff >= 1:
                d[ff] = max(d.get(ff, 1.0), s) if s != 1.0 else d.get(ff, 1.0)
    for ff in sorted(d):
        ob.scale = (d[ff],) * 3
        ob.keyframe_insert('scale', frame=ff)

def resolve_character_dir(name_or_path: str, base_root: str = DEFAULT_KARAKTER_ROOT) -> str:
    """Resolve character directory from name (e.g. 'uki') or path."""
    if os.path.isdir(name_or_path) and os.path.exists(os.path.join(name_or_path, 'character.json')):
        return os.path.abspath(name_or_path)
    cand = os.path.join(base_root, name_or_path.lower())
    if os.path.isdir(cand) and os.path.exists(os.path.join(cand, 'character.json')):
        return os.path.abspath(cand)
    raise FileNotFoundError(f"Character '{name_or_path}' with character.json not found in {base_root} or directly.")

def load_meta(cards_dir: str):
    return json.load(open(os.path.join(cards_dir, 'character.json'), encoding='utf-8'))

def _norm_env(env, ranges):
    vals = []
    for a, b in ranges:
        for f in range(int(a), int(b) + 1):
            if f < len(env):
                vals.append(env[f])
    if not vals:
        return 1.0
    vals.sort()
    p = vals[min(len(vals) - 1, int(len(vals) * 0.95))]
    return p if p > 1e-6 else 1.0

def make_character(
    sc,
    cam,
    char_name_or_dir: str,
    tag: str,
    loc: Tuple[float, float, float],
    exprs: List[Tuple[int, str]],
    poses: List[Tuple[int, str]],
    speak: Tuple[Tuple[int, int], ...] = (),
    actions: Optional[List[Dict[str, Any]]] = None,
    env: Optional[List[float]] = None,
    f0: int = 1,
    f1: Optional[int] = None,
    scale: float = 1.0,
    blink_seed: int = 0,
    u_ranges: Tuple[Tuple[int, int], ...] = (),
    cards_dir: Optional[str] = None,
):
    """
    Build a complete 2.5D card-layered anime character with poses, expressions,
    blinking, idle breathing, and lip-sync in Blender.
    
    char_name_or_dir: 'uki', 'arum', 'seni', 'riska' or full directory path.
    exprs: [(frame, expression_name)]
    poses: [(frame, pose_name)]
    speak: [(start_frame, end_frame)] speech ranges
    env: optional audio amplitude list per frame for dynamic lip-sync
    """
    cards = cards_dir or resolve_character_dir(char_name_or_dir)
    J = load_meta(cards)
    char_id = J.get('name', os.path.basename(cards)).lower()
    PFX = char_id + '_'

    S = CHAR_H_M / J['body']['char_height_px']
    bw, bh = J['body']['canvas']
    feet = J['body']['feet_y']
    cxb = J['body']['center_x']
    hx, hy = J['head']['paste_on_body']
    hw, hh = J['head']['canvas']
    chin = J['head']['chin_y']
    mcx, mcy = J['mouth']['center_on_head']
    mw, mh = J['mouth']['canvas']
    blink_ok = set(J['blink']['blink_ok'])
    HDX = J['body'].get('head_dx', {})

    P = lambda n: os.path.join(cards, n + '.png')
    f1 = f1 if f1 is not None else max([f for f, _ in exprs + poses] + [f0]) + 30

    root = _empty(sc, f'CHAR_{char_id}_{tag}', loc)
    root.scale = (scale,) * 3

    # Always face camera (yaw axis)
    if cam:
        c = root.constraints.new('LOCKED_TRACK')
        c.target = cam
        c.track_axis = 'TRACK_NEGATIVE_Y'
        c.lock_axis = 'LOCK_Z'

    # Ground contact shadow (direct mesh, no bpy.ops / context dependency)
    sh_verts = [(0.5 * math.cos(2 * math.pi * i / 32), 0.5 * math.sin(2 * math.pi * i / 32), 0.006) for i in range(32)]
    me_sh = bpy.data.meshes.new(f'CHAR_shadow_mesh_{char_id}_{tag}')
    me_sh.from_pydata(sh_verts, [], [list(range(32))])
    sh = bpy.data.objects.new(f'CHAR_shadow_{char_id}_{tag}', me_sh)
    sc.collection.objects.link(sh)
    # Keep the contact shadow horizontal in world space. Parenting it to the
    # camera-facing character root would billboard the floor ellipse vertically.
    sh.location = (loc[0], loc[1], 0.008)
    sh.scale = (0.75 * scale, 0.42 * scale, 1)
    sh.data.materials.append(_shadowmat())

    # Dedicated pivot for Director motion; breathing keys remain on the body.
    motion = _empty(sc, f'CHAR_MOTION_{char_id}_{tag}', (0, 0, 0), root)
    B = _empty(sc, f'CHAR_B_{char_id}_{tag}', (0, 0, 0), motion)
    body_c = (0, 0, (feet - bh / 2) * S)
    body_poses = sorted({n for _, n in poses})
    bodies = {
        p: _plane(sc, f'CHAR_{tag}_b_{p}', _cardmat(P(PFX + 'badan_' + p)), bw, bh, body_c, B, S)
        for p in body_poses
    }
    # A very thin cool silhouette behind each pose creates a readable rim edge
    # while leaving the original PNG artwork and its colors untouched.
    rim_color = (0.12, 0.22, 0.40)
    rim_bodies = {
        p: _rim_plane(sc, f'CHAR_{tag}_rim_b_{p}', P(PFX + 'badan_' + p),
                      bw, bh, body_c, B, S, rim_color)
        for p in body_poses
    }

    HP = _empty(sc, f'CHAR_HP_{char_id}_{tag}', ((hx + hw / 2 - cxb) * S, 0, (feet - chin) * S), B)
    head_c = (0, -0.010, (chin - hh / 2) * S)
    head_exprs = sorted({n for _, n in exprs})
    heads = {
        x: _plane(sc, f'CHAR_{tag}_h_{x}', _cardmat(P(PFX + 'kepala_' + x)), hw, hh, head_c, HP, S)
        for x in head_exprs
    }
    rim_heads = {
        x: _rim_plane(sc, f'CHAR_{tag}_rim_h_{x}', P(PFX + 'kepala_' + x),
                      hw, hh, head_c, HP, S, rim_color)
        for x in head_exprs
    }

    lids = _plane(
        sc,
        f'CHAR_{tag}_lids',
        _cardmat(P(PFX + 'kelopak')),
        hw,
        hh,
        (0, -0.020, (chin - hh / 2) * S),
        HP,
        S,
    )
    # Keep the mouth just in front of the face card. Excessive Y separation creates visible parallax at oblique camera angles.
    mouth_c = ((mcx - hw / 2) * S, -0.013, (chin - hh / 2) * S - (mcy - hh / 2) * S)
    mouth_shapes = J['mouth'].get('shapes', ['a', 'i', 'u', 'e', 'o'])
    mouths = {
        s: _plane(sc, f'CHAR_{tag}_m_{s}', _cardmat(P(PFX + 'mulut_' + s)), mw, mh, mouth_c, HP, S)
        for s in mouth_shapes
    }

    _schedule(bodies, poses)
    _schedule(rim_bodies, poses)
    _schedule(heads, exprs)
    _schedule(rim_heads, exprs)

    # Pop scaling on pose/expression transitions
    B.scale = (1, 1, 1)
    B.keyframe_insert('scale', frame=max(1, f0))
    HP.scale = (1, 1, 1)
    HP.keyframe_insert('scale', frame=max(1, f0))
    if len(poses) > 1:
        _pop(B, [f for f, _ in poses[1:]])
    if len(exprs) > 1:
        _pop(HP, [f for f, _ in exprs[1:]])

    # Neck offset per pose (CONSTANT interpolation)
    _interp('CONSTANT')
    hx0 = HP.location.x
    for f, n in sorted(poses, key=lambda x: x[0]):
        HP.location.x = hx0 + HDX.get(n, 0) * S
        HP.keyframe_insert('location', index=0, frame=max(1, int(f)))
    _interp('BEZIER')

    # Subtle natural breathing and head movement (every ~10 frames)
    for f in range(max(1, f0 - 10), f1 + 11, 10):
        B.location = (0, 0, 0.010 * math.sin(f * 0.21 + blink_seed))
        B.keyframe_insert('location', frame=f)
        B.rotation_euler = (0, 0.012 * math.sin(f * 0.09 + blink_seed), 0)
        B.keyframe_insert('rotation_euler', frame=f)
        HP.rotation_euler = (0, 0.035 * math.sin(f * 0.13 + blink_seed * 2), 0)
        HP.keyframe_insert('rotation_euler', frame=f)

    # Apply subtle Director motion on a separate pivot, preserving body/head animation.
    motion_keys = {}
    def _motion_key(frame, y=0.0, z=0.0, tilt=0.0):
        frame = max(int(f0), min(int(f1), int(frame)))
        motion_keys[frame] = ((0.0, float(y), float(z)), (0.0, float(tilt), 0.0))

    _motion_key(f0)
    for cue in sorted(actions or [], key=lambda item: int(item.get('start_frame', f0))):
        action = str(cue.get('movement', 'hold'))
        a = max(f0, int(cue.get('start_frame', f0)))
        b = min(f1, max(a, int(cue.get('end_frame', a + 1)) - 1))
        if action == 'quick_recoil':
            _motion_key(a)
            _motion_key(a + 2, y=0.075, z=0.025, tilt=-0.075)
            _motion_key(a + 7, y=0.035, z=0.010, tilt=-0.030)
            _motion_key(min(b, a + 12))
        elif action == 'lean_forward':
            _motion_key(a)
            _motion_key(min(b, a + 4), y=-0.055, z=0.010, tilt=0.045)
            _motion_key(max(a, b - 3), y=-0.055, z=0.010, tilt=0.045)
            _motion_key(b)
        elif action == 'step_forward':
            _motion_key(a)
            _motion_key(min(b, a + 5), y=-0.12, tilt=0.015)
            _motion_key(max(a, b - 3), y=-0.12, tilt=0.015)
            _motion_key(b)
        elif action == 'subtle_gesture':
            _motion_key(a)
            _motion_key(min(b, a + 4), z=0.025, tilt=0.025)
            _motion_key(max(a, b - 3), z=0.025, tilt=0.025)
            _motion_key(b)
        else:
            _motion_key(a)
            _motion_key(b)

    for frame in sorted(motion_keys):
        location, rotation = motion_keys[frame]
        motion.location = location
        motion.rotation_euler = rotation
        motion.keyframe_insert('location', frame=frame)
        motion.keyframe_insert('rotation_euler', frame=frame)

    # Automatic natural blinking
    rnd = random.Random(blink_seed)
    keys = [(f0, False)]
    f = f0 + rnd.randint(20, 60)
    blinks = []
    while f < f1 - 5:
        if (
            _at(exprs, f) in blink_ok
            and _at(exprs, f + 3) == _at(exprs, f)
            and all(abs(f - e) > 4 for e, _ in exprs)
        ):
            f |= 1
            keys += [(f, True), (f + 3, False)]
            blinks.append(f)
        f += rnd.randint(60, 110)
    _vis(lids, keys)

    # Lip-sync: on twos (odd frames)
    mk = {s: [(f0, False)] for s in mouth_shapes}
    plan = []
    if speak:
        if env is not None:
            nrm = _norm_env(env, speak)
            def e_at(ff):
                return sum(env[min(max(ff + d, 0), len(env) - 1)] for d in (-1, 0, 1)) / 3.0 / nrm
        else:
            def e_at(ff):
                return 0.5 + 0.5 * math.sin(ff * 0.7)

        for a, b in speak:
            f = int(a) | 1
            k = 0
            while f <= b:
                e = e_at(f)
                if e < 0.10:
                    s = None
                elif any(x <= f <= y for x, y in u_ranges):
                    s = 'u'
                elif e < 0.30:
                    s = 'e'
                elif e < 0.55:
                    s = 'o' if (k // 2) % 2 == 0 else 'i'
                else:
                    s = 'a'
                plan.append((f, s))
                f += 2
                k += 1
            plan.append((int(b) + 2 | 1, None))
        for f, s in plan:
            for n in mouth_shapes:
                mk[n].append((f, n == s))

    for n, o in mouths.items():
        _vis(o, mk[n])

    return dict(
        root=root,
        motion=motion,
        B=B,
        HP=HP,
        bodies=bodies,
        heads=heads,
        lids=lids,
        mouths=mouths,
        blinks=blinks,
        mouth_plan=plan,
        S=S,
        char_name=char_id,
    )

def make_silhouette(
    sc,
    cam,
    char_name_or_dir: str,
    tag: str,
    loc: Tuple[float, float, float],
    pose: str = 'diam',
    color: Tuple[float, float, float] = (0.05, 0.04, 0.09),
    scale: float = 1.0,
    cards_dir: Optional[str] = None,
    head: str = 'netral',
):
    """Create a flat dark silhouette for secondary/extra characters."""
    cards = cards_dir or resolve_character_dir(char_name_or_dir)
    J = load_meta(cards)
    char_id = J.get('name', os.path.basename(cards)).lower()
    PFX = char_id + '_'
    S = CHAR_H_M / J['body']['char_height_px']
    bw, bh = J['body']['canvas']
    feet = J['body']['feet_y']
    cxb = J['body']['center_x']
    hx, hy = J['head']['paste_on_body']
    hw, hh = J['head']['canvas']
    P = lambda n: os.path.join(cards, n + '.png')
    HDX = J['body'].get('head_dx', {})

    root = _empty(sc, f'SIL_{char_id}_{tag}', loc)
    root.scale = (scale,) * 3
    if cam:
        c = root.constraints.new('LOCKED_TRACK')
        c.target = cam
        c.track_axis = 'TRACK_NEGATIVE_Y'
        c.lock_axis = 'LOCK_Z'

    b = _plane(
        sc,
        f'SIL_{tag}_b',
        _silmat(P(PFX + 'badan_' + pose), color),
        bw,
        bh,
        (0, 0, (feet - bh / 2) * S),
        root,
        S,
    )
    h = _plane(
        sc,
        f'SIL_{tag}_h',
        _silmat(P(PFX + 'kepala_' + head), color),
        hw,
        hh,
        (
            (hx + hw / 2 - cxb + HDX.get(pose, 0)) * S,
            -0.010,
            (feet - hy - hh / 2) * S,
        ),
        root,
        S,
    )
    return dict(root=root, body=b, head=h, S=S)

# Aliases
make_char = make_character
make_uki = make_character

