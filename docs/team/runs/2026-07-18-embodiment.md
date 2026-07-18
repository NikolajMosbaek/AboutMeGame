# E1 — Embodiment & Tactility (#232)

**Date:** 2026-07-18 · direct implementation (standing authority) ·
**Spec/plan:** `docs/superpowers/{specs,plans}/2026-07-18-embodiment*` ·
**PRs:** #235 (first-person hands), #236 (panting + lens rain).

Shipped: a procedural forearm+hand (~60 tris, zero asset bytes) rising for
drink/eat/dig from the camera's world transform, store-edge driven with pause
hold, respawn-refill guard and reduced-motion static pose (review findings);
exhaustion panting (breathe() every 1.6 s while stamina < 20 and moving);
rain-on-the-lens CSS droplet overlay riding the W1 envelope (zero draw calls,
static — reduced-motion safe). This closes the fourth and final immersion
direction from the 2026-07-18 brainstorm (J1 comedy, reactive world, W1
weather, E1 embodiment).
