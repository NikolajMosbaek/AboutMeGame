# Fix — Monkeys respect the river (J1 follow-up)

**Date:** 2026-07-18 · **Mode:** direct implementation (user bug report:
"monkeys jumping around, often into the water — no comic element"; standing
decision authority) · **Branch/PR:** `fix/monkeys-respect-the-river`.

## Root cause

The troop's single anchor ring crossed the carved river bed (2.6 u deep — the
full `RIVER.depth`) on **4 of its 5 legs** (verified by sampling the real
terrain), and monkey movement had no water awareness at all — unlike the
jaguar, which refuses forbidden ground. The dominant on-screen behavior was
therefore monkeys swimming the river every patrol cycle. Compounding it, the
hop gait ran whenever a monkey wasn't frozen — including while dwelling at an
anchor — so idle monkeys bounced in place forever and the troop read as
aimless jumping, burying the comedy grammar entirely.

## What shipped

- **Bank-split troop** (`TROOP_BANKS`): each monkey lives on one river bank
  for life; every intra-bank patrol leg is pinned dry against the real
  terrain by test. `TROOP_ANCHORS` stays as the flat pool.
- **Water-guarded movement** (the jaguar's idiom, plus bank-skirting):
  every step — troop travel, curious approach, flee, heist run — refuses
  water deeper than `WADE_DEPTH` and steers along the bank via `STEER`
  offsets. Arrival only counts on the direct step (review finding: a steered
  sidestep must not "reach" a plant it stepped around).
- **Heist reachability + give-up clock**: a thief is elected only with a dry
  straight line (`dryPath`) AND within `HEIST_MAX_RANGE` (the timeout's
  travel budget × 0.8 — review finding: an uncapped election shipped a
  sprint-give-up-retry loop at ~2 far plants and suppressed the drift
  fallback). Blocked heists resolve via `HEIST_TIMEOUT` (25 s): phase 1
  flees empty-handed, phase 2 drops the fruit where it stands.
- **Degenerate perch fix**: a plant sitting ON an anchor no longer perches
  the thief at the plant itself (where the chase radius killed the gag the
  same frame) — the home anchor must be ≥ 1.5 × perch distance away.
- **Hop belongs to travel**: displacement-gated. Idle monkeys sit calm, so
  the freeze-beat, curious head-tilt and taunt-bounce finally read.
- **First-gag pacing**: the heist clock starts at `FIRST_HEIST_HEAD_START`
  (60 s), so the first robbery can land ~30 s into a session instead of 90+.

## Review findings (skeptical pass, fixed + pinned)

1. Uncapped thief election vs the fixed timeout budget → permanent gag loop
   at far plants (CONFIRMED, fixed with `HEIST_MAX_RANGE` + system test).
2. `moveToward` reported "reached" off a steered sidestep (CONFIRMED latent,
   fixed + pure test).
3. Transient bank jitter on off-leg returns — NEEDS-VERIFICATION, bounded
   (timer-limited modes), accepted.

## Verification

Full suite (1692 tests), build, lint, bundle budget (403.3/432 KB gz) green
locally; CI + render gate green on the PR; deploy verified after merge.
