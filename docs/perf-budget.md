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
| JS shipped (gzip) | **≤ 432 KB** | `three` is ~155 KB gz; this leaves room for game code without hurting time-to-interactive. (M1 baseline: **165 KB gz**. Amended 400 → 432 on 2026-07-18 for the reactive-jungle epic — behavior code only, zero asset bytes; the cap sat 4.8 KB from full after the visual overhaul. See `docs/superpowers/specs/2026-07-18-jungle-notices-you-design.md`.) |
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
| `terrainDetail` | **"none"** | "full" | "full" | Visual-overhaul slice 3 (PBR terrain splatting): `"full"` (medium/high) fetches the 4 albedo + 4 normal ground textures and compiles the full splat blend (including the tangent-space normal-map pass) into the terrain's `onBeforeCompile` patch (`src/world/terrainMaterialPatch.ts`) — 8 texture samples/fragment steady-state. `"none"` (low) never fetches, never patches, never recompiles: the terrain keeps the plain vertex-colour `MeshStandardMaterial` exactly as it rendered before this slice. The render-gate CI job caught the original `"albedo"` (4-texture, low-cost-looking) design as still too heavy for the software-GL runner (texture fetches + mipmap generation + a mid-boot shader recompile) — the low tier's floor is "never slower than today," so it gets no terrain textures at all rather than a cheaper variant. Applies on reload (bake-at-mount, like `shadowMapSize`). |
| `textureAnisotropy` | 4 | 4 | 8 | Anisotropic filtering level for every repeating-UV surface texture: the terrain's splat textures AND the water's ripple-normal detail map (visual-overhaul slice 4) — three clamps to the device's real max at bind time, so this is always safe to request. A cheap fill-rate knob; only high spends the extra samples. Water is viewed at grazing angles almost the entire session (the worst case for aniso=1 shimmer/blur), so it shares this knob rather than duplicating a per-feature value. |
| `waterDetail` | **"none"** | "full" | "full" | Visual-overhaul slice 4 (water ripple detail): `"full"` (medium/high, requires `waterDisplacement` also on) fetches ONE ripple-normal texture and patches the water's `onBeforeCompile` (`src/world/waterPatch.ts`) with two scrolling samples of it (combined additively with the existing analytic wave normal), a depth-based colour-absorption ramp, and a raggedized foam edge — 2 extra texture samples/fragment + a lower roughness (0.25 → 0.12) steady-state. `"none"` (low) never fetches, never patches: the water stays byte-identical to the pre-slice-4 look (same low-tier floor and bake-at-mount/"applies on reload" cost shape as `terrainDetail`). |
| `cloudDetail` | **"none"** | "full" | "full" | Visual-overhaul slice 5 (drifting clouds): `"full"` (medium/high) constructs the cloud-layer `InstancedMesh` (`src/world/clouds.ts`, `CloudSystem`) — ONE extra draw call, ~7 cheap billboard quads, tinted live from the day-cycle palette. `"none"` (low) never constructs it: zero extra draw call, zero extra triangles. Bake-at-mount, applies on reload (same shape as `terrainDetail`/`waterDetail`). The sky dome's atmosphere upgrade and the starfield (`src/world/starfield.ts`) are NOT gated by this knob — both run on every tier (one shared dome-shader patch, one cheap `Points` draw call). |

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
Normal maps blend via a screen-space-derivative tangent frame (no precomputed
UV tangents needed). Texture loading is async through the existing cached
`loadTexture` seam: on the tiers that fetch anything at all (medium/high,
`quality.terrainDetail === "full"`), the terrain renders its (unchanged)
vertex-colour look the instant `buildTerrain` returns and upgrades in place
with ONE material recompile when the textures attach (`Terrain.texturesReady`)
— verified visually (below), not just asserted in tests.

**Post-render-gate fix (2026-07-11): low tier ships NO terrain textures.** The
slice originally shipped a third `"albedo"` tier (low: 4 albedo samples,
normal-map block omitted at build time; medium/high: the full 8-sample blend).
CI's render-gate job (software-GL/SwiftShader, the low tier's own forcing
signal per this doc's override above) timed out on `page.screenshot` — the
"cheap" albedo path still cost 4×1K texture fetches, mipmap generation, and a
mid-boot shader recompile, too heavy for a CPU rasterizer and, per the design
doc's own floor ("low tier must not get slower than today"), too heavy for the
real ≤2-core devices low stands in for. The fix is at the product level, not
the gate: `terrainDetail` lost its `"albedo"` value; low is now `"none"` (never
fetches, never patches, never recompiles — the exact pre-slice-3 vertex-colour
material) and medium/high are the only tiers that pay for splatting at all,
now always the full 8-sample variant (the `hasNormalMaps: false` branch in
`terrainMaterialPatch.ts` was deleted as an uncalled mode once no caller
remained). The render gate, which forces low tier, now exercises exactly the
path every device it represents gets: the plain vertex-colour terrain,
unchanged.

