# Run: G1 slice 2 — static depth-shaded water + shoreline foam (onBeforeCompile wiring)

> PR #116 contract update. This run wires the slice-1 `waterSurface.ts` math
> into the live water material via `material.onBeforeCompile`, with **no
> animation** (slice 3 adds `uTime`) and **no quality-tier gating** (slice 4).

## Feature

G1 (water) slice 2: patch the existing single water `MeshStandardMaterial` in
`src/world/boundaries.ts` via `material.onBeforeCompile`, with
`src/world/waterSurface.ts` as the single source of truth for palette and foam
math. The flat plane gains (a) a **view-angle fresnel two-tone colour ramp**
blending `WATER_SHALLOW`→`WATER_DEEP`, and (b) a **soft shoreline foam collar**
driven by real `seaLevel - groundHeight` depth sampled from a build-time baked
ground-height `DataTexture`. One plane, one draw call, triangles ±0, no `uTime`,
no quality-tier gating. The non-WebGL TextView and the bounds maths
(`isInBounds`/`clampToBounds`) are untouched.

## Acceptance Criteria

- **AC1:** `boundaries.ts` imports `WATER_SHALLOW`/`WATER_DEEP`/`FOAM_DEPTH_START`/
  `FOAM_DEPTH_END`/`shorelineFoam` from `waterSurface.ts` and uses them as the
  single source of truth (constants injected as uniforms; foam math transcribed
  line-for-line). A headless grep guard asserts NO re-declared palette hex
  (`0x2e6f9e`/`0x193d57`) and no inline foam-edge literals in `boundaries.ts`/GLSL.
- **AC2:** across the visible water surface the colour reads with view-angle
  (fresnel) variation — a blend between lighter `WATER_SHALLOW` and darker
  `WATER_DEEP`, not a single flat tone — verified against the running build with
  cited before/after screenshots (wide framing showing the near-to-horizon
  gradient).
- **AC3:** a soft, feathered foam band reads where water meets land, hugging the
  island's actual irregular coastline (driven by `seaLevel - groundHeight` via
  the baked `DataTexture`, NOT a radial circle), confirmed visually with a cited
  from-inside-looking-out near-shore screenshot; the foam is a tone-mapped
  off-white, not a clipped pure-white rim.
- **AC4:** no animation — no `uTime`/wave displacement, `waveHeight` unimported,
  the surface holds still, the water plane geometry is unchanged.
- **AC5:** the water stays exactly one mesh / one draw call, triangles ±0; the
  gzip bundle delta is reported from `vite build` and stays well under the 400 KB
  cap (no new dependency/asset bytes; delta = shader strings + the now-imported
  `waterSurface.ts`); `StatsOverlay`/`checkFrame` stay green at ≥30 fps on the
  target-device profile.
- **AC6:** the `DataTexture` and any uniform-holding resources are disposed in
  `Boundaries.dispose()` alongside `waterGeo`/`waterMat`; no per-frame allocation
  and no per-frame update callback is introduced.
- **AC7:** the non-WebGL TextView path and the boundaries bounds maths
  (`isInBounds`/`clampToBounds`) are unchanged; existing `boundaries.test.ts` and
  `vehicle.test.ts` call `buildBoundaries()` with no args and stay green; the
  full suite passes via `npm test` (cited) and `npm run build` succeeds.
- **AC8:** the `heightAt`-absent path is safe — the no-foam GLSL variant (via a
  compile-time `#define HAS_FOAM`) references no sampler/uniform, produces no
  three warning/error, and is covered by the headless `onBeforeCompile` test
  alongside the with-foam variant; `customProgramCacheKey` disambiguates both
  water variants from terrain/props programs.
- **AC9:** the GLSL transcription is guarded headlessly by invoking
  `onBeforeCompile` against the real `THREE.ShaderLib`/`ShaderChunk` source (not a
  stub) and asserting the injected anchors + imported palette/foam constants are
  present in both variants; the colour-space handling (sRGB→linear before the mix)
  is stated and applied.
