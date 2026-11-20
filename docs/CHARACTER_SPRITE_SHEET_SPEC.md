# Character Sprite Sheet System — Technical Specification

Status: implementation baseline / v1
Repository: `nietaldarkopik/animasi2d`
Implementation branch: `feat/character-sprite-sheet-hybrid`

## Goals

- Keep the existing Character Builder as the canonical editable character source.
- Export portable reference packs for Google Flow and external character-asset workflows.
- Import a standardized animation atlas as a full character animation asset.
- Support clothing changes without changing character identity, body proportions, skeleton, or frame alignment.
- Keep PixiJS as the runtime renderer and preserve existing character versions and projects.

## Existing foundations (verified in repository)

- Character Builder stores immutable `CharacterVersion` snapshots with a version-pinned `CharacterConfig`.
- Character parts reference `LibraryAsset` IDs and hashes; archived assets remain available to old character versions.
- Existing logical character canvas is 400x800 units. Full-canvas raster parts are typically 800x1600 (2x).
- Existing design template `anime-v1` defines slot anchors and four facing values: front/right/left/back.
- Existing rig stores per-facing joints and can split body/clothing parts for bone animation.
- Existing expressions store eye, brow and mouth part variants.
- Existing frontend renderer can composite the modular character into a transparent canvas and export PNG/SVG.
- Existing character versioning is immutable.

## Architecture

Hybrid means two representations coexist:

1. **Modular source character** — body parts, face, hair, clothing, accessories, palette, expressions, rig and facing-specific assets. This remains editable in Character Builder.
2. **Animation sprite atlas** — rasterized 1024x1024 cells, grouped into atlas pages and played by PixiJS. This is a derived runtime asset, not the source of truth for the modular character.

Outfits are independent compatible assets. They must declare the character template, rig/skeleton compatibility, facing, pose/frame IDs, slot/layer mapping, anchors and source hashes. Do not assume one static clothing PNG can fit every pose.

## Frame and atlas standard

| Property | Standard |
|---|---|
| Frame canvas | 1024 x 1024 px |
| Format | PNG RGBA, transparent background |
| Color space | sRGB |
| Pivot | root/ground anchor; default (512, 1024) |
| Source character canvas | 400 x 800 logical units |
| Atlas page | 4 columns x 4 rows |
| Atlas page dimensions | 4096 x 4096 px |
| Metadata | JSON manifest |
| Runtime | PixiJS 8 |

The 1024x1024 frame is square; the full-body 1:2 character is contained and centred horizontally. Character pixels must not be stretched to fill the square. The pivot must be stored per pack and can be overridden after validation.

## Naming and metadata contract

- Character IDs are stable: `uki`, `arum`, `riska`, `seni`.
- Animation names: `idle`, `walk`, `run`, `talk`, `sit`, `gesture`, `custom`.
- Frame IDs are stable within an animation, e.g. `walk_0001`.
- Facing values: `front`, `right`, `left`, `back`.
- Outfit IDs are independent, e.g. `casual`, `hoodie`, `formal`.
- Every pack must declare format version, character/version, template, rig version, frame dimensions, pivot, atlas page layout, animations, FPS/loop, facing, outfit compatibility, asset hashes and QC results.

## Outfit compatibility

An outfit is accepted only when its compatibility metadata matches the character's:
- design template and character proportions;
- rig/skeleton version;
- facing;
- animation and frame IDs for pose-matched clothing;
- slot/layer and anchor definitions.

Two supported methods:
- **Modular outfit:** garment layers are attached to rig bones and rendered with the character.
- **Pose-matched outfit:** garment artwork is provided for each matching pose/frame ID. This is the reliable fallback for clothing generated as complete artwork by Google Flow.

A generated outfit is never automatically assumed compatible. The importer must show alignment/identity warnings and allow manual correction before approval.

## Atlas manifest contract

The importer accepts the following sidecar manifest format. Coordinates are pixel coordinates in the atlas page; each frame rectangle is exactly 1024 x 1024.

```json
{
  "format": "animasi2d.character-sprite-atlas",
  "format_version": 1,
  "character": { "id": 12, "name": "Uki", "version": 3 },
  "frame": { "width": 1024, "height": 1024, "pivot": { "x": 512, "y": 1024 } },
  "atlas": { "width": 4096, "height": 4096, "columns": 4, "rows": 4 },
  "facing": "front",
  "animations": {
    "idle": {
      "fps": 8,
      "loop": true,
      "frames": [
        { "id": "idle_0001", "x": 0, "y": 0, "width": 1024, "height": 1024 }
      ]
    }
  },
  "outfit": { "id": "base", "name": "Pakaian dasar", "type": "base" }
}
```

If no sidecar manifest is supplied, the importer creates one animation from all grid cells in row-major order. This is a convenient fallback, but it cannot infer semantic animation groups from a picture alone.

## Import validation

The importer validates:
- PNG dimensions and atlas grid divisibility;
- transparent alpha channel and non-empty frames;
- declared frame count versus available cells;
- pivot and character bounds;
- frame-to-frame root alignment;
- stable scale and facing;
- duplicate or missing frame IDs;
- manifest version and required metadata;
- outfit compatibility and missing pose frames
- RGBA PNG signature (transparent channel required)
- base/outfit relationship: an outfit variant must have a base pack first and exactly match animation IDs and ordered frame IDs, facing and pivot.

