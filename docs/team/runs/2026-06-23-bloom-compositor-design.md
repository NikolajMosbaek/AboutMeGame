# Run: G2 bloom compositor — T8 converged-design run log

> Design-decision record for the G2 bloom slice (#116). This is **T8** — the
> run log that captures the **converged design and its rationale** for wiring ONE
> tuned `UnrealBloomPass` behind the renderer seam. It is **docs-only** (it
> changes no product code; the implementation landed in the T1–T7 commits on this
> branch, and the running-build verification + mobile-floor measurement are in the
> sibling T9 (`2026-06-23-bloom-compositor-verify.md`) and T10
> (`2026-06-23-bloom-medium-mobile-floor-t10.md`) logs). It records, in one place:
> the converged design and rationale, the **half-res-on-medium fix** for the flaw
> the Quality critic flagged, the **tone-mapping ownership** decision, the
> **snow-cap scope correction**, and the **swiftshader-is-not-the-target-device**
> honesty caveat.

## End state in one sentence

ONE tuned `UnrealBloomPass`, constructed only behind a small injected render
delegate so the **beacons** and the **tower lamp** glow on medium/high, with
**zero post cost on low** and the Vitest suite left **WebGL-free**.

## Converged design

The G2 slice introduces a post-processing compositor and threads it through the
engine via a deliberately narrow seam, so WebGL never enters the headless test
graph and low-tier devices pay nothing.

- **The seam is an injected render *delegate*, not a composer reference.** The
  Engine gained one optional `EngineOptions.compositor?: { render(scene,camera),
  setSize(w,h), dispose() }` (`src/engine/types.ts` `RenderDelegate`,
  `src/engine/Engine.ts:24/66/83`). `Engine.render()` calls the compositor when
  present, else the bare `renderer.render` (`Engine.ts:191-194`);
  `Engine.resize()` forwards to `compositor.setSize` **after** the existing
  `renderer.setSize` + camera update (`Engine.ts:114-117`); `Engine.dispose()`
  calls `compositor.dispose()` **before** `renderer.dispose()` (`Engine.ts:222-223`).
  This is a real boundary — *who presents the frame* — not an `isPreview` mode
  flag, and it keeps the Engine free of any `three/examples/jsm` import.

- **The composer lives in exactly one new module:** `src/engine/createCompositor.ts`,
  a sibling to `createRenderer.ts` — the two modules nothing under jsdom imports.
  `createBloomCompositor(renderer, scene, camera, quality)` builds
  `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass` and returns the
  minimal `Compositor` (= `RenderDelegate`). It is the **only** place a
  `three/examples/jsm/postprocessing/*` pass is constructed.

- **`GameCanvas` is the WebGL-only composition root.** Inside its mount
  `useEffect` it builds the compositor **only when `quality.bloom` is true**
  (medium/high) and injects it (`GameCanvas.tsx:138-146`); on low it constructs
  nothing and injects no delegate → the Engine takes the plain `renderer.render`
  branch, **zero composer bytes built, zero post fill-rate cost.** Every jsdom
  test that touches this graph neutralises it (`vi.mock("./createCompositor.ts")`
  / `vi.mock("./engine/GameCanvas.tsx")`), so the suite stays WebGL-free.

- **bloom is a bake-at-mount knob**, like `waterDisplacement` — the compositor's
  *existence* is the configuration. The live `applyRendererQuality` path
  (maxPixelRatio + shadows) does **not** tear down or rebuild the composer;
  medium/high both bloom and the rare `auto→low` flip applies on reload. Recorded
  prose-only in `docs/perf-budget.md` (bloom row: **shipped + applies on reload**).

### Rationale

A "shared link, no install" 3D experience must reach low-end mobile, so the
expensive fill-rate effect has to be *absent*, not merely disabled, on low — the
inject-or-don't seam gives exactly that. Isolating the composer in a renderer-seam
sibling that jsdom never imports is what lets the full Vitest suite run headless
without a WebGL shim; the alternative (a composer reference on the Engine) would
drag `three/examples/jsm` into the test graph. The delegate is kept to three
methods so a test can inject a plain stub (`Engine.test.ts`) and assert the
routing without any GPU.

## The half-res-on-medium fix (the flagged flaw)

The Quality critic flagged the original plan's mechanism for running bloom at half
resolution on medium: passing a **halved `Vector2`** to the `UnrealBloomPass`
constructor. **That value is dead.** Verified against **three r169 (0.169.0)**:

- `EffectComposer.addPass` (`EffectComposer.js:63-68`) immediately calls
  `pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio)`
  on every pass it receives — overwriting whatever resolution the pass was
  constructed with.
- `EffectComposer.setSize` (`EffectComposer.js:193-206`) recomputes
  `effectiveWidth/Height` and loops `this.passes[i].setSize(effectiveWidth,
  effectiveHeight)` over **every** pass — overwriting the constructor value again
  on each resize.

So the constructor `Vector2` never survives to a single rendered frame.

**The fix: the Compositor *owns* bloom-buffer size propagation.** On every
`setSize(w,h)` (`createCompositor.ts:91-108`) it:

1. reads `dpr = renderer.getPixelRatio()` so the buffers track the **drawing
   buffer**, not CSS pixels;
2. calls `composer.setSize(w·dpr, h·dpr)` — full-res `RenderPass` + base
   `rt1`/`rt2`, so the **base image is pixel-identical to the low path** (no
   white-point / exposure drift from a downscaled base);
3. **only when `quality.tier === "medium"`**, immediately re-calls
   `bloomPass.setSize(w·dpr·0.5, h·dpr·0.5)` to downscale **only the bloom mip
   pyramid**; on **high** it leaves the full-res value the composer already pushed.

This sticks because `EffectComposer.render` (`EffectComposer.js:105-145`) **never
re-calls `setSize`** per frame — it only iterates `pass.render(...)`. The override
therefore holds frame-to-frame and is re-applied on each resize. To make the
passed dimensions land exactly, the composer's internal pixel-ratio factor is
neutralised once at build (`composer.setPixelRatio(1)`, `createCompositor.ts:63`)
and dpr is owned explicitly in `setSize`.

The result is the AC's intent: base RenderPass full-res on all tiers (base frame
matches the low path), bloom buffer **half effective resolution on medium** and
**full on high** — achieved by owned `bloomPass.setSize`, **not** by the
constructor.

