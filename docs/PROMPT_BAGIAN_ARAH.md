# Prompt bagian kepala arah kanan / kiri / belakang

Dibuat otomatis oleh `php artisan library:prompts` dari `RasterAssetGenerator::prompt()` (master art style + aturan slot).
Pakai di generator gambar Anda (hasil: PNG transparan), lalu unggah di **Library** dengan kategori yang sama dan menu **Menghadap** yang sesuai.
Ukuran bebas: otomatis dipas ke format standar slot. Ganti bagian `[EXTRA REQUIREMENTS]` untuk gaya rambut/warna lain, dan `[CHARACTER]` untuk jenis kelamin/usia.
Agar bisa ditukar otomatis saat arah karakter diganti, nama aset sebaiknya sama dengan versi depannya.

## Wajah — right

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: face shape with neck and ears, without eyes, brows or mouth
[VIEW]: side view, the character facing the viewer's right (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: bare head shape with neck and one ear, no hair, no eyes, no brows, no mouth, skin tone #f1c7a0

MODULAR ASSET RULES:
- Generate ONLY the requested face shape with neck and ears, without eyes, brows or mouth; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 170 units wide, centred at x=200, y=190 of 800; the app places every asset of this slot at the same spot, so it must replace any other face shape with neck and ears, without eyes, brows or mouth without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's right (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Wajah — left

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: face shape with neck and ears, without eyes, brows or mouth
[VIEW]: side view, the character facing the viewer's left (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: bare head shape with neck and one ear, no hair, no eyes, no brows, no mouth, skin tone #f1c7a0

MODULAR ASSET RULES:
- Generate ONLY the requested face shape with neck and ears, without eyes, brows or mouth; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 170 units wide, centred at x=200, y=190 of 800; the app places every asset of this slot at the same spot, so it must replace any other face shape with neck and ears, without eyes, brows or mouth without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's left (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Wajah — back

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: face shape with neck and ears, without eyes, brows or mouth
[VIEW]: back view (seen from behind, orthographic)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: bare head shape with neck and one ear, no hair, no eyes, no brows, no mouth, skin tone #f1c7a0

MODULAR ASSET RULES:
- Generate ONLY the requested face shape with neck and ears, without eyes, brows or mouth; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 170 units wide, centred at x=200, y=190 of 800; the app places every asset of this slot at the same spot, so it must replace any other face shape with neck and ears, without eyes, brows or mouth without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the back view (seen from behind, orthographic).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Rambut depan — right

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: front hair (bangs and side locks framing the face)
[VIEW]: side view, the character facing the viewer's right (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: short black neat side-parted hair, the front/top hair layer only

MODULAR ASSET RULES:
- Generate ONLY the requested front hair (bangs and side locks framing the face); nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 300 units wide, centred at x=200, y=150 of 800; the app places every asset of this slot at the same spot, so it must replace any other front hair (bangs and side locks framing the face) without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's right (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Rambut depan — left

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: front hair (bangs and side locks framing the face)
[VIEW]: side view, the character facing the viewer's left (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: short black neat side-parted hair, the front/top hair layer only

MODULAR ASSET RULES:
- Generate ONLY the requested front hair (bangs and side locks framing the face); nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 300 units wide, centred at x=200, y=150 of 800; the app places every asset of this slot at the same spot, so it must replace any other front hair (bangs and side locks framing the face) without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's left (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Rambut depan — back

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: front hair (bangs and side locks framing the face)
[VIEW]: back view (seen from behind, orthographic)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: short black neat side-parted hair, the front/top hair layer only

MODULAR ASSET RULES:
- Generate ONLY the requested front hair (bangs and side locks framing the face); nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 300 units wide, centred at x=200, y=150 of 800; the app places every asset of this slot at the same spot, so it must replace any other front hair (bangs and side locks framing the face) without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the back view (seen from behind, orthographic).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Rambut belakang — right

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: back hair (the part behind the head and shoulders)
[VIEW]: side view, the character facing the viewer's right (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: short black hair, the part behind the head and nape only

MODULAR ASSET RULES:
- Generate ONLY the requested back hair (the part behind the head and shoulders); nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 320 units wide, centred at x=200, y=200 of 800; the app places every asset of this slot at the same spot, so it must replace any other back hair (the part behind the head and shoulders) without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's right (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Rambut belakang — left

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: back hair (the part behind the head and shoulders)
[VIEW]: side view, the character facing the viewer's left (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: short black hair, the part behind the head and nape only

MODULAR ASSET RULES:
- Generate ONLY the requested back hair (the part behind the head and shoulders); nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 320 units wide, centred at x=200, y=200 of 800; the app places every asset of this slot at the same spot, so it must replace any other back hair (the part behind the head and shoulders) without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's left (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Rambut belakang — back

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: back hair (the part behind the head and shoulders)
[VIEW]: back view (seen from behind, orthographic)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: short black hair, the part behind the head and nape only

