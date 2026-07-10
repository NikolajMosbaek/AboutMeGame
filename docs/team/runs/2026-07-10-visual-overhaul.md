# Run log — 2026-07-10 — Visual overhaul

## Intake

Owner directive (verbatim intent): *"I'm still not happy with the graphics. … research what
it takes for you to do a MAJOR graphics update in every way. The requirements are simply:
1. It must be free. 2. You can do it without any input from me."* Followed by: *"go ahead
and do the full upgrade."*

## Research summary (grounds the design)

Stack inventory (agent sweep, 2026-07-10): game is 100% procedural — every material
`MeshStandardMaterial` flat-shaded/vertex-colored, zero shipped texture/model binaries,
one directional + one hemisphere light, gradient-shader sky dome, two-sine water patch,
bloom-only compositor (three-examples chain), three ^0.169. Budget headroom: 216 KB of
400 KB JS gzip; ~0.25 MB of 6 MB initial download.

Tooling research: pmndrs `postprocessing` (MIT) + `n8ao` (MIT) for the effects stack;
CC0 assets from Poly Haven / ambientCG / Quaternius / Kenney; gltf-transform +
meshopt for model compression; three current release r185 (WebGPU exists but stays out of
scope — no visual payoff, real migration risk).

## Decisions

1. Ship as **7 sequential slice PRs directly to `main`** (not an integration branch): each
   slice is an unambiguous standalone upgrade of one subsystem; hybrid mid-states look
   fine, and production improves continuously. (Contrast with the pivot, where a
   half-pivoted hybrid was unacceptable.)
2. Design doc is binding: `docs/design/2026-07-10-visual-overhaul-design.md`.
3. Free-only policy enforced by an asset license manifest (`public/assets/LICENSES.md`)
   listing source + license for every imported binary.

## Trail

| Slice | PR | Result |
|---|---|---|
| 1 — foundation (three 0.185 + pmndrs post stack) | — | in progress; review finding fixed pre-PR: postprocessing was folded into the eager `three` chunk (low tier paid ~74 KB gz for nothing) → now a lazy `postfx` chunk behind a `quality.bloom`-gated dynamic import (`loadCompositor` seam), eager JS +7.6 KB (three's own growth only) |
| 2 — lighting (sky IBL + N8AO + shadows) | — | in progress; sky-driven PMREM environment light on ALL tiers (`EnvLightSystem`, built by `GameCanvas` — needs the real renderer `buildWorld`/`buildGame` never touch), regen scheduled by a pure palette-delta + real-seconds cap (`envBakeScheduler.ts`, ~every 2s while the sky is moving, measured over a full 180s loop; low bakes once at golden-hour and never again); retired the flat `HemisphereLight` (nothing else referenced it); N8AO ambient occlusion added inside the existing lazy `postfx` chunk (medium "Performance", high "Medium"; `+77.25 KB` gz to that chunk — the single biggest bundle cost of the slice, only 23.3 KB of the 400 KB JS-gzip cap left after it, flagged for the next slice); player-following texel-snapped shadow frustum (`ShadowFrustumSystem`, headless-tested, `lightBasis` proven bit-exact against `THREE.Matrix4.lookAt`) replaces the whole-island frame — same map size now ~3x sharper texels (not the ~10x a naive read of the halfExtent range might suggest; recorded as a deviation). All 4 gates green (`build`/`test`/`check:bundle`/`verify` EXIT=0); `--landmark-tour`'s accent-coverage check for 4/6 sites was independently confirmed to ALREADY fail on unmodified `main` (A/B tested with AO on/off — identical failure either way, plus a visual check showing the framing is simply too wide/distant to resolve the tiny accent prop) — a pre-existing gap outside this slice's scope, not a regression. review: sun-direction corruption off-origin — caught by review, fixed with a direction-owner seam. render-gate caught software-GL stall (CI's GPU-less runner resolved medium → N8AO + ~2s env rebakes on SwiftShader = seconds/frame, screenshot timeout); fixed with renderer-string tier override (`isSoftwareRenderer` in `deviceCapability.ts` forces detected tier low; explicit setting still wins). |
| 3 — terrain PBR splatting | — | 4 CC0 ambientCG texture sets (Grass001 jungle floor, Ground037 leaf litter, Rock057 mossy rock, Ground054 river-mud/sand — chosen by downloading and looking at the albedo previews, not guessed from tags; `public/assets/LICENSES.md`), processed by a new `scripts/process-textures.mjs` (sharp devDependency, build-time only) to 1024px WebP (albedo q80, normal q90), 2701.0 KB total. Splat weights are a pure, tested module (`src/world/terrainSplat.ts`) driven by the SAME height bands `colorForHeight` already used plus slope (from the now-smooth vertex normal) and noise; packed into a vec4 vertex attribute the terrain's `onBeforeCompile` patch (`terrainMaterialPatch.ts`, the `waterPatch.ts` idiom) blends 4 albedo (+4 normal, medium/high) samples by, world-XZ planar UV at 6 units/repeat. The surviving vertex-colour macro tint needed ZERO extra GLSL — it rides three's own `color_fragment` multiply, which runs after our albedo write by anchor ordering alone. `flatShading` dropped (now `computeVertexNormals`); `heightAt` and every gameplay-relevant sample stayed byte-identical (existing `terrain.test.ts` unchanged and green). Texture loading is async through the existing `loadTexture` seam — the terrain renders its unchanged vertex-colour look instantly and upgrades in place with one recompile (`Terrain.texturesReady`); quality gains a new `terrainDetail: "albedo" \| "full"` knob (low omits the normal-map block at BUILD TIME, no dangling sampler) plus `terrainAnisotropy` (4/4/8). JS-gzip landed at +3.0 KB (20.3 KB of the 400 KB cap left, inside the ~20 KB the design flagged as remaining). All 4 gates green (`build`/`test`/`check:bundle`/`verify` EXIT=0); visually confirmed via manual Playwright spot-checks at noon lighting — camp ground reads as real mottled jungle-floor texture with tint bands surviving, the lagoon shore shows a clean sand→jungle-floor blend right at the waterline, and the highland/overhang slopes read as mossy rock. Low tier (forced via `localStorage`) was also spot-checked and looks correct (albedo-only, no normal maps) — noted as a manual, non-CI check since no quality-override flag exists in the official verify tooling. |
| 4 — water | — | |
| 5 — sky/atmosphere | — | |
| 6 — flora & fauna models | — | |
| 7 — polish + live verify | — | |
