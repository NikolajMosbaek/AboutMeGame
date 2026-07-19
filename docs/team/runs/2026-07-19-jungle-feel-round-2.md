# Jungle feel, round 2 — "Still doesn't feel like a jungle" (2026-07-19)

**Mode:** direct implementation (user verdict after the density epic;
standing decision authority) · **Branch:** `feat/jungle-feel`.

## Diagnosis (walked the player's ACTUAL first minutes this time)

The density epic fixed instance counts; the feel failures were elsewhere,
visible in four screenshots of the spawn walk:

1. **A color-space bug** (found by the graphics consult, ranked above
   everything): `process-models.mjs`'s material-mode bake wrote the recolor
   map's sRGB bytes raw into `COLOR_0`, which three treats as linear — all
   flora rendered ONE GAMMA TOO BRIGHT. `#4a7d3f` jungle green displayed as
   ≈`#93ba88` mint; `#5c4430` trunk brown as pale beige. The texture-mode
   bake had already fixed this exact bug for the object kits. This was the
   "pastel orchard".
2. **White-out atmosphere**: every keyframe's fog/horizon was bright
   neutral; fog, the water's fresnel reflection AND the baked environment
   light read the same values — one hue is the whole island's air.
3. **The spawn lawn**: blanket 18 u/10 u vegetation clearances left ~1,000
   m² of bare ground as the first thing every player sees.
4. **Orchard-height trees**.

## What shipped

- `srgbToLinear` on the recolor tuples; flora GLBs re-baked (7 binaries,
  same sizes, zero new bytes).
- Humid haze: NOON `#cfe4f2`→`#c6dcc2`, EVENING `#b9c3d6`→`#adbfad`
  (domeBottom + fogColor together; `SKY_BOTTOM` matched; dawn/golden drama
  untouched; density untouched — the hue was the problem).
- The lawn: per-category clearances (trees keep the camp's 18 u sky
  opening; understory hugs 9 u, rocks 12 u, grass 7 u), grass spawn-bowl
  bias (~2.4× concentration inside 60 u at zero triangle delta), leaf
  litter down to the valley floor (`LITTER_MID` 9, mottle 0.6), floor shade
  `SHADE_MAX` 0.24.
- Valley canopy 10.3–17.2 u + 8% emergent giants (19.6–23.5 u) — uniform
  scale, zero triangle delta. Low tier untouched on every axis.

## Verification

Spawn high-tier frame cost 485,134 (vs 485,582 before — unchanged, as
predicted for uniform scaling). 1729 tests green (clearance/grass contracts
re-pinned two-sided). Before/after player-path screenshots archived in the
session scratchpad — the camp-inland view goes from "golf course with a
pastel backdrop" to saturated jungle with brush at the clearing edge.
Graphics-review verification pass + CI + deploy on the PR.
