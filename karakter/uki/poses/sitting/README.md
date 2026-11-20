# Uki — sitting pose references

Empat lembar sumber `_mentah/uki_duduk_[A-D].jpg` berisi referensi berdiri dan dua pose duduk per lembar.

## Generate transparent PNG references

From the repository root:

```bash
python karakter/uki/_proses/proses_duduk.py
```

The script uses Pillow and NumPy, preserves the original JPGs, and writes extracted transparent PNGs to:

`karakter/uki/poses/sitting/references/`

It also writes `pose_catalog.json` in this directory.

## Canonical pose groups

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
- Chroma-key output is an initial automated extraction. Inspect green fringes and small transparent gaps before using the PNGs in production.
- Existing standing poses and modular assets are not replaced.
- The generated PNGs are reference assets only; they are not automatically registered in the Builder library by this script.