Raw single-image sprite sheets without a manifest may be imported in assisted mode: user selects cell width/height, columns/rows, animation ranges, FPS and facing. Such imports are treated as unverified until mapped and previewed.

## Current implementation status

- Character Builder now exports a 1024x1024 transparent current-facing reference PNG and a version-pinned JSON reference manifest.
- Character Builder has an Import Sprite Sheet dialog for 1024x1024 PNG atlases, grid dimensions, FPS, facing, optional atlas manifest and outfit metadata.
- Imported atlases are stored as immutable file-backed sprite-pack records with SHA-256, frame metadata and `pending_review` status.
- Outfit variants are stored as full-character pose-matched atlases (not garment-only overlays). They must match the base pack's animation and frame IDs/order and pivot. This makes whole-outfit switching possible without trying to align a separate shirt layer over an arbitrary pose.
- Imported atlases can now be previewed in Character Builder using PixiJS 8 `AnimatedSprite`; the preview reads frame rectangles, pivot, FPS and loop behavior from the manifest.
- 2.5D card exports now include complete 4×4 composite sprite-sheet pages (body pose × head expression), per-page manifests/source maps, and a Google Flow editing prompt; edited ZIP imports attach those pages as unverified sprite packs to a new card character.
- Scene-layer playback, timeline animation tracks, per-scene outfit selection, frame QC and pack version management remain subsequent phases.
- The reference-pack exporter and atlas importer are different formats and purposes: the former guides image generation; the latter describes actual animation frames.

## Storage and versioning

- Store PNG atlas pages and source reference files in file storage, not MySQL blobs.
- Store metadata, ownership, hashes, status, compatibility and QC reports in MySQL.
- Keep sprite packs immutable and link them to a specific CharacterVersion.
- New outfits or regenerated sheets create new versions; do not mutate packs used by existing episodes/projects.
- Use content hashes to avoid duplicate uploads and to detect changed files.

## Editable 2.5D character package + Google Flow sprite sheet

The 2.5D Card Character page exports a ZIP with both the original modular source and a complete composite sprite sheet:

1. Export the currently viewed immutable character version as a ZIP.
2. The ZIP contains `character.json`, all original body/head/mouth/blink PNGs under `assets/`, `sprite-sheet-index.json`, one or more composite atlas pages under `sprite-sheet/`, page manifests, and `GOOGLE-FLOW-PROMPT.txt`.
3. Each sprite-sheet cell is a complete character composition for one body-pose × head-expression combination. Every page is a 4×4 grid of 1024×1024 frames (4096×4096 PNG RGBA); combinations beyond 16 continue on another page. The page manifest maps every frame ID back to its original pose and expression IDs using `source_map`.
4. Edit only the PNG pages in Google Flow. Preserve the exact canvas size, grid, cell boundaries, character scale/position, transparent background, and identity. The supplied prompt file describes these constraints.
5. Import the edited ZIP as a new character. The original modular source is retained for the existing card rig, and each edited atlas page is automatically attached to the new character as an unverified full-character sprite pack. The source character and its versions are never overwritten.

Package format: `animasi2d.character-card-package`, version 1. Sprite atlas pages use `animasi2d.character-sprite-atlas`, version 1. Import reads only explicitly referenced, allow-listed ZIP entries and does not extract arbitrary paths. ZIP upload is limited to 50 MB, each original PNG to 10 MB, and the combined unique original asset count to 200. The server requires PHP ZipArchive and GD extensions for export.

Important: Google Flow may alter geometry or cell boundaries even when instructed not to. Imported sheets are marked `pending_review`; preview and alignment review are required before treating them as production-ready. The modular card assets remain unchanged in this first version, while the edited full-character atlas is attached as a sprite pack for preview/runtime work.

## PixiJS runtime

- Load atlas pages lazily and cache textures by immutable pack/version/hash.
- Use manifest frame rectangles, pivot, FPS, loop and animation IDs.
- Allow outfit switching only to a validated compatible outfit.
- Release textures when the pack is no longer referenced.
- Preserve the existing modular renderer and rig workflow.

## Delivery phases

1. **Reference Pack Export:** export a 1024x1024 transparent current-facing reference image and version-pinned JSON manifest from Character Builder. This is the first implementation increment.
2. **Sprite Sheet Importer:** upload a PNG atlas plus optional manifest; crop frames; validate; preview animation; save an immutable sprite pack.
3. **Pose and animation library:** define canonical pose IDs, facing and animation timelines; connect imported frames to the library.
4. **Outfit Manager:** support modular rigged clothing and pose-matched clothing sets with anchors and compatibility.
5. **Google Flow workflow:** export reference packs and prompts; import generated results; run QC and alignment review.
6. **PixiJS integration:** (a) PixiJS atlas playback preview in Character Builder; (b) connect sprite-pack references to scene layers and timeline; (c) allow validated outfit selection per scene.
7. **Story/Auto Director integration:** map shot instructions to animation IDs, pose IDs, expressions, facing and outfit.

## Non-goals for v1

- Do not replace PixiJS.
- Do not replace or flatten the Character Builder source.
- Do not claim that Google Flow guarantees pixel-perfect alignment.
- Do not auto-approve generated sheets or clothing without validation.
- Do not change existing character versions or old project assets.
