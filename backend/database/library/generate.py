#!/usr/bin/env python3
"""Generates the ORIGINAL sample asset library (SVG) -> svg/<category>/<key>.svg + manifest.json.

Characters share one 400x800 full-body canvas (centre x=200); every part is drawn in place, so parts line up without
any per-asset offset. "Half body" is just a crop of the same canvas (see builder view presets). Recolourable regions
carry data-tint="skin|hair|top|bottom|hijab|tie|eye|shoe|accent" with a sensible default fill.

Anatomy (keep in sync with App\\Services\\Library\\AiAssetGenerator::GEOMETRY):
  face ellipse centre (200,190) rx80 ry92 | neck y270-315 | shoulders y~330 x105-295 | waist y560 | legs y560-745 | feet to 785

Re-run:  python generate.py   (writes into this folder)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
INK = "#26262e"
O = f'stroke="{INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"'
O2 = f'stroke="{INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"'


def svg(body, w=400, h=800):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'


def p(d, fill, tint=None, ol=O, extra=""):
    t = f' data-tint="{tint}"' if tint else ""
    return f'<path d="{d}" fill="{fill}"{t} {ol} {extra}/>'


def mirror(d):
    """Mirror a path made ONLY of absolute M/L/C/Q/Z commands around x=200 (numbers alternate x, y)."""
    import re
    res, nums = [], 0
    for t in re.findall(r"[A-Za-z]|-?\d+(?:\.\d+)?", d):
        if t.isalpha():
            res.append(t)
            nums = 0
        else:
            v = float(t)
            res.append(f"{400 - v:g}" if nums % 2 == 0 else f"{v:g}")
            nums += 1
    return " ".join(res)


def both(d, fill, tint=None, ol=O, extra=""):
    return p(d, fill, tint, ol, extra) + p(mirror(d), fill, tint, ol, extra)


SKIN, SKIN_SH = "#f1c7a0", "#e3ae85"
HAIR = "#1f1b24"
TOP, BOTTOM, HIJAB, TIE, EYE, SHOE, ACC = "#f4f6fa", "#34456a", "#f1f1f5", "#3f5f86", "#3a2b2b", "#2b2b33", "#2e3440"

assets = []  # (category, key, name, tags, svg_text)


def add(cat, key, name, tags, body, w=400, h=800):
    assets.append((cat, key, name, tags, svg(body, w, h)))


# ---------------------------------------------------------------- face (head + neck + ears) ----
def face(key, name, head):
    neck = p("M178 262 L178 318 Q200 334 222 318 L222 262 Z", SKIN, "skin")
    shade = p("M178 290 Q200 312 222 290 L222 318 Q200 334 178 318 Z", SKIN_SH, "skin", ol="", extra='opacity="0.55"')
    ears = '<ellipse cx="121" cy="202" rx="11" ry="18" fill="%s" data-tint="skin" %s/><ellipse cx="279" cy="202" rx="11" ry="18" fill="%s" data-tint="skin" %s/>' % (SKIN, O, SKIN, O)
    blush = '<ellipse cx="148" cy="232" rx="17" ry="9" fill="#ee8f86" opacity="0.32"/><ellipse cx="252" cy="232" rx="17" ry="9" fill="#ee8f86" opacity="0.32"/>'
    nose = f'<path d="M196 224 Q200 229 204 224" fill="none" {O2}/>'
    add("face", key, name, ["wajah", "kepala"], neck + shade + ears + p(head, SKIN, "skin") + blush + nose)


face("face_round", "Wajah bulat", "M120 185 C120 128 156 98 200 98 C244 98 280 128 280 185 C280 245 245 288 200 288 C155 288 120 245 120 185 Z")
face("face_oval", "Wajah oval", "M124 180 C124 120 160 98 200 98 C240 98 276 120 276 180 C276 235 240 285 200 290 C160 285 124 235 124 180 Z")
face("face_square", "Wajah tegas", "M122 170 C122 118 158 98 200 98 C242 98 278 118 278 170 L274 228 C268 266 236 284 200 284 C164 284 132 266 126 228 Z")
face("face_heart", "Wajah lancip", "M122 172 C122 120 160 98 200 98 C240 98 278 120 278 172 C278 228 240 282 200 294 C160 282 122 228 122 172 Z")


# ---------------------------------------------------------------- body (skin only) ----
def body(key, name, k):  # k = torso half-width offset
    legs = both(f"M{140 + k * 0.3:g} 552 L138 748 L198 748 L200 552 Z", SKIN, "skin")
    torso = p(f"M{138 + k:g} 346 Q200 326 {262 - k:g} 346 C{272 - k:g} 410 {284 - k:g} 480 {280 - k:g} 560 L{120 + k:g} 560 C{116 + k:g} 480 {128 + k:g} 410 {138 + k:g} 346 Z", SKIN, "skin")
    arms = both(f"M{92 + k:g} 360 Q{82 + k:g} 450 {94 + k:g} 566 L{118 + k:g} 566 Q{118 + k:g} 450 {124 + k:g} 364 Z", SKIN, "skin")
    hands = both(f'M{93 + k:g} 566 Q{92 + k:g} 612 {106 + k:g} 614 Q{120 + k:g} 612 {118 + k:g} 566 Z', SKIN, "skin")
    add("body", key, name, ["badan", "tubuh"], legs + torso + arms + hands)


def body_legs():
    legs = both("M140 552 L138 748 L198 748 L200 552 Z", SKIN, "skin")
    hips = p("M126 540 L274 540 L276 566 L124 566 Z", SKIN, "skin")
    add("body", "body_legs", "Badan: hanya kaki (untuk torso & lengan terpisah)", ["badan", "kaki"], legs + hips)


body_legs()
body("body_slim", "Badan ramping", 8)
body("body_normal", "Badan normal", 0)
body("body_sturdy", "Badan kekar", -8)


# ---------------------------------------------------------------- tops ----
def pocket():
    return ('<rect x="228" y="428" width="38" height="46" rx="4" fill="#f4f6fa" data-tint="top" %s/>' % O2 +
            '<rect x="238" y="438" width="18" height="20" rx="3" fill="#7a5a3c" stroke="%s" stroke-width="1.5"/>' % INK +
            '<circle cx="247" cy="448" r="5" fill="#e0c07a"/>')


def collar():
    return (p("M176 316 L200 356 L162 346 L156 322 Z", TOP, "top", ol=O2) + p("M224 316 L200 356 L238 346 L244 322 Z", TOP, "top", ol=O2))


def shirt(key, name, long):
    torso = p("M112 322 C104 400 114 480 118 568 L282 568 C286 480 296 400 288 322 C262 334 232 338 200 338 C168 338 138 334 112 322 Z", TOP, "top")
    if long:
        sl = both("M112 322 C94 328 82 350 80 440 L84 566 L118 566 L124 345 Z", TOP, "top")
        cuff = both("M84 548 L118 548 L118 566 L84 566 Z", TOP, "top", ol=O2)
    else:
        sl = both("M112 322 C94 328 82 345 76 398 L116 408 L124 340 Z", TOP, "top")
        cuff = ""
    detail = f'<path d="M200 356 L200 568" fill="none" {O2}/>' + "".join(f'<circle cx="203" cy="{y}" r="2.5" fill="{INK}"/>' for y in (390, 440, 490, 540))
    fold = '<path d="M130 470 Q160 500 150 560" fill="none" stroke="#c9d0dc" stroke-width="2.5" stroke-linecap="round"/>'
    add("top", key, name, ["atasan", "seragam", "smk", "kemeja"], torso + sl + cuff + fold + detail + collar() + pocket())


shirt("top_smk_short", "Seragam SMK lengan pendek", False)
shirt("top_smk_long", "Seragam SMK lengan panjang", True)

hood = (p("M150 318 C150 296 250 296 250 318 L246 350 Q200 372 154 350 Z", "#243150", "top")
        + p("M110 322 C102 400 112 480 116 572 L284 572 C288 480 298 400 290 322 C262 336 232 340 200 340 C168 340 138 336 110 322 Z", "#2f3f63", "top")
        + both("M110 322 C92 328 80 350 78 440 L82 568 L118 568 L124 345 Z", "#2f3f63", "top")
        + f'<path d="M200 346 L200 572" fill="none" {O}/><path d="M176 346 Q172 380 170 400 M224 346 Q228 380 230 400" fill="none" stroke="{INK}" stroke-width="2.5"/>'
        + p("M120 500 L160 500 L150 560 L116 560 Z", "#2a3858", "top", ol=O2) + p("M280 500 L240 500 L250 560 L284 560 Z", "#2a3858", "top", ol=O2))
add("top", "top_hoodie", "Jaket hoodie", ["atasan", "jaket", "hoodie"], hood)

tshirt = (p("M114 322 C106 400 116 480 120 560 L280 560 C284 480 294 400 286 322 C262 332 232 336 200 336 C168 336 138 332 114 322 Z", "#e8704f", "top")
          + both("M114 322 C96 328 84 345 80 392 L116 404 L124 338 Z", "#e8704f", "top")
          + p("M170 322 Q200 354 230 322", "none", None, ol=O))
add("top", "top_tshirt", "Kaos oblong", ["atasan", "kaos", "kasual"], tshirt)

# ---------------------------------------------------------------- accessories ----
tie = p("M190 340 L210 340 L207 358 L193 358 Z", TIE, "tie") + p("M193 358 L207 358 L214 446 L200 470 L186 446 Z", TIE, "tie") + '<path d="M196 380 L204 380 M194 410 L206 410" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2"/>'
add("accessory", "acc_tie", "Dasi", ["aksesori", "dasi", "seragam"], tie)
lan = (f'<path d="M170 322 L200 470 L230 322" fill="none" stroke="#c0392b" stroke-width="6" stroke-linejoin="round"/>'
       + '<rect x="184" y="466" width="32" height="44" rx="4" fill="#ffffff" %s/><rect x="190" y="472" width="20" height="20" rx="3" fill="#8fb4d8"/><path d="M190 500 H210" stroke="%s" stroke-width="2"/>' % (O2, INK))
add("accessory", "acc_lanyard", "Tali ID card", ["aksesori", "id card", "tali"], lan)

# ---------------------------------------------------------------- bottoms / shoes ----
trousers = p("M120 546 L280 546 L278 604 L264 758 L204 758 L200 614 L196 758 L136 758 L122 604 Z", BOTTOM, "bottom") + f'<rect x="120" y="546" width="160" height="16" fill="#27334f" data-tint="bottom" {O2}/><path d="M200 562 V614" fill="none" {O2}/><rect x="192" y="548" width="16" height="12" rx="2" fill="#d9c07a"/>'
add("bottom", "bottom_trousers", "Celana panjang", ["bawahan", "celana", "seragam"], trousers)
skirt = p("M120 546 L280 546 C300 640 312 700 322 742 L78 742 C88 700 100 640 120 546 Z", BOTTOM, "bottom") + "".join(f'<path d="M{x} 560 Q{x + (x - 200) * 0.15:g} 650 {x + (x - 200) * 0.3:g} 740" fill="none" stroke="#27334f" stroke-width="2.5" stroke-linecap="round"/>' for x in (150, 175, 225, 250)) + f'<rect x="120" y="546" width="160" height="14" fill="#27334f" data-tint="bottom" {O2}/>'
add("bottom", "bottom_skirt", "Rok panjang", ["bawahan", "rok", "seragam"], skirt)
shoe_l = f'M128 748 L200 748 L206 776 Q206 788 192 788 L124 788 Q110 788 110 776 Q116 756 128 748 Z'
shoes = both(shoe_l, SHOE, "shoe") + both('M112 778 L205 778 L205 788 L112 788 Z', "#ffffff", None, ol=O2)
add("shoes", "shoes_sneakers", "Sepatu sneakers", ["sepatu"], shoes)

# ---------------------------------------------------------------- bag ----
bag = (both("M96 372 C78 380 76 470 90 520 L112 516 L116 372 Z", ACC, "accent")
       + both("M126 322 L152 322 L142 480 L116 480 Z", "#3a4150", "accent")
       + both("M116 472 L142 472 L142 486 L116 486 Z", "#222833", "accent", ol=O2))
add("bag", "bag_backpack", "Tas ransel", ["tas", "ransel"], bag)

# ---------------------------------------------------------------- hair ----
add("hair_back", "hairb_long", "Rambut belakang panjang", ["rambut", "panjang"],
    p("M108 160 C100 110 150 82 200 82 C250 82 300 110 292 160 C300 260 296 380 306 470 C250 486 150 486 94 470 C104 380 100 260 108 160 Z", HAIR, "hair"))
add("hair_back", "hairb_short", "Rambut belakang pendek", ["rambut", "pendek"],
    p("M112 170 C106 112 152 84 200 84 C248 84 294 112 288 170 C290 200 284 224 278 232 L122 232 C116 224 110 200 112 170 Z", HAIR, "hair"))
add("hair_back", "hairb_bun", "Rambut belakang + sanggul", ["rambut", "sanggul"],
    p("M112 170 C106 112 152 84 200 84 C248 84 294 112 288 170 C290 200 284 224 278 232 L122 232 C116 224 110 200 112 170 Z", HAIR, "hair")
    + f'<circle cx="244" cy="76" r="30" fill="{HAIR}" data-tint="hair" {O}/><path d="M228 66 Q244 56 260 68" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>')

add("hair_front", "hairf_messy", "Rambut acak", ["rambut", "pendek", "acak"],
    p("M116 190 C106 130 128 92 160 84 L164 62 L186 82 L204 54 L222 82 L246 64 L246 88 C280 98 294 140 284 190 C278 168 270 150 252 142 C230 150 190 150 168 138 C146 146 126 160 116 190 Z", HAIR, "hair"))
add("hair_front", "hairf_neat", "Rambut rapi belah samping", ["rambut", "pendek", "rapi"],
    p("M116 190 C104 128 140 86 200 84 C262 84 298 126 284 190 C278 166 266 150 244 146 C210 150 160 142 142 128 C128 146 120 166 116 190 Z", HAIR, "hair")
    + f'<path d="M150 124 Q190 118 226 128" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="3"/>')
add("hair_front", "hairf_long", "Rambut panjang belah tengah", ["rambut", "panjang"],
    p("M114 200 C100 124 140 84 200 84 C260 84 300 124 286 200 C290 270 286 360 296 420 L270 420 C268 330 270 250 264 196 C250 160 224 140 200 128 C176 140 150 160 136 196 C130 250 132 330 130 420 L104 420 C114 360 110 270 114 200 Z", HAIR, "hair"))
add("hair_front", "hairf_bob", "Rambut sebahu (bob)", ["rambut", "sebahu"],
    p("M112 210 C100 126 140 84 200 84 C260 84 300 126 288 210 C290 250 286 290 280 304 L262 296 C262 250 262 214 254 188 C232 166 212 146 200 134 C186 148 164 168 146 188 C138 214 138 250 138 296 L120 304 C114 290 110 250 112 210 Z", HAIR, "hair"))

# ---------------------------------------------------------------- hijab ----
hijab = (f'<path fill-rule="evenodd" d="M92 220 C76 112 130 74 200 74 C270 74 324 112 308 220 C316 300 304 360 340 430 L60 430 C96 360 84 300 92 220 Z M200 112 C232 112 262 142 262 190 C262 238 236 278 200 278 C164 278 138 238 138 190 C138 142 168 112 200 112 Z" fill="{HIJAB}" data-tint="hijab" {O}/>'
         + f'<path d="M110 300 Q130 360 100 420 M290 300 Q270 360 300 420 M150 110 Q120 150 120 210" fill="none" stroke="#c9c9d6" stroke-width="2.5" stroke-linecap="round"/>')
add("hijab", "hijab_basic", "Kerudung segi empat", ["kerudung", "hijab"], hijab)


# ---------------------------------------------------------------- eyes ----
def eye_open(cx, ry=16, rx=13, dx=0, dy=0, lid=0):
    clip = f'M{cx - rx - 2} {196 - ry - 2 + lid} L{cx + rx + 2} {196 - ry - 2 + lid}'
    return (f'<ellipse cx="{cx}" cy="196" rx="{rx}" ry="{ry}" fill="#ffffff" {O2}/>'
            f'<circle cx="{cx + dx}" cy="{196 + dy}" r="{min(rx, ry) - 4}" fill="{EYE}" data-tint="eye"/>'
            f'<circle cx="{cx + dx}" cy="{196 + dy}" r="{min(rx, ry) - 9}" fill="#1b1416"/>'
            f'<circle cx="{cx + dx + 3}" cy="{196 + dy - 4}" r="2.6" fill="#ffffff"/>'
            + (f'<path d="M{cx - rx - 2} {196 - ry + lid} L{cx + rx + 2} {196 - ry + lid} L{cx + rx + 2} {196 - ry - 3} L{cx - rx - 2} {196 - ry - 3} Z" fill="{SKIN}" data-tint="skin" stroke="none"/><path d="{clip}" fill="none" {O}/>' if lid else '')
            + f'<path d="M{cx - rx - 1} {196 - ry + 3 + lid} Q{cx} {196 - ry - 4 + lid} {cx + rx + 1} {196 - ry + 3 + lid}" fill="none" {O}/>')


add("eyes", "eyes_round", "Mata bulat", ["mata", "normal"], eye_open(165) + eye_open(235))
add("eyes", "eyes_wide", "Mata terbelalak", ["mata", "kaget"], eye_open(165, 20, 16) + eye_open(235, 20, 16))
add("eyes", "eyes_serious", "Mata serius", ["mata", "serius"], eye_open(165, 14, 13, lid=7) + eye_open(235, 14, 13, lid=7))
add("eyes", "eyes_think", "Mata melirik", ["mata", "berpikir"], eye_open(165, 16, 13, dx=5, dy=-3) + eye_open(235, 16, 13, dx=5, dy=-3))
add("eyes", "eyes_happy", "Mata senyum", ["mata", "senang"], f'<path d="M148 202 Q165 180 182 202" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/><path d="M218 202 Q235 180 252 202" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>')
add("eyes", "eyes_laugh", "Mata tertawa", ["mata", "tertawa"], f'<path d="M148 196 Q165 214 182 196" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/><path d="M218 196 Q235 214 252 196" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>')
add("eyes", "eyes_wink", "Mata kedip", ["mata", "kedip"], eye_open(165) + f'<path d="M218 198 Q235 180 252 198" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>')

# ---------------------------------------------------------------- brows ----
def brow(d1, d2, w=5):
    return f'<path d="{d1}" fill="none" stroke="{HAIR}" data-tint="hair" stroke-width="{w}" stroke-linecap="round"/><path d="{d2}" fill="none" stroke="{HAIR}" data-tint="hair" stroke-width="{w}" stroke-linecap="round"/>'


add("brows", "brows_normal", "Alis normal", ["alis"], brow("M148 166 Q165 158 182 164", "M218 164 Q235 158 252 166"))
add("brows", "brows_up", "Alis naik", ["alis", "kaget"], brow("M148 156 Q165 142 182 152", "M218 152 Q235 142 252 156"))
add("brows", "brows_serious", "Alis serius", ["alis", "serius"], brow("M146 160 L182 168", "M218 168 L254 160", 6))
add("brows", "brows_worried", "Alis sedih", ["alis", "sedih"], brow("M148 168 Q166 164 182 154", "M218 154 Q234 164 252 168"))

# ---------------------------------------------------------------- mouth ----
add("mouth", "mouth_smile", "Senyum", ["mulut", "senang"], f'<path d="M180 246 Q200 262 220 246" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>')
add("mouth", "mouth_open", "Senyum lebar", ["mulut", "senang"], f'<path d="M172 240 Q200 246 228 240 Q226 272 200 274 Q174 272 172 240 Z" fill="#8c2f39" {O}/><path d="M176 242 Q200 248 224 242 L222 252 Q200 256 178 252 Z" fill="#ffffff"/><path d="M186 266 Q200 258 214 266 Q208 274 200 274 Q192 274 186 266 Z" fill="#e57a86"/>')
add("mouth", "mouth_laugh", "Tertawa", ["mulut", "tertawa"], f'<path d="M166 238 Q200 248 234 238 Q232 286 200 288 Q168 286 166 238 Z" fill="#8c2f39" {O}/><path d="M170 240 Q200 250 230 240 L228 254 Q200 260 172 254 Z" fill="#ffffff"/><path d="M182 276 Q200 264 218 276 Q210 288 200 288 Q190 288 182 276 Z" fill="#e57a86"/>')
add("mouth", "mouth_surprised", "Kaget (o)", ["mulut", "kaget"], f'<ellipse cx="200" cy="254" rx="10" ry="14" fill="#8c2f39" {O}/>')
add("mouth", "mouth_flat", "Datar", ["mulut", "serius"], f'<path d="M184 252 L216 252" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>')
add("mouth", "mouth_think", "Mencibir", ["mulut", "berpikir"], f'<path d="M186 254 Q204 250 218 242" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>')

# ---------------------------------------------------------------- glasses ----
add("glasses", "glasses_round", "Kacamata bulat", ["kacamata"],
    f'<circle cx="165" cy="196" r="28" fill="#cfe6f5" fill-opacity="0.22" stroke="{ACC}" data-tint="accent" stroke-width="4"/><circle cx="235" cy="196" r="28" fill="#cfe6f5" fill-opacity="0.22" stroke="{ACC}" data-tint="accent" stroke-width="4"/>'
    f'<path d="M193 194 Q200 188 207 194 M137 190 L120 184 M263 190 L280 184" fill="none" stroke="{ACC}" data-tint="accent" stroke-width="4" stroke-linecap="round"/>')
add("glasses", "glasses_square", "Kacamata kotak", ["kacamata"],
    f'<rect x="136" y="176" width="56" height="42" rx="9" fill="#cfe6f5" fill-opacity="0.22" stroke="{ACC}" data-tint="accent" stroke-width="4"/><rect x="208" y="176" width="56" height="42" rx="9" fill="#cfe6f5" fill-opacity="0.22" stroke="{ACC}" data-tint="accent" stroke-width="4"/>'
    f'<path d="M192 190 L208 190 M136 186 L120 182 M264 186 L280 182" fill="none" stroke="{ACC}" data-tint="accent" stroke-width="4" stroke-linecap="round"/>')

# ---------------------------------------------------------------- hats / headphones ----
add("hat", "hat_cap", "Topi baseball (depan)", ["topi"],
    p("M118 160 C116 100 150 70 200 70 C250 70 284 100 282 160 Z", "#2d5fa8", "accent") + p("M112 160 L288 160 C300 166 314 180 310 192 C280 176 150 176 90 192 C86 180 100 166 112 160 Z", "#2d5fa8", "accent")
    + f'<circle cx="200" cy="72" r="6" fill="#2d5fa8" data-tint="accent" {O2}/>')
add("hat", "hat_cap_back", "Topi baseball (terbalik)", ["topi"],
    p("M116 168 C112 96 150 66 200 66 C250 66 288 96 284 168 Z", "#2e3440", "accent") + p("M116 150 L284 150 L284 168 L116 168 Z", "#262b35", "accent", ol=O2)
    + p("M268 96 C300 92 336 100 346 112 C318 118 290 122 270 120 Z", "#2e3440", "accent", ol=O2))
add("headphone", "headphone_head", "Headphone di kepala", ["headphone"],
    f'<path d="M118 206 C108 90 292 90 282 206" fill="none" stroke="{ACC}" data-tint="accent" stroke-width="10" stroke-linecap="round"/>'
    f'<ellipse cx="116" cy="212" rx="17" ry="28" fill="{ACC}" data-tint="accent" {O}/><ellipse cx="284" cy="212" rx="17" ry="28" fill="{ACC}" data-tint="accent" {O}/>')
add("headphone", "headphone_neck", "Headphone di leher", ["headphone"],
    f'<path d="M156 340 C150 300 250 300 244 340" fill="none" stroke="{ACC}" data-tint="accent" stroke-width="9" stroke-linecap="round"/>'
    f'<ellipse cx="152" cy="352" rx="17" ry="26" fill="{ACC}" data-tint="accent" {O}/><ellipse cx="248" cy="352" rx="17" ry="26" fill="{ACC}" data-tint="accent" {O}/>')

# =============================================================== backgrounds (1280x720) ============
def bg(key, cat, name, tags, body):
    assets.append((cat, key, name, tags, svg(body, 1280, 720)))


desk = lambda x, y, w: f'<rect x="{x}" y="{y}" width="{w}" height="14" rx="3" fill="#b98a5a" {O2}/><rect x="{x + 10}" y="{y + 14}" width="10" height="70" fill="#8d6640"/><rect x="{x + w - 20}" y="{y + 14}" width="10" height="70" fill="#8d6640"/>'

bg("bg_school_yard", "bg_school", "Halaman sekolah", ["sekolah", "halaman", "luar"],
   '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec9f0"/><stop offset="1" stop-color="#dff2fb"/></linearGradient></defs>'
   '<rect width="1280" height="720" fill="url(#sky)"/>'
   '<circle cx="1080" cy="110" r="46" fill="#fff4c2"/><ellipse cx="260" cy="120" rx="90" ry="26" fill="#ffffff" opacity=".9"/><ellipse cx="340" cy="136" rx="70" ry="22" fill="#ffffff" opacity=".9"/>'
   f'<rect x="120" y="230" width="760" height="290" fill="#f2e6d4" {O2}/><rect x="120" y="200" width="760" height="40" fill="#c0504d" {O2}/>'
   + "".join(f'<rect x="{150 + i * 120}" y="270" width="80" height="110" fill="#8fc3e6" {O2}/><path d="M{190 + i * 120} 270 V380 M{150 + i * 120} 325 H{230 + i * 120}" stroke="{INK}" stroke-width="2"/>' for i in range(6))
   + f'<rect x="470" y="410" width="100" height="110" fill="#6b4a32" {O2}/><rect x="440" y="150" width="160" height="50" rx="6" fill="#2b4c7e" {O2}/>'
   '<path d="M452 178 H588" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".85"/>'
   f'<rect x="1000" y="140" width="8" height="390" fill="#9aa0a8"/><rect x="1008" y="150" width="90" height="30" fill="#e63946"/><rect x="1008" y="180" width="90" height="30" fill="#ffffff"/><path d="M1008 150 H1098 V210 H1008" fill="none" {O2}/>'
   '<rect y="520" width="1280" height="200" fill="#b9c4cc"/><rect y="520" width="1280" height="14" fill="#9aa8b2"/>'
   '<path d="M0 640 H1280" stroke="#ffffff" stroke-width="5" stroke-dasharray="40 30" opacity=".8"/>')

bg("bg_school_class", "bg_school", "Ruang kelas", ["sekolah", "kelas", "dalam"],
   '<rect width="1280" height="720" fill="#efe7d6"/><rect y="500" width="1280" height="220" fill="#c9a77c"/><rect y="500" width="1280" height="12" fill="#a98558"/>'
   f'<rect x="300" y="110" width="680" height="300" rx="8" fill="#2f5d50" {O}/><rect x="316" y="126" width="648" height="268" fill="#3a6f60"/><path d="M360 200 H640 M360 250 H760 M360 300 H560" stroke="#e8f5ee" stroke-width="5" stroke-linecap="round" opacity=".7"/>'
   '<rect x="300" y="410" width="680" height="14" fill="#8d6640"/>'
   f'<rect x="60" y="120" width="170" height="210" fill="#9fd0ee" {O2}/><path d="M145 120 V330 M60 225 H230" stroke="{INK}" stroke-width="2"/>'
   f'<circle cx="1130" cy="140" r="52" fill="#ffffff" {O2}/><path d="M1130 140 V108 M1130 140 L1152 150" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>'
   + desk(160, 540, 240) + desk(520, 560, 240) + desk(880, 540, 240))

bg("bg_school_lab", "bg_school", "Lab komputer", ["sekolah", "lab", "komputer", "informatika"],
   '<rect width="1280" height="720" fill="#dfe6ef"/><rect y="520" width="1280" height="200" fill="#8f9bab"/><rect y="520" width="1280" height="10" fill="#6f7b8b"/>'
   f'<rect x="80" y="90" width="1120" height="14" fill="#2b4c7e"/><rect x="480" y="120" width="320" height="170" rx="6" fill="#ffffff" {O}/><rect x="498" y="138" width="284" height="134" fill="#233a5e"/><path d="M520 170 H700 M520 205 H760 M520 240 H640" stroke="#7fe0a8" stroke-width="5" stroke-linecap="round"/>'
   + "".join(
       f'<rect x="{x}" y="420" width="260" height="14" rx="3" fill="#cfd6e0" {O2}/><rect x="{x + 10}" y="434" width="10" height="110" fill="#9aa4b2"/><rect x="{x + 240}" y="434" width="10" height="110" fill="#9aa4b2"/>'
       f'<rect x="{x + 60}" y="320" width="140" height="96" rx="6" fill="#2a2f3a" {O2}/><rect x="{x + 68}" y="328" width="124" height="80" fill="#4f8cff"/><rect x="{x + 118}" y="416" width="24" height="6" fill="#2a2f3a"/>'
       f'<rect x="{x + 70}" y="404" width="120" height="14" rx="4" fill="#e9edf3" {O2}/>' for x in (60, 360, 660, 960)))

bg("bg_home_living", "bg_home", "Ruang tamu", ["rumah", "ruang tamu", "dalam"],
   '<rect width="1280" height="720" fill="#f6e3c9"/><rect y="520" width="1280" height="200" fill="#b98856"/>'
   '<path d="M0 560 H1280 M0 610 H1280 M0 665 H1280" stroke="#a37646" stroke-width="3"/>'
   f'<rect x="120" y="110" width="260" height="230" fill="#a7d8f0" {O}/><path d="M250 110 V340 M120 225 H380" stroke="{INK}" stroke-width="3"/><path d="M96 100 Q140 230 100 360 L150 360 Q190 230 150 100 Z" fill="#e07a5f" {O2}/>'
   f'<rect x="520" y="400" width="500" height="150" rx="26" fill="#5b8fb9" {O}/><rect x="500" y="340" width="540" height="90" rx="26" fill="#6ea2cc" {O}/><rect x="500" y="420" width="46" height="130" rx="20" fill="#4d7ea8" {O2}/><rect x="994" y="420" width="46" height="130" rx="20" fill="#4d7ea8" {O2}/>'
   f'<rect x="560" y="140" width="190" height="130" fill="#ffffff" {O2}/><path d="M575 250 L625 190 L665 230 L700 200 L735 250 Z" fill="#7fb77e"/><circle cx="700" cy="170" r="14" fill="#f4d35e"/>'
   f'<rect x="1090" y="360" width="30" height="190" fill="#8d6640" {O2}/><ellipse cx="1105" cy="340" rx="70" ry="60" fill="#5c9e5f" {O2}/>')

bg("bg_park", "bg_outdoor", "Taman", ["taman", "luar", "alam"],
   '<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc4f2"/><stop offset="1" stop-color="#d9f0fb"/></linearGradient></defs><rect width="1280" height="720" fill="url(#sk)"/>'
   '<ellipse cx="220" cy="110" rx="100" ry="28" fill="#fff" opacity=".9"/><ellipse cx="900" cy="150" rx="120" ry="30" fill="#fff" opacity=".9"/>'
   '<path d="M0 440 Q300 340 640 430 T1280 420 V720 H0 Z" fill="#8fd18a"/><rect y="520" width="1280" height="200" fill="#7bc377"/>'
   f'<path d="M520 720 Q620 560 700 520 Q760 500 800 520" fill="none" stroke="#e8d3a8" stroke-width="80" stroke-linecap="round"/>'
   + "".join(f'<rect x="{x}" y="{y}" width="26" height="110" fill="#8d6640" {O2}/><circle cx="{x + 13}" cy="{y - 20}" r="{r}" fill="#4ea85a" {O2}/><circle cx="{x - 30}" cy="{y + 6}" r="{int(r * .65)}" fill="#5cb868" {O2}/>' for x, y, r in ((130, 360, 88), (1060, 340, 96), (1190, 400, 70)))
   + f'<rect x="300" y="540" width="170" height="14" rx="3" fill="#b98a5a" {O2}/><rect x="310" y="554" width="10" height="40" fill="#8d6640"/><rect x="450" y="554" width="10" height="40" fill="#8d6640"/><rect x="300" y="510" width="170" height="10" rx="3" fill="#b98a5a" {O2}/>')

# =============================================================== more locations ==================
bg("bg_school_canteen", "bg_school", "Kantin sekolah", ["sekolah", "kantin", "makan", "dalam"],
   '<rect width="1280" height="720" fill="#fbe9c8"/><rect y="500" width="1280" height="220" fill="#d9b98a"/><rect y="500" width="1280" height="12" fill="#b89560"/>'
   f'<rect x="180" y="120" width="920" height="150" rx="10" fill="#e76f51" {O}/><path d="M180 270 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0 q40 40 80 0" fill="#f4a261" {O2}/>'
   '<rect x="420" y="150" width="440" height="70" rx="8" fill="#fff4e0"/><path d="M450 185 H830" stroke="#e76f51" stroke-width="10" stroke-linecap="round"/>'
   f'<rect x="200" y="330" width="880" height="120" fill="#c68b59" {O}/><rect x="200" y="320" width="880" height="26" fill="#e3a872" {O2}/>'
   + "".join(f'<ellipse cx="{x}" cy="312" rx="40" ry="12" fill="#ffffff" {O2}/><circle cx="{x}" cy="300" r="14" fill="{c}" {O2}/>' for x, c in ((300, "#e63946"), (460, "#f4d35e"), (620, "#4ea85a"), (780, "#f4a261"), (940, "#6ea2cc")))
   + desk(110, 560, 200) + desk(480, 580, 200) + desk(900, 560, 200))

bg("bg_school_library", "bg_school", "Perpustakaan", ["sekolah", "perpustakaan", "buku", "dalam"],
   '<rect width="1280" height="720" fill="#efe3cf"/><rect y="520" width="1280" height="200" fill="#a67c52"/><rect y="520" width="1280" height="10" fill="#8a6339"/>'
   + "".join(
       f'<rect x="{x}" y="90" width="300" height="400" fill="#8d6640" {O}/>'
       + "".join(f'<rect x="{x + 10}" y="{105 + r * 95}" width="280" height="8" fill="#6f4e2e"/>' + "".join(f'<rect x="{x + 16 + i * 26}" y="{40 + r * 95 + 20}" width="20" height="{58 + (i * 7) % 18}" fill="{c}" {O2}/>'.replace(f'y="{40 + r * 95 + 20}"', f'y="{105 + r * 95 - 58 - (i * 7) % 18}"') for i, c in enumerate(("#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#e9c46a", "#6d597a", "#8ecae6", "#b56576", "#588157", "#fb8500")))
                 for r in range(4)) for x in (60, 400, 740))
   + f'<rect x="1060" y="300" width="170" height="14" rx="3" fill="#c9a77c" {O2}/><rect x="1075" y="314" width="12" height="206" fill="#8d6640"/><rect x="1203" y="314" width="12" height="206" fill="#8d6640"/>'
   f'<rect x="1100" y="250" width="90" height="50" rx="4" fill="#ffffff" {O2}/><path d="M1145 250 V300" stroke="{INK}" stroke-width="2"/>')

bg("bg_school_field", "bg_school", "Lapangan upacara", ["sekolah", "lapangan", "olahraga", "luar"],
   '<defs><linearGradient id="fs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fbbe8"/><stop offset="1" stop-color="#cfeaf8"/></linearGradient></defs><rect width="1280" height="720" fill="url(#fs)"/>'
   '<ellipse cx="300" cy="120" rx="110" ry="28" fill="#fff" opacity=".9"/><ellipse cx="980" cy="90" rx="90" ry="24" fill="#fff" opacity=".9"/>'
   f'<rect y="360" width="1280" height="70" fill="#d8d3c8" {O2}/><rect y="430" width="1280" height="290" fill="#6fbf73"/><rect y="540" width="1280" height="180" fill="#86cf8a"/>'
   '<path d="M0 560 H1280 M640 430 V720" stroke="#ffffff" stroke-width="6" opacity=".85"/><circle cx="640" cy="620" r="70" fill="none" stroke="#ffffff" stroke-width="6" opacity=".85"/>'
   f'<rect x="1060" y="200" width="8" height="330" fill="#9aa0a8"/><rect x="1068" y="210" width="110" height="36" fill="#e63946"/><rect x="1068" y="246" width="110" height="36" fill="#ffffff"/><path d="M1068 210 H1178 V282 H1068" fill="none" {O2}/>'
   + "".join(f'<rect x="{x}" y="250" width="22" height="130" fill="#8d6640" {O2}/><circle cx="{x + 11}" cy="228" r="{r}" fill="#4ea85a" {O2}/>' for x, r in ((80, 70), (230, 62), (1180, 56))))

bg("bg_home_bedroom", "bg_home", "Kamar tidur", ["rumah", "kamar", "tidur", "dalam"],
   '<rect width="1280" height="720" fill="#e7eef7"/><rect y="530" width="1280" height="190" fill="#c8a47a"/><rect y="530" width="1280" height="10" fill="#a98558"/>'
   f'<rect x="140" y="110" width="250" height="230" fill="#a7d8f0" {O}/><path d="M265 110 V340 M140 225 H390" stroke="{INK}" stroke-width="3"/>'
   f'<rect x="520" y="340" width="520" height="190" rx="14" fill="#6ea2cc" {O}/><rect x="520" y="300" width="520" height="70" rx="14" fill="#ffffff" {O}/><rect x="540" y="310" width="150" height="50" rx="18" fill="#f1f5f9" {O2}/>'
   f'<rect x="500" y="290" width="26" height="250" rx="8" fill="#8d6640" {O2}/><rect x="1034" y="290" width="26" height="250" rx="8" fill="#8d6640" {O2}/>'
   f'<rect x="1100" y="400" width="130" height="130" fill="#b98a5a" {O}/><path d="M1100 465 H1230" stroke="{INK}" stroke-width="3"/><circle cx="1165" cy="432" r="6" fill="{INK}"/><circle cx="1165" cy="498" r="6" fill="{INK}"/>'
   f'<rect x="1130" y="330" width="14" height="70" fill="#8d6640"/><path d="M1105 330 L1170 330 L1150 280 L1125 280 Z" fill="#f4d35e" {O2}/>')

bg("bg_home_kitchen", "bg_home", "Dapur", ["rumah", "dapur", "masak", "dalam"],
   '<rect width="1280" height="720" fill="#fdf1dc"/><rect y="520" width="1280" height="200" fill="#d6c3a5"/>'
   + "".join(f'<path d="M{x} 520 V720" stroke="#bfa985" stroke-width="3"/>' for x in range(0, 1280, 160))
   + f'<rect x="80" y="110" width="360" height="130" fill="#e9c46a" {O}/><path d="M260 110 V240" stroke="{INK}" stroke-width="3"/><circle cx="240" cy="180" r="6" fill="{INK}"/><circle cx="280" cy="180" r="6" fill="{INK}"/>'
   f'<rect x="60" y="360" width="720" height="160" fill="#f1f1f1" {O}/><rect x="50" y="340" width="740" height="30" fill="#8f9bab" {O2}/>'
   f'<rect x="130" y="270" width="120" height="70" rx="6" fill="#b0bec5" {O2}/><rect x="145" y="285" width="90" height="40" fill="#78909c"/>'
   f'<rect x="900" y="170" width="260" height="350" rx="14" fill="#e8eef2" {O}/><path d="M900 330 H1160" stroke="{INK}" stroke-width="3"/><rect x="1130" y="220" width="8" height="70" rx="4" fill="#78909c"/><rect x="1130" y="360" width="8" height="90" rx="4" fill="#78909c"/>'
   f'<circle cx="640" cy="130" r="60" fill="#ffffff" {O}/><path d="M640 130 V92 M640 130 L668 140" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>')

bg("bg_street", "bg_outdoor", "Jalan raya", ["jalan", "kota", "luar"],
   '<defs><linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3f3"/><stop offset="1" stop-color="#e6f4fb"/></linearGradient></defs><rect width="1280" height="720" fill="url(#st)"/>'
   + "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{400 - y}" fill="{c}" {O2}/>' + "".join(f'<rect x="{x + 18 + i * 38}" y="{y + 26 + j * 46}" width="22" height="28" fill="#fff6c9" {O2}/>' for i in range((w - 30) // 38) for j in range((400 - y - 40) // 46)) for x, y, w, c in ((30, 120, 200, "#b8c4d6"), (260, 200, 170, "#d6b8a8"), (470, 80, 230, "#a8c6d6"), (740, 180, 190, "#cfc0d9"), (960, 130, 260, "#b8d6bd")))
   + f'<rect y="400" width="1280" height="70" fill="#cfd5db" {O2}/><rect y="470" width="1280" height="250" fill="#5d6570"/><path d="M0 595 H1280" stroke="#ffe08a" stroke-width="8" stroke-dasharray="70 50"/>'
   f'<rect y="466" width="1280" height="8" fill="#e8ecef"/><rect x="170" y="250" width="12" height="170" fill="#7c8793"/><path d="M176 250 Q215 244 235 262" fill="none" stroke="#7c8793" stroke-width="8"/><rect x="226" y="258" width="34" height="14" rx="4" fill="#fff3a1" {O2}/>')

# =============================================================== props (400x400) ===================
def prop(key, cat, name, tags, body):
    assets.append((cat, key, name, tags, svg(body, 400, 400)))


prop("prop_books", "prop_school", "Tumpukan buku", ["buku", "sekolah"],
     f'<rect x="90" y="300" width="230" height="50" rx="6" fill="#457b9d" {O}/><rect x="104" y="306" width="200" height="12" fill="#a8dadc"/>'
     f'<rect x="110" y="250" width="200" height="50" rx="6" fill="#e63946" {O}/><rect x="124" y="256" width="170" height="12" fill="#ffd6d6"/>'
     f'<rect x="100" y="200" width="215" height="50" rx="6" fill="#f4a261" {O}/><rect x="114" y="206" width="185" height="12" fill="#ffe8cf"/>')
prop("prop_laptop", "prop_school", "Laptop", ["laptop", "komputer", "informatika"],
     f'<rect x="90" y="120" width="220" height="150" rx="10" fill="#2a2f3a" {O}/><rect x="104" y="134" width="192" height="122" rx="4" fill="#4f8cff"/><path d="M120 165 H220 M120 195 H260 M120 225 H190" stroke="#dbe9ff" stroke-width="6" stroke-linecap="round"/>'
     f'<path d="M60 285 H340 L318 310 H82 Z" fill="#cfd6e0" {O}/><rect x="170" y="290" width="60" height="8" rx="3" fill="#9aa4b2"/>')
prop("prop_backpack", "prop_school", "Tas ransel", ["tas", "sekolah"],
     f'<path d="M120 110 Q200 40 280 110 L300 330 Q200 360 100 330 Z" fill="#2b4c7e" {O}/><rect x="140" y="220" width="120" height="90" rx="14" fill="#3a6ab0" {O2}/><rect x="160" y="170" width="80" height="14" rx="6" fill="#1b3558"/><path d="M165 60 Q200 30 235 60" fill="none" stroke="{INK}" stroke-width="8" stroke-linecap="round"/>')
prop("prop_chair", "prop_school", "Kursi sekolah", ["kursi", "sekolah"],
     f'<rect x="120" y="60" width="160" height="130" rx="10" fill="#f4a261" {O}/><rect x="110" y="190" width="190" height="34" rx="8" fill="#e08a3c" {O}/>'
     f'<rect x="130" y="224" width="14" height="130" fill="#6b7280" {O2}/><rect x="260" y="224" width="14" height="130" fill="#6b7280" {O2}/><rect x="146" y="290" width="112" height="10" fill="#6b7280"/>')
prop("prop_desk", "prop_school", "Meja sekolah", ["meja", "sekolah"],
     f'<rect x="50" y="140" width="300" height="34" rx="8" fill="#c9a77c" {O}/><rect x="70" y="174" width="14" height="180" fill="#8d6640" {O2}/><rect x="316" y="174" width="14" height="180" fill="#8d6640" {O2}/><rect x="84" y="250" width="232" height="10" fill="#8d6640"/>')
prop("prop_clock", "prop_school", "Jam dinding", ["jam", "waktu"],
     f'<circle cx="200" cy="200" r="130" fill="#ffffff" {O}/>' + "".join(f'<path d="M{200 + 112 * __import__("math").sin(i * 0.5236):.1f} {200 - 112 * __import__("math").cos(i * 0.5236):.1f} L{200 + 124 * __import__("math").sin(i * 0.5236):.1f} {200 - 124 * __import__("math").cos(i * 0.5236):.1f}" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>' for i in range(12))
     + f'<path d="M200 200 V120" stroke="{INK}" stroke-width="9" stroke-linecap="round"/><path d="M200 200 L255 225" stroke="{INK}" stroke-width="6" stroke-linecap="round"/><circle cx="200" cy="200" r="9" fill="{INK}"/>')
prop("prop_ball", "prop_misc", "Bola", ["bola", "olahraga"],
     f'<circle cx="200" cy="200" r="120" fill="#ffffff" {O}/><path d="M200 120 L262 165 L238 238 L162 238 L138 165 Z" fill="{INK}"/><path d="M200 120 V80 M262 165 L316 148 M238 238 L274 292 M162 238 L126 292 M138 165 L84 148" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>')
prop("prop_basketball", "prop_misc", "Bola basket", ["bola", "basket", "olahraga"],
     f'<circle cx="200" cy="200" r="120" fill="#f08a24" {O}/><path d="M80 200 H320 M200 80 V320 M118 118 Q200 200 118 282 M282 118 Q200 200 282 282" fill="none" stroke="{INK}" stroke-width="5"/>')
prop("prop_mug", "prop_home", "Gelas / mug", ["gelas", "minum"],
     f'<path d="M110 130 H270 V290 Q270 340 220 340 H160 Q110 340 110 290 Z" fill="#8ecae6" {O}/><path d="M270 170 Q340 170 340 225 Q340 280 270 280" fill="none" stroke="{INK}" stroke-width="8"/><path d="M110 170 H270" stroke="#ffffff" stroke-width="10" opacity=".6"/>'
     f'<path d="M160 100 Q150 70 175 50 M205 100 Q195 70 220 50" fill="none" stroke="#cfd6e0" stroke-width="7" stroke-linecap="round"/>')
prop("prop_phone", "prop_home", "Ponsel", ["ponsel", "hp"],
     f'<rect x="130" y="50" width="140" height="300" rx="24" fill="#2a2f3a" {O}/><rect x="143" y="78" width="114" height="244" rx="6" fill="#7fb7ff"/><circle cx="200" cy="334" r="8" fill="#9aa4b2"/><rect x="180" y="62" width="40" height="6" rx="3" fill="#9aa4b2"/>')
prop("prop_plant", "prop_home", "Tanaman pot", ["tanaman", "pot"],
     f'<path d="M130 260 H270 L252 360 H148 Z" fill="#d9825b" {O}/><rect x="122" y="246" width="156" height="22" rx="6" fill="#e69a74" {O2}/>'
     f'<path d="M200 246 Q200 150 150 100 Q215 110 200 246 M200 246 Q215 130 280 90 Q240 160 200 246 M200 246 Q180 170 120 170 Q190 150 200 246" fill="#5c9e5f" {O2}/>')
prop("prop_lamp", "prop_home", "Lampu meja", ["lampu"],
     f'<path d="M110 160 L160 70 H250 L300 160 Z" fill="#f4d35e" {O}/><rect x="190" y="160" width="20" height="150" fill="#6b7280" {O2}/><ellipse cx="200" cy="330" rx="80" ry="20" fill="#6b7280" {O}/>')
prop("prop_gift", "prop_misc", "Kotak hadiah", ["hadiah", "kado"],
     f'<rect x="90" y="170" width="220" height="170" rx="8" fill="#e63946" {O}/><rect x="80" y="140" width="240" height="46" rx="8" fill="#ff6b6b" {O}/><rect x="180" y="140" width="40" height="200" fill="#ffd166"/>'
     f'<path d="M200 140 Q150 70 120 110 Q140 150 200 140 Q260 150 280 110 Q250 70 200 140" fill="#ffd166" {O2}/>')
prop("prop_umbrella", "prop_misc", "Payung", ["payung", "hujan"],
     f'<path d="M40 190 Q200 20 360 190 Q330 160 300 190 Q270 160 240 190 Q220 160 200 190 Q180 160 160 190 Q130 160 100 190 Q70 160 40 190 Z" fill="#e63946" {O}/><path d="M200 190 V330 Q200 365 165 360" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/><path d="M200 60 V190 M120 110 L160 190 M280 110 L240 190" stroke="{INK}" stroke-width="3"/>')
prop("prop_flower", "prop_misc", "Bunga", ["bunga"],
     f'<path d="M200 200 V360" stroke="#4ea85a" stroke-width="12" stroke-linecap="round"/><path d="M200 300 Q150 270 130 300 Q160 320 200 300 M200 270 Q250 240 275 268 Q245 292 200 270" fill="#5cb868" {O2}/>'
     + "".join(f'<ellipse cx="200" cy="130" rx="26" ry="52" fill="#ff8fab" {O2} transform="rotate({a} 200 170)"/>' for a in range(0, 360, 60)) + f'<circle cx="200" cy="170" r="26" fill="#ffd166" {O2}/>')

# ---------------------------------------------------------------- write ----
CATEGORIES = [
    # slug, name, kind, z_order (stacking: low = behind), sort
    ("hair_back", "Rambut belakang", "part", 1, 1), ("body", "Badan (kaki)", "part", 2, 2), ("shoes", "Sepatu", "part", 3, 14),
    ("bottom", "Bawahan", "part", 4, 13), ("torso", "Badan atas", "part", 5, 3), ("arm_l", "Lengan kiri", "part", 6, 4), ("arm_r", "Lengan kanan", "part", 6, 5),
    ("top", "Atasan", "part", 7, 12), ("bag", "Tas", "part", 8, 16),
    ("face", "Wajah", "part", 9, 6), ("hair_front", "Rambut depan", "part", 10, 7), ("hijab", "Kerudung", "part", 11, 8),
    ("eyes", "Mata", "part", 12, 9), ("brows", "Alis", "part", 13, 10), ("mouth", "Mulut", "part", 14, 11),
    ("glasses", "Kacamata", "part", 15, 17), ("hat", "Topi", "part", 16, 18), ("headphone", "Headphone", "part", 17, 19),
    ("accessory", "Aksesori", "part", 18, 15),
    ("pose", "Referensi: Pose", "reference", 0, 4), ("expression_ref", "Referensi: Ekspresi", "reference", 0, 5),
    ("bg_school", "Lokasi: Sekolah", "background", 0, 1), ("bg_home", "Lokasi: Rumah", "background", 0, 2), ("bg_outdoor", "Lokasi: Luar ruangan", "background", 0, 3),
    ("prop_school", "Properti: Sekolah", "prop", 0, 1), ("prop_home", "Properti: Rumah", "prop", 0, 2), ("prop_misc", "Properti: Lainnya", "prop", 0, 3),
]

manifest = {"categories": [dict(zip(("slug", "name", "kind", "z_order", "sort"), c)) for c in CATEGORIES], "assets": []}
for cat, key, name, tags, text in assets:
    d = os.path.join(HERE, "svg", cat)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, key + ".svg"), "w", encoding="utf-8") as f:
        f.write(text)
    manifest["assets"].append({"key": key, "category": cat, "name": name, "tags": tags, "file": f"svg/{cat}/{key}.svg"})
with open(os.path.join(HERE, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
print(len(assets), "assets")
