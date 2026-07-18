# Embodiment & Tactility — a body in the jungle

**Date:** 2026-07-18 · **Status:** approved (final deferred direction from the
J1 brainstorm; user directive "Implement the last one") · **Size:** 2 PRs.

## Goal
The player feels present in a body: a first-person hand/arm that rises into
view for the survival verbs (drink, eat, dig), audible exhaustion when stamina
runs dry, and W1's rain landing on the "lens".

## What ships
1. **First-person hands** (`src/player/hands.ts`): ONE procedural low-poly
   forearm+hand mesh (~60 tris, stamped colors, zero asset bytes) positioned
   from the camera's world transform each frame (no scene-graph surgery).
   Pure pose curves per action: `drink` (rises center, tips up, ~1 s, on the
   thirst-rise edge), `eat` (rises holding a fruit sphere, ~0.9 s, on the
   eaten edge), `dig` (rhythmic pump while `digProgress != null`), `idle`
   (parked below the view frustum). Reduced motion: the hand appears at a
   static raised pose for the action's duration — presence without animation.
2. **Exhaustion panting** (audio): while stamina < 20 and the player keeps
   moving, the existing `breathe()` one-shot repeats every ~1.6 s
   (edge-guarded timer in `AudioSystem`); stops on recovery.
3. **Rain on the lens**: a DOM overlay in `GameCanvas` whose droplet pattern
   (pure CSS gradients) fades with `weather.snapshot().rain01` — the W1 tie-in.
   Zero draw calls, reduced-motion safe (static pattern).

## Architecture
Pure pose math + thin `HandsSystem` (store-edge driven, the AudioSystem
posture). Panting lives in the existing `AudioSystem` update. The lens overlay
is a `GameCanvas` div driven by a rAF-polled opacity write.

## Out of scope
Mud/damage lens effects; camera pratfalls; held-item inventory visuals;
weapon-style hand idle sway.