## Tone-mapping ownership: renderer stays ACES+sRGB → OutputPass reads it

`OutputPass` is **mandatory** and terminates the chain, and it owns the final
ACES + sRGB encode. **Correction to the original design (it had this backwards):**
on the compositor path the renderer is LEFT at `ACESFilmicToneMapping` /
`SRGBColorSpace` — the same values `createRenderer` sets — via the WebGL-free
helper `configureCompositorColor` (`src/engine/compositorColor.ts`). It is **not**
neutralised to `NoToneMapping` / `LinearSRGBColorSpace`.

The reason is how `OutputPass.render` works in three r169 (`OutputPass.js:42-69`):
it derives its shader defines FROM the renderer's own `toneMapping` /
`outputColorSpace` at render time. `SRGB_TRANSFER` is set only when
`ColorManagement.getTransfer(outputColorSpace) === SRGBTransfer` (true for sRGB,
**false** for linear), and a tone-mapping define only for a *named* tone mode
(`NoToneMapping` is not one). Neutralising the renderer would therefore make
`OutputPass` set NEITHER define and become a **pass-through** that presents a raw,
un-encoded (dark/under-exposed) buffer — the bug the first cut shipped and review
caught. Leaving the renderer at ACES + sRGB is exactly what makes `OutputPass`
tone-map + encode once.

The intermediate `EffectComposer` targets are linear `HalfFloatType`, so
`RenderPass` still writes **scene-linear** HDR (the renderer applies no
tone-map/encode when drawing into a linear render target), `UnrealBloomPass` adds
light in linear space, and `OutputPass` applies **ACES + sRGB exactly once** at
the end of the chain.

The plain **low** path is untouched: `createRenderer` sets ACES + sRGB and the
renderer presents directly. Keeping the compositor path on the *same* ACES + sRGB
is what makes the base (non-glowing) pixels track the low baseline across tiers —
only the added light differs (re-verified: high -9.7%, medium -3.7% base-exposure
vs low, the residual being the deliberate fog/shadow/prop tier knobs).

## Emissive promotion: scoped to the two genuine sources

Promotion is confined to `src/world/landmarks.ts` and the **two genuine emissive
sources**, with the bloom threshold tuned **high** (`threshold 0.85`, `strength
0.5`, `radius 0.3`, `createCompositor.ts:28-30`) so ordinary lit stone, the
`#cfe4f2` sky and water specular do **not** clear it:

- **Beacon** — the additive `MeshBasicMaterial` opacity raised **0.28 → 0.42** so
  its post-tonemap luminance clears the high threshold while keeping the additive
  `depthWrite:false` look.
