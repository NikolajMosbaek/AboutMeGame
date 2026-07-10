# The Lost Idol — Visual Overhaul (2026-07-10)

**Binding design doc.** Owner directive: *"a MAJOR graphics update in every way. It must be
free. You can do it without any input from me."* Research and stack inventory:
`docs/team/runs/2026-07-10-visual-overhaul.md`.

## Target look

**Stylized-realistic.** Real light on believable surfaces: PBR textures, image-based ambient
light, ambient occlusion, atmospheric sky — while keeping the readable, hand-placed island.
We are not chasing photorealism with raymarched everything; we are removing every trace of
"flat-shaded programmer art". After the overhaul, no player-visible surface should be an
untextured flat-shaded primitive color.

## Non-negotiables (inherited)

- **Free only.** Libraries MIT/ISC; assets CC0 (Poly Haven, ambientCG, Quaternius, Kenney).
  Every imported asset is listed in `public/assets/LICENSES.md` with source URL and license.
- **Budgets hold:** ≤400 KB JS gzip, ≤6 MB initial download, ≤150 draw calls, ≤500k tris,
  30 fps mobile / 60 fps desktop (`src/perf/perfBudget.ts`). Anything expensive is gated by
  the existing low/medium/high quality tiers; **low tier must not get slower than today.**
- **One day-cycle driver.** `DayCycleSystem` + `dayPalette(t)` stay the single source of
  sun/sky/fog/environment truth. New visual systems subscribe to the palette; none invent
  their own clock. Reduced-motion behaviour (pin to golden hour, hold phases) extends to all
  new effects.
- **Gameplay untouched.** No mechanics, clue prose, or balance changes ride along.
- Branch isolation, green-only merge, run-log auditing per the constitution.

## Architecture decisions

1. **Stay on WebGLRenderer; upgrade three `^0.169` → `^0.185`.** WebGPU/TSL migration is a
   separate project with no visual payoff of its own; the WebGL effects ecosystem is mature.
2. **Post stack = pmndrs `postprocessing` + `n8ao`.** Replaces the three-examples
   EffectComposer chain. Effects merge into fewer fullscreen passes (mobile win), mipmap-blur
   bloom replaces UnrealBloomPass at visual parity or better, SMAA replaces MSAA-only AA,
   N8AO provides temporally-stable SSAO. Color pipeline: rendering in linear, single
   tone-map (AgX) + sRGB encode at the end of the chain — exactly one place owns color.
3. **Environment light is generated, not downloaded.** A small PMREM render of the
   procedural sky feeds `scene.environment`, re-rendered as the palette moves — IBL that
   tracks the day cycle for ~0 asset bytes. (HDRIs stay an option for grading reference.)
4. **Textures ship as WebP** (sharp-processed, ≤1K working size), loaded via the existing
   `src/engine/assets.ts` seam. KTX2/basis is a recorded upgrade path if GPU memory becomes
   a measured problem — not speculative plumbing now.
5. **Models ship as meshopt GLB** (gltf-transform: prune → join → quantize → meshopt),
   loaded through `GLTFLoader` + `MeshoptDecoder`, instanced through the existing
   InstancedMesh budget discipline (flora stays ≤ a handful of draw calls).
6. **Shader extensions keep the `onBeforeCompile` patch idiom** (`waterPatch.ts` precedent):
   pure TS reference functions + GLSL transcription, so logic stays unit-testable headless.

## Slices (one PR each, in order)

| # | Slice | Contents |
|---|-------|----------|
| 1 | Foundation | three 0.185, pmndrs postprocessing (bloom parity + SMAA + AgX), docs |
| 2 | Lighting | sky-driven PMREM environment, N8AO (med/high), shadow quality pass |
| 3 | Terrain | CC0 PBR splatting (slope/height+noise), smooth shading, normal maps |
| 4 | Water | scrolling normal maps, depth absorption, sun specular, foam, underwater dapple |
| 5 | Sky | physical atmosphere fitted to the 5-keyframe palette, stars, clouds, god rays (high) |
| 6 | Flora & fauna | Quaternius CC0 models instanced in, wind sway shader, grass layer |
| 7 | Polish | ambient particles, per-time color grade, finale upgrade, social preview, live verify |

Each slice: tests first where logic is pure; `npm run build && npm test && npm run
check:bundle` unmasked (`EXIT=$?`); `npm run verify` for world-visible changes; code review
before merge; perf-budget doc updated with measured sizes.
