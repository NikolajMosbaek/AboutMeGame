# G5 slice 1 — grounding contact shadows for the shadow-less tier (#160)

**Date:** 2026-07-17 · **Mode:** direct implementation (user-directed, no team
orchestration this run) · **Epic:** G5 (#159).

## Where the epic actually stood

Most of #160 — and much of the G5 epic — had already landed under other
banners before this run:

- **Sky-derived environment map** (`envLightSystem.ts`, PMREM from the live
  sky, day-cycle-tracked `environmentIntensity`, bake scheduler): shipped in
  #206 "sky-driven IBL, N8AO, player-following shadows" and refined in #208.
- **Ambient-occlusion grounding**: N8AO ships on every tier that builds a
  compositor (medium/high).
- **Real sun shadow maps**: medium/high, player-following frustum.
- G5's later slices (cross-billboard foliage, hero GLTF props) were
  overtaken by the visual overhaul's **real CC0 models** (#209–#212) — lit
  materials that relight with the day cycle, which is what the epic's
  "lit surfaces, not stickers" direction demanded.

The one place the epic's named deficiency ("objects look weightless") still
held was the **low tier**: `shadows: false`, no compositor ⇒ no AO — every
tree, rock and landmark floated. That tier is also what CI's render gate runs.

## What this slice adds

`src/world/groundingShadows.ts` — soft blob grounding discs for shadow-less
tiers only:

- **One `InstancedMesh`** (+1 draw call, 2 triangles per prop) over the props'
  own placement points (canopy trees, palms, rocks — collected at placement in
  `props.ts`, never recomputed; the 900 tiny understory plants are excluded)
  plus a wider, softer disc per landmark site.
- **Zero asset bytes**: the radial falloff is a runtime-generated
  `DataTexture` (no canvas — builds headless), quadratic alpha falloff to
  exactly 0 at the rim, `LinearFilter` (the `DataTexture` default is
  `NearestFilter`, which would band the gradient — caught in review).
- Discs tilt to the terrain normal (pure finite-difference math, headless
  tested), lift 0.06 off the ground, draw as decals (`transparent`,
  `depthWrite: false`, `polygonOffset`), never cast/receive.
- **Gated by `quality.groundingShadows`** — `true` only on low. Medium/high
  are grounded by the real shadow pass + N8AO; a blob under a shadow-mapped
  tree would double-shadow.

## Review

A skeptical reviewer pass verified the three.js transform/alpha/disposal
paths, ran numerical probes of the placement math against the real terrain
(no disc pokes through above the falloff-invisible rim), and found one real
defect — the `NearestFilter` banding above — which is fixed and pinned.

## Verification

- 1568 tests pass, including: blob alpha profile + linear filtering, terrain
  normal math, one-mesh instancing, decal material flags, radius/lift/tilt
  transforms, disposal (texture dispose event), props ground-point census,
  low-tier-only gating through `buildWorld`, tier-table pins.
- `npm run build` · `check:bundle` **395.2 / 400 KB gzip** (+0.6 KB) ·
  `lint` · `npm run verify` — the Playwright render gate runs the LOW tier in
  CI, so the new path is exercised end-to-end.

## Epic disposition

With this slice, #160 closes. Recommendation recorded on #159: the epic's
remaining named slices are superseded — procedural normal/roughness detail
(slice 2) was overtaken by the terrain/water PBR detail knobs (#207-era) and
the CC0 model swaps; cross-billboard foliage (slice 3) by the real flora
models with wind (#210); hero GLTF props (slice 4) by the landmark model
swap-ins (#211). Close the epic rather than hold it open for work the
overhaul already delivered by other means.
