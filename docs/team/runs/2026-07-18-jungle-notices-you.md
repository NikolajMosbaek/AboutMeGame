# J1 — The Jungle Notices You: emergent physical comedy (#218)

**Date:** 2026-07-18 · **Mode:** direct implementation (user-directed via
brainstorm → spec → plan; user AFK with standing decision authority) ·
**Spec:** `docs/superpowers/specs/2026-07-18-jungle-notices-you-design.md` ·
**Plan:** `docs/superpowers/plans/2026-07-18-jungle-notices-you.md` ·
**PRs:** #222 (grammar + birds + fish), #223 (monkey troop + heist),
#224 (jaguar double-take + comedy audio/FX).

## What shipped

- **Reaction grammar** (`wildlife/reactions.ts`): idle → freeze-beat → react
  (overshoot) → cooldown. `COMIC_TIMING` is the one "lightly cartoonish"
  dial; `PLAIN_TIMING` collapses the beat for reduced motion.
- **Birds**: sprint-past flush (freeze → overshooting explosion, 8 s
  refractory, `justFlushed`/`consumeFlushBurst` seams).
- **Fish**: wading splash startles the whole pool (epicentre included),
  full-envelope dart with fade-out, refractory.
- **Monkeys** (`wildlife/monkeys.ts`, new): 4 procedural capuchins — troop
  life between validated anchors, one-at-a-time curiosity, freeze-beat flee,
  and the fruit heist (90 s pacing, steal through the forage seam, perch
  toward home turf, taunt, timed/chased drop, walk-over scoop via
  `creditExternalEat`). Camp is sanctuary; respawn resets the troop.
- **Jaguar**: `startled` mode — a stalk crossing within 5 u of a snake
  freezes, bolts at 1.4× charge speed, and prowls under a 45 s humiliation
  cooldown. A committed charge is never interrupted (decision: comedy must
  not rescue the player mid-pounce).
- **Audio**: five procedural one-shots (squawk cascade, monkey chitter,
  monkey raspberry, jaguar yelp, splash plip-cluster), all `blip()`-family,
  zero asset bytes, wired through drained edges in `AudioSystem`.
- **FX**: `LeafBurstSystem` reuses the pooled `DiscoveryBurst` fountain at
  the flush position (its own queue, so FX and audio never fight over one
  drained edge). Reduced-motion suppresses particles but drains the queue.

## Key decisions

- **Procedural monkeys, not GLB** — every existing animal is procedural
  (#212's own conclusion after CC0 sourcing dead-ends); zero asset bytes.
- **Walk-over scoop** for dropped fruit — no interact-key priority conflicts
  with the delicate sites > forage > drink chain; instant chase payoff.
- **Budget amendment 400 → 432 KB JS gzip** (approved) — recorded in
  `docs/perf-budget.md`; actual epic cost ~4 KB gz (395.2 → ~399.3).
- **Perch heads toward the troop's nearest anchor** — always-inland retreat;
  "away from the player" could strand the drop past the boundary clamp.

## Review findings (all fixed and pinned)

PR I: missing refractories (machine-gun gags), truncated dart envelope
(velocity pop), splash-epicentre inversion, blind `describe()`. PR II:
phantom-steal race when the player picks first (double meal + stomped regrow
clock), offshore perch strand, stale drift dwell. PR III findings in its PR.

## Verification

Per PR: full suite, build, `check:bundle`, lint, Playwright render gate (low
tier) — all green before each merge; deploy verified after the final merge.
Real-browser feel of the comic timing is tuned from `COMIC_TIMING` — one
table, adjustable in a follow-up without touching any consumer.
