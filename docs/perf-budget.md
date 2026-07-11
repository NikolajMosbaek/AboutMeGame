# Performance budget

- **Issue:** #13 — Define the performance budget
- **Epic:** #1 — Tech Foundation & Platform
- **Enforced in code:** `src/perf/perfBudget.ts` (`PERF_BUDGET`, `checkFrame`)
- **Surfaced live:** the runtime stats overlay (`src/perf/StatsOverlay.tsx`, #14)

The bar from the charter and Epic 6 is **"runs on a mid-range phone."** The
budget below makes that concrete so it can be measured, shown live while
playing, and asserted in tests — not left as a vibe. Numbers live in
`PERF_BUDGET`; this doc records the rationale.

## Target device

A mid-range phone roughly equivalent to an iPhone SE (2nd/3rd gen) / a
mid-tier Android (Adreno 6xx-class GPU) on mobile Safari/Chrome over a 4G
connection. If it is smooth there, desktop is comfortable.

## The budget

| Metric | Budget | Why |
|--------|--------|-----|
| Frame rate (mobile) | **≥ 30 fps** (33.3 ms/frame) | The floor for a smooth-feeling driving/flying camera on the target device. Below it, the quality scaler (Epic 6, #47) steps down. |
| Frame rate (desktop) | **60 fps** | Headroom is expected on desktop. |
| Draw calls / frame | **≤ 150** | Three.js does not batch across materials; draw-call count is the first thing that blows up as the world grows, so it is watched first. |
| Triangles / frame | **≤ 500 k** | Comfortable for the target GPU with low-poly terrain + landmarks. |
| JS shipped (gzip) | **≤ 400 KB** | `three` is ~155 KB gz; this leaves room for game code without hurting time-to-interactive. (M1 baseline: **165 KB gz**.) |
| Total initial download | **≤ 6 MB** | Textures + models + audio before the world is interactive, over 4G. |
| Time to interactive | **≤ 4 s** on 4G | The "just a link" promise dies if the first load drags. |

## Quality tiers (Epic 6, #47/#48)

The quality scaler resolves an effective render config from the player's
`quality` setting and a detected device tier (`src/perf/deviceCapability.ts` →
`src/perf/quality.ts`). `"auto"` follows the device; `"low"`/`"high"` force a
tier. The detected tier is conservative: missing signals land on `medium`, and
any touch/coarse-pointer device caps at `medium` no matter how many cores it
reports. The table is the single source of truth (`QUALITY_TIERS`), asserted in
`src/perf/quality.test.ts`.

**Software WebGL forces `low`, overriding every other signal.** `readEnv()`
probes the WebGL renderer string once per session (throwaway canvas/context,
`WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`, plain `RENDERER`
fallback; non-throwing — no context ⇒ no signal ⇒ the heuristics above decide).
A string matching `/swiftshader|llvmpipe|softpipe|software|angle \(software/i`
means the "GPU" is a CPU rasterizer (VMs, CI runners, old laptops, blocklisted
GPUs): the medium tier's N8AO passes + ~2s PMREM env rebakes take seconds per
frame there — no core/RAM count compensates for a missing GPU, so detection
lands on `low` (no compositor/AO, no shadows, ONE static env bake at load).
Caught by the render-gate CI job (screenshot timeout on the GPU-less runner,
visual-overhaul slice 2). An explicit player `"low"`/`"high"` setting still
wins — only `"auto"` follows detection (`resolveQuality`'s contract).

| Knob | low | medium | high | Why it scales |
|------|-----|--------|------|---------------|
| `maxPixelRatio` | **1** | 1.5 | 2 | Fill rate is the dominant mobile cost; capping DPR at 1 is the single biggest lever for the target phone. |
| `shadows` | **off** | on | on | The shadow map is the costliest single feature; off on low. |
| `shadowMapSize` | 1024 | 1024 | 2048 | Smaller map ⇒ cheaper shadow pass on medium. |
| `propDensity` | **0.4** | 0.7 | 1.0 | Multiplier on the vegetation budgets (450 canopy trees / 60 palms / 900 understory / 120 rocks, `src/world/props.ts`) — fewer instances ⇒ fewer triangles. |
| `fog` | **off** | on | on | Cheap, but low drops it so the shorter draw distance reads cleanly. |
| `waterDisplacement` | **off** | on | on | Vertex displacement + grid subdivision on the full-screen water plane; off on low to protect mobile fill rate. Applies on reload. |
| `bloom` | **off** | on | on | Threshold post-processing pass that makes the emissive site accents (and later fireflies) glow; fill-rate spend, not draw/triangle; off on low to protect mobile fill rate. **Shipped** behind the renderer seam — pmndrs `postprocessing`'s mipmap-blur `BloomEffect`, merged with SMAA/vignette/tone-mapping into ONE `EffectPass` in `src/engine/createCompositor.ts` (visual-overhaul slice 1, replacing the earlier three-examples `UnrealBloomPass` chain); applies on reload. |
| `envDynamic` | **off** | on | on | Whether the sky-driven PMREM environment light (`EnvLightSystem`, visual-overhaul slice 2) regenerates as the day cycle moves. Every tier gets the environment map itself (a real per-tier lighting upgrade, not gated); low bakes it ONCE at load (the golden-hour keyframe) and never touches it again — a free visual upgrade with zero steady-state cost. Applies on reload (bake-at-mount). |
| `ao.qualityMode` | n/a (no compositor) | `"Performance"` | `"Medium"` | N8AO's sample-count preset (visual-overhaul slice 2) — medium/high only, inside the same lazy `postfx` chunk as bloom. `aoRadius`/`distanceFalloff`/`intensity`/`halfRes` are the SAME on both tiers (tuned once for this world's scale); only the preset differs. Applies on reload. |
| `terrainDetail` | **"albedo"** | "full" | "full" | Visual-overhaul slice 3 (PBR terrain splatting): `"full"` compiles the 4-sample tangent-space normal-map blend into the terrain's `onBeforeCompile` patch (`src/world/terrainMaterialPatch.ts`); `"albedo"` (low) omits that block at BUILD TIME — the compiled program references no normal sampler at all, so low pays for 4 texture samples/fragment, never 8. Every tier gets the real splatted albedo (no tier renders flat vertex-colour-only terrain any more); this only gates the normal-map fill-rate spend. Applies on reload (bake-at-mount, like `shadowMapSize`). |
| `terrainAnisotropy` | 4 | 4 | 8 | Anisotropic filtering level for the terrain's splat textures — three clamps to the device's real max at bind time, so this is always safe to request. A cheap fill-rate knob; only high spends the extra samples. |

**Low tier vs the mobile budget.** Low is tuned to comfortably clear the
mid-range-phone bar: pixelRatio 1 (no super-sampling), no real-time shadows, and
~40% of the set dressing. Props are `InstancedMesh` (3 draw calls regardless of
count), so the draw-call budget is unaffected by density; the win is in
triangles and the dropped shadow pass. The cheap knobs (`maxPixelRatio`,
`shadows`) re-apply live when the setting changes in the pause menu
(`applyRendererQuality`); the build-time knobs (`propDensity`, `shadowMapSize`,
`fog`, `waterDisplacement`, `bloom`) bake at mount, so the menu notes "Detail
level applies on reload." `bloom` is a renderer-seam post-pass: the compositor's
existence _is_ its configuration, so it follows the bake-at-mount path with the
other detail knobs and re-applies on reload — the live `applyRendererQuality`
path (`maxPixelRatio` + shadows) does not tear down or rebuild the composer.

**Bundle impact.** Epic 6 added the scaler, the text view, the a11y announcer
and the responsive/reduced-motion CSS without regressing the budget. The bloom
slice (G2) wired the three-examples `EffectComposer` + `UnrealBloomPass` chain
behind the renderer seam (below is its replacement).

**Visual-overhaul slice 1 (2026-07-10)** upgraded `three` `^0.169` → `^0.185.1`
and replaced that three-examples chain with pmndrs `postprocessing` `^6.39.2`:
`RenderPass` → ONE merged `EffectPass` holding a mipmap-blur `BloomEffect`
(same **0.85** luminance threshold — the load-bearing invariant
`src/world/landmarks.test.ts`/`src/wildlife/fliers.ts`/`src/wildlife/jaguar.ts`
all pin their emissive intensities against), `SMAAEffect`, a subtle
`VignetteEffect`, and an AgX `ToneMappingEffect` that owns the composited
path's single tone-map + sRGB encode (the bare low-tier path grades with the
same AgX mode, applied directly on the renderer instead — see
`src/engine/compositorColor.ts`). Merging into one `EffectPass` costs ONE
fullscreen fragment pass instead of the old chain's three separate blits — a
mobile fill-rate win on top of the color-pipeline swap.

**Postprocessing is a LAZY chunk, gated to the bloom tiers** (review finding on
this slice: an early cut folded it into the eager `three` vendor chunk, making
the low tier download ~74 KB gz it can never use — fixed before merge).
`GameCanvas` reaches `createCompositor.ts` only through a dynamic `import()`
behind the `quality.bloom` gate (the injectable `loadCompositor` seam,
tier-gating pinned in `GameCanvas.compositor.test.tsx`), and `vite.config.ts`'s
`manualChunks` gives `postprocessing` its own **`postfx`** bucket — deliberately
NOT the `three` bucket, which would silently re-eager-load it. Verified in
`dist/`: `index.html` modulepreloads only the `three` chunk; `postfx` +
`createCompositor` are referenced solely from the entry's dynamic-import dep
table (`__vitePreload`), fetched when the gate passes. On medium/high the
engine renders correctly-graded bare frames (AgX on the renderer) until the
chunk arrives, then `Engine.setCompositor` attaches the chain atomically —
colour ownership flips to the `ToneMappingEffect` in the same synchronous step
(progressive enhancement; a failed chunk load degrades to the bare path).

Measured `vite build` (gzip), branch vs `main` at the same base commit,
confirmed against the actual dist chunk listing:

- **Entry chunk:** 90.52 → 91.11 KB (**+0.59 KB** — the compositor wrapper +
  loader seam stay thin; all the new library code lives in the lazy chunk).
- **`three` vendor chunk (eager):** 126.17 → 133.17 KB (**+7.00 KB**, three's
  own 0.169→0.185 growth — the one unavoidable eager cost of the upgrade).
- **`postfx` chunk (lazy, medium/high only):** new, **73.96 KB** + a 0.51 KB
  `createCompositor` split chunk. The whole `postprocessing` library is
  considerably larger than the four single-purpose three-examples classes it
  replaces (SMAA alone ships baked search/area antialiasing lookup data; the
  attribute-merging `EffectPass` machinery is real code) — but only the tiers
  that build the chain ever download it, post-mount, off the TTI path.
- **CSS:** unchanged, 4.54 KB.
- **Initial (eager) JS gzip:** 216.7 → 224.3 KB (**+7.6 KB** — the three
  bump). This is what the LOW tier and time-to-interactive pay; the design
  doc's "low must not get slower" holds for the effects stack (0 extra bytes,
  0 extra passes), with the small three delta as the upgrade's floor cost.
