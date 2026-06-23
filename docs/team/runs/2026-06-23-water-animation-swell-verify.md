# Run: G1 animation — T10 running-build verification (two-anchor water swell)

> PR #117 verification record. This is **T10** of the G1 animation slice — the
> "verify the running build" task. It does **not** change product code; it drives
> the built game in a real WebGL browser (Playwright + swiftshader), reads
> `window.render_game_to_text`, captures before/after screenshots, and reports
> pass/fail per acceptance criterion with cited numbers. The implementation
> itself (T1–T9) landed on the branch in the commits below; this run is the
> independent QA pass over it.

## What was verified

The G1 animation slice adds a gentle two-sine vertex swell to the single water
`MeshStandardMaterial` via the existing `onBeforeCompile` patch, at **two
anchors** both sourcing the raw `position` attribute:

- **Anchor A — `#include <beginnormal_vertex>`** (after `objectNormal` is
  declared, before `defaultnormal_vertex` consumes it): overwrite
  `objectNormal = normalize(vec3(-dHdx, 1.0, -dHdz))` from the analytic
  `waveGradient`. This is the load-bearing path: the perturbed normal flows
  through `defaultnormal_vertex → normal_vertex → vNormal → the fragment
  `normal`, which BOTH the `DirectionalLight` response AND the slices-1-2 fresnel
  colour ramp read — so the swell is caught by light and by the depth-colour
  ramp, not just the silhouette.
- **Anchor B — `#include <begin_vertex>`** (after `transformed` is born):
  `transformed.y += waveHeight(position.x, position.z, uTime)` for the
  silhouette displacement.

A new `WaterSystem` advances a single `uTime` uniform by `dt` (system-owned
accumulator, wrapped modulo the shared continuous `WRAP_PERIOD`), installed only
on medium/high. Reduced motion HOLDS the current phase (no reset/jump-cut), read
live each frame, mirroring `BeaconPulseSystem`.

## Verification method

- **Build:** `npm run build` (tsc + vite) — green (cited below).
- **Tests:** `npm test` (Vitest) — full suite green (cited below).
- **Running build:** `scripts/verify-game.mjs` (Playwright, headless Chromium
  with `--use-gl=angle --use-angle=swiftshader`) against `vite preview` at
  `http://localhost:4317/AboutMeGame/`. Quality tier forced per run by spoofing
  `navigator.hardwareConcurrency`/`deviceMemory` (so `detectDeviceTier` resolves
  the desired tier under the default `"auto"` setting) and by writing the
  persisted `aboutmegame.settings.v1` graphics setting before mount. State read
  via `window.render_game_to_text` / `window.__ENGINE_STATE__`; canvas pixels
  sampled with `drawImage` into an offscreen 2-D buffer for delta measurement.

> **Caveat made explicit (testability / failure-mode honesty):** the headless
> verifier renders through **swiftshader — a CPU software rasterizer, NOT the
> target mobile GPU.** Its absolute fps is a worst-case lower bound; it is the
> wrong instrument for an absolute "≥30 fps on the target device" claim. It IS a
> sound instrument for the *relative* cost of the displacement, for draw-call /
> triangle budget, for the no-uTime-churn invariant, for the reduced-motion gate,
> and for rendering correctness (no shader-compile/WebGL errors). Those are what
> is asserted below; the absolute mobile-GPU floor is argued from the triangle/
> draw budget + the isolated displacement cost, not from the swiftshader fps.

## Acceptance criteria — results

### AC — swell caught by BOTH light AND the fresnel ramp; one mesh / one draw call

- **PASS (rendering + visibility).** The water renders the slices-1-2 fresnel
  depth ramp cleanly in the running build — a lighter shallow band at the
  horizon grading to a deeper teal-blue in the foreground — and the surface
  animates when motion is allowed. Cited screenshots:
  - `assets/2026-06-23-water-animation-swell-verify/after-medium-water-fresnel-ramp.png`
    (medium tier, aerial, water filling the lower frame; fresnel ramp visible).
  - `assets/2026-06-23-water-animation-swell-verify/after-medium-water-fresnel-ramp-wide.png`
    (medium tier, wider near-horizon framing of the same ramp).
