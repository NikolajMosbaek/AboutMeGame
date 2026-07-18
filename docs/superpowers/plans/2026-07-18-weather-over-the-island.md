# Weather Over the Island — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Right-sizing note:** executed inline by the session that wrote it (user
> directive, standing authority). Spec:
> `docs/superpowers/specs/2026-07-18-weather-over-the-island-design.md`.

**Goal:** Deterministic procedural weather — showers that dim/fog/gust the
world with a rain streak layer, dawn mist, a rain audio bed and distant
thunder.

**Architecture:** Pure `weather.ts` schedule (hash-derived, no randomness) →
thin `WeatherSystem` multiplying the frame values `DayCycleSystem`/
`EnvLightSystem` already wrote, plus small public knobs on `CloudSystem`
(`setWeatherDark`) and `WindSystem` (`setGust`). Rain visuals are one
camera-following Points layer behind a `rainDetail` tier knob; audio rides
new noise primitives on `AudioContextLike`.

## Global constraints

Zero asset bytes · JS ≤ 432 KB gz · +1 draw call max (medium/high) · rain
bed nodes exist only while raining · reduced motion: no streaks/gusts, keep
dim/fog/audio · low tier: never slower than today (`rainDetail: "none"`) ·
pure-core/thin-system, test-first, no per-frame allocation, dispose all.

## PR I — weather core + system (slices 1–2)

### Task 1: pure core `src/world/weather.ts` (+ tests)

Produces: `WeatherSnapshot { rain01, dim, fogBoost, cloudDark, gust01, heavy }`,
`weatherAt(playSeconds, seed=1): WeatherSnapshot`, `mistAt(dayPhase): number`,
`thunderTimes(showerIndex, seed): number[]` (offsets within the shower),
constants `FIRST_GAP≈240, GAP_MIN/MAX 240/420, GATHER 30, RAIN_MIN/MAX
60/150, CLEAR 20, LIGHT_CAP 0.55`. Envelope continuous (smoothstep ramps);
`dim = 0.45×rain01`, `fogBoost = 1.6×rain01`, `cloudDark = rain01`,
`gust01 = max(gatherRamp, rain01)`. Hash idiom: `hash2` from
`wildlife/geometry.ts`.

### Task 2: `src/world/WeatherSystem.ts` (+ tests) and knob seams

- `CloudSystem.setWeatherDark(d01)`: scales material color toward storm-grey
  and opacity up; test pins it.
- `WindSystem.setGust(g01)`: clock rate `1 + 1.2×g01`; test pins bounds.
- `WeatherSystem(sky, scene, dayCycle, clouds?, wind?, reducedMotion?)`:
  pause-aware clock; multiplies `sun.intensity`/`environmentIntensity`
  (values re-written upstream each frame — multiply, never accumulate);
  `fog.density = base×(1+fogBoost+mist)`; drained `justThundered()`;
  `snapshot()`; registered in `buildWorld` AFTER `EnvLightSystem`
  (GameCanvas registers EnvLight — verify actual order; weather registers
  from buildWorld after dayCycleSystem, and multiplies env intensity only
  when it diverges — confirm during implementation, keep sun+fog+clouds+gust
  authoritative).
- `World` exposes `weather: { snapshot(); justThundered() }`.

## PR II — rain streak layer (slices 3–4)

### Task 3: `src/world/rainLayer.ts` (+ tests)

~700 points, cylinder r≈18/h≈16 around origin; CPU fall at 9–13 m/s
(index-hashed), wrap to top; `setIntensity(rain01)` maps opacity 0→0.5 and
`visible=false` at 0; `follow(x, z)`; `dispose()`. `RainSystem` (same file):
reads `WeatherSystem.snapshot()`, camera position, reduced motion; gated by
new `rainDetail: "none" | "full"` in `quality.ts` (low none, m/h full) +
tier-table test pins.

## PR III — weather audio + close-out (slices 5–6)

### Task 4: noise primitives + `AudioEngine.setRainLevel/thunder` (+ tests)

`AudioContextLike` gains `createBuffer(ch, len, rate): AudioBufferLike` and
`createBufferSource(): AudioBufferSourceNodeLike { buffer; loop; start; stop;
connect; disconnect }`; both fake contexts extended. `setRainLevel(l01)`:
lazily builds noise-source→bandpass(≈2.4 kHz)→gain, ramps gain to
`l01×RAIN_MAX_GAIN`, tears down at 0. `thunder()`: noise burst through
lowpass (≈140 Hz) with ~2 s exponential decay + one 45 Hz sine sub, one-shot.

### Task 5: `AudioSystem` weather source + buildGame wiring (+ tests)

Optional param `{ rain01(): number; justThundered(): boolean }`; per frame
`setRainLevel(rain01())`, thunder on the drained edge. buildGame passes
`world.weather`.

### Task 6: docs + deploy

Run log `docs/team/runs/2026-07-18-weather-over-the-island.md`; verify
deploy; confirm live site; board issues closed.

## Self-review

Spec coverage: showers ✓(T1/T2) mist ✓(T1/T2) gusts ✓(T2) rain layer ✓(T3)
rain bed + thunder ✓(T4/T5) tier/reduced-motion gates ✓(T2/T3) docs ✓(T6).
No placeholders; names consistent (`snapshot()`, `justThundered()`,
`setGust`, `setWeatherDark`, `rainDetail`).
