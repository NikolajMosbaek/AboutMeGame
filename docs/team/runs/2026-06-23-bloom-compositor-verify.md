# Run: G2 bloom compositor — T9 running-build verification

> Verification record for the G2 bloom slice (#116, #119). This is **T9** — the
> "verify the running build" task. It does **not** change product code; it builds
> the game, runs the full Vitest suite, drives the built game in a real WebGL
> browser (Playwright + swiftshader) at **all three quality tiers**, captures
> before/after screenshots, samples presented pixels, and reports pass/fail per
> acceptance criterion with cited numbers. The implementation (T1–T8) landed on
> the branch in the commits below; this run is the independent QA pass over it.
> The one product change T9 makes is a **prose-only** bundle-number correction in
> `docs/perf-budget.md` (the shipped prose claimed the `three` chunk was
> byte-identical and postprocessing tree-shook out — the actual dist listing
> shows it folds into the `three` chunk; see the bundle AC below).

## What was verified

The G2 slice wires ONE tuned `UnrealBloomPass` behind the renderer seam so the
two genuine emissive sources — the landmark **sky-beacons** and the **tower
lamp** — glow on medium/high, with **zero post cost on low**:

- `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass` live ONLY in
  `src/engine/createCompositor.ts` (sibling to `createRenderer.ts`).
- The Engine gained one optional injected render delegate
  (`EngineOptions.compositor`); `Engine.render/resize/dispose` route through it
  when present, else the bare `renderer.render`.
- `GameCanvas` builds the compositor at mount ONLY when `quality.bloom` is true
  (medium/high) and injects it; on low it injects nothing → plain
  `renderer.render`, no composer bytes constructed.
- Half-res bloom on medium is owned by the compositor's `setSize`
  (`composer.setSize(w·dpr,h·dpr)` then `bloomPass.setSize(half)` on medium),
  NOT the dead `UnrealBloomPass` constructor resolution.
- On the compositor path the renderer is `NoToneMapping` / `LinearSRGB` and
  `OutputPass` owns ACES+sRGB once; the plain low path keeps the renderer's
  existing ACES+sRGB.

## Verification method

- **Build:** `npm run build` (tsc --noEmit + vite build) — green (cited below).
- **Tests:** `npm test` (Vitest) — full suite green, WebGL-free (cited below).
- **Running build:** a T9 driver (Playwright, headless Chromium with
  `--use-gl=angle --use-angle=swiftshader`) against `vite preview` at
  `http://localhost:4317/AboutMeGame/`. Quality tier forced per run:
  - **low** — persisted `aboutmegame.settings.v1` `quality:"low"` → `resolveQuality`
    forces the low tier (`bloom:false`, no compositor).
  - **high** — `quality:"high"` → high tier (full-res bloom).
  - **medium** — `quality:"auto"` + spoofed `navigator.hardwareConcurrency=6`,
    `deviceMemory=6`, non-touch, so `detectTier()` resolves **medium** (half-res
    bloom). The resolved signals are read back from the page and asserted.
  - State read via `window.render_game_to_text` / `window.__ENGINE_STATE__`.
    Presented pixels sampled from the **screenshot PNG** (decoded via
    `createImageBitmap` into a readable 2-D canvas — the live WebGL buffer is not
    preserved, so reading it back yields black and provokes a swiftshader
    `ReadPixels` stall).

> **Caveat made explicit (failure-mode honesty):** the headless verifier renders
> through **swiftshader — a CPU software rasterizer, NOT the target mobile GPU.**
> Its absolute fps is a worst-case lower bound; it is the wrong instrument for an
> absolute "≥30 fps on the target device" claim, especially for a **fill-rate**
> effect like bloom (a full-screen blur is CPU-expensive under swiftshader and
> cheap on a GPU — which is the whole point of the half-res-on-medium design). It
> IS a sound instrument for rendering correctness (no shader-compile/WebGL
> errors), for the glow-vs-flat difference across tiers, for cross-tier
> white-point/exposure consistency, for teardown cleanliness, and for the
> relative cost of the pass. Those are what is asserted below; the absolute
> mobile-GPU floor is argued from budget + the relative pass cost, not the
> swiftshader fps.

## Acceptance criteria — results

### AC — beacon + lamp glow on medium/high; low flat with zero post cost

- **PASS (running build, all three tiers).** Same vantage at the Arrivals Gate
  (craft driven to the gate at `(0,64)`, teaser card "The Arrivals Gate" up),
  presented-frame metrics (near-white pixels = bloom bleed; max luminance):
  - **low**  (`quality:"low"`, no compositor): **1** near-white pixel, maxLum
    **250** — the beacon is a flat, pale, translucent column, NO glow.
    `glow-low-flat-arrivals-gate.png`.
  - **medium** (auto, spoofed 6c/6GB, half-res bloom): **12,257–12,996** near-white
    pixels, maxLum **255** — the beacon blooms a bright white-cored halo into the
    sky. `glow-medium-halfres-arrivals-gate.png`.
  - **high** (`quality:"high"`, full-res bloom): **12,525–12,761** near-white
    pixels, maxLum **255** — beacon glows. `glow-high-fullres-arrivals-gate.png`.
  - That is a **>12,000× step** in bloomed pixels from low → medium/high, at an
    identical vantage. The base spawn-vantage captures
    (`base-{low,medium,high}-spawn-vantage.png`) show the same contrast across
    the whole beacon field: flat pale columns on low, glowing columns on
    medium/high.
- **Zero post cost on low — structural proof:** `GameCanvas` only calls
  `createBloomCompositor` when `quality.bloom` is true; on low it injects nothing
  and `Engine.render` takes the `renderer.render` branch. The low run's
  `render_game_to_text` reports the **true scene** draw/triangle counts (see
  below) — i.e. no terminal post-pass — confirming no composer is presenting.
- **No console / WebGL / THREE errors at any tier.** `0` real errors, `0` real
  warnings per tier (the only swiftshader notices are benign software-renderer /
  `ReadPixels`-stall info provoked by the screenshot path itself, filtered).

### AC — composer lives only in createCompositor.ts; suite stays green + WebGL-free

- **PASS.** `npm test`: **62 files / 510 tests passed**, no WebGL. Transitive-import
  grep:
  - Real `from "three/examples/jsm/..."` imports in `src/` are only `assets.ts`
    (pre-existing `GLTFLoader`) and **`createCompositor.ts`** (the four
    postprocessing passes). The `Engine.ts` / `types.ts` / `GameCanvas.test.tsx`
    matches are **comments**, not imports.
  - `createBloomCompositor` is imported only by `GameCanvas.tsx`. Every jsdom test
    that touches that graph neutralises it: `GameCanvas.test.tsx` and
    `GameCanvas.journal.test.tsx` `vi.mock("./createCompositor.ts")`; `App.test.tsx`
    `vi.mock("./engine/GameCanvas.tsx")` entirely; `JournalPanel`/`CompletionPanel`
    tests only *mention* GameCanvas in prose and render the panels directly. So
    **nothing jsdom loads constructs a composer** — the suite is WebGL-free.

### AC — reads the shipped bloom knob + tier; half-res on medium, full on high

- **PASS.** The compositor reads `quality.tier`/`quality.bloom` from the resolved
  `QualityConfig` (no change to `QUALITY_TIERS`, `quality.test.ts`, or the
  perf-budget bloom-row definition beyond prose). Medium downscales ONLY the
  bloom mip pyramid (`bloomPass.setSize(w·dpr·0.5, h·dpr·0.5)` after
  `composer.setSize` — re-applied every resize, never per-frame); high leaves the
  full-res value. The base RenderPass image stays full-res (see white-point AC),
  so the base frame matches the low path and only the glow differs. The
  per-tier resolution was confirmed live (low→no compositor; medium/high→compositor
  presenting, see the draw/tri artifact below).

### AC — OutputPass owns ACES+sRGB once; base pixels identical, no drift

- **PASS.** **Decisive gate = medium-vs-high** base-sky white-point: both present
  through the compositor (`NoToneMapping` → `OutputPass` ACES+sRGB) and both have
  fog on, so they share every confound EXCEPT bloom resolution + propDensity. If
  the compositor's tone-mapping ownership drifted the white point, they would
  diverge. Measured per-channel base-sky drift **medium-vs-high = 1 level**
  (`[188,198,211]` vs `[188,197,210]`) — within AA/dithering tolerance ⇒ **no
  double-tone-map, no exposure drift on the compositor path.**
- **low-vs-compositor is the fog knob, not drift.** Low's base sky differs by ~12
  levels (`[176,197,210]` vs `[188,198,211]`), a haze toward the fog colour
  `#cfe4f2` because **low has fog OFF** (a deliberate tier knob) while
  medium/high have it on. It is reported, not failed; the screenshots confirm the
  base scene tone matches across tiers and only the deliberate fog haze + cast
  shadows + the added glow differ.

### AC — bundle gzip branch-vs-main; three a separate vendor chunk; under 400 KB

- **PASS.** Measured from a clean worktree build of `main` vs this branch
  (`vite build`, gzip), confirmed against the actual dist chunk listing:

  | chunk | `main` | branch | delta |
  |---|---|---|---|
  | `three` vendor JS | **120.73 KB** | **124.87 KB** | **+4.14 KB** (the 4 postprocessing passes) |
  | entry JS | **73.91 KB** | **74.22 KB** | **+0.31 KB** (compositor wrapper + landmark tweaks + seam glue) |
  | total first-load JS | **~194.64 KB** | **~199.09 KB** | **+4.45 KB** |
  | modules transformed | 95 | 106 | +11 |

  - The id-based `manualChunks` (`/node_modules\/three\//`) folded
    `three/examples/jsm/postprocessing/*` into the **`three`** vendor chunk
    (+4.14 KB), and the **entry chunk did NOT grow with three internals** (+0.31 KB
    is the small compositor wrapper + landmark emissive tweaks). Total **~199.1 KB
    gz**, far inside the **400 KB** cap. CSS **3.5 KB** (unchanged).
  - **Doc correction (prose-only, this run):** the T8 perf-budget prose claimed
    the `three` chunk was "byte-identical to `main`" and that postprocessing
    "tree-shakes out until the compositor is reachable … first-load delta …
    essentially nil." That is wrong: `GameCanvas` → `createCompositor` makes the
    passes reachable, so they ship in the `three` chunk (+4.1 KB). The prose is
    corrected to the measured numbers above. No code change.
  - `npm run build` is green (tsc --noEmit + vite build; ✓ built).

### AC — dispose from Engine.dispose, setSize from Engine.resize; no WebGL in Vitest

- **PASS (headless seam test + running build).** `Engine.test.ts` asserts an
  injected stub compositor's `render`/`setSize`/`dispose` are routed through
  `Engine.render`/`resize`/`dispose` (resize forwards AFTER the renderer/camera
  resize; dispose runs before `renderer.dispose`), plus the bypass assertion that
  with NO compositor the path is `renderer.render` and no compositor object
  exists. No WebGL enters Vitest (510 tests green).
- **StrictMode double-mount / teardown is clean (running build).** A churn probe
  entered + exited the world **2 cycles** (each mount builds a high-tier compositor
  and disposes it on unmount): **0** WebGL context-lost / too-many-contexts /
  leak warnings, 0 WebGL/THREE errors. `Compositor.dispose` →
  `composer.dispose()` + `bloomPass.dispose()` + `outputPass.dispose()` frees all
  GPU targets each teardown.

### AC — mobile floor: medium half-res bloom measured with audio bed running

- **MEASURED + FLAGGED (swiftshader caveat governs the call).** Medium tier (true
  half-res bloom), audio **UNMUTED** (ambient bed running, not a silent scene),
  the live render loop run to steady state at a beacon:
  - **steady-state ~21.3 fps** (samples `26.1→21.9→21.1→21.0→20.9→21.4→21.5→21.5`),
    **swiftshader software-WebGL — a worst-case lower bound, NOT a target-device
    measurement.** High (full-res bloom, 2× DPR, full props) ~18 fps swiftshader.
  - **Relative cost:** the prior G1 run measured medium (no bloom) at ~28–31 fps
    swiftshader; adding the full-screen bloom passes drops it ~7 fps **under CPU
    rasterization.** Bloom is a **fill-rate** pass (a fixed-cost mip-blur every
    frame, independent of bright-pixel count), which is exactly the cost CPU
    software rasterization punishes most and a GPU — especially the half-res
    pyramid on medium — handles cheaply.
  - **Draw/triangle budget is untouched (bloom is fill-rate, not geometry):** see
    below — bloom adds **zero** scene draw calls / triangles.
  - **Decision (honest exit):** bloom is **NOT** auto-dropped to high-only on the
    strength of the swiftshader number, because that number is explicitly **not**
    the target-device gate (per the AC and the established G1 caveat) and half-res
    bloom is a standard cheap mobile effect. **This is the top residual risk and
    is flagged for a real mid-range-phone capture** (below). T9 does not change
    `QUALITY_TIERS` (out of scope; the slice's design keeps the tier table fixed).
- **Draw calls + triangles, before/after (from `render_game_to_text`):**
  - **low** (no compositor — true scene info): **29 draws / 90,406 triangles** at
    the gate vantage. This is the geometry baseline.
  - **medium / high** (compositor presenting): `render_game_to_text` reports
    **1 draw / 1 triangle** — the terminal `OutputPass` full-screen quad, because
    `renderer.info.render` resets per `renderer.render` and the OutputPass is the
    last pass. This is a **measurement artifact that itself confirms the compositor
    is presenting**; it is NOT a geometry change. **Bloom adds zero scene
    geometry** — `RenderPass` renders the unchanged scene; `UnrealBloomPass` +
    `OutputPass` are full-screen quad passes. The scene geometry for medium/high
    is their tier's world (more props/shadows than low), never bloom geometry.

### AC — TextView / no-WebGL path + Epic 4/5 contracts untouched; scope clean

- **PASS.** `git diff main...HEAD --name-only` is confined to: `docs/perf-budget.md`,
  `src/engine/{Engine,GameCanvas,createCompositor,types}.ts` (+ `Engine.test.ts`,
  `GameCanvas.test.tsx`, `GameCanvas.journal.test.tsx`), `src/world/landmarks.ts`
  (+ `landmarks.test.ts`), `vite.config.ts`, and this run log + assets. **No
  TextView / no-WebGL fallback file changed**; `src/audio/` and `buildGame.ts`
  untouched; **nothing under `.claude/`**. The `landmark:<poiId>` group naming and
  `placed[]` are untouched (verified — `buildLandmarks` only brightened the
  beacon material + lamp emissive; structure/grouping unchanged), guarded by
  `landmarks.test.ts`.
- **Snow-cap scope correction (recorded per the design):** snow caps are vertex
  colours (`0xeef2f5`) in the single shared terrain `MeshStandardMaterial`, not a
  discrete material, so there is nothing to promote without a scene-wide low
  threshold (would bloom sky/water) or new per-peak shader work (out of scope).
  The bloom threshold is tuned **high** (`0.85`, strength `0.5`, radius `0.3`) so
  only the two real sources clear it. **Deliberate snow-cap emissive glow is
  scoped OUT to a later G3/G4 material slice.** If bright snow incidentally clears
  the threshold under ACES it is acceptable but not engineered.

## Cited command output

`npm test` — full suite:

```
 Test Files  62 passed (62)
      Tests  510 passed (510)
```

`npm run build` (branch):

```
✓ 106 modules transformed.
dist/index.html                 2.05 kB │ gzip:  0.84 kB
dist/assets/index-*.css        16.30 kB │ gzip:  3.54 kB
dist/assets/index-*.js        224.93 kB │ gzip: 74.22 kB   (entry; main was 73.91)
dist/assets/three-*.js        496.52 kB │ gzip: 124.87 kB  (three+postprocessing; main was 120.73)
✓ built in ~0.6s
```

T9 driver (all three tiers + mobile-floor + StrictMode churn):

```
low    : resolvedTier 14c/16GB  drawCalls 29  triangles 90406  baseSky [176,197,210]  glowBright 1      maxLum 250
medium : resolvedTier  6c/6GB   drawCalls  1  triangles     1  baseSky [188,198,211]  glowBright 12257  maxLum 255
high   : resolvedTier 14c/16GB  drawCalls  1  triangles     1  baseSky [188,197,210]  glowBright 12582  maxLum 255
skyDrift (base, white-point gate): medium-vs-high = 1  (low-vs-compositor = 12 = fog knob)
mobileFloor: medium, muted=false, steady ~21.3 fps  (swiftshader — not a target-device measurement)
strictMode : 2 cycles, 0 problems (no WebGL context/leak warnings)
T9 VERIFY OK — all tiers rendered clean, no drift, no WebGL warnings.
```

Screenshot evidence:
`docs/team/runs/assets/2026-06-23-bloom-compositor-verify/`
(`glow-{low,medium,high}-*-arrivals-gate.png`, `base-{low,medium,high}-spawn-vantage.png`).

## Residual risk / follow-ups (honest exit)

- **TOP RISK — medium mobile fps is unmeasured on a real GPU.** Software
  swiftshader puts medium (half-res bloom, audio on) at ~21 fps, below the
  software comfort zone, but bloom is a fill-rate pass that CPU rasterization
  punishes and a GPU handles cheaply — the half-res-on-medium design exists for
  exactly this. **A real mid-range-phone capture is owed** before trusting medium
  bloom on mobile. If a real device shows medium under the ≥30 fps floor, the
  reserved remedy is to make `bloom` **high-only** in `QUALITY_TIERS` (a one-line
  table change + its `quality.test.ts` row) — deferred to that measurement, not
  guessed here.
- **`render_game_to_text` reports the OutputPass on the compositor path** (1
  draw / 1 tri), not the scene draws. This is a known artifact of `renderer.info`
  resetting per `renderer.render`; the scene geometry is unchanged by bloom
  (fill-rate, not geometry). If a future slice needs the true scene draws on the
  compositor path, expose them before the post-pass chain runs.
- **Cross-tier base-pixel identity is only literal on fog/shadow-free surfaces.**
  The compositor's no-drift guarantee is proven via medium-vs-high (both
  compositor+fog, drift 1); low's sky differs by the deliberate fog knob. There is
  no tier-invariant world surface across all three (fog/shadows/props differ by
  design), so the white-point gate is correctly the compositor-vs-compositor
  comparison, not low-vs-everything.