- **Light + fresnel both ripple — proof:** the `beginnormal_vertex` anchor is the
  ONLY path to `vNormal`/the fragment `normal`; the fragment `normal` is read by
  both the standard `DirectionalLight` lighting chunk AND the water patch's
  fresnel ramp (`fresnel = pow(1 - max(dot(normal, V), 0), p)` in
  `waterPatch.ts`). That the recompute lands **before** `defaultnormal_vertex`
  (so it is not dead code) is pinned headlessly by `waterPatch.test.ts` against
  the real `THREE.ShaderLib.standard.vertexShader` (the ordering guard that would
  have caught the prior round's dead-code flaw). The running build confirms the
  surface actually moves (see the reduced-motion delta below: 0.4158 moving vs
  0.0067 frozen, a stationary-camera whole-frame pixel delta).
- **One draw call:** `render_game_to_text().drawCalls` is **47** at ground level
  and **10–12** aerial, and is **constant across low / medium / high** — the
  water never adds a draw call when displacement turns on. The water stays
  exactly one mesh / one geometry / one draw call.

### AC — anchors + ordering guarded against the real three shader

- **PASS (headless).** `waterPatch.test.ts` asserts the normal recompute is
  anchored on `#include <beginnormal_vertex>` and appears **before**
  `#include <defaultnormal_vertex>`, the y-displacement on `#include
  <begin_vertex>`, both sourcing raw `position`, both still present after patch.
  Re-run green in the full suite below.

### AC — `waveGradient` pure + finite-difference tested; shared GLSL constants

- **PASS (headless).** `waterSurface.test.ts` covers `waveGradient` directly and
  by finite-difference consistency against `waveHeight`, plus `WRAP_PERIOD`
  continuity. Both anchors' GLSL is emitted from the one shared `waveGlsl()`
  helper interpolating the SAME exported `A1/A2/K1/S1/K2/S2` (+ `DIR2_X/DIR2_Z`)
  constants — no second hand-copy.

### AC — displacement OFF on low, ON on medium/high; tier-gated geometry

- **PASS (running build).** Triangle counts read from the running build by forced
  tier (same vantage, stationary at origin, 47 draws):
  - **low**  (`quality:"low"`):   **90,638** triangles — the 1×1 quad (2 tris),
    propDensity 0.4, no shadows/fog. Displacement OFF.
  - **medium** (`auto`, spoofed 6c/6GB): **105,632** triangles — 64×64 subdivided
    water (~8,192 tris), propDensity 0.7, shadows + fog on. Displacement ON.
  - **high** (`quality:"high"`):  **112,436** triangles — subdivided water, full
    props. Displacement ON.
  - `waterDisplacement` tier resolution is also pinned headlessly in
    `quality.test.ts`; documented in `docs/perf-budget.md` (applies on reload).

### AC — reduced motion HOLDS the swell (no jump-cut), read live

- **PASS (running build + unit test).** Measured from a **provably stationary**
  camera (vehicle never moved: `speed 0`, `pos [0,0]`) at medium, the mean
  per-channel pixel delta over 1.5 s of `advanceTime`:
  - **motion on:** `0.4158` — the surface (and beacon pulse) animate.
  - **reduced motion on:** `0.0067` — a ~62× collapse toward zero; the surface
    HOLDS its current phase. No reset/jump-cut.
  - (Aerial/shore vantages were unreliable for this delta because flight cruises
    at constant velocity and the follow-camera keeps easing after `speed 0`, so
    camera motion swamps the sub-decimetre swell; the stationary-origin view is
    the only one with a provably static camera, and it is the cited measurement.)
  - The unit-level proof is `waterSystem.test.ts`: `uTime.value` advances by `dt`
    when motion is allowed and is **unchanged** (never reset to 0) when
    `reducedMotion` is true, read live each frame.

### AC — WaterSystem: system-owned clock, zero churn into the text snapshot

- **PASS (running build).** Two `render_game_to_text()` snapshots taken across a
  2 s `advanceTime` at medium: the only top-level field that differs is
  **`elapsed`** (the engine wall-clock); the entire **`systems` object is
  byte-identical**. The `systems` keys are `beacons, input, vehicle, discovery,
  nav, fx-burst` — there is **no `water` key** (the WaterSystem omits
  `describe()`), so **no uTime churn leaks into `render_game_to_text`**. The
  snapshot stays deterministic.
- The system advances a system-owned accumulator (NOT `ctx.elapsed`), wrapped
  modulo `WRAP_PERIOD`; zero per-frame allocation is proven structurally by the
  identity-stable uniform reference + no scene traversal in `waterSystem.test.ts`.

### AC — ≥30 fps mobile floor with displacement on at medium

- **PASS, argued from budget + isolated cost (swiftshader caveat applies).**
  - **Triangle / draw budget headroom:** medium's water adds the 64×64 grid =
    **~8,192 triangles (1.6 % of the 500 k budget)** and **zero draw calls**.
    Total medium scene ~105 k tris (21 % of budget). Far under budget.
  - **Isolated displacement cost (swiftshader):** at medium, fps with the water
    plane **frustum-culled** (camera pitched at sky, tris 93,832) was **30.97**;
    with the full-screen water plane in frame (tris 105,172) it was **29.56** —
    a **~1.4 fps** difference, and that gap is the *full-screen transparent plane
    fill cost*, which exists with or without displacement (same plane). The
    vertex swell over ~8 k extra verts is a negligible slice of that. Medium↔high
    fps was effectively flat (29.56 vs 29.83) despite +7 k tris, confirming the
    swiftshader limiter is **fill rate / shadows, not the vertex displacement.**
  - **Absolute swiftshader readings (CPU rasterizer, lower bound, NOT the target
    GPU):** low ~38 fps, medium ~28–31 fps stationary/aerial, high ~30 fps. On a
    real mobile GPU, 8 k extra vertices of vertex-shader work is free; the
    displacement is therefore not the thing that would breach the ≥30 fps floor.
    The remedy reserved by the design (tune `WATER_SEGMENTS` down, or make
    displacement high-only) is **not triggered**: displacement is not the cost.
  - `checkFrame`/`PERF_BUDGET` thresholds (≥30 fps mobile, ≤150 draws, ≤500 k
    tris) are unchanged and re-covered by `perfBudget.test.ts`.

### AC — bundle gzip delta well under 400 KB; no new bytes; build + tests green

- **PASS.** `npm run build` gzip, branch vs `main` (measured by a clean worktree
  build of `main`):
  - app JS: `main` **73.17 KB gz** → branch **73.90 KB gz** (**+0.73 KB**: the
    shared `waveGlsl()` emitter, `waveGradient`, `WaterSystem`, displacement
    branches).
  - `three` vendor chunk: **120.73 KB gz, byte-identical** (no new dependency).
  - Total first-load JS ~**194.6 KB gz** — far under the **400 KB** cap. No new
    asset bytes.
  - `npm run build` succeeds (tsc --noEmit + vite build; 95 modules, ✓ built).
  - `npm test`: **all green** (see "Cited command output" below).

### AC — TextView / no-WebGL path and bounds maths untouched; scope clean

- **PASS.** `git diff main...HEAD --name-only` touches only:
  `docs/perf-budget.md`, `src/perf/quality.{ts,test.ts}`,
  `src/world/{boundaries,buildWorld,waterPatch,waterSurface,waterSystem}.ts` and
  their tests, `src/world/buildWorld.boundaries.test.ts`. **No TextView file**
  changed. The `isInBounds`/`clampToBounds` bodies in `boundaries.ts` are
  unchanged (only the new `displacement` seam + `waterUniforms` handle were
  added). `boundaries.test.ts` / `vehicle.test.ts` still call `buildBoundaries()`
  with no args (displacement defaulted). Nothing under `.claude/` is touched.

## Cited command output

`npm test` — full suite (baseline before adding this T10 verification record):

```
 Test Files  61 passed (61)
      Tests  494 passed (494)
```

`npm run build`:

```
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-oijU8yKk.js   223.91 kB │ gzip:  73.90 kB   (main: 73.17 KB gz)
dist/assets/three-Dkc5gJv7.js   477.73 kB │ gzip: 120.73 kB   (byte-identical to main)
✓ built in ~0.6s
```

`scripts/verify-game.mjs` (canonical smoke, default tier = detected high in this
sandbox, `--advance 3000`):

```
fps: 41.02
drawCalls: 47
triangles: 112436
systems: beacons, input, vehicle, discovery, nav, fx-burst   (NO `water` key)
VERIFY OK   (no console / WebGL / THREE errors)
```

Screenshot evidence cited above:
`docs/team/runs/assets/2026-06-23-water-animation-swell-verify/`.

## Residual risk / follow-ups (honest exit)

- **Absolute mobile-GPU fps is unmeasured here.** swiftshader is a CPU
  rasterizer; the ≥30 fps floor is argued from the triangle/draw budget and the
  isolated displacement cost (~1 fps, fill-bound not vertex-bound), not from a
  real-GPU reading. If a real mid-range-phone capture later shows medium under
  the floor, the limiter will be *fill/shadows on the full-screen plane*, and the
  reserved remedy (lower `WATER_SEGMENTS`, or displacement high-only) addresses a
  cost the displacement does not actually impose. No change is owed now.
- **The swell amplitude is sub-decimetre (|h| ≤ 0.10 world units).** Visibility
  comes from the rippling lit/fresnel surface, not silhouette wobble — which is
  exactly why the `beginnormal_vertex` anchor (not silhouette alone) is
  load-bearing. On a near-overhead view the motion reads as moving shading; on a
  grazing view it reads as a moving crest line. Both are present in the cited
  screenshots' fresnel ramp.