- **AC10:** the `waterSurface.test.ts` tree-shaking guard is intentionally
  flipped to a positive "`boundaries.ts` imports and uses `waterSurface`"
  assertion, called out as a deliberate contract change; all changes stay within
  `src/` and `docs/` with nothing under `.claude/` created, edited, or deleted.

## Roundtable Positions

- **Product Owner** (high) — Approve as the top backlog G1 item, slice 2. Slice 1
  shipped the pure math; this slice is the visible payoff: the world's single
  largest surface stops reading as dead. Hard fence: this slice adds the static
  look ONLY — no `uTime`, no `WaterSystem`, no quality-tier branch (those are
  slices 3–4). The two palette blues stay the single source of truth in
  `waterSurface.ts`; `boundaries.ts` must not re-declare a hex. The two visual ACs
  (depth gradient, foam collar) are the bar — they are screenshot-confirmed, not
  asserted by green unit tests alone.
- **product-frontend** (high) — Support, but the seam matters. `buildBoundaries`
  takes `heightAt` as an OPTIONAL DI parameter — never a module-level
  singleton/global — so `boundaries.test.ts`/`vehicle.test.ts`/preview-without-
  terrain keep calling `buildBoundaries()` byte-for-byte. Hard objection to a
  perfect-circle foam ring: it would read as a fake decal stuck on the water; foam
  MUST follow the real irregular coastline. Hard objection to washed-out blue —
  the palette is sRGB-authored and must be gamma-decoded to linear before the
  GLSL `mix`, or the in-build look is muddy.
- **Senior Systems/Backend Engineer** (high) — Ship one patched material, not a
  second mesh / ShaderMaterial / EffectComposer. The ground-height lookup is baked
  ONCE at build time from the DI'd `heightAt` into a 128×128 single-channel
  `DataTexture` (~64 KB VRAM, 0 download/bundle bytes, 0 draw calls, 0 triangles)
  — re-deriving the FBM in GLSL would duplicate terrain math and is a worse
  single-source violation. The `DataTexture` and uniform-holding objects are
  created once and disposed in `dispose()`; zero per-frame allocation. Hard line:
  the no-`heightAt` path must reference NO sampler at all — gate foam behind a
  compile-time `#define HAS_FOAM`, never a runtime null-sampler bind.
- **Senior 3D Graphics Engineer** (high) — Owns the GLSL transcription. Drive the
  across-surface two-tone gradient from the **view-angle fresnel term ALONE**:
  `fresnel = pow(1.0 - max(dot(N,V),0.0), p)` with `p≈3.5` (the ONE art tunable
  the patch owns — not a palette/foam constant, so AC1 holds), then
  `mix(uWaterShallow, uWaterDeep, clamp(fresnel,0,1))`, mirroring `waterColor()`
  line-for-line. **Do NOT** normalize raw `seaLevel - groundHeight` to blend the
  colour: over open water depth ≈ 11 (`landBase − shoreDrop = 3 − 14 = −11`), so
  any normalization near `FOAM_DEPTH_END = 1.5` saturates the whole surface to
  flat `WATER_DEEP` — the exact flat tone AC2 forbids. Foam stays in its native
  `[FOAM_DEPTH_START, FOAM_DEPTH_END]` depth band: `1 - smoothstep(uFoamStart,
  uFoamEnd, depth)`, soft tone-mapped off-white, never clipped pure white. Keep
  it `mediump`, branch-free; `customProgramCacheKey` returns distinct constant
  strings for the foam and no-foam variants so the patched water program never
  collides with terrain/props `MeshStandard` programs.
- **senior-sound-engineer** (high) — Zero coupling from the audio chair; no
  `src/audio/`/`src/engine/` touch, gzip-negligible. No objection. On the record:
  if water ever becomes audible it must be SYNTHESISED, never a downloaded loop.
