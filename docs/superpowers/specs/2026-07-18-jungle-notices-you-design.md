# The Jungle Notices You — emergent physical comedy from a reactive jungle

**Date:** 2026-07-18 · **Status:** approved (user, via brainstorm dialogue) ·
**Epic size:** 6 AI-sized slices, shipped as 3 PRs.

## Goal

Make The Lost Idol **funnier and more immersive with the same systems**: a
jungle that notices the player and reacts with believable-but-lightly-
cartoonish physical comedy. Humor is emergent (situations, never scripts),
frequent (a star comedian actively seeks the player out), and always doubles
as immersion (every reaction is evidence the world is alive).

**Approved tone boundary (amends the "as realistic as possible" pillar):**
realism bends for *reaction timing only*. Animals may react with exaggerated,
snappy comic timing — double-takes, frozen beats, overshoot — but never break
species behavior: no talking, no cartoon sound effects. Comedy stings are
synthesized *animal* sounds from the existing procedural audio engine.

## What ships (user-visible)

1. **Birds** explode out of trees in a squawking flush when the player
   sprints past — with a comic frozen beat first.
2. **Fish** scatter radially from the player's wading splash.
3. **A capuchin monkey troop** (3–4, procedural low-poly like every other
   animal) lives its own life in the canopy, gets curious when the player
   stands still — and pulls the centerpiece gag: **the fruit heist**. One
   monkey darts in, steals fruit (held, or from a plant the player is near),
   retreats to a low perch, taunts (chitter + bounce), and drops the fruit
   after ~20 s or when chased.
4. **The jaguar gets one humiliation**: a stalk path that crosses a snake's
   alert radius triggers a freeze-beat double-take and an ignominious bolt,
   with a startled yelp.
5. **New procedural one-shots** (squawk cascade, monkey chitter/raspberry,
   jaguar yelp, splash-scatter) and a leaf-burst particle on bird flush.

## Architecture

Three pieces, all following the repo's established pure-math + thin-System
idiom (`stepFlock`/`stepJaguar` precedent — pure state-step functions,
headless-tested, thin Systems own THREE objects):

### `src/wildlife/reactions.ts` — the reaction grammar (pure, slice 1)

One shared vocabulary every reacting creature steps through:

```
idle → notice → freeze-beat → react (flee | approach | taunt) → cooldown → idle
```

Pure functions over `(state, dt, stimulus)` where stimulus is
`{ distance, playerSpeed, … }`. All comic timing — freeze duration, overshoot
curve, cooldown — lives in ONE exported tunables table so "lightly
cartoonish" is a single dial, not scattered magic numbers. The reduced-motion
setting collapses freeze/overshoot to plain immediate flight.

### `src/wildlife/monkeys.ts` — the star (slices 3–4)

Procedural low-poly capuchins (geometry.ts helpers; zero asset bytes; no GLB
— matches the jaguar/snakes/birds precedent from #212). Behavior states:
`troop` (own-life movement between canopy anchor points), `curious`
(approach + head-tilt while the player stands still), `heist` (steal → perch
→ taunt → drop/chased-drop), `flee`. A pacing knob enforces min/max minutes
between heists so gags neither cluster nor starve (the one good idea from the
rejected "comedy director" approach). The heist integrates at the existing
forage seam; chasing = closing distance to the perch, which forces the drop.

### Reaction upgrades to existing systems (slices 2, 5)

- **Birds** (`birds.ts`): sprint-past within radius → grammar-driven flush
  (extends the existing `scatterFactor` machinery).
- **Fish** (`fish.ts`): wading splash → radial scatter through the grammar.
- **Jaguar** (`jaguar.ts`): new `startled` mode reachable only from `stalk`
  when the path crosses a snake alert radius; freeze-beat → bolt → long
  cooldown before it will stalk again.

### Audio & FX (slice 6)

4–5 one-shots on `AudioEngine` built from the existing `blip()` family, zero
asset bytes. Leaf-burst particle on flush reuses the discovery-burst Points
idiom. All rising-edge fired from `AudioSystem`/wildlife systems per the
established edge-guard pattern.

## Slices → PRs

| PR | Slices | Content |
|----|--------|---------|
| I  | 1–2    | Budget amendment; reaction grammar (pure) + birds flush rewired through it; fish scatter |
| II | 3–4    | Monkey troop core (geometry, troop/curious/flee); the fruit heist + pacing knob |
| III| 5–6    | Jaguar-vs-snake double-take; comedy audio one-shots + leaf-burst FX + tuning sweep |

Each PR: test-first, full gates (tests, build, bundle budget, lint, Playwright
render gate), review pass, squash-merge, auto-deploy.

## Budget amendment (PR I, approved)

Raise the JS gzip cap **400 → 432 KB** in `PERF_BUDGET`, rationale recorded in
`docs/perf-budget.md` (single-sourced; the SEC1 CI gate follows). Current
usage is 395.2 KB — the epic's behavior code needs real headroom. Asset
budget unchanged (epic adds 0 asset bytes). Every slice reports its byte
delta. Perf: monkeys are one InstancedMesh-or-merged draw call per troop;
all step math is O(instances) per frame with no allocation.

## Testing

- Grammar: every transition, timing table, reduced-motion collapse — pure
  unit tests.
- Birds/fish/jaguar/monkeys: state machines tested via fake stimuli
  (`stepFlock` precedent); heist loop against fake forage/player sources.
- Systems: thin — wiring pins only.
- Visuals: run the build per slice; CI render gate (low tier) exercises
  everything (no GLB path to miss).

## Out of scope (future epics, not designed)

Weather & atmosphere; embodiment/tactility; player pratfalls (camera comedy —
belongs with embodiment); monkeys interacting with the quest/dig; any
downloaded animal assets.
