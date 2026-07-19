# Jungle density — "it must FEEL like a jungle" (user finding, 2026-07-19)

**Mode:** direct implementation (user: "It doesn't feel like a jungle. It
feels like an island with some trees on. Fix that any way you think is
right"; standing decision authority) · **Branch:** `feat/jungle-density`.

## Diagnosis

450 canopy trees over the ~85k m² island = one tree per ~190 m² — open
parkland, not jungle. Understory topped out at knee height (1.3× of a 1.2 u
cross), so nothing ever broke a sightline at eye level. Jungle feel =
density + vertical layering + short sightlines + shaded floor; none were
present.

## What shipped (3 commits, one PR)

1. **Density + layering** (`props.ts`): canopy 450→680 with enlarged valley
   crowns (0.85–1.55), understory 900→2200 with a 32% eye-height tall-fern
   share (1.9–2.8×, four-way flat-ground guard), palms 60→72, rocks 120→160,
   grass 2200→3000. `fullFoliage` param (from `quality.floraDetail`) keeps
   the LOW tier at the original silhouettes.
2. **Structural affordability** (`floraUpgrade.ts` + `floraCullSystem.ts`):
   the graphics review priced the naive first cut at 732k tris/frame (146%
   of budget) — island-spanning single InstancedMeshes can never be
   frustum-culled. Canopy/understory now split into spatial chunk meshes
   with chunk-local bounding spheres (frustum + fitted-shadow-pass culling
   work for real); understory additionally distance-culled at 90 u.
3. **Under-canopy ground shade** (`canopyShade.ts`): green-biased vertex-
   colour darkening baked under the canopy crowns (bilinear coverage grid
   from `props.canopyCrowns`) — the canopy's ambient occlusion, every tier,
   zero per-frame cost.

## Measured (scripts/measure-frame-cost.mjs — new permanent tool)

Instrumented-GL (renderer.info is useless on compositor tiers), real built
app, forced tiers:

| Tier | Vantage | Draws | Tris | Budget % |
|---|---|---|---|---|
| high | spawn (max vantage) | 121 | 485,582 | 97.1% |
| high | jungle interior | ~105 | ~410–418k | ~82% (pre-epic high was 88.4%) |
| low | spawn | 31 | 156,559 | ≈ pre-epic floor 156,837 |

## Review (graphics-3d agent, 2 passes)

Pass 1 found a **blocker** (746k-tris budget math, uncapped medium raise, low
fill-cost regression, tall-fern slope floating, stale doc) → redesign to
chunked culling + measurement. Pass 2: **all findings CONFIRMED-RESOLVED, no
blocker**; R1 (low tier accidentally sparser after the trims: 136 trees vs
180) fixed by raising low propDensity to 0.26 (177/19 ≈ original), with the
floor test now bounding from both sides. Noted for the future: spawn-on-high
is ZERO planning headroom; draw calls (121, worst ~140) are the next-thinnest
budget.

## Verification

1709 tests green (16 new), build, lint, bundle 404.3/432 KB, verify-game
smoke VERIFY OK (low), high-tier hardware-GL screenshots confirm closed
canopy + eye-level enclosure + shaded floor at eye level and a canopy sea
from the vista. CI + deploy verified on the PR/merge.