- **Senior Quality Engineer** (high) — Endorse with the verification pinned. The
  GLSL marker test must invoke `onBeforeCompile` against the REAL three
  `ShaderLib`/`ShaderChunk` source (not a fabricated stub) so a three-version
  chunk rename actually goes red — and it must exercise BOTH the foam and no-foam
  variants. The AC1 grep guard must positively assert `boundaries.ts` imports AND
  uses the symbols, with NO re-declared hex/foam literal. The tree-shaking guard
  flip (`waterSurface.test.ts`) is a NAMED contract change for PR #116, not an
  incidental defeat of a guard. The two visual ACs are confirmable ONLY via the
  Playwright smoke verifier / `render_game_to_text` with cited before/after
  screenshots — green unit tests are necessary but not sufficient.

## Consensus Design

Patch the existing single water `MeshStandardMaterial` in `boundaries.ts` via
`material.onBeforeCompile`. One `PlaneGeometry`, one mesh, one draw call,
triangles ±0; no second mesh, no `ShaderMaterial`, no `EffectComposer`, no
`uTime`. `waterSurface.ts` is the single source of truth for palette and foam
math; the GLSL `mix`/foam mirror the JS line-for-line.

**Decisions:**

1. **Single patched material.** Patch the existing water `MeshStandardMaterial`
   via `material.onBeforeCompile` — keep one `PlaneGeometry`, one mesh, one draw
   call, triangles ±0; no new geometry, no second mesh, no `ShaderMaterial`, no
   `EffectComposer`.
2. **Single source of truth.** Import `WATER_SHALLOW`/`WATER_DEEP`/
   `FOAM_DEPTH_START`/`FOAM_DEPTH_END`/`shorelineFoam` from `waterSurface.ts` and
   feed the constants in as uniforms; the GLSL `mix`/foam mirror the JS
   line-for-line. No re-declared hex (`0x2e6f9e`/`0x193d57`) and no duplicated
   foam smoothstep literals in `boundaries.ts` or GLSL.
3. **Fresnel-driven two-tone.** Drive the across-surface gradient from the
   view-angle fresnel term ALONE: `fresnel = pow(1 - max(dot(N,V),0), p)`, `p≈3.5`
   mixing `uWaterShallow`→`uWaterDeep`, exactly as `waterColor()`'s jsdoc intends.
   `p` is the single art tunable the patch owns (not a palette/foam constant), so
   AC1 holds.
4. **No raw-depth colour blend.** Do NOT use raw `seaLevel - groundHeight` depth
   to blend colour. Over open water depth ≈ 11; normalizing near
   `FOAM_DEPTH_END = 1.5` would saturate the whole surface to flat `WATER_DEEP`
   (the flaw AC2 forbids). Confining depth to the foam band's native
   `[FOAM_DEPTH_START, FOAM_DEPTH_END]` domain needs NO new normalization scale
   and NO magic number — resolving the Quality material flaw without extending
   `waterSurface.ts`.
5. **Foam follows the real coastline.** Foam is driven by `depth = seaLevel -
   groundHeight` (the real, irregular coastline), never the radial
   `coastRadius`/`islandRadius` bands — per the module jsdoc, AC3, and the UX hard
   objection (a perfect-circle ring would read as a fake decal).
6. **Baked ground-height texture.** Supply per-fragment ground height by baking a
   128×128 single-channel `THREE.DataTexture` once at build time from the DI'd
   `heightAt` over the island XZ extent (~64 KB VRAM, 0 download/bundle bytes, 0
   draw calls). The vertex stage passes a `vWorldXZ` varying; the fragment samples
   in normalized `[0,1]` UV and applies `1 - smoothstep(uFoamStart, uFoamEnd,
   depth)`. Foam = soft tone-mapped off-white, never clipped pure white.
7. **sRGB→linear transport.** Convert the sRGB-authored palette tuples to LINEAR
   on the TS side (`THREE.Color().setRGB(r,g,b, SRGBColorSpace)` → `.r/.g/.b`)
   before setting the uniforms, because MeshStandard fragment math runs in linear
   before the `SRGBColorSpace` + `ACESFilmicToneMapping` output. Conversion is a
   transport step, not a hex re-declaration — single source of truth intact; fixes
   washed-out blues.