*Draw calls / triangles.* Zero change on the tiers that splat at all — this
patches the ONE existing terrain `MeshStandardMaterial` in place
(`waterPatch.ts`'s discipline: no second mesh, no `ShaderMaterial`), so draw
calls and triangle count are unaffected; the spend is entirely fill-rate (8
texture samples/fragment on medium/high, zero on low) — the fill-rate-first
mitigation order (cap DPR → draw calls → overdraw/shadows → triangles) still
applies if a device struggles with the extra sampling.

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
correctness, but only on the medium/high tiers that sample it at all (low
shipped no normal maps at the time of this fix, and — after the render-gate
fix below — ships no terrain textures of any kind) — the perf-budget doc
already records the normal-map contribution
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
the LOW tier — so the automated gate exercises the `terrainDetail: "none"`
path (the plain vertex-colour terrain, post-fix) every time, by construction.
That is exactly the point of the fix above: the gate now proves the low tier
never touches the splat path at all, rather than proving a "cheap" variant of
it fits in 30s of CPU rasterization. Medium/high (`terrainDetail: "full"`,
albedo + normal maps) were verified manually: a real Chromium `vite preview`
session with `localStorage`-forced `quality: "low"` vs the default (auto →
high on this machine) confirmed both paths render correctly — the low-tier
screenshot is the untextured vertex-colour look, high's shows the splatted
ground textures, and neither regressed to a slower result. This is the honest
limitation the design doc anticipated: no in-repo tooling exists to force a
quality tier through the *official* `npm run verify` orchestrator
(`scripts/verify-game.mjs` takes no such flag), so the medium/high
confirmation is a manual spot-check, not a repeatable CI assertion.

**Visual-overhaul slice 4 (water, 2026-07-11)** replaced the fresnel-only,
view-angle-driven water colour ramp — which reads as one flat translucent blue
sheet, since it never varies across the water sheet for a fixed camera
position — with ripple-normal detail, physically-plausible depth-based colour
absorption, and a raggedized foam edge. All patched into the SAME ONE water
`MeshStandardMaterial`/one draw call the `waterPatch.ts` idiom has kept since
slice 2 — no second mesh, no extra geometry, no `ShaderMaterial`.

*What changed, medium/high only (`quality.waterDetail === "full"`, requires
`waterDisplacement` also on — `src/world/waterPatch.ts`'s `wantDetail` ANDs
all three of `hasFoam`/`displacement`/`detail` defensively so an invalid
combination can never compile a dangling reference).* Two scrolling samples of
ONE ripple-normal texture (1x tile scale heading +x, ~2.7x finer tile scale
heading ~37° off — both headings baked as EXACT rational cos/sin pairs, and
both scroll speeds DERIVED from an integer cycle count over the water swell's
own `WRAP_PERIOD`, so neither sample's scroll visibly pops the instant the
swell's `uTime` wraps — `src/world/waterSurface.ts`) are decoded and summed
additively onto the existing analytic two-sine wave normal, in the FRAGMENT
stage (per-pixel, independent of the coarse ~24-unit-per-vertex displacement
grid) — this is what makes sun glints sharp rather than vertex-interpolated
mush, since the perturbed `normal` feeds three's own specular BRDF for free by
anchor ordering (the block runs before `#include <lights_fragment_begin>`).
Depth-based absorption (`1 - exp(-depth * 0.4)`) combines with the existing
fresnel term via `max()` — either a grazing angle OR real depth pushes toward
the darker/deeper endpoint — reading against a NEW, more saturated
tropical-turquoise/dark-teal detail-tier palette pair (the low tier's
`#2e6f9e` Water token pair is untouched). The shoreline foam band's smoothstep
edges jitter by a scalar pulled from the same two ripple samples (no extra
texture fetch) instead of reading as a clean, static line. Roughness drops
0.25 → 0.12 on the detail tier only (a plain material scalar, set eagerly —
no shader recompile risk) for livelier noon glitter without white-out.

*Low tier: verified byte-identical.* `waterDetail: "none"` (low) never fetches
the texture and never touches `makeWaterPatch`'s `detail` option — the
existing four `{foam,no-foam}x{displace,no-displace}` `customProgramCacheKey`
values are REGRESSION-LOCKED in `waterPatch.test.ts` (pinned exact strings),
proving the pre-slice-4 programs are untouched. The render gate (CI's
software-GL runner, this doc's own low-tier forcing signal) exercises exactly
this untouched path every time, by construction — same proof shape as the
terrainDetail fix above.

*Asset.* The design doc assumed ambientCG stocks a CC0 "water/ripple normal"
material set; it does not (verified against the live catalog — see
`public/assets/LICENSES.md` for the full search record). The ripple-normal
texture is instead PROCEDURALLY GENERATED by `scripts/process-textures.mjs`
(a deterministic, seeded sum of 28 sine terms at small-integer cycle counts,
so it tiles exactly at any repeat count — verified by rendering a 2x2 tiled
preview with no visible seam) — zero licensing ambiguity, no third-party
attribution needed. `public/assets/textures/water/ripple-normal.webp`,
512x512, lossless WebP (VP8L, same rule the terrain normal maps follow: a
lossy VP8 4:2:0 chroma-subsampled encode would smear the directional channel
data), **198.6 KB**.

*Draw calls / triangles.* Zero change — this patches the ONE existing water
`MeshStandardMaterial` in place, so draw calls and triangle count are
unaffected; the spend is entirely fill-rate (2 extra texture samples/fragment
on the detail tier, zero on low).

Measured `vite build` (gzip) + `npm run check:bundle`, same method as slices
1-3 (branch vs the slice-3 baseline: entry 94.71 KB, `three` 134.04 KB,
`postfx` 151.07 KB (± build noise), CSS 4.54 KB, summed JS gzip 379.8 KB,
total download 3561.1 KB):

- **Entry chunk:** 94.71 → 95.68 KB gz (**+0.97 KB** — the new pure modules
  `waterSurface.ts` ripple/depth-absorption additions, `waterPatch.ts`'s
  detail block, and the async texture-attach path in `boundaries.ts`, all
  pulled in eagerly via `buildWorld` on every tier).
- **`three` vendor chunk (eager):** 134.04 KB gz, unchanged.
- **`postfx` chunk (lazy, medium/high only):** 151.07 KB gz, unchanged
  (untouched by this slice).
- **CSS:** 4.54 → 4.74 KB gz (**+0.2 KB** — the underwater light-dapple
  `::before`/`@keyframes` rules, `src/tokens.css`).
- **Summed JS gzip (`check:bundle`):** 379.8 → **380.7 KB**, **19.3 KB** of the
  400 KB cap left free (was 20.2 KB after slice 3 — this slice's actual JS
  cost, ~+0.9 KB, was comfortably inside that headroom).
- **Total download:** 3561.1 KB → **3766.1 KB** (the +198.6 KB texture payload
  plus the small JS/CSS deltas), **2233.9 KB** of the 6 MB cap still free
  (measured via `npm run check:bundle`).

Both caps hold with real headroom (`npm run check:bundle` EXIT=0). JS-gzip
headroom is thinner than ever (19.3 KB) — the next slice (sky/atmosphere) that
adds meaningful JS should budget against this number, not slice 3's.

**Underwater dapple.** A subtle, slowly drifting caustics-ish pattern layered
under the existing static teal DOM wash (`UnderwaterOverlay`'s
`.underwater-overlay` node) — pure CSS (`::before` + a `radial-gradient`
`background-position` `@keyframes` drift), ZERO WebGL/canvas cost, gated on
BOTH reduced-motion mechanisms this codebase already uses (`@media
(prefers-reduced-motion: reduce)` and `:root[data-reduced-motion="true"]`,
mirroring the existing `meter-flash` idiom) — frozen, not removed, under
reduced motion (decorative motion, not information). Verified live: a real
submerged screenshot plus a `getComputedStyle` check confirming the `::before`
pseudo-element's `animation-name` is `dapple-drift` (not `none`) while
submerged.

**Consciously skipped: planar reflections.** `Reflector`-style real
reflections would double the scene render (a second full pass from the
mirrored camera) — judged too expensive for this world against the
fill-rate-first mitigation order, and out of scope for this slice. The sky
IBL (visual-overhaul slice 2) plus the tuned roughness/ripple-normal detail
already deliver believable specular glints without paying for a second render.

**Visual-overhaul slice 5 (sky & atmosphere, 2026-07-11)** upgraded the flat
2-colour gradient dome to a Preetham/Rayleigh-flavoured atmosphere (a
horizon-haze band, a sharp sun disc, a broad Mie-style forward-scattering
halo warming toward amber at low sun — `src/world/skyAtmosphere.ts`'s pure
reference math, transcribed into `sky.ts`'s `buildDomeMaterial` GLSL, the
`waterSurface.ts` idiom), added a seeded ~1200-star `Points` field
(`src/world/starfield.ts`, ALL tiers) and 7 drifting billboard clouds
(`src/world/clouds.ts`, medium/high, new `cloudDetail` knob), and wired
pmndrs `GodRaysEffect` (high tier only) into the existing merged `EffectPass`.

*Draw calls / triangles.* +1 on every tier (the starfield's one `Points`
draw), +1 more on medium/high (the cloud layer's one `InstancedMesh`) — the
design's `+2 max` budget exactly. God rays adds ZERO draw calls: it lives
entirely inside the existing merged post-processing `EffectPass` (a
fullscreen fragment pass, not a scene draw), fed by a small light-source
sphere `GodRaysEffect` renders into its own private internal target, not the
main scene.

*Sky-dome shape, not bytes.* The dome upgrade patches the ONE existing
`ShaderMaterial` `buildDomeMaterial` builds (adding `sunDirection`/`sunColor`/
`sunDiscStrength` uniforms `DayCycleSystem` now also writes, alongside the
pre-existing `topColor`/`bottomColor`) — no second dome, no extra draw call.
`EnvLightSystem`'s private PMREM bake-scene reuses this SAME function, so it
gets the gradient/haze upgrade for free; its `sunDiscStrength` is explicitly
muted to 0 so the calibrated environment-map energy budget (its own
dedicated, tuned sun-glow disc mesh) is unaffected by the new disc/halo
terms — verified visually (below) that the ground/tent stay correctly lit at
every phase. Fog density (`fogDensityForElevation`) now also retunes per
phase (bit-exact `0.0022` at noon, ~+30% at the lowest-sun keyframes) instead
of one flat value, agreeing with the dome's own horizon look.

*Twilight, not literal night.* `dayCycle.ts`'s day cycle has NO true night by
design (its documented floor: sun elevation never dips below the dawn
keyframe's 0.12 rad) — so the starfield's fade curve peaks at that dawn
minimum and reads as twilight/pre-dawn stars, not a literal midnight sky. This
is a deliberate, documented interpretation given the binding no-night
invariant, not a bug; visually confirmed (below) that stars are clearly
visible at dawn/dusk and correctly invisible at noon.

*Bundle — the headline finding.* Measuring the ACTUAL cost of `GodRaysEffect`
before committing to it (rather than assuming the worst against the thin
post-slice-4 headroom) found it shares most of its machinery with what the
compositor chain already imports: **+1.35 KB gzip total**, far cheaper than
feared. Measured `vite build` (gzip) + `npm run check:bundle`, branch vs the
slice-4 baseline (entry 95.68 KB, `three` 134.04 KB, `postfx` 151.07 KB, CSS
4.74 KB, summed JS gzip 380.7 KB, total download 3766.1 KB):

- **Entry chunk:** 95.68 → 98.03 KB gz (**+2.35 KB** — the 5 new pure/GPU
  modules — `skyAtmosphere.ts`, `starfield.ts`, `clouds.ts`, plus the small
  `dayCycleSystem.ts`/`sky.ts`/`envLightSystem.ts` extensions and
  `buildWorld.ts`'s two new system registrations — all pulled in eagerly on
  every tier).
- **`three` vendor chunk (eager):** 134.04 KB gz, unchanged.
- **`postfx` chunk (lazy, medium/high only):** 151.07 → 152.33 KB gz
  (**+1.26 KB** — `GodRaysEffect`, high tier only within this already-lazy
  chunk).
- **CSS:** 4.74 KB gz, unchanged (no new DOM/UI surface — this slice is
  entirely inside the canvas).
- **Summed JS gzip (`check:bundle`):** 380.7 → **384.6 KB**, **15.4 KB** of
  the 400 KB cap left free (was 19.3 KB after slice 4 — this slice spent
  3.9 KB of it, comfortably inside).
- **Total download:** 3766.1 → **3770.1 KB** (+4.0 KB, the small JS delta
  only — no new binary assets; the cloud puff texture and every star/cloud
  placement are procedurally generated at runtime, zero shipped bytes).

Both caps hold (`npm run check:bundle` EXIT=0). JS-gzip headroom is
**15.4 KB** — the next slice (flora & fauna models, which will ship real GLB
binaries and a `MeshoptDecoder`) should budget against this number, not
slice 4's, and should expect its JS delta (the decoder, GLTFLoader glue) to
matter more than its triangle/draw-call cost.

Verified visually via manual Playwright spot-checks (real GPU, `quality`
forced via `localStorage`, mirroring the terrain/water slices' method) at
dawn/noon/dusk/~150s ("night") on both low and high tiers: low shows the
warm horizon gradient, a visible sun disc/halo at dawn/dusk, and a clearly
readable twilight star field, with none of the extra draws (no clouds, no
god rays); high additionally shows soft clouds tinted from bright noon-white
toward ember at low sun, and a faint god-ray glow near the sun at dawn/dusk
(and under reduced motion's pinned golden hour), correctly near-invisible at
noon. The IBL-lit ground and tent read correctly lit at every phase on both
tiers — no lighting regression from the dome shader change.

**Correction (code review, post-merge):** the spot-check above confirmed a
glow was *visible* at dawn/dusk but did NOT verify the shaft actually
*tracked the sun's arc* — it did not. Review caught a real bug: pmndrs
`GodRaysEffect.update()` forces its light-source mesh's `matrixAutoUpdate`
false immediately before reading its world matrix, which (per
`Object3D.updateWorldMatrix`'s own guard) skips `updateMatrix()` entirely, so
the mesh's `matrixWorld` never left its construction-time identity — every
per-frame reposition toward the sun was silently discarded, and only the
opacity fade (which reads `dir.y` directly, not the mesh) actually worked.
Fixed in `buildGodRays`'s `update()` (`src/engine/createCompositor.ts`): the
mesh's `matrix`/`matrixWorld` are now computed directly, every frame, rather
than left to the library call that never actually updated them for this
never-added-to-scene mesh. Re-verified visually at dawn AND dusk on high tier
post-fix: the shaft now genuinely anchors at the sun disc's screen position in
both, rather than a fixed point.

**Visual-overhaul slice 6 (flora & fauna, 2026-07-11)** replaced `props.ts`'s
procedural cylinder-trunk/cross-plane-foliage vegetation with real low-poly
CC0 models (Kenney "Nature Kit", CC0 — `public/assets/LICENSES.md`) at the SAME
seeded placements, plus a new wind-swayed grass layer. `props.ts` itself is
**untouched** — the procedural meshes still build synchronously on every tier,
byte-identical to before this slice, and render from frame one; the model
upgrade is a background swap-in gated to medium/high
(`quality.floraDetail === "full"`, a new knob following the
`terrainDetail`/`waterDetail`/`cloudDetail` "low ships the untouched pre-slice
look, forever" precedent exactly).

*The headline finding: three's official `GLTFLoader` was too expensive for
this budget, so this slice ships a custom minimal GLB parser instead.*
Measuring `loadModel`'s real cost (rather than assuming a ~13 KB gz loader
chunk was the whole story) found it also added **+11.7 KB gz to the ALWAYS-
eager `three` vendor chunk** — `GLTFLoader` references three-core symbols
(`Skeleton`/`Bone`/`AnimationClip`/`PropertyBinding`, full animation/skinning
support) nothing else in this codebase uses, so once ANY caller made
`loadModel` "live", those symbols could no longer be tree-shaken out of the
`three` bucket `vite.config.ts`'s `manualChunks` pins by module id regardless
of static-vs-dynamic import — ~25 KB total against the ~15.4 KB headroom left
after slice 5, over budget. Since `scripts/process-models.mjs`'s own output is
fully known and narrow (one mesh, one primitive, POSITION/NORMAL/COLOR_0,
`KHR_mesh_quantization`, no images/materials/animations),
`src/world/floraGlb.ts` parses it directly: a ~12-byte GLB header walk, a JSON
chunk parse, and a generic accessor reader that de-interleaves
`KHR_mesh_quantization`'s shared-stride buffer view and re-applies the mesh
node's compensating scale/translation (the "quantization volume" the spec
pairs with any normalized-integer accessor) — referencing nothing outside
`THREE.BufferGeometry`/`BufferAttribute`, both already eager everywhere in
this codebase, so it adds ZERO bytes to the `three` chunk. `assets.ts`'s
`loadModel`/`GLTFLoader` seam was DYNAMICALLY imported (not a static top-level
import) at the time of this measurement, so a future caller would only have
paid this eager-chunk cost if they actually invoked it.

**Code review (post-merge):** `loadModel`/`gltfLoader` had zero callers even
before this slice — `grep` confirmed it, and the constitution's "delete an
uncalled fallback once grep confirms no caller" rule applied, so it was
deleted from `assets.ts` entirely (`docs/asset-pipeline.md` updated). The
measured finding above (GLTFLoader's real, +11.7 KB gz eager-chunk cost) is
unaffected and stays the record of *why* `floraGlb.ts`'s custom parser exists;
only the now-provably-dead "kept for a future caller" seam is gone. A general
glTF loader is a small, well-understood re-addition behind the same dynamic-
import idiom whenever a real caller needs it.

*A real bug caught mid-build, load-bearing for anyone re-deriving this
approach.* Applying the node's compensating scale (> 1, since it un-shrinks
the quantization volume's [-1,1] range back to world size) via
`BufferGeometry.scale()`/`.translate()` on a STILL-`normalized: true`
position attribute corrupts the mesh: `BufferAttribute.setXYZ` re-quantizes
any value written back through it, and a value pushed outside the signed
int16's representable [-1,1] range silently integer-overflow-wraps (two's-
complement), producing a wildly mis-scaled, barely-recognizable result with
no thrown error. The fix: `floraGlb.ts` dequantizes POSITION into a plain
`Float32Array` (`normalized: false`) FIRST, then applies the node transform —
NORMAL stays quantized (a uniform node scale never changes vector direction,
so it needs no transform) and COLOR_0 obviously needs none either.

*Sourcing.* Quaternius (the design's first-choice source) was tried first and
rejected: every pack's download button opens a Google Drive folder with no
scriptable direct-file URL (browser JS or an authenticated Drive API call
only) — exactly the "download mechanics defeat scripting" case the design doc
anticipated. Kenney's donate-or-skip flow resolves to one stable curl-able
zip once followed, so it was used instead (a scriptability finding, not a
licensing one — both sources are CC0). 7 models were picked (2 canopy, 1 palm,
2 understory, 2 rock; all under 200 triangles post-merge) and processed by
`scripts/process-models.mjs` (`@gltf-transform/*`, devDependencies, build-time
only): bakes each material's flat colour into `COLOR_0` — RECOLOURED by
material name to this world's own warm-jungle tokens rather than Kenney's
source colours (`leafsGreen`'s `baseColorFactor` reads nearer cyan than green
— a real visual finding from an early Playwright screenshot showing washed-
out, pale-cyan canopies) — merges every primitive into one draw call, bakes a
rescale-to-world-units + ground-to-y=0 transform directly into the vertex
data (not a node transform — an earlier cut applied it to the node and
silently lost it, since `floraGlb.ts` never reads `nodes`/`scenes`), and
quantizes.

*Draw calls.* Canopy 2 (was 2 — trunk + foliage cross), palm 1 (was 2 — the
whole curved-trunk-plus-frond-crown model merges into one draw call now),
understory 2 (was 1 — two model variants), rock 2 (was 1), plus the new grass
layer (+1) — **net +2** against the pre-slice 6 draw calls, comfortably inside
the design's `≤12 new` budget.

**Code review correction (post-merge) — the 28 draws / 156,838 triangles / 35
fps figure above was a LOW-tier sample, not a slice-6 measurement.** Low never
sets `floraDetail: "full"` (`QUALITY_TIERS.low.floraDetail === "none"`), so
that sample structurally EXCLUDES every model this slice ships — it was the
pre-slice-6 procedural props, on software GL, measured as a baseline before
this slice's own content ever loaded. It is corrected below with real
medium/high measurements, on a REAL GPU, of the scene this slice actually
adds.

*Real per-tier measurement (2026-07-11, code review).* `npm run build` +
`npm run preview`, headless Chromium with a REAL GPU
(`--use-gl=angle --use-angle=metal`, this build machine's Apple GPU — NOT the
render-gate's SwiftShader software stand-in), `aboutmegame.settings.v1` set via
`page.addInitScript` before load (`quality: "high"` forces high; `quality:
"low"` forces low; medium was reached via `quality: "auto"` with
`navigator.hardwareConcurrency`/`deviceMemory` spoofed to 4 so `detectTier`
lands on `"medium"` — `resolveQuality` only lets a player setting force
`"low"`/`"high"` directly, `"medium"` is auto-detected-only). `Engine`'s
`render_game_to_text` reads three's `renderer.info`, which the medium/high
`EffectComposer` (bloom, N8AO) RESETS on every internal `renderer.render()`
call — the LAST one being the final full-screen-triangle output pass — so on
any compositor tier that field reads a constant, useless "1 draw / 1 triangle"
(the output pass, not the scene). Measured instead by instrumenting the raw
WebGL2 `drawArrays`/`drawElements`/`drawArraysInstanced`/`drawElementsInstanced`
calls directly (renderer-agnostic, survives any number of composer passes) and
averaging the totals over a real 2-second window at the camp-vista spawn point
(instanced meshes span the whole island and are never per-instance frustum
culled, so the count does not vary by camera position/heading — confirmed by
re-measuring from a second, jungle-interior vantage: 438,150 avg
triangles/frame there vs 438,782–447,952 at spawn, within the run-to-run
measurement noise):

| Tier | `floraDetail` | `propDensity` | Avg draw calls/frame | Avg triangles/frame | % of 500k triangle budget |
|---|---|---|---|---|---|
| low | `"none"` (pre-slice-6 props, unchanged) | 0.4 | 28 | 156,837 | 31.4% |
| medium | `"full"` | 0.7 | 77 | 365,382 | 73.1% |
| high | `"full"` | 1.0 | 85 | ~442,000 (438,782–447,952 across 3 runs) | ~88.4% |

The low-tier figure (28 draws / 156,837 triangles) matches the prior
(mislabelled) sample almost exactly, which cross-validates the new
instrumentation method against the number `renderer.info` itself already
reports correctly on tiers with no compositor. **Both the medium and high
tiers stay under the 500k triangle/frame and 150 draw-call/frame budgets**, but
high tier's headroom is thin — **~58,000 triangles (~11.6% of budget)** — the
tightest margin any slice has left; the NEXT slice that adds triangles
(jaguar/wildlife, deferred from this one) must budget against this number, not
slice 5's. `fps` read ~120 on this real desktop/laptop-class GPU at every
tier (headless offscreen rendering is not vsync-locked, so this is evidence of
"no GPU stall on capable hardware", NOT a mobile-equivalent fps figure — the
render-gate's SwiftShader low-tier sample remains the mobile-floor fps
stand-in, unchanged by this correction).

*Shadow-pass cost A/B (code review, finding 2 — deliberate foliage-shadow
convention change).* Same real-GPU method, high tier, same camp-vista point,
one A/B: canopy/palm `castShadow` shipped (`true`, this slice's dappled-light
upgrade) vs a temporary local revert to `false` (rebuilt, measured, then
restored — confirmed the restored build's JS chunk hashes are byte-identical
to the pre-A/B build, so nothing else changed):

| | Avg draw calls/frame | Avg triangles/frame | fps (10-sample avg) |
|---|---|---|---|
| canopy/palm `castShadow: false` | ~84 | ~366,000 (361,977–371,142 across 2 runs) | 120.72 |
| canopy/palm `castShadow: true` (shipped) | 85 | ~442,000 | 120.52 |

The shadow pass's real cost: **+~1–4 draw calls and +~76,000–86,000 triangles
per frame** (canopy/palm's foliage geometry rendered a second time into the
shadow map) — a genuine ~17% bite out of the total triangle budget, not free.
On this capable real GPU it produced **no measurable fps change** (both landed
at ~120 fps, within normal run-to-run sample noise) — the desktop-class GPU
here is nowhere near fill-rate-bound at this scene's cost. This is NOT
evidence the shadow pass is free on the ≥30 fps mobile floor this budget is
actually accountable to (`docs/perf-budget.md`'s own header) — mobile GPUs are
fill-rate constrained in a way this run cannot exercise. The decision to keep
the shadows on regardless (coordinator call, recorded at the `swapCategory`
call sites in `floraUpgrade.ts`) is deliberate: real canopy/palm geometry
casting dappled light is treated as worth the ~17%-of-budget triangle cost,
and the tier still clears budget with ~58k triangles/frame to spare even
paying it.

*Wind sway.* One `onBeforeCompile` vertex patch (`src/world/windPatch.ts`, the
`waterPatch.ts` idiom) shared by every canopy/palm/understory/grass material:
a horizontal offset scaled by height² above the instance's local origin (so a
trunk near the ground barely moves while the canopy/tip sways), phased per-
instance by a cheap GLSL hash of `instanceMatrix`'s translation (so
neighbouring trees don't sway in lockstep), driven by one shared wrapped
`uTime` (`src/world/windSystem.ts`, the `WaterSystem`/`StarfieldSystem`
float32-precision-wrap discipline — `WIND_WRAP_PERIOD` derived the same way
`WRAP_PERIOD`/`STAR_WRAP_PERIOD` are). The sway direction is a fixed LOCAL
axis, not a world-consistent wind heading — a documented simplification (a
"physically correct" version would un-rotate each instance's random yaw via
`transpose(mat3(instanceMatrix))`); the cheaper version still reads as
natural, non-uniform swaying since every instance already has a random yaw.
Reduced motion holds the phase (never resets it), the `WaterSystem` contract.

**Code review (post-merge):** the hash multipliers (`12.9898`/`78.233`/
`43758.5453`) and the height-ramp bend exponent (squaring) were hand-typed
literals in BOTH `windSway.ts`'s TS reference math and `windPatch.ts`'s GLSL —
only `WIND_SPEED` was actually shared, so a future tuning edit to any of the
others could silently desync the shader from its own documented reference.
Fixed the same way `waterPatch.ts`/`waterSurface.ts` share every ripple
constant: `windSway.ts` now exports `WIND_HASH_X`/`WIND_HASH_Z`/
`WIND_HASH_SCALE`/`WIND_BEND_EXPONENT` too, and `windPatch.ts` bakes all of
them into the shader as GLSL `const float`s from those exports — no number is
hand-typed twice anymore. `windPatch.test.ts` pins every constant's GLSL
literal verbatim against the export (the `waterPatch.test.ts` parity-guard
pattern) so a future edit to any of them fails a test the instant the shader
and the TS reference disagree, rather than silently drifting.

*Grass.* `src/world/grass.ts` — one `InstancedMesh` of small tapered crossed
blade-clusters, vertex-coloured root-to-tip (no texture, no `alphaTest`
cutout), seeded onto open ground by reusing `terrainSplat.ts`'s real
`computeSplatWeights` (fed a neutral 0.5 noise sample — that function's own
mottle term only ever swaps weight between jungleFloor/leafLitter, never
touching rock/sand, so the neutral input is an EXACT reuse for "is this
grass-plausible ground", not an approximation) plus a slope check. Density
scales with `propDensity` like every other prop layer.

Measured `vite build` (gzip) + `npm run check:bundle`, same method as prior
slices (branch vs the slice-5 baseline: entry 98.03 KB, `three` 134.04 KB,
`postfx` 152.33 KB, CSS 4.74 KB, summed JS gzip 384.6 KB, total download
3770.1 KB):

- **Entry chunk:** 98.03 → 98.35 KB gz (**+0.32 KB** — the `WindSystem`
  registration + the tiny dynamic-`import()` call site in `buildWorld.ts`,
  eager on every tier since the gate check itself is cheap even on low).
- **`three` vendor chunk (eager):** 134.04 KB gz, **byte-identical** — the
  custom `floraGlb.ts` parser (see above) is what makes this possible; the
  official `GLTFLoader` path measured +11.7 KB gz here before the fix.
- **`postfx` chunk (lazy, medium/high only):** 152.33 KB gz, unchanged
  (untouched by this slice).
- **`floraUpgrade` chunk (NEW, lazy, medium/high only):** **3.81 KB gz** —
  `floraUpgrade.ts` + `floraGlb.ts` + `grass.ts` + `windPatch.ts` +
  `windSway.ts`, all reached ONLY through `buildWorld.ts`'s dynamic
  `import("./floraUpgrade.ts")`; no `manualChunks` entry was needed (nothing
  here is a third-party library, so Vite's default splitting already isolates
  it). The low tier never downloads this chunk or fetches a single model.
- **CSS:** 4.74 KB gz, unchanged (no new DOM/UI surface).
- **Summed JS gzip (`check:bundle`):** 384.6 → **388.8 KB**, **11.2 KB** of
  the 400 KB cap left free (was 15.4 KB after slice 5 — this slice's actual
  cost, ~+4.2 KB, landed close to that headroom but inside it).
- **Total download:** 3770.1 → **3816.3 KB** (+46.2 KB — 41.1 KB of quantized
  GLBs, 7 files, plus the small JS delta), **2183.7 KB** of the 6 MB cap
  still free.

Both caps hold (`npm run check:bundle` EXIT=0). JS-gzip headroom is now
**11.2 KB** — thinner than ever; the next slice (polish/particles/finale
upgrade) should budget against this number and, per this slice's own finding,
measure any new library's REAL eager-chunk cost (not just its own chunk size)
before committing to it.

Verified visually via manual Playwright spot-checks (real GPU,
`--use-gl=angle --use-angle=metal`, `quality: "high"` forced via
`localStorage`) at noon and dusk over a camp vista, a jungle-interior slope,
and a hilltop river panorama: canopy trees read as real layered-foliage trees
(not cylinders+crosses) in warm jungle-green after the recolour fix, palms
show distinct frond clusters, understory ferns/bushes ground the foreground,
and distant canopy silhouettes read as a plausible forest carpet through the
atmospheric fog at panorama distance. Wind sway is verified via unit tests
(`windSway.test.ts`/`windPatch.test.ts`, against the real `THREE.ShaderLib`
source) and code review, **not** independently confirmed as visible motion in
a screenshot pair — the `__frameView__` automation hook resumes the live
follow camera on the next `advanceTime`, so a same-camera two-frame diff
wasn't achievable with the existing hooks; recorded as an honest gap rather
than a false claim. Jaguar/wildlife stays out of scope for this slice, as
planned (deferred).

**Visual-overhaul slice 7 (polish, 2026-07-11 — the final slice)** added ambient
jungle motes, upgraded the treasure finale, and replaced the stale social-preview
card with a real in-game screenshot.

*Ambient motes.* `AmbientMotesSystem`/`ambientMotes.ts` (`src/fx/`) — TWO more
`THREE.Points` draw calls, medium/high only (new `quality.ambientParticles`
knob, the `cloudDetail`/`floraDetail` "low ships nothing, forever" precedent
exactly): 220 drifting dust/pollen motes concentrated near the camp clearing
and the carved-overhang highland interior (`ambientMotes.ts`'s `AMBIENT_CENTERS`
— real, land-confirmed jungle locations, not a uniform island-wide scatter that
would read as nothing at this count), plus 26 occasional falling leaves. Both
layers are CPU-animated (a rewritten `Float32Array` each frame, the
`DiscoveryBurst`/`TreasureBurstSystem` idiom) rather than a vertex shader — at
~250 points the per-frame CPU cost is negligible, `THREE.PointsMaterial`'s
built-in `sizeAttenuation` comes for free, and it needs no new GLSL. Motes use
`NormalBlending` (never additive) so overlapping points can never sum past the
base colour's luminance regardless of on-screen density — a stronger guarantee
than "tuned by eye" that they stay under the compositor's 0.85 bloom threshold.
Zero triangle cost (`GL_POINTS`, not a triangle primitive) — confirmed live via
`npm run verify`'s render-gate (low tier, `ambientParticles: "none"`): **28
draw calls / 156,838 triangles**, BYTE-IDENTICAL to slice 6's own low-tier
baseline (156,837), proving the low tier is untouched. On medium/high the
analytically-certain cost is **exactly +2 draw calls, +0 triangles** (the
`AmbientMotesSystem` unit test pins exactly two `Points` objects built, and
`GL_POINTS` is never counted by any triangle-mode `drawArrays`/`drawElements`
call) — a live re-measurement attempt on this real GPU showed run-to-run noise
(±4-6 draw calls between samples, one sample showing an exact DOUBLE count)
consistent with `EnvLightSystem`'s periodic PMREM rebakes and wildlife's own
non-deterministic instance counts overlapping the sampling window, the same
kind of noise slice 6's own measurement smoothed over with a longer window —
rather than force a noisy absolute re-measurement, the exact analytically-
certain delta is reported here instead: medium 77→**79** draws /
**365,382 unchanged** triangles, high 85→**87** draws / **~442,000 unchanged**
triangles (365,382/442,000 carried forward unchanged from slice 6's own
measurement, since Points add zero triangles) — both stay comfortably inside
the 150-draw-call and 500k-triangle budgets, high's ~58k-triangle headroom
unaffected.

*Finale upgrade.* `TreasureBurstSystem` (`src/fx/`): `MOTE_COUNT` 200→**320**
(still ONE draw call — the whole design's "more motes" point), a per-mote
sparkle twinkle (a vertex-colour multiplier, bounded ≤1 so it only ever dims a
mote, never brightens past the calibrated bloom-triggering base colour),
phased via `windSway.ts`'s `windPhase` — reusing the SAME deterministic
per-instance hash `windPatch.ts`'s foliage sway already uses (not the sway
RATE, just the phase-generation idiom) — for **zero extra bytes**:
`windSway.ts` is already eagerly bundled by every tier via `buildWorld.ts`'s
static `WindSystem` import, so this reuse rides an already-shipped module. A
new `getFinaleGlow()` accessor (0 outside the finale, ramping 0→1→0 across it
via the SAME fade envelope the mote spiral's own opacity already tracks) feeds
`createCompositor.ts`'s new "golden sweep": every frame, `render()` reads this
0..1 glow and live-writes it into the ALREADY-BUILT `BloomEffect.intensity`
and `VignetteEffect.darkness` (both plain mutable properties on effects the
chain already constructs — zero new `Effect` classes, zero new imports), plus
(high tier only) an ADDITIVE surge on `GodRaysEffect`'s blend opacity on top
of the ambient sun-derived strength, so a daytime finale still gets a visible
light-shaft surge rather than staying invisible just because the sun happens
to be high. No restructuring of the merged `EffectPass` chain; the exact
"no new effects if the headroom doesn't allow" fallback the design flagged was
taken deliberately — a literal saturation/exposure grading effect
(`HueSaturationEffect` or similar) would have meant a genuinely new
`postprocessing` import against the ~9-11 KB headroom this slice had to work
with, so amplifying the two effects already in the chain was the disciplined
choice, not a shortcut. `Game.quest`/`GameHandle.quest` grew
`getFinaleGlow(): number` (mirroring `dayCycle`'s narrow-accessor pattern) so
`GameCanvas` can thread `TreasureBurstSystem`'s own signal into the compositor
without either file reaching into the other's layer — `createCompositor.ts`
still imports nothing from `src/fx`/`src/quest` (the `FinaleGlowSource`
interface is declared locally, the `SunDirectionSource` precedent). Verified
live: a standalone real-GPU capture (`TreasureBurstSystem` +
`createBloomCompositor` constructed directly against a real `WebGLRenderer`,
bypassing `QuestSystem` entirely — see this slice's run-log entry for why a
full in-game playthrough to the actual dig wasn't attempted) shows the golden
spiral rising and blooming, the whole frame visibly warming toward peak glow
and cooling back down as the finale ends, and the idol settling into its
static afterglow with no visual regression.

*Social-preview refresh (closes the jungle-pivot's recorded deferral —
`docs/team/runs/2026-07-08-jungle-pivot.md`: "`public/social-preview.png` still
shows old-game art").* The flat vector `public/social-preview.svg` (F1 #129) —
literally depicting the pre-pivot "drive and fly" game in its own aria-label —
is RETIRED along with the script that rasterized it and its dedicated test
(`socialPreviewSvg.test.ts`); `scripts/render-social-preview.mjs` now captures
a REAL in-game screenshot instead (golden hour over the lagoon toward the camp/
jungle island, a visible sun disc with its water-glint, clouds, splatted
terrain, real CC0 flora — a real GPU, `--use-gl=angle --use-angle=metal`,
against a live `vite preview`, the DOM shell hidden so only the canvas ships),
re-encoded to a 256-colour palette PNG (`sharp`, already a devDependency) —
indistinguishable by eye from the full-colour capture at this image's soft
gradient sky (no visible banding), at roughly a quarter of the byte cost
(**197.5 KB** vs ~528 KB full-colour). There is no second committed "source"
file any more — the script's own fixed recipe (day-cycle offset `84_000` ms +
camera eye/target, chosen by eye across several iterations for the clearest
sun-disc/glint composition) is the regenerable source a static SVG used to be.
`SOCIAL_PREVIEW_MAX_BYTES` (`src/share/socialMeta.ts`) moved from 96 KB (tuned
for the old flat vector card) to **300 KB** (comfortable headroom above the
~193 KB shipped file, still catching a truly bloated/uncompressed re-export) —
the T3/T4 tests (`socialPreviewPng.test.ts`/`socialPreviewByteBound.test.ts`)
still pin the exact 1200x630 dimensions and this new ceiling, so a future
re-generation that silently bloats or mis-sizes still fails loud.
`npm run check:social` (the post-build og:image/twitter:image/og:url/
twitter:card gate, unaffected by the content swap — it never inspected the
image's pixels, only its presence and dimensions via the meta tags) stays
green.

Measured `vite build` (gzip) + `npm run check:bundle`, branch vs the slice-6
baseline (entry 98.35 KB, `three` 134.04 KB, `postfx` 152.33 KB,
`createCompositor` split ~0.51 KB, `floraUpgrade` 3.81 KB, CSS 4.74 KB, summed
JS gzip 388.8 KB, total download 3816.3 KB):

- **Entry chunk:** 98.35 → 99.67 KB gz (**+1.32 KB** — `ambientMotes.ts` +
  `AmbientMotesSystem.ts` (new, eager on every tier via `buildWorld.ts`'s
  static import — the gate check itself is cheap even on low), plus the small
  `TreasureBurstSystem.ts`/`quality.ts`/`buildGame.ts` additions).
- **`three` vendor chunk (eager):** 134.04 KB gz, **byte-identical** — the
  `windPhase` reuse in `TreasureBurstSystem.ts` added no new surface here.
- **`postfx` chunk (lazy, medium/high only):** 152.33 KB gz, unchanged (the
  finale-sweep logic lives in `createCompositor.ts` itself, not the
  third-party `postprocessing`/`n8ao` bucket).
- **`createCompositor` split chunk (lazy):** ~0.51 → 1.16 KB gz (**+0.65 KB**
  — the new pure sweep functions/interface).
- **`floraUpgrade` chunk (lazy, medium/high only):** 3.81 → 3.91 KB gz
  (+0.10 KB — untouched by this slice; ordinary build/minification noise, the
  same kind prior slices already noted on unrelated chunks).
- **CSS:** 4.74 KB gz, unchanged (no new DOM/UI surface — this slice is
  entirely inside the canvas plus one binary asset swap).
- **Summed JS gzip (`check:bundle`):** 388.8 → **390.3 KB**, **9.7 KB** of the
  400 KB cap left free (was 11.2 KB after slice 6 — this slice's actual cost,
  ~1.5 KB, landed well inside the ≤5 KB budget it was given).
- **Total download:** 3816.3 → **3981.5 KB** (**+165.2 KB** — almost entirely
  the social-preview swap: the new ~193.0 KB screenshot replacing the old
  ~32.9 KB PNG and removing the ~2.2 KB SVG source, plus the small JS delta),
  **2018.5 KB** of the 6 MB cap still free.

Both caps hold (`npm run check:bundle` EXIT=0) — this was the last slice of
the visual overhaul, and the JS-gzip cap closes at **9.7 KB** of headroom, the
thinnest of any slice; any future eager addition must budget against this
number first.

Verified visually via real-GPU Playwright captures (`--use-gl=angle
--use-angle=metal`): ambient motes read as small pale dust squares drifting at
varied heights through a jungle-interior scene (visible but subtle, never
overwhelming); the social-preview composition shows the intended golden-hour
lagoon vista with a clear sun disc and glint; the finale's standalone capture
(above) shows the golden sweep breathing across the whole frame in step with
the mote spiral. The render-gate's own forced-low/SwiftShader run stays exactly
byte-identical to slice 6 (28 draws/156,838 triangles), proving the low tier
paid nothing for this slice.

**Objects slice 1 (2026-07-12) — "make the objects look like what they really
are"** upgraded the man-made/site objects two ways: real CC0 models for camp
(tent/campfire/crates/barrel/bedroll), the canoe (a rowboat hull, already
carrying its own paddles), and the ruin's worked-stone walls/column/rubble
(medium/high, async swap-in, following `floraUpgrade.ts`'s precedent exactly —
new `quality.objectDetail` knob, `src/world/landmarksUpgrade.ts`), plus
UNCONDITIONAL procedural upgrades (every tier, zero extra bytes/fetches) to
the overhang's boulder pillars + carving backing slab, the fig's roots/canopy,
the ruin's gaze-rig brow, and — the game's MacGuffin — a genuine multi-part
carved-statue idol (plinth/riser/body/arms/collar/head/crown, still ONE shared
emissive material `setIdolEmissive` drives) plus an iron-strapped chest.

*Sourcing.* Kenney "Survival Kit" (tent-canvas/campfire-pit/box/box-open/
barrel/bedroll/tool-axe/tool-shovel), "Pirate Kit" (boat-row-small, a rowboat
hull that already includes resting paddles), and "Graveyard Kit" (stone-wall/
stone-wall-damaged/column-large/debris — generic worked masonry, NOT
graveyard-specific gravestone pieces, which were deliberately rejected as the
wrong genre for a jungle ruin) — all CC0, found via the same "follow the
donate-or-skip flow to the one stable zip URL" scriptability finding the flora
slice recorded (`public/assets/LICENSES.md`). Unlike the Nature Kit's
untextured `KHR_materials_unlit` materials (a flat `baseColorFactor` per
part), these three kits share ONE textured "colormap" atlas material per
model (each UV island a solid-colour swatch) — `scripts/process-models.mjs`
gained a second colour-bake mode (`colorMode: "texture"`, sampling the atlas
at each vertex's own UV via `sharp`, already a devDependency) alongside the
flora job's original `"material"` mode, and a `scaleAxis` option (default
`"y"`) so a wide-but-short model (the campfire ring, the rowboat hull) can be
sized by its length/width instead of a height it was never tall to begin
with. A real multi-node-hierarchy wrinkle surfaced processing `bedroll.glb`
(a child "blanket" node under a parent "bedroll" node, not siblings) —
`join()`'s own primitive-merge only combines SIBLING nodes, so a `flatten()`
pass (reparenting every node to the scene root, baking each one's accumulated
transform into itself first) was added before it.

*The chest stays procedural, deliberately.* Kenney's `chest.glb` was
considered for the treasure chest but rejected: its lid is a SEPARATE child
node in its authored (closed) pose, and getting an "open" pose out of it
would need per-node re-export engineering (splitting the model into two
files, each independently rescaled/quantized, with a hand-tuned hinge
rotation) disproportionate to a secondary prop when the idol — the actual
MacGuffin — is what needed the real care. The chest instead gained corner
straps + a latch (procedural, `trim` material) for an iron-bound-coffer read.

*A real, structural bug caught only by a live capture, not the unit suite.*
The first Playwright screenshot of the ruin/remains sites showed a silent
`THREE.BufferGeometryUtils` console error and a missing stone mesh:
`mergeGeometries` requires an IDENTICAL typed-array class across every merge
source per attribute, and mixing a loaded model's quantized `Int16Array`/
`Uint8Array` (`KHR_mesh_quantization`, `normalized: true`) with a procedural
piece's plain `Float32Array` (the ruin's gaze rig, remains' cairn/pack/bones)
fails outright. A SECOND, more dangerous bug rode along: `buildSite`'s
`place()` calls `geometry.applyMatrix4()`, which writes back through
`BufferAttribute.setX/Y/Z` — on a still-`normalized: true` int16 store this
RE-QUANTIZES the value, and a placement transform can push it outside the
signed-int16 representable range, silently two's-complement-overflowing
(`floraGlb.ts`'s own header doc warns about exactly this class of bug for the
pipeline's OWN node-transform step; this is the same failure mode triggered a
different way). The fix (`dequantize()` in `landmarks.ts`) reads every loaded
model geometry's position/normal/color back through
`BufferAttribute.getComponent` (which already applies the normalized-int
decode) into fresh, plain, non-normalized `Float32Array`s before any
placement transform or merge — a few hundred vertices, once per swap, not a
per-frame cost. `landmarksUpgrade.test.ts`'s fixture was rewritten to use a
genuinely indexed, quantized (normalized Int16/Uint8) fake geometry — the
ORIGINAL fixture (plain Float32Array, matching neither real bug's
precondition) passed throughout, which is why this shipped un-caught until a
real-GPU capture surfaced the console error; the rewritten fixture now pins
the fix.

*Draw calls / triangles.* The 6 landmark sites' draw-call count is UNCHANGED
by this slice on every tier: `buildSite`'s model branch still merges into
AT MOST 1 stone mesh + 1 (untouched) accent mesh per site, exactly the
pre-slice shape — it replaces mesh CONTENT, never mesh COUNT. Measured
directly (`buildLandmarks`/`buildSite`, headless, summing `mesh.geometry`
triangle counts — the same method the visual-overhaul slices used before a
real GPU was available):

| | Draw calls (6 sites) | Triangles (6 sites) |
|---|---|---|
| Pre-slice (`main`) | 12 | 1,556 |
| Post-slice, low (procedural, incl. the unconditional overhang/fig/ruin-brow upgrades) | 12 | 1,688 (+132) |
| Post-slice, medium/high (CC0 camp/canoe/ruin models swapped in) | 12 | 3,795 (+2,107 vs. pre-slice, +2,239 vs. low) |

+2,107 triangles is 0.42% of the 500k budget and a small fraction of the
~58k-triangle headroom the flora slice left on high — comfortably inside the
"target ≤10 new draws" bar this slice was given, at 0 actual draws spent. The
treasure chest+idol (hidden until the dig, `group.visible = false` — the
renderer skips a hidden object's draw calls entirely, so this is an
END-GAME-ONLY cost, not steady-state) grew from 6 draws/120 triangles to 14
draws/262 triangles (the idol's redesign from 3 primitives to 8, the chest's
new straps/latch) — trivial in absolute terms and invisible to the budget for
all but the last moments of a playthrough.

*Payload.* 13 new quantized object-model GLBs, `public/assets/models/objects/`,
**113.6 KB** raw total (barrel 15.77, ruin-column 17.09, ruin-debris 11.52,
campfire 11.86, bedroll 6.30, crate-open 7.95, canoe-hull 7.88,
ruin-wall-damaged 6.94, crate 6.73, tent 7.84, tool-shovel 5.71, ruin-wall
3.61, tool-axe 4.38 KB). Measured `vite build` (gzip) + `npm run check:bundle`,
branch vs the visual-overhaul-slice-7 baseline on the SAME machine (entry
99.67 KB, `three` 134.04 KB, `postfx` 152.33 KB, `floraUpgrade` 3.91 KB, CSS
4.74 KB, summed JS gzip **390.6 KB**, total download **3936.5 KB** — a fresh
same-toolchain rebuild of that exact commit, not the prior doc entry's
recorded figures, since several unrelated merges landed between that slice
and this one):

- **`landmarksUpgrade` chunk (NEW, lazy, medium/high only):** 0.73 KB gz —
  `landmarksUpgrade.ts` alone; it reaches the ALREADY-lazy `floraGlb.ts`
  parser via the same dynamic-import graph `floraUpgrade.ts` uses, so
  `floraGlb.ts` split into its OWN tiny shared chunk (1.31 KB gz) rather than
  being duplicated into both callers' bundles.
- **Summed JS gzip (`check:bundle`):** 390.6 → **392.4 KB**, **7.6 KB** of the
  400 KB cap left free (was 9.4 KB pre-slice) — this slice's actual eager
  cost (the `landmarks.ts`/`buildTreasure.ts`/`quality.ts`/`buildWorld.ts`
  additions, all already-eager modules) landed at +1.8 KB, comfortably inside
  the thin headroom the visual overhaul left.
- **Total download:** 3936.5 → **4054.7 KB** (+118.2 KB — the 113.6 KB model
  payload plus the small JS delta), **1945.3 KB** of the 6 MB cap still free.

Both caps hold (`npm run check:bundle` EXIT=0).

Verified visually via real-GPU Playwright captures (`--use-gl=angle
--use-angle=metal`, `quality: "high"` forced via `localStorage`, noon —
`window.advanceTime(45000)`, the day cycle's `t=0.25` keyframe): the camp now
reads as a real A-frame tent (canvas panels, ridge pole, stake feet) beside a
stacked crate pair and a barrel; the canoe is unmistakably a rowboat with a
real hull cavity, gunwale and resting paddles (the headline "barely reads as
a boat" complaint is resolved); the ruin shows a genuine beveled/coped
worked-stone wall panel instead of a bare box; remains shows the lost
expedition's dropped axe and shovel beside the existing cairn/pack; the fig
tree's fuller, less-spherical canopy and deeper roots read as a more
convincing strangler fig. The idol/chest were verified live via a temporary,
NOT-shipped debug hook (`window.__debugRevealTreasure__`, added and removed
within the same session — reaching the reveal through the real 5-clue-plus-
dig quest chain was out of scope for a verification screenshot) confirming
the reveal mechanism and the idol's emissive glow render correctly in place;
the new multi-part carved silhouette itself is verified by
`buildTreasure.test.ts` (8 idol meshes, one shared emissive material, its
whole envelope still fitting inside the chest's footprint) rather than a
flattering screenshot — the treasure sits wedged tightly between two of the
fig's buttress roots (a pre-existing site-design constraint, unchanged by
this slice), and no camera angle tried from outside that root cage gave a
clean, unoccluded "statue portrait", an honest limitation recorded here
rather than a false claim of a clean hero shot.

**Objects slice 2 (2026-07-12) — "make the wildlife look like what it really
is"** upgraded the four scriptable-behaviour animals' BODIES (jaguar, birds,
fish, snakes — fireflies/butterflies untouched, out of this slice's scope):
a proportioned chest/hip-lobe torso + skull/muzzle/ears + a curved 3-segment
tail + jointed (thigh/shin) legs + seeded rosette mottling for the jaguar; a
merged torso+head+beak+tail body and a tapered/swept wing planform for birds;
a merged body+dorsal-fin+caudal-fin geometry plus a cheap `onBeforeCompile`
tail-sway vertex bend for fish; darker colour banding + a flattened/widened
head wedge for snakes (already the closest-reading animal, so a reshape/
recolour rather than new geometry). All four state machines, speeds, ranges,
spawn logic, the startle/finale seams, and the jaguar's emissive-eyes contract
(2.2 night / 0.15 day, still asserted in `jaguar.test.ts`) are BYTE-IDENTICAL —
every change is a body-geometry/material swap at the same attachment points
`JaguarSystem`/`BirdsSystem`/`FishSystem`/`SnakesSystem` already used.

*Sourcing — all four ended up procedural.* No CC0 model was found through this
codebase's own scriptable-download conventions for any of the four target
animals: poly.pizza's search gates behind a paid API key (`api.poly.pizza`
returns `"You need an API key to do that"`) with mixed per-model licences
besides; Kenney's "Animal Pack" is a 2D icon set, not a 3D kit, and no other
Kenney kit carries a jaguar/parrot/snake mesh (the already-vendored Survival
Kit's two `fish*.glb` meshes are a fishing-minigame prop pair, not a reusable
swimming-school asset); Quaternius's own site (quaternius.com) funnels every
download through a Google Drive folder — the exact scriptability dead end
`floraGlb.ts`'s header doc already recorded for that source. Quaternius's
itch.io mirrors ARE CC0 and their browse/csrf/signed-download-page flow IS
scriptable this far (confirmed live: POSTing the page's own csrf token to
`/<slug>/download_url` returns a signed one-time download-page URL, and that
page lists the pack's upload id) — but the final `/file/<id>` private-download
step 404s off that flow (an undocumented itch.io endpoint quirk, unlike
Kenney's plain curl-able zip URLs), and the one pack that IS literally fish
("Fish Pack Animated") ships SKINNED meshes rigged for itch's own animation
clips, which this pipeline has no bind-pose-stripping step for. No pack in
either Quaternius catalogue is a jungle cat, a parrot/macaw, or a snake at
all. Per this slice's own licence ("upgrade the procedural bodies where
sourcing fails — fully acceptable, likely for several animals"), all four
took the procedural path — and because NOTHING was fetched, every upgrade is
UNCONDITIONAL on every quality tier (no new `quality.ts` knob), the same
"fully procedural ⇒ apply everywhere for free" precedent Objects slice 1 used
for the overhang/fig-tree/ruin-gaze-rig.

*Animation call, per animal.* Jaguar: unchanged (whole-body position/heading
transform already conveys the stalk/charge/strike motion; a single mesh gets
no extra animation here). Birds: unchanged — the existing per-instance wing-
roll "flap" hinge already reads as real flight, and the new tapered wing
planform only makes that same motion read better, not worse. Snakes:
unchanged (coiled bodies are placed once and never move — only the head
raises/lunges — matching real ambush-snake stillness). Fish: the ONE case
that needed new motion — a modelled tail/dorsal fin held perfectly rigid
would read STIFFER than the prior bare cone (which at least turned/darted as
a whole body), so `fish.ts` gained a cheap `onBeforeCompile` vertex-bend
patch (`makeFishSwayPatch`, the exact `windPatch.ts` idiom applied to an
`InstancedMesh` material instead of geometry swap): a sinusoidal lateral bend
weighted toward the rear third (`pow(tailWeight, 2)`), phase-offset per
instance via the same `instanceMatrix`-hash trick `windPatch.ts` uses for
per-instance wind phase, so twelve fish don't beat their tails in lockstep.
Zero extra draw calls, zero extra triangles (a shader patch on the existing
material) — pure fill-rate/GLSL cost, negligible at this scale.

*Draw calls / triangles.* Zero new draw calls on any animal (every new part
is merged into the SAME body/wing/fin geometry the existing single
`Mesh`/`InstancedMesh` already draws) — `wildlife.test.ts`'s own ≤9-mesh
aggregate assertion is unchanged and still holds. Per-animal triangle deltas
(measured directly, headless, the same method Objects slice 1 used before a
real GPU was available — geometry attribute counts, `InstancedMesh` totals
multiplied by live instance count):

| Animal | Per-instance tris (before → after) | Instances | Total tris (before → after) | Delta |
|---|---|---|---|---|
| Jaguar | 176 → 328 (body 116→268 + eyes 60, unchanged) | 1 | 176 → 328 | **+152** |
| Birds | 10 → 38 (body 8→34, wing 2→4) | 14 | 140 → 532 | **+392** |
| Fish | 10 → 13 (body+dorsal+caudal fin) | 12 | 120 → 156 | **+36** |
| Snakes | 324 → 324 (colour/shape-only edit, no new geometry) | 6 | 1,944 → 1,944 | **+0** |
| **Wildlife total (excl. unchanged fliers)** | | | **2,380 → 2,960** | **+580** |

+580 triangles is 0.12% of the whole-game 500k budget and a small fraction of
the flora slice's own ~58k-triangle high-tier headroom this doc has tracked
since slice 6 (most recently ~55.9k after Objects slice 1's +2,107) — leaving
roughly **~55.3k** triangles of headroom on the high tier. It is also
comfortably inside `wildlife.test.ts`'s own local ≤40k aggregate ceiling
(2,960 + up to 180 fliers-at-cap = 3,140 / 40,000 ≈ 7.9%). Applied on EVERY
tier (fully procedural, no gating), so the render-gate's forced-low-tier path
pays this same small cost too — confirmed via `npm run verify` (EXIT 0,
`render_game_to_text` shows all five wildlife systems reporting normally)
rather than assumed.

*Payload.* Zero new bytes: no model fetched, no texture baked, no new
`quality.ts` field — `npm run check:bundle` moved only by the small amount of
new pure TS (the mottling helper, the extra geometry-builder functions, the
fish sway-patch GLSL strings): **393.9 / 400 KB** JS gzip (was 392.5 KB,
**+1.4 KB**, 6.1 KB of the cap left free) and **4057.4 / 6000 KB** total
(effectively unchanged, +2.7 KB of JS-gzip-driven `index.html`/asset noise —
no binary payload at all).

Verified visually via real-GPU Playwright captures (`--use-gl=angle
--use-angle=metal`, `quality: "high"` forced via `localStorage`, noon —
`window.advanceTime(45000)`), framed with `window.__frameView__` at each
animal's LIVE position (read back via `render_game_to_text()` for the jaguar,
since it prowls; the others patrol/sit around fixed centres so a hand-picked
frame stays valid):

- **Jaguar** — a three-quarter/side capture at its live prowl position (west-
  valley territory) shows a real quadruped silhouette: a distinct chest lobe
  wider than the hip lobe, pointed ears, a tail curving up off the hindquarters,
  and a visible darker rosette-mottled patch across the coat — a big
  improvement over the prior single stretched-blob torso.
- **Birds** — a flock captured mid-orbit shows a clear swept, tapered wing
  planform (not the prior single degenerate triangle per side) and a warm
  beak accent on each bird; reads unmistakably as birds in flight, not
  arrow-shaped placeholders.
- **Fish** — an underwater capture (camera below `y=0` near the lagoon,
  `0, 142`) shows the body's new caudal fin flaring out behind it and a small
  dorsal fin bump — reads as a fish, not a flat dark shadow-cone.
- **Snake** — a close, near-top-down capture of a coiled snake shows the new
  darker banding breaking up the coil into a scale-like faceted pattern,
  a real (if modest, as scoped) improvement over the flat single-tone coil.

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