- **Tower lamp** — `emissiveIntensity` nudged **0.9 → 1.6** so it reliably clears
  the threshold under the linear-HDR → OutputPass chain.

`placed[]` and the `landmark:<poiId>` group naming are untouched (guarded by
`landmarks.test.ts`).

## Snow-cap scope correction (deferred to a later G3/G4 material slice)

The original AC text implied snow caps would also glow. **Corrected:** snow caps
are **vertex colours** (`0xeef2f5`) inside the single shared terrain
`MeshStandardMaterial` (`src/world/terrain.ts:116`), **not a discrete material** —
there is nothing to "promote" without either (a) a scene-wide low bloom threshold,
which would bloom the sky and water and break palette coherence and beacon
readability, or (b) new per-peak terrain-shader work, which is out of scope
(graphics-3d territory) and risks the Epic 2 terrain contract.

**Decision:** the firm glow targets for this slice are the **beacons + tower lamp**
only. **Deliberate snow-cap emissive glow is scoped OUT to a later G3/G4 material
slice** (backlog G3/G4, the "emissive accents want bloom — sequence after G2"
follow-ups). If bright snow incidentally clears the tuned threshold under ACES it
is acceptable, but it is **not promised or engineered** in G2.

## Bundle / chunking decision

`vite.config.ts` `manualChunks` was widened from the bare `{ three: ["three"] }`
specifier (which matches only the bare module id, leaving
`three/examples/jsm/postprocessing/*` to resolve to distinct ids) to an **id-based
matcher** returning `"three"` for any id matching `/node_modules\/three\//`
(`vite.config.ts:29-30`). This folds the postprocessing passes into the single
`three` vendor chunk, keeps three internals out of the entry chunk, and stays far
under the 400 KB gz first-load cap — the measured branch-vs-main numbers are cited
in the T9 log (entry +0.31 KB, `three` chunk +4.14 KB, total ~199 KB gz).

## Lifecycle

`Compositor.dispose()` (`createCompositor.ts:110-117`) calls `composer.dispose()`
(frees `rt1`/`rt2` + the copy pass), `bloomPass.dispose()` and
`outputPass.dispose()`. Per-pass dispose is the correct and sufficient action:
`UnrealBloomPass.dispose` (**three r169** `UnrealBloomPass.js:149-179`) already
frees its bright target, its horizontal/vertical mip targets, all its materials
and its `fsQuad`; `RenderPass` has no targets and no dispose. `Engine.dispose()`
invokes `compositor.dispose()` before `renderer.dispose()`, so StrictMode
double-mount and title↔world transitions free every GPU target on each teardown
(proven clean in the T9 run — 0 WebGL warnings).

## Honesty caveat — swiftshader is not the target device

The running-build verification (T9) and the mobile-floor measurement (T10) drive
the build through **swiftshader, a CPU software rasterizer — NOT the target mobile
GPU.** Its absolute fps is a **worst-case lower bound**, and it is the **wrong
instrument** for an absolute "≥30 fps on the target device" claim — *especially*
for a **fill-rate** effect like bloom: a full-screen mip-blur is CPU-expensive
under software rasterization and cheap on a GPU, which is the entire reason the
design runs bloom **half-res on medium**. swiftshader **is** sound for rendering
correctness (no shader-compile / WebGL errors), the glow-vs-flat step across
tiers, cross-tier white-point consistency, teardown cleanliness, and the
**relative** cost of the pass. The absolute mobile floor is argued from the
geometry budget (~5× headroom under both caps) plus the relative pass cost — **not**
from the swiftshader number. **The top residual risk is therefore explicit:
medium's half-res bloom is unmeasured on a real GPU; a real mid-range-phone capture
is owed.** Reserved remedy if a real device shows medium under the floor: flip
`medium.bloom` to `false` in `QUALITY_TIERS` (a one-line table change + its
`quality.test.ts` row) — deferred to that measurement, not guessed here.

## Scope

`git diff main...HEAD --name-only` is confined to `src/` (the engine seam +
`landmarks.ts` emissive tweaks), `docs/` (this run log + the T9/T10 verification
logs + the prose-only `perf-budget.md` reconciliation), and test/config files
(`vite.config.ts`, the `Engine`/`GameCanvas`/`landmarks` tests). `src/audio/`,
`buildGame.ts`, and the TextView / no-WebGL fallback are untouched; **nothing
under `.claude/`**.