8. **DI seam, no singleton.** Thread `terrain.heightAt` into `buildBoundaries` via
   an OPTIONAL constructor parameter (`buildBoundaries(heightAt?)`) — a DI seam,
   never a module-level singleton/global. `buildWorld` passes `terrain.heightAt`;
   `boundaries.test.ts`/`vehicle.test.ts` keep calling `buildBoundaries()` with no
   args and stay byte-for-byte behaviour-identical.
9. **Safe `heightAt`-absent path.** Gate the foam contribution behind a
   compile-time GLSL `#define HAS_FOAM` injected ONLY when `heightAt` is present,
   so the no-foam variant references no sampler/uniform (no dangling uniform, no
   null sampler, no three warning). The headless `onBeforeCompile` test exercises
   BOTH variants.
10. **Distinct cache keys.** Set distinct constant `customProgramCacheKey` strings
    for the foam and no-foam patched-water variants so the program does not
    collide with terrain/props `MeshStandard` programs in three's shader cache.
11. **No animation, no tier gating.** No `uTime`, no `waveHeight` import, no vertex
    displacement; the plane stays flat at `seaLevel - 0.05`. No quality-tier gating
    (slice 4). TextView fallback and `isInBounds`/`clampToBounds` unchanged.
12. **Lifecycle.** Dispose the `DataTexture` and any uniform-holding resources in
    `Boundaries.dispose()` alongside `waterGeo`/`waterMat`; introduce no per-frame
    allocation and no `update()`/per-frame callback this slice.
13. **Named tree-shaking-guard contract flip.** Flip the `waterSurface.test.ts`
    tree-shaking guard (lines 406–435) as the NAMED, intentional contract change:
    replace "no `src` file imports `./waterSurface`" with a positive assertion that
    `boundaries.ts` imports and uses the ramp/foam symbols — called out as a
    deliberate PR #116 contract update, not an incidental defeat of a guard.
14. **Real-shader-source GLSL guard.** Verify the GLSL transcription headlessly by
    invoking the `onBeforeCompile` callback against the REAL three MeshStandard
    shader source (`THREE.ShaderLib`/`ShaderChunk`), not a fabricated stub,
    asserting injected anchors + imported palette/foam constants are present in
    both variants — so the marker test gives real (not false) confidence against a
    three-version chunk rename.
15. **Visual-AC verification plan.** Verify the two visual ACs ONLY via the
    Playwright smoke verifier / `render_game_to_text` with cited before/after
    screenshots: a wide frame for the depth gradient (AC2) and a from-inside-
    looking-out near-shore frame for the foam collar (AC3). The craft clamps to
    `boundaryRadius = 178`; the follow/preview camera looks out over it; the foam
    ring ≈175.6–185.8 is framable from inside. Report the `vite build` gzip delta
    and confirm `checkFrame`/`StatsOverlay` ≥30 fps on the target-device profile.
16. **Scope fence.** Stay entirely within `src/` and `docs/`; touch nothing under
    `.claude/`. If the approach appears to need a harness/process/role change, halt
    and surface it instead of acting.

**Rejected alternatives:**

- Normalizing raw `seaLevel - groundHeight` to drive the colour blend — saturates
  the open-water surface to flat `WATER_DEEP` (depth ≈ 11 vs `FOAM_DEPTH_END`
  1.5); the exact flat tone AC2 forbids. Fresnel-alone for colour; depth stays in
  the foam band.
- A radial `coastRadius`/`islandRadius` foam ring — a perfect circle reads as a
  fake decal and ignores the real coastline; forbidden by the module jsdoc, AC3,
  and the UX hard objection.
- Re-deriving the terrain FBM in GLSL to get per-fragment ground height — a worse
  single-source violation and a fill-rate cost; the baked `DataTexture` is the
  zero-pass answer.
- A runtime null-sampler bind on the no-`heightAt` path — a dangling uniform and a
  three warning; gated out at COMPILE time via `#define HAS_FOAM` instead.
- A module-level singleton holding `heightAt` — breaks the DI/test seam; an
  optional `buildBoundaries(heightAt?)` parameter is used.
