# W1 — Weather Over the Island (#225)

**Date:** 2026-07-18 · **Mode:** direct implementation ("same setup" user
directive; standing decision authority) · **Spec/plan:**
`docs/superpowers/{specs,plans}/2026-07-18-weather-over-the-island*` ·
**PRs:** #229 (core + system + knobs), #230 (rain layer), #231 (audio).

## What shipped

- **Pure schedule** (`world/weather.ts`): hash-derived showers (first ~4½ min
  in), gather phase where gusts lead, light/heavy envelope, clearing tail,
  dawn mist, thunder times. All factors derive from one envelope.
- **`WeatherSystem`**: MULTIPLIES the day cycle's fresh per-frame sun + fog
  writes (registered dayCycle → weather → underwater, so the slice-5 haze and
  the absolute submerged fog stay authoritative). Knobs:
  `CloudSystem.setWeatherDark`, `WindSystem.setGust` (clock ≤ 2.2×).
  `EnvLightSystem` dims its own writes (dynamic, bake, AND static low-tier
  path — on low, dimming is the weather).
- **Rain streaks** (`world/rainLayer.ts`): ~700 hashed points around the
  camera, CPU fall + wrap, envelope-tracked opacity; `rainDetail` tier knob
  (low: none); reduced-motion suppressed.
- **Audio**: `AudioContextLike` gains buffer/noise primitives; `setRainLevel`
  (3-node looped-noise bed that exists only while raining), `thunder()`
  (lowpassed noise burst + 45 Hz sub); driven from `AudioSystem` via the
  weather snapshot + drained thunder edge.

## Review findings (fixed + pinned)

PR I: fog stomps (day-cycle haze, underwater), un-dimmed env on rebake/low
tier, discontinuous gusts, missing real-knob pins, honest cloud-opacity scope
cut. PR III findings in its PR.

## Verification

Per PR: full suite, build, bundle budget, lint, Playwright render gate — all
green before merge; deploy verified after the final merge. Epic cost ≈ +1.7 KB
gz, zero asset bytes, +1 draw call (medium/high).
