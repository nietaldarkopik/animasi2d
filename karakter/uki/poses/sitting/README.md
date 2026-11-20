# Uki — sitting pose references

Empat lembar sumber `_mentah/uki_duduk_[A-D].jpg` berisi referensi berdiri dan dua pose duduk per lembar.

## Generate transparent PNG references

From the repository root:

```bash
python karakter/uki/_proses/proses_duduk.py
```

The script uses Pillow and NumPy, preserves the original JPGs, and writes:
- Extracted transparent PNGs to `references/`
- Per-image extraction metadata to `pose_manifest.json`
- A checkerboard preview to `pose_contact_sheet.jpg`
- Alpha/chroma-key diagnostics to `pose_qa_report.json`

The script divides each source sheet into three equal-width panels with no overlap. It reports when foreground pixels reach a panel boundary; inspect those poses for possible clipping.

## Canonical pose groups

The hand-maintained `pose_catalog.json` is intentionally separate from the generated manifest.

| Pose ID | Reference | Alternative(s) |
|---|---|---|
| `sit_chair_neutral` | `sit_chair_neutral_a` | B, C |
| `sit_chair_lean` | `sit_chair_lean_a` | C |
| `sit_floor_crosslegged` | `sit_floor_crosslegged_b` | D |
| `sit_wide_legs` | `sit_wide_legs_d` | — |

## Important

- These are static reference poses, not a frame sequence.
- The figures are headless. A compatible head and neck anchor still need to be fitted.
- The chair is not present in the references and must be a separate prop, placed behind the body.
- Chroma-key output is an automated first pass. Inspect the contact sheet and QA report for green fringes, clipping and small transparent gaps before production use.
- Existing standing poses and modular assets are not replaced.
- The generated PNGs are reference assets only; they are not automatically registered in the Builder library by this script.