- A second water mesh / `ShaderMaterial` / `EffectComposer` — extra draw call /
  bytes / pass; the single `onBeforeCompile`-patched `MeshStandardMaterial` is
  kept.
- Re-declaring `0x2e6f9e`/`0x193d57` or the foam-edge literals in `boundaries.ts`
  — splits the source of truth; the constants are imported and the sRGB→linear
  conversion is a transport step only.
- Folding `uTime`/wave displacement/quality-tier gating into this slice — those
  are slices 3–4; the surface stays flat and ungated here.

## Critique history

**Round 1 — material flaw + second-code-path flaw (both addressed above):**

- **MATERIAL (resolved):** The original framing risked blending colour off
  normalized raw depth, which saturates the whole open-water surface to flat
  `WATER_DEEP` (depth ≈ 11 ≫ `FOAM_DEPTH_END` 1.5) — the exact flat tone the
  critic flagged and AC2 forbids. Resolved by driving the two-tone from the
  **view-angle fresnel term alone** (`pow(1 - dot(N,V), p)`, `p≈3.5`), exactly
  what `waterColor()`'s jsdoc supplies, and confining `depth` to the foam band's
  native `[FOAM_DEPTH_START, FOAM_DEPTH_END]` domain so no new normalization scale
  or magic number enters `boundaries.ts`.
- **SECOND CODE PATH (resolved):** The `heightAt`-absent variant must not leave a
  dangling sampler/uniform. Resolved by gating the foam contribution behind a
  compile-time `#define HAS_FOAM` injected only when `heightAt` is present, so the
  no-foam program references no sampler at all; `customProgramCacheKey` returns
  distinct constant strings for both variants, and the headless `onBeforeCompile`
  test exercises BOTH.
- **COLOUR SPACE (resolved):** sRGB-authored palette mixed "straight" in a `vec3`
  would double-encode under the renderer's `SRGBColorSpace` + ACES output.
  Resolved by converting sRGB→linear on the TS side
  (`Color().setRGB(r,g,b, SRGBColorSpace)` → `.r/.g/.b`) before setting the
  uniforms — a transport step, not a hex re-declaration.
- **NON-BLOCKING:** The two visual ACs cannot be proven by headless Vitest;
  recorded the Playwright smoke verifier / `render_game_to_text` screenshot plan
  (wide frame for the gradient; from-inside-looking-out near-shore frame for the
  foam) as the explicit verification path.

## Task Plan

| ID | Owner | Depends on | Title / first test |
|----|-------|-----------|--------------------|
| T1 | graphics | slice 1 | `bakeGroundHeight(heightAt, extent, res)` pure helper — sample `heightAt` over the island XZ extent into an R-channel buffer; out-of-extent behaviour defined. First test: known `heightAt` → expected samples; out-of-extent clamps; deterministic. |
| T2 | graphics | T1 | `groundHeightTexture` factory wrapping the bake into a 128×128 single-channel `THREE.DataTexture`. First test: texture format/size/wrap; values round-trip the bake. |
| T3 | graphics | slice 1 | `makeWaterPatch` — the `onBeforeCompile` GLSL builder + `customProgramCacheKey`, foam and no-foam variants via `#define HAS_FOAM`. First test: invoke against real `ShaderLib`/`ShaderChunk`, assert injected anchors + imported palette/foam constants in BOTH variants; distinct constant cache keys. |
| T4 | backend | T2,T3 | Wire `buildBoundaries(heightAt?)` DI seam — bake texture + patch material when present; skip foam when absent. First test: with-`heightAt` patches + binds texture; without-`heightAt` stays flat-fresnel, no sampler. |
| T5 | backend | T4 | `Boundaries.dispose()` releases material + `DataTexture` alongside `waterGeo`/`waterMat`. First test: dispose spies fire on all owned resources; no per-frame callback added. |
| T6 | backend | T4 | Lock `buildWorld → buildBoundaries(terrain.heightAt)` seam. First test: `buildWorld` passes `terrain.heightAt` (terrain built first). |
| T7 | quality | T3,T4 | AC1 single-source-of-truth grep guard: `boundaries.ts` imports AND uses the symbols; NO re-declared `0x2e6f9e`/`0x193d57` or inline foam-edge literals. First test: positive use-assertion + negative literal-scan. |
| T8 | quality | all | Flip the `waterSurface.test.ts` tree-shaking guard (lines 406–435) to a positive "`boundaries.ts` imports and uses `waterSurface`" assertion — the named PR #116 contract change. |
| T9 | quality | T8 | Confirm `boundaries.test.ts`/`vehicle.test.ts` call `buildBoundaries()` with no args and stay green; full `npm test` + `npm run build`. |
| T10 | verify | all | Playwright smoke verifier / `render_game_to_text`: cited before/after screenshots (wide gradient frame; from-inside near-shore foam frame); `vite build` gzip delta; `checkFrame`/`StatsOverlay` ≥30 fps. |
| T11 | runner | all | Record this slice decision log under `docs/team/runs/` (positions, converged design + rationale, plan, the named tree-shaking-guard contract flip, the visual-AC verification plan). First test: `waterPatch.runlog.test.ts` — the entry exists, references AC1–AC10 and the boundaries←waterSurface contract flip, and lives only under `docs/`. |

