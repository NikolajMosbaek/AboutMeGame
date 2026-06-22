# World scope & layout

- **Issues:** #15 (scope & layout), #21 (boundaries)
- **Epic:** #2 — World & Environment
- **Source of truth:** `src/world/worldConfig.ts`

## Scope: one small island

A **single small island**, not a sprawling map. The content is 13 points of
interest; the world only needs to be big enough to space them so exploration
feels like discovery, and small enough that a player sees the whole thing in a
few minutes of driving/flying. An island also gives a natural, diegetic
boundary — water — instead of an invisible wall.

- Terrain tile: **520 × 520** units.
- Land: a full-height **plateau out to radius 165**, then a shore ramp down to
  open water by radius 200. The interior is gentle rolling grass (peaks ~21u),
  deliberately drivable — no cliffs to get stuck on.
- Soft boundary at radius **178**: past it the player is eased back (Epic 3
  enforces via `boundaries.clampToBounds`). You can roam the whole island and
  its beaches, but not drive off into the empty sea.

## Layout: a guided loop, free to roam

The 13 landmarks (`POI_ANCHORS`) are hand-placed in a **loop** that starts at
the southern spawn (#1 Arrivals Gate, by the origin plaza) and winds outward and
around the island, finishing at the far north-west edge (#13 Hall of Mirrors) —
mirroring the narrative order of the content. Following the beacons in order is
a natural tour, but nothing gates movement, so a player can wander anywhere.

Each landmark carries a **sky-beacon**: a tall, glowing, colour-coded column
visible from across the island. That is the level-design answer to "guide
exploration" (#20) — you can always see where the unvisited places are, and the
colours make each a distinct target. Epic 5 turns the same anchors into on-HUD
navigation hints and a "found N of 13" progress meter.

## Why these numbers

Spacing (~60–90u between neighbours) keeps two landmarks from being visible as
"the same place," while the gentle terrain and beacons keep the next target
findable. The plateau-then-shore height field guarantees every POI sits on solid
ground regardless of the noise seed (asserted in `worldConfig.test.ts`).
