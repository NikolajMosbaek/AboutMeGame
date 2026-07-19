# Darker jungle-river water (2026-07-19)

**Mode:** direct implementation (user: the water "still reads pale/white",
"Fix it"; standing decision authority) · **Branch:** `feat/darker-water`.

## Diagnosis

The pale expanse in the river/valley shots was TWO distinct things, separated
by direct scene manipulation + a terrain-height probe:

1. **Genuine water** (the lagoon lake, the carved river channel): a glossy
   `MeshStandardMaterial` (roughness 0.12) whose full-strength sky-dome IBL
   reflection (`envMapIntensity` defaulted to 1.0) washed grazing angles
   toward the bright sky, over a too-pale postcard-turquoise diffuse tone.
2. **Over-bright open TERRAIN** — the canoe-view foreground is LAND at ~11 u
   (terrain-height probe), the unshaded valley floor which AgX tone-mapping
   desaturates toward cool grey-white under full midday sun. NOT water; a
   distinct issue, deliberately left as a follow-up rather than risk a broad
   terrain-lighting change in this slice.

## What shipped (the water half)

- `WATER_ENV_INTENSITY_DETAIL = 0.35` — dims the detail-tier water's OWN
  sky reflection (a per-material scalar; terrain/flora IBL untouched). Low
  tier keeps 1.0 (byte-identical water, pinned).
- `WATER_ROUGHNESS_DETAIL` 0.12 → 0.28 — a jungle river isn't a mirror; the
  softer specular stops grazing angles glaring to a white sheet.
- Deepened detail palette: `WATER_SHALLOW_DETAIL` 0x2fb8ad → 0x1c8f86 (deep
  tropical teal), `WATER_DEEP_DETAIL` 0x0d2f38 → 0x072424 (near-black river
  green); `DEPTH_ABSORPTION_RATE` 0.4 → 0.62 so the ~2.6 m channel resolves
  strongly toward the dark tone while the shallow lagoon stays tropical.

## Verification

Screenshots (session scratchpad) confirm the lagoon reads as dark tropical
green-teal water with broken sun sparkle, and the river channel is teal —
both no longer white sheets. 1730 tests green (envMapIntensity detail/low
pins added; palette tests are relative invariants, still hold). Zero
geometry delta; bundle 407.0 KB. Low tier untouched (`wantDetail` gate).

## Follow-up (explicitly not in this slice)

The over-bright open valley-floor terrain (AgX desaturating sunlit ground) —
addressable by darkening the low-band terrain albedo/vertex colour or
extending canopy/vegetation shade along the river corridor, verified against
the whole-world exposure so shaded ground doesn't go muddy.