## The named contract flip — boundaries.ts ← waterSurface.ts

Slice 1 shipped `waterSurface.ts` deliberately **unimported**, and
`waterSurface.test.ts` carried a tree-shaking guard asserting no `src` file
imported `./waterSurface`. This slice intentionally **flips that guard**: it is
the named, deliberate PR #116 contract change, not an incidental defeat of a
guard. The guard is rewritten to a positive assertion that `boundaries.ts`
imports and **uses** the ramp/foam symbols (`WATER_SHALLOW`, `WATER_DEEP`,
`FOAM_DEPTH_START`, `FOAM_DEPTH_END`, `shorelineFoam`) as the single source of
truth. The AC1 grep guard backs this up by also asserting NO re-declared palette
hex (`0x2e6f9e`/`0x193d57`) and no inline foam-edge literals leak into
`boundaries.ts` or the GLSL strings.

## Visual-AC verification plan (AC2, AC3)

The two visual ACs are confirmable ONLY against the running build — green
headless tests are necessary but not sufficient. The plan:

- **AC2 (depth/fresnel gradient):** a **wide framing** screenshot showing the
  near-to-horizon gradient — the surface reads as a blend from lighter
  `WATER_SHALLOW` near-overhead/under the craft to darker `WATER_DEEP` toward the
  grazing horizon, NOT a single flat tone. Captured before/after via the
  Playwright smoke verifier (`scripts/verify-game.mjs`) / `render_game_to_text`
  and cited in the verify step.
- **AC3 (foam collar):** a **from-inside-looking-out near-shore framing** — the
  craft clamps to `boundaryRadius = 178` but the follow/preview camera looks out
  over it; the foam ring (≈175.6–185.8) is framable from inside. The foam reads
  as a soft, feathered, tone-mapped off-white collar hugging the island's
  irregular coastline — not a clipped pure-white rim and not a perfect circle.
- **Perf (AC5):** report the `vite build` gzip delta (baseline `main` ≈ 187 KB
  vs the 400 KB cap; delta = shader strings + the now-imported `waterSurface.ts`,
  sub-KB, no new dependency/asset bytes) and confirm `checkFrame`/`StatsOverlay`
  ≥30 fps on the target-device profile (fill-rate is the real cost; the patch
  stays `mediump`, branch-free).

## Result

Decision log recorded for G1 slice 2. The headless implementation (the baked
ground-height texture, the `onBeforeCompile` GLSL patch with foam/no-foam
variants, the `buildBoundaries(heightAt?)` DI seam, the dispose lifecycle, the
AC1 single-source grep guard, and the flipped tree-shaking guard) is covered by
the slice's Vitest suites; the two visual ACs are confirmed against the running
build via the Playwright smoke verifier / `render_game_to_text` per the plan
above. All changes stay within `src/` and `docs/`; nothing under `.claude/` is
created, edited, or deleted.
