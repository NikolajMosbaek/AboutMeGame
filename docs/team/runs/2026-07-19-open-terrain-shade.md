# Open valley-floor deepening — kill the pale grey-white wash (2026-07-19)

**Mode:** direct implementation (standing decision authority; the recorded
follow-up from PR #241, `2026-07-19-darker-water.md`) · **Branch:**
`feat/open-terrain-shade`.

## Diagnosis (confirmed, not re-derived)

At noon `dayCycle` drives sun 1.6 + env IBL 1.0 onto the low-band jungle-floor
vertex colour `0x3f6b33` (`terrain.ts` `colorForHeight`, the `y < 12` band).
Ground UNDER canopy is saved by `canopyShade.ts` — a build-time vertex-colour
darkening keyed to crown coverage. The OPEN river-corridor / clearing floor has
zero crown coverage, so it gets no shade term, renders full-bright, and AgX
tone-mapping desaturates the bright green toward a pale grey-white sheet.

A terrain-height probe (`buildTerrain().heightAt`) put the open valley floor at
`y ≈ 8–12` — a `landBase + relief` plateau sitting right at the TOP of the
jungle-floor band, exactly where the wash lives.

## Lever

Generalize the shade mechanism with its exact complement, in `canopyShade.ts`:
`applyOpenFloorShade` deepens the OPEN low-band floor toward a richer, lusher
jungle green, keyed to `openness = 1 − canopyCoverage` (reusing the SAME
`coverageGrid`, not rebuilt). By construction it fades to zero where
`applyCanopyShade` is already working, so it can never further muddy shaded
ground. A `lowBandWeight(y)` confines it to the jungle-floor band (`0.7 < y < 12`,
mirroring `colorForHeight`) with a gentle ramp off the waterline mud and a SHORT
(0.8 u) ramp into the deep-jungle band — deliberately short, because the wash
plateau reaches y ≈ 11–12 and the deepened floor lands close to the (already
darker) deep-jungle colour, so the join reads continuous. Green-biased
(`[0.4, 0.28, 0.44]` red/green/blue × `openness × band`, `OPEN_FLOOR_MAX = 0.28`)
so red and blue drop more than green — lush, not muddy. Build-time, every tier
(low's terrain look IS its vertex colours; medium/high multiply vColor into the
splatted albedo), zero per-frame cost, zero draw calls, zero geometry delta.

## Verification (running build, player view, multiple times of day)

Playwright + `__frameView__`, high AND low tiers, NOON (t=0.25 → advanceTime
45000) and GOLDEN dusk (t=0.5 → 90000), 8 s flora-GLB settle. Cameras placed
ABOVE probed ground heights (an early underground vantage produced a fog/backface
grey artifact that was mistaken for the wash — corrected).

- **Open corridor floor (valley top-down), noon:** the open ground strip flips
  from a pale washed olive-grey to a deep, saturated jungle green; canopy crowns
  and the waterline-mud checkerboard unchanged. `before/after_noon_valley-topdown.png`.
- **Canopied control (inland), noon:** byte-identical, full-frame mean green
  delta = 0.0 — the `(1 − coverage)` keying proven. `after_noon_canopied-inland.png`.
- **Golden dusk:** all vantages move ≤ 1 green level — already-shaded ground did
  NOT go muddy at low sun.
- **Low tier:** open floor reads as healthy deep green, not over-darkened / night.

Screenshots: session scratchpad `final/` (clean above-ground before/after set)
and `shots2/valley-topdown` (the clearest open-floor read).

## Gates

1739 tests pass | 1 skipped (9 new: `lowBandWeight` band membership + monotone
edges; `applyOpenFloorShade` deepening, green-bias, band exclusion, `(1−coverage)`
keying, monotonicity, composition with `applyCanopyShade`, version bump). Build
(tsc + vite) green, lint green. Frame cost high tier: 121 draws / 485 k tris
(budget 150 / 500 k) — unchanged; CPU vertex-colour bake adds no geometry.

## Risk for the reviewer

The magnitude (`OPEN_FLOOR_MAX = 0.28`, green-bias vector, `EDGE_HIGH = 0.8`) is
eye-tuned against noon+golden on high+low. The band top edge deliberately runs
near full strength up to y = 12 to catch the y ≈ 11 plateau; the seam into the
deep-jungle band reads continuous because the deepened floor ≈ deep-jungle
colour, but that is the one place to eyeball if the join ever looks stepped.
