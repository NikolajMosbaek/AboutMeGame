# Living water — visible stream flow + a waterfall (user request, 2026-07-19)

**Mode:** direct implementation (user: "1. Improve water quality so there's
water movement and a stream 2. Add a waterfall"; standing decision
authority) · **Branch:** `feat/living-water` (4 commits, 1 PR).

## What shipped

1. **The stream reads as a stream** (`riverFlowTexture.ts` + `waterPatch.ts`
   + `waterSurface.ts`): the river's current was already real gameplay
   (`waterZones.ts` pushes a swimming player) but invisible. A 128² baked
   flow field now drives analytic foam lanes drifting downstream inside the
   channel on the detail tier (medium/high) — wrap-safe scroll (integer
   cycles per `WRAP_PERIOD`), distance-fade anti-aliasing, released in the
   lagoon, zero flow tokens compiled on the low tier (pinned).
2. **The waterfall** (`waterfall.ts`): the river source sits in a natural
   box-canyon (bed −2.6, ~22 u wall — probed, test-pinned); the river now
   pours over it. Bowed scrolling curtain, crest lip + rock cap, two
   counter-drifting splash discs, five radial-alpha mist puffs, all
   procedural DataTextures, ≤ 6 draws, every tier. Distance-attenuated
   lowpass roar: `roarLevelAt` → `AudioEngine.setWaterfallLevel` (the rain
   bed's exact lazy/teardown/never-runs-muted contract).

## The review story (2 full passes, 1 verification pass)

Pass 1 found a **blocker**: the first-cut streak lanes (sampling the ripple
normal map's red channel) compiled correctly but were INVISIBLE on the real
build — channel max 0.804 under a 0.62–0.85 smoothstep window, ~0.5 u
features at the chosen tilings, mip erosion past 5 u — proven by A/B
screenshots against main. The analytic rewrite made them visible and
immediately exposed the review's predicted bend artifact: a lane axis built
as `dot(world, direction)` phase-jumps where the nearest-segment direction
rotates (concentric contour rings at the {-20,38} junction). Structural fix:
the flow texture bakes CONTINUOUS river coordinates (arc length + signed
cross offset, `projectOntoRiver` extended and shared with the gameplay
current), so the shader does zero per-fragment direction math. Verification
pass: A/B confirmed lanes visible at eye level and from above, bend clean,
no centre seam, no quantization judder — **MERGE**.

Also from review: rock cap closing the crest silhouette, mist radial-alpha,
`AudioEngine.dispose` roar-bed symmetry, cached mist lookup, wrapped bob
clock, doc corrections.

## Verification

1729 tests green (21 new), build/lint green, bundle 406.9/432 KB gz
(+2.6 KB), low tier untouched (pinned), draw calls +6 max at the falls
vantage only. High-tier screenshots archived in the session scratchpad; CI +
deploy verified on the PR/merge.
