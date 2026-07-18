# Weather Over the Island — rain, mist, gusts and thunder

**Date:** 2026-07-18 · **Status:** approved (follow-up epic from the J1
brainstorm — "Weather & atmosphere" was the user's selected fourth immersion
direction, deferred; user directive: "Do the weather epic next, same setup") ·
**Epic size:** 6 slices, shipped as 3 PRs.

## Goal

The island gets weather: passing rain showers that dim the world, drum on the
canopy and put streaks in the air; mist that pools at dawn; wind gusts that
agitate the vegetation; distant thunder under heavy rain. Deterministic,
procedural, zero asset bytes — mood the player *feels arrive and pass*, never
a scripted cutscene.

## What ships (user-visible)

1. Every few minutes a shower builds: the light dims, fog thickens, clouds
   darken, gusts agitate the flora — then rain falls (light or heavy), then
   it clears. The first shower lands early enough that a normal expedition
   sees weather (~4–6 min in).
2. **Rain**: a camera-following streak layer (medium/high tiers), a
   filtered-noise rain bed whose level tracks intensity (all tiers), and
   world dimming (all tiers).
3. **Dawn mist**: fog density swells around dawn on every loop (fog tiers).
4. **Thunder**: distant rumbles at hash-scheduled intervals while a heavy
   shower peaks.
5. Reduced motion: no rain streaks, no gust agitation — the dimming, fog,
   and audio still carry the weather.

## Architecture (pure core + thin system, the house idiom)

### `src/world/weather.ts` — the pure core (slice 1)

- `weatherAt(playSeconds: number, seed?: number): WeatherSnapshot` — a
  deterministic schedule derived by hashing shower indices (no
  `Math.random`): clear gaps (~240–420 s, first gap shortened to ~240 s) →
  gathering (30 s ramp) → rain (60–150 s with a smooth intensity envelope;
  heavy showers reach 1.0, light cap ~0.55) → clearing (20 s ramp).
- `WeatherSnapshot = { rain01, dim, fogBoost, cloudDark, gust01, heavy }` —
  every consumer-facing factor derived from the envelope in ONE place.
- `mistAt(dayPhase: number): number` — dawn mist 0..1, peaking at the dawn
  keyframe, independent of showers (adds to `fogBoost`).
- `thunderDue(playSeconds, seed)` — hash-scheduled strike times while
  `rain01 > 0.6` on a heavy shower; the system turns them into a drained
  edge.

### `src/world/WeatherSystem.ts` — the thin applier (slice 2)

Owns a pause-aware play clock (the `BirdsSystem` own-clock convention) and
applies the snapshot each frame, AFTER `DayCycleSystem`/`EnvLightSystem` in
registration order (both write light values per frame; weather multiplies
what they wrote):

- `sky.sun.intensity *= 1 − dim` (all tiers) and
  `scene.environmentIntensity *= 1 − dim` — the world genuinely darkens.
- `sky.fog.density = FOG_DENSITY_BASE × (1 + fogBoost + mist)` (fog tiers).
- `CloudSystem.setWeatherDark(cloudDark)` — a new small public knob that
  darkens/opacifies the existing cloud material (cloud tiers).
- `WindSystem.setGust(gust01)` — the sway clock advances up to ~2.2× during
  gusts (frequency agitation: zero shader changes, reads as wind picking
  up). Reduced motion already holds the clock — gusts inherit that for free.
- Exposes `snapshot()` for audio/tests and `justThundered()` (drained edge).

### Rain streak layer — `src/world/rainLayer.ts` (slice 3)

One `THREE.Points` cloud (~700 points) in a cylinder around the camera,
CPU-advanced fall with wrap (no per-frame allocation), opacity =
`rain01 × cap`, hidden at `rain01 = 0`. Follows the camera on x/z. Gated by
a new `rainDetail: "none" | "full"` tier knob — low ships "none" (the
low-tier floor is "never slower than today"; dimming + audio still deliver
weather there), medium/high "full". Suppressed by reduced motion.

### Weather audio (slices 5–6)

`AudioContextLike` gains `createBuffer`/`createBufferSource` (the noise
primitives Web Audio needs; fakes extended). On `AudioEngine`:

- `setRainLevel(level01)`: a looped runtime-generated white-noise buffer
  through a bandpass into its own gain — created when level first rises
  above 0, torn down when it returns to 0, so the persistent-node budget is
  only borrowed while it actually rains (documented against the "≤ ~8 bed
  nodes" guideline).
- `thunder()`: a one-shot noise burst through a lowpass with a slow ~2 s
  decay plus a sub-oscillator rumble — distant, never a crack.

`AudioSystem` gains an optional weather source `{ rain01(): number;
justThundered(): boolean }` and drives both.

## Slices → PRs

| PR | Slices | Content |
|----|--------|---------|
| I  | 1–2    | Pure weather core + mist; WeatherSystem applying dim/fog/cloud/gust; CloudSystem + WindSystem knobs |
| II | 3–4    | Rain streak layer + `rainDetail` tier knob; camera-follow wiring in GameCanvas/buildWorld |
| III| 5–6    | Noise audio primitives + rain bed + thunder one-shot + AudioSystem wiring; run log; deploy |

Each PR: test-first, full gates, skeptical review pass, squash-merge.

## Budget

Zero asset bytes. JS estimate ≈ +4–6 KB gz against the 432 KB cap (32.2 KB
headroom). +1 draw call (the rain Points, medium/high only). The rain bed's
3 audio nodes exist only while raining. No new dependencies.

## Testing

Weather envelope: determinism, gap/shower alternation, first-shower timing,
envelope continuity (no steps), light-vs-heavy caps, mist peak at dawn,
thunder only during heavy peaks. System: multiply-after-write light math,
fog restore on clear, gust clock bounds, pause holds the clock, edges
drained once. Rain layer: wrap bounds, opacity tracking, reduced-motion and
tier gating, dispose. Audio: node counts, bed create/teardown at the 0
boundary, mute gate, thunder voice count.

## Out of scope

Lightning flashes (sky/postfx coupling — a follow-up slice if wanted);
wet-surface material response; puddles; weather affecting gameplay
(stamina/visibility mechanics); weather persistence across reloads.