- **Summed JS gzip (all chunks, what `check:bundle` counts):** 216.2 →
  298.1 KB, **101.9 KB** of the 400 KB cap still free. **Total download:**
  257.3 → 339.2 KB, **5.66 MB** of the 6 MB cap still free.

Both caps hold with real headroom, but this swap spent a meaningfully larger
slice of the summed-JS budget than the chain it replaced (`+81.9 KB` here vs
the old chain's `+4.1 KB`, T9) — later visual-overhaul slices that add more
`postprocessing` effects (e.g. slice 2's N8AO) should re-measure against this
new baseline rather than assume similar headroom remains, and anything imported
from `postprocessing` must stay behind the `loadCompositor` seam so it lands in
the `postfx` chunk, never the eager graph.

**Visual-overhaul slice 2 (lighting, 2026-07-11)** added three things: a
sky-driven PMREM environment light (`src/world/envLightSystem.ts`, all
tiers — built directly by `GameCanvas`, not `buildWorld`, since
`THREE.PMREMGenerator` needs the real renderer those composition-root
functions deliberately never touch), N8AO ambient occlusion (`n8ao` `^1.10.3`,
medium/high only, inside the existing lazy `postfx` chunk), and a
player-following texel-snapped shadow frustum (`src/world/shadowFrustumSystem.ts`,
pure CPU-side repositioning of the existing shadow camera — no new GPU
resources, so it costs nothing in this table).

*Draw calls / triangles.* The env-light bake is transient work — a handful of
small (96px) cubemap-face renders through a 2-triangle mini-scene (a private
dome + a small sun-glow disc), run on a schedule (roughly every ~2 seconds
while the palette is actively moving, per `envBakeScheduler.ts`'s tuned
defaults — measured over a full 180s loop in `envBakeScheduler.test.ts`), NOT
a steady per-frame draw-call/triangle cost; low bakes once at load and never
again. N8AO adds fullscreen passes (its AO compute pass plus a depth-aware
half-res upscale — `halfRes: true` on both tiers, a deliberate mobile-fill-rate
default per N8AO's own docs measuring a 2-4x speed win from it), not
draw-calls/triangles in the `PERF_BUDGET` sense, but it IS extra fill-rate
spend on top of bloom/SMAA/vignette — the fill-rate-first mitigation order
(cap DPR → draw calls → overdraw/shadows → triangles) still applies if a
device struggles.

Measured `vite build` (gzip), same method as slice 1 (branch vs the same base
commit, confirmed against the dist chunk listing):

- **Entry chunk:** 91.11 → 92.51 KB (**+1.4 KB** — the new pure world modules
  `envBakeScheduler.ts`/`envIntensity.ts`/`shadowFrustum.ts`/`shadowFrustumSystem.ts`
  plus `dayCycleSystem.ts`'s two new methods, all pulled in eagerly via
  `buildWorld`/`buildGame` on every tier).
- **`three` vendor chunk (eager):** 133.17 → 133.26 KB (**+0.09 KB**,
  effectively unchanged — `PMREMGenerator` was already part of `three`; nothing
  new was added to this chunk).
- **`postfx` chunk (lazy, medium/high only):** 74.47 → 151.72 KB (**+77.25 KB**,
  entirely `n8ao`'s own weight — bloom/SMAA/vignette/tone-mapping are
  unchanged). This is a MUCH bigger add than slice 1 warned about ("later
  slices... should re-measure against this new baseline rather than assume
  similar headroom remains") — n8ao ships a single monolithic bundle (AO
  compute + Poisson-disc denoise + blue-noise tables + half-res upscale
  shaders), and there is no smaller "AO-only" build to reach for without
  vendoring a custom shader, which is out of this slice's scope.
- **CSS:** unchanged, 4.54 KB.
- **Summed JS gzip (`check:bundle`):** 298.1 → **376.7 KB**, only **23.3 KB**
  of the 400 KB cap left free (was 101.9 KB after slice 1). **Total download:**
  339.2 → **417.9 KB**, 5582.1 KB of the 6 MB cap still free.

Both caps still hold (`npm run check:bundle` EXIT=0), but the JS-gzip
headroom is now thin: **the very next slice that adds any meaningful JS
(terrain PBR splatting, water normal maps, or flora GLB decoding logic) should
re-measure before assuming there's room** — 23.3 KB does not survive a second
n8ao-sized library add. If a future slice needs more headroom, the standing
options are (in the team's own fill-rate/bytes-first order): drop `halfRes`
tuning further, reconsider N8AO's inclusion on medium specifically, or accept
the cost against a documented trade so the decision is visible here rather
than silently exhausting the cap.

**Visual-overhaul slice 3 (terrain, 2026-07-11)** replaced the flat-shaded,
untextured-vertex-colour terrain with real PBR texture splatting: 4 CC0
ambientCG ground textures (jungle floor / leaf litter / rock / sand,
`public/assets/LICENSES.md`) blended per-vertex by slope/height/noise
(`src/world/terrainSplat.ts`, a pure module) and applied via the terrain
material's `onBeforeCompile` patch (`src/world/terrainMaterialPatch.ts`, the
`waterPatch.ts` idiom — world-XZ planar UV, `TERRAIN_TILE_SIZE = 6` world
units/repeat). The mesh is now smooth-shaded (`computeVertexNormals`, no more
`flatShading`); the old elevation-band vertex colour survives unchanged as a
macro tint (three's own `diffuseColor.rgb *= vColor` in `color_fragment` runs
on the splatted albedo for free, by anchor ordering alone — no extra GLSL).
Normal maps (medium/high, `quality.terrainDetail === "full"`) blend via a
screen-space-derivative tangent frame (no precomputed UV tangents needed); low
tier omits that block entirely at build time (`quality.terrainDetail ===
"albedo"`) so it never pays for the extra 4 samples/fragment. Texture loading
is async through the existing cached `loadTexture` seam: the terrain renders
its (unchanged) vertex-colour look the instant `buildTerrain` returns and
upgrades in place with ONE material recompile when the textures attach
(`Terrain.texturesReady`) — verified visually (below), not just asserted in
tests.

*Draw calls / triangles.* Zero change — this patches the ONE existing terrain
`MeshStandardMaterial` in place (`waterPatch.ts`'s discipline: no second mesh,
no `ShaderMaterial`), so draw calls and triangle count are unaffected; the
spend is entirely fill-rate (extra texture samples/fragment: 4 albedo every
tier, +4 normal on medium/high) — the fill-rate-first mitigation order (cap
DPR → draw calls → overdraw/shadows → triangles) still applies if a device
struggles with the extra sampling.

*Texture payload.* 8 WebP files — 4 albedo @ q80 (lossy VP8, 1024x1024) + 4
normal maps (lossless VP8L, 512x512, `scripts/process-textures.mjs`) — totalling
**3065.7 KB**, counted at RAW bytes (already-compressed binary, `docs/perf-budget.md`'s
conservative convention) toward the 6 MB initial-download cap:

| File | Bytes (KB) |
|---|---|
| jungle-floor-albedo.webp | 213.7 |
| jungle-floor-normal.webp | 596.6 |
| leaf-litter-albedo.webp | 427.5 |
| leaf-litter-normal.webp | 575.6 |
| rock-albedo.webp | 155.9 |
| rock-normal.webp | 421.4 |
| sand-albedo.webp | 213.4 |
| sand-normal.webp | 461.6 |

**Post-merge review fix (2026-07-11): normal maps were re-encoded lossless.**
The numbers above (and this doc's original slice-3 measurement below) reflect
the FIX; they are not the numbers first shipped. The original pipeline encoded
`*-normal.webp` with `sharp`'s default `lossless: false` (VP8 lossy, q90) at
1024x1024 — a code-review finding caught that VP8's lossy path always runs
through 4:2:0 chroma-subsampled YUV, which smears per-channel normal-map data
(directional vectors, not perceptual colour) into blotchy, muted relief on the
medium/high tiers. The direct fix — `.webp({ lossless: true })` at the
existing 1024x1024 — is CORRECT but not affordable as-is: lossless WebP on a
photographic (noisy) source is dramatically bigger than lossy, measured at
~8.0 MB for the 4 normal maps alone (vs ~1.7 MB lossy), which alone blows the
6 MB total-download cap by ~3.7 MB. The shipped fix keeps the maps lossless
(fixing the corruption) but halves their resolution to 512x512 (albedo stays
1024): the 4 normal maps now total ~2.0 MB, only **+0.36 MB** over the old
(corrupted) lossy baseline. This trades some normal-map surface detail for
correctness, but only on the medium/high tiers that sample it at all (low is
albedo-only) — the perf-budget doc already records the normal-map contribution
as "a subtle normal-map lighting nuance, not a colour/texture change" at this
world's scale, so a lower-resolution but correctly-encoded map reads better
than a full-resolution corrupted one. Verify the encoding with the RIFF fourCC
at byte offset 12 (`xxd -s 12 -l 4 -p file.webp` → `5650384c` / `VP8L`, not
`VP8 `) — macOS `file` does not distinguish VP8 from VP8L.

Measured `vite build` (gzip) + `npm run check:bundle`, same method as slices
1-2 (branch vs the slice-2 baseline: entry 92.51 KB, `three` 133.26 KB,
`postfx` 151.72 KB, CSS 4.54 KB, summed JS gzip 376.7 KB, total download
417.9 KB):

- **Entry chunk:** 92.51 → 94.71 KB (**+2.2 KB** — the new pure modules
  `terrainSplat.ts`/`terrainMaterialPatch.ts`, the texture-attach path in
  `terrain.ts`, and the two new `QualityConfig` fields, all pulled in eagerly
  via `buildWorld` on every tier).
- **`three` vendor chunk (eager):** 133.26 → 134.04 KB (+0.78 KB — three's own
  version is unchanged, `^0.185.1`; this is within normal terser/rollup
  measurement noise across builds, not attributable to new imports from this
  slice — `THREE.RepeatWrapping`/`THREE.NoColorSpace` are pre-existing enum
  exports, not new surface).
- **`postfx` chunk (lazy, medium/high only):** 151.72 → 151.07 KB (-0.65 KB,
  untouched by this slice — build noise).
- **CSS:** unchanged, 4.54 KB.
- **Summed JS gzip (`check:bundle`):** 376.7 → **379.8 KB**, **20.2 KB** of the
  400 KB cap left free (was 23.3 KB after slice 2 — the splat patch fit inside
  the ~20 KB the design flagged as remaining, at +3.1 KB actual). **Total
  download:** 417.9 KB → **3561.1 KB** (the post-fix +3065.7 KB texture payload
  plus the small JS delta), **2438.9 KB** of the 6 MB cap still free (measured
  directly via `npm run check:bundle`).

Both caps hold (`npm run check:bundle` EXIT=0). JS-gzip headroom is still
**very** thin (20.2 KB) — the next slice that adds meaningful JS (water normal
maps, flora GLB decoding) should budget against this number, not slice 2's.
Total-download headroom is comfortable again post-fix (2438.9 KB) — the
naive "just add `lossless: true` at 1024x1024" fix would have left it at
**-3731.7 KB** (over budget), which is why the resolution trade above was
necessary.

**Quality-tier verification.** `npm run verify`'s render gate runs on software
WebGL (`docs/perf-budget.md`'s own software-renderer override), which forces
the LOW tier — so the automated gate exercises the `terrainDetail: "albedo"`
path, not medium/high. Medium/high (`terrainDetail: "full"`, normal maps) were
verified manually: a real Chromium `vite preview` session with
`localStorage`-forced `quality: "low"` vs the default (auto → high on this
machine) confirmed both paths render correctly — the low-tier screenshots are
visually near-indistinguishable from high at this scale (expected: the
difference is a subtle normal-map lighting nuance, not a colour/texture
change), confirming the low path never regressed to a slower OR a worse-looking
result. This is the honest limitation the design doc anticipated: no
in-repo tooling exists to force a quality tier through the *official*
`npm run verify` orchestrator (`scripts/verify-game.mjs` takes no such flag),
so the medium/high confirmation is a manual spot-check, not a repeatable CI
assertion.

## How it is enforced

- **Live:** `StatsOverlay` polls `Engine.getState()` and runs `checkFrame`
  against `PERF_BUDGET` every 250 ms, turning red the instant fps drops or draw
  calls/triangles exceed budget. Toggle-on in dev by default.
- **Tests:** `checkFrame` is unit-tested; perf-tuning work (Epic 6, #48) asserts
  headroom against these constants so a regression fails CI.
- **Bundle:** `npm run check:bundle` (= `vite-node scripts/check-bundle-size.mjs`)
  measures the built `dist/` after `npm run build`, exits non-zero when a cap is
  exceeded, and fails the PR — it is the `Check bundle size` step that runs after
  Build in `.github/workflows/ci.yml`. Two caps are measured, both sourced solely
  from `PERF_BUDGET` (`src/perf/perfBudget.ts`, via `src/perf/bundleBudget.ts`) so
  no threshold is restated here:
  - **JS-gzip cap** — the summed gzip size of the JS chunks (the `kind === 'js'`
    artifacts) vs `maxJsGzipKb`.
  - **Total cap** — every shipped `dist/` artifact vs `maxInitialDownloadKb`,
    where JS/CSS/text count at their gzip size and already-compressed binaries
    (the `'other'` kind: models, textures, audio, fonts) count at their **raw**
    bytes. Counting binaries raw is conservative-by-design — it over-counts a
    hypothetical compressible binary so the gate fails sooner, which a future
    asset/audio slice should budget against rather than treat as a bug.

  The gzip size is also visible in every `vite build`, and `three` is split into
  its own chunk for caching.

### Supply-chain audit

- **Audit:** `npm run audit:ci` (single-sourced in `package.json` as
  `npm audit --omit=dev --audit-level=high`) runs in CI right after `npm ci`,
  before Lint/Build/Test (`.github/workflows/ci.yml`, SEC1 slice 4, #138). It
  is a hard gate: a non-zero exit fails the PR and is never swallowed with
  `|| true` or `continue-on-error`.

  **What blocks.** A **high or critical** advisory in a **shipped** dependency —
  the production closure `react`, `react-dom`, `three`. `--audit-level=high`
  covers **both high and critical**; **moderate and low** advisories in shipped
  deps **do not block** — a deliberate threshold choice, so "audit passes" must
  never be read as "zero advisories."

  **What is knowingly out of scope.** **Dev-only** tooling advisories (the
  `esbuild` / `vite` / `vitest` family) are deliberately excluded: that code
  runs only on the build machine and never reaches a user's browser. They are
  not ignored — they are deferred to H2 and tracked by Dependabot (#137).

  **How the carve-out line is drawn.** `--omit=dev` scopes the audit by
  **dependency-graph membership** — `dependencies` are in, `devDependencies`
  are out — **not** a hardcoded package allowlist. So moving a package into
  `dependencies` predictably **extends** the gate's scope (it becomes shipped,
  and its advisories now block), and that is the intended, legible consequence.

  **Advisory-DB-time-sensitivity.** The gate consults the **live GitHub Advisory
  DB** at run time, so it is not lockfile-deterministic: a brand-new upstream
  advisory can turn a **previously-green PR red with no code change in that PR**.
  That is the gate working as intended. Triage it — infrastructure outage vs. a
  real advisory — and route a real one to Dependabot / H2; **never** silence it
  with `|| true` or `continue-on-error`.

These are living numbers: Epic 6 (#48 perf tuning, #47 quality scaling) tightens
or relaxes them against real device measurement, changing `PERF_BUDGET` in one
place.