MODULAR ASSET RULES:
- Generate ONLY the requested back hair (the part behind the head and shoulders); nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 320 units wide, centred at x=200, y=200 of 800; the app places every asset of this slot at the same spot, so it must replace any other back hair (the part behind the head and shoulders) without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the back view (seen from behind, orthographic).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Mata — right

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: pair of eyes only
[VIEW]: side view, the character facing the viewer's right (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: one visible anime eye seen in profile, dark brown iris, no brow

MODULAR ASSET RULES:
- Generate ONLY the requested pair of eyes only; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 160 units wide, centred at x=200, y=196 of 800; the app places every asset of this slot at the same spot, so it must replace any other pair of eyes only without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's right (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Mata — left

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: pair of eyes only
[VIEW]: side view, the character facing the viewer's left (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: one visible anime eye seen in profile, dark brown iris, no brow

MODULAR ASSET RULES:
- Generate ONLY the requested pair of eyes only; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 160 units wide, centred at x=200, y=196 of 800; the app places every asset of this slot at the same spot, so it must replace any other pair of eyes only without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's left (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Alis — right

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: pair of eyebrows only
[VIEW]: side view, the character facing the viewer's right (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: one visible eyebrow seen in profile

MODULAR ASSET RULES:
- Generate ONLY the requested pair of eyebrows only; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 160 units wide, centred at x=200, y=165 of 800; the app places every asset of this slot at the same spot, so it must replace any other pair of eyebrows only without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's right (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Alis — left

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: pair of eyebrows only
[VIEW]: side view, the character facing the viewer's left (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: one visible eyebrow seen in profile

MODULAR ASSET RULES:
- Generate ONLY the requested pair of eyebrows only; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 160 units wide, centred at x=200, y=165 of 800; the app places every asset of this slot at the same spot, so it must replace any other pair of eyebrows only without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's left (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Mulut — right

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: mouth only
[VIEW]: side view, the character facing the viewer's right (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: closed neutral mouth seen in profile, just the lip line

MODULAR ASSET RULES:
- Generate ONLY the requested mouth only; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 70 units wide, centred at x=200, y=250 of 800; the app places every asset of this slot at the same spot, so it must replace any other mouth only without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's right (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```

## Mulut — left

```
MASTER ART STYLE - CONSISTENT JAPANESE ANIME

Create a professional 2D Japanese anime character illustration using a consistent, high-quality anime art style. Maintain the same visual identity across all generated characters and body parts.

Visual style:
Modern Japanese anime, clean delicate line art, smooth confident outlines, expressive anime eyes, stylized facial features, attractive anime proportions, carefully detailed hair strands, polished cel shading, soft controlled shadows, clean flat colors, smooth edges, crisp shapes, professional anime character-sheet quality. Balanced proportions, visually appealing design, consistent line weight, consistent shading technique, and harmonious color rendering.

Design rules:
- Preserve the same art style, line quality, shading, proportions, and rendering technique for every generation.
- Use clear, well-defined shapes and distinct color regions.
- Keep details clean and readable, suitable for vector conversion and 2D animation.
- Follow the specified character attributes, anatomy, clothing, colors, hairstyle, facial features, and accessories exactly.
- Do not invent additional clothing, accessories, or details that were not requested.
- When generating an individual body part, draw only the specified part while preserving the same anime design language and visual proportions as the complete character.
- For isolated assets, use a plain white or transparent background as requested, with no unnecessary objects.

Output requirements:
Clean 2D anime illustration, animation-asset-friendly design, sharp outlines, no text, no watermark, no photorealism, no 3D rendering, no Western cartoon style, no chibi style, no sketchy unfinished lines, no inconsistent proportions, no excessive gradients, and no unnecessary background elements.

CUSTOM PARAMETERS:
[CHARACTER]: male, teenager, slim
[POSE]: neutral standing pose
[BODY PART]: mouth only
[VIEW]: side view, the character facing the viewer's left (orthographic profile)
[BACKGROUND]: transparent
[EXTRA REQUIREMENTS]: closed neutral mouth seen in profile, just the lip line

MODULAR ASSET RULES:
- Generate ONLY the requested mouth only; nothing else.
- This part belongs to a fixed character template (a 400x800 full-body canvas). Its standard size is about 70 units wide, centred at x=200, y=250 of 800; the app places every asset of this slot at the same spot, so it must replace any other mouth only without resizing.
- Draw it exactly as it would sit on the full character, same scale and angle as the complete character in the side view, the character facing the viewer's left (orthographic profile).
- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.
- Genuine transparent alpha background, not black, white, or checkerboard pixels.
- Keep outline weight, shading, highlights, and color treatment identical across all assets.

OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D character builder.
```
