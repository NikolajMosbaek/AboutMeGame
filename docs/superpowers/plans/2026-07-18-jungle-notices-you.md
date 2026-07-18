# The Jungle Notices You — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Right-sizing note:** this plan is executed inline by the same session that
> wrote it (user AFK, standing authority). Tasks lock in exact files,
> interfaces, tunables, state machines and test lists; they do not duplicate
> every line of implementation code. Spec:
> `docs/superpowers/specs/2026-07-18-jungle-notices-you-design.md`.

**Goal:** Emergent, lightly-cartoonish physical comedy from a jungle that
reacts to the player — reaction grammar, bird flush, fish scatter, a
fruit-stealing monkey troop, a jaguar-vs-snake double-take, and procedural
comedy audio/FX.

**Architecture:** A pure reaction-grammar module supplies shared comic timing
(notice → freeze-beat → react → cooldown). Existing pure step functions
(`stepFlock`, `stepFish`, `stepJaguar`) gain grammar-driven inputs/modes; a
new `monkeys.ts` follows the same pure-step + thin-System idiom with
procedural geometry from `geometry.ts` helpers. Audio one-shots ride
`AudioEngine`'s `blip()` family; the leaf burst rides the discovery-burst
Points idiom.

**Tech stack:** TypeScript, Three.js (InstancedMesh/merged low-poly), Vitest,
Web Audio (procedural), existing engine System contract.

## Global constraints

- Zero asset bytes — everything procedural (models, textures, audio).
- Budget after amendment: JS ≤ **432 KB gzip** (raised from 400 in PR I with
  rationale in `docs/perf-budget.md`; `PERF_BUDGET` single source), total
  ≤ 6 MB, draw calls ≤ 150, tris ≤ 500k, TTI ≤ 4 s. Report byte delta per PR.
- Comedy stings are synthesized animal sounds only — no cartoon SFX.
- Reduced-motion setting collapses freeze-beat/overshoot to plain flight.
- All state machines pure + headless-tested (`stepFlock` precedent); Systems
  stay thin; no per-frame allocation; dispose everything.
- Never commit to main; each PR green (tests, build, `check:bundle`, lint,
  `verify`) before merge.

---

## PR I — grammar + birds flush + fish scatter (slices 1–2)

### Task 1: budget amendment

**Files:** Modify `src/perf/perfBudget.ts` (or wherever `PERF_BUDGET.jsGzipKb`
lives — locate via `grep -rn "400" src/perf/`), `docs/perf-budget.md`;
existing budget tests updated.

- [ ] Raise JS gzip cap 400 → 432 with a dated rationale paragraph in
  `docs/perf-budget.md` (epic needs behavior-code headroom; asset budget
  untouched). Update any test pinning 400. Run `npm run check:bundle`.

### Task 2: reaction grammar (pure)

**Files:** Create `src/wildlife/reactions.ts`, `src/wildlife/reactions.test.ts`.

**Produces (later tasks consume):**

```ts
export type ReactionPhase = "idle" | "freeze" | "react" | "cooldown";
export interface ReactionState { phase: ReactionPhase; timer: number }
export interface ReactionStimulus { triggered: boolean } // caller computes trigger
export interface ReactionTiming {
  freezeSeconds: number;   // the comic beat before reacting
  reactSeconds: number;    // how long the reaction plays
  cooldownSeconds: number; // refractory period before re-triggering
}
export const COMIC_TIMING: ReactionTiming;   // the "lightly cartoonish" dial
export const PLAIN_TIMING: ReactionTiming;   // reduced-motion: freeze = 0
export function initialReaction(): ReactionState;
export function stepReaction(s: ReactionState, dt: number,
  stim: ReactionStimulus, t: ReactionTiming): ReactionState;
/** 0..1 envelope of the react phase with overshoot: fast attack past 1.0
 *  (~1.15) then settle — pure, sampled by consumers for radius/height. */
export function overshoot(phase01: number): number;
/** True exactly on the idle/freeze→react rising edge helper for one-shot
 *  audio: `justReacted(prev, next)`. */
export function justReacted(prev: ReactionState, next: ReactionState): boolean;
```

- [ ] Failing tests: phase transitions (idle→freeze on trigger; freeze→react
  after freezeSeconds; react→cooldown; cooldown→idle; re-trigger blocked in
  cooldown; PLAIN_TIMING skips freeze), overshoot shape (peaks > 1 mid-phase,
  ends ≈ 1, reduced variant not required — plain timing just has freeze 0),
  justReacted edge exactly once. Implement minimal. Commit.

### Task 3: birds flush through the grammar

**Files:** Modify `src/wildlife/birds.ts`, `src/wildlife/birds.test.ts`
(extend existing tests, don't break `startle()`/existing scatter contract).

**Consumes:** `stepReaction`, `COMIC_TIMING`/`PLAIN_TIMING`, `overshoot`,
`justReacted`.

**Behavior:** `stepFlock` gains a `playerSpeed` parameter. Sprint-past
(speed > 5.5 m/s) within `SPRINT_FLUSH_RADIUS = 26` (wider than the walk
ALERT_RADIUS 18) triggers a grammar-driven flush: freeze-beat (birds hold,
flap stops — the comic beat) then explosive scatter with `overshoot` scaling
`SCATTER_SPREAD`/`SCATTER_CLIMB` and 2× flap. Walking inside 18 keeps today's
behavior exactly. `BirdsSystem` gains an optional `ReducedMotionSource`
(shape: `{ reducedMotion: boolean }` — confirm the settings store's field
name at wiring) choosing the timing table per frame, and exposes
`justFlushed(): boolean` (drained edge) for the audio slice.

- [ ] Failing tests: sprint inside 26 → freeze then scatter; walk at 20 → no
  flush; walk inside 18 → immediate scatter (unchanged contract); freeze
  holds pose (scatterFactor 0 during freeze); overshoot factor > 1 sample;
  reduced motion → no freeze phase; startle() unchanged. Implement. Commit.

### Task 4: fish scatter through the grammar

**Files:** Modify `src/wildlife/fish.ts`, `src/wildlife/fish.test.ts`.

**Behavior:** `stepFish` gains `wadingSplash: boolean` (caller computes:
player in water AND speed > 1). A splash within `SPLASH_RADIUS = 8` triggers
grammar flee for the whole pool: brief freeze (fish hold), then radial dart
at `1.5 × FLEE_SPEED` with overshoot on the first burst. Existing
walk-close flee unchanged. `FishSystem` computes the splash from the
existing player source + `waterDepthAt`.

- [ ] Failing tests: splash → all pool fish flee (not just near ones); freeze
  beat before dart; no splash → unchanged behavior; speeds return to patrol.
  Implement. Commit. PR I: gates, review pass, merge.

---

## PR II — monkey troop + fruit heist (slices 3–4)

### Task 5: monkey geometry + troop/curious/flee core

**Files:** Create `src/wildlife/monkeys.ts`, `src/wildlife/monkeys.test.ts`;
modify `src/wildlife/buildWildlife.ts` (build + register), `src/buildGame.ts`
(pass forage seam in PR II Task 6 — core takes only terrain/player/session).

**Produces:**

```ts
export const TROOP_SIZE = 4;
export type MonkeyMode = "troop" | "curious" | "heist" | "flee";
export interface MonkeyState { mode: MonkeyMode; x: number; z: number;
  heading: number; timer: number; anchor: number; carrying: FruitKind | null }
export interface TroopEnv { player: { x: number; z: number };
  playerSpeed: number; playerStillSeconds: number }
export function initialMonkeyState(i: number): MonkeyState;
export function stepMonkey(s: MonkeyState, dt: number, env: TroopEnv,
  timing: ReactionTiming): MonkeyStepResult;
export class MonkeysSystem implements System { /* thin; describe(); dispose() */ }
```

**Behavior:** 4 capuchins, procedural geometry (torso/head/limbs/curl-tail via
`stampVertexColor` + `mergeOrThrow`, ≤ ~300 tris each, ONE InstancedMesh body
draw call + one tail mesh if needed); canopy anchor points near the valley
fruit bands (constant table, clear of sites like `FLOCK_WAYPOINTS`). `troop`:
hop-move between anchors (bouncy sine hop — the lightly-cartoonish gait, pure
function of timer). `curious`: player still > 4 s within 14 u → nearest monkey
approaches to 6 u, head-tilt oscillation, retreats on movement. `flee`:
player closes < 3 u → grammar freeze-beat then bound away. Ground height via
`terrain.heightAt` + hop offset. Deterministic (index-hashed phases, no
Math.random in state).

- [ ] Failing tests: state transitions (incl. curious requires stillness;
  flee on close approach; freeze-beat via grammar), hop pose pure + bounded,
  determinism (two runs identical), system registration + dispose. Implement.
  Commit.

### Task 6: the fruit heist

**Files:** Modify `src/wildlife/monkeys.ts` + tests; modify
`src/forage/ForageSystem.ts` (expose a steal seam), `src/buildGame.ts`
(wire forage → monkeys). Create nothing else.

**Interfaces:**

```ts
// ForageSystem gains (and buildGame passes to MonkeysSystem):
export interface FruitSteal {
  /** Nearest ripe plant within `radius` of (x,z), or null. */
  findRipeNear(x: number, z: number, radius: number): FruitPlant | null;
  /** Mark stolen: bare the plant + start regrow (same path as a pick, no eat). */
  steal(plant: FruitPlant): void;
  /** A dropped fruit the player can pick up (eat on interact, despawn 60 s). */
  dropAt(x: number, z: number, kind: FruitKind): void;
}
```

**Behavior:** `heist` mode, gated by a pacing knob (`HEIST_MIN_GAP = 90 s`,
`HEIST_MAX_WAIT = 240 s` — after max wait the troop drifts toward the player
to find a plant): trigger when the player is within 10 u of a ripe plant and
the gap has elapsed → nearest monkey darts to the plant (fast bound),
`steal()`, carries visible fruit (one small sphere child toggled per
instance) to a perch anchor ~10 u away, taunts (bounce + chitter edge
exposed as `justTaunted()`), then `dropAt(perch)` after 20 s — or immediately
when the player closes within 4 u of the perch (the chase). Dropped fruit:
ForageSystem renders one small mesh, interact-to-eat via the existing pick
seam, despawns after 60 s. Death/respawn: monkeys reset to troop, any carried
fruit silently dropped in place.

- [ ] Failing tests: pacing gap enforced (no heist before 90 s, forced drift
  after 240 s); steal bares plant + regrow starts; chase forces early drop;
  drop is pickable + nourishes + despawns; no heist while player in camp
  (reuse `clearOfSites`-style camp exclusion); reset-on-respawn. Implement.
  Commit. PR II: gates, review pass, merge.

---

## PR III — jaguar double-take + comedy audio/FX (slices 5–6)

### Task 7: jaguar-vs-snake double-take

**Files:** Modify `src/wildlife/jaguar.ts` + tests, `src/wildlife/snakes.ts`
(expose `positions(): ReadonlyArray<{x,z}>`), `src/wildlife/buildWildlife.ts`
(pass snake positions into `JaguarEnv`).

**Behavior:** `JaguarEnv` gains `snakes: ReadonlyArray<{x,z}>`. New mode
`startled`, reachable ONLY from `stalk`: when the stalk step would land
within `SNAKE_SCARE_RADIUS = 5` of any snake → freeze-beat (hold pose,
`STARTLE_FREEZE = 0.5 s`) then bolt directly away at `1.4 × CHARGE_SPEED`
for 2.5 s, then `prowl` with a long `STARTLED_COOLDOWN = 45 s` before any new
stalk. Expose `justStartled(): boolean` edge. Charge mode is NOT interrupted
(committed pounce stays dangerous — comedy never rescues the player
mid-charge; decision recorded here).

- [ ] Failing tests: stalk path into snake radius → startled (freeze → bolt →
  prowl + cooldown); charge unaffected; no re-stalk during cooldown; bolt
  respects `forbidden()` ground. Implement. Commit.

### Task 8: comedy audio + leaf-burst FX + tuning sweep

**Files:** Modify `src/audio/AudioEngine.ts` + tests (new one-shots:
`squawkCascade()` ~5 staggered falling chirps; `monkeyChitter()` rapid
high blip run; `monkeyRaspberry()` short low square-wave burr; `jaguarYelp()`
one rising startled sawtooth; `splashScatter()` short filtered noise-ish
burst from detuned blips). Modify `src/audio/AudioSystem.ts` + tests (rising
edges off `birds.justFlushed()`, monkeys `justTaunted()`/`justStole()`,
`jaguar.justStartled()` — same polled-edge posture as `snakes.anyAlert()`).
Create `src/fx/LeafBurstSystem.ts` + test (discovery-burst Points idiom, one
burst at flush position, reduced-motion aware). Modify `src/buildGame.ts`
wiring.

- [ ] Failing tests: each one-shot voice count + mute gate (extend `it.each`
  table); each edge fires exactly once per event (rising-edge tests with fake
  sources); leaf burst activates on flush edge + disposes. Implement.
- [ ] Tuning sweep: run the build (`npm run dev` + `develop-web-game`/verify
  screenshots), adjust `COMIC_TIMING` + gains once against the running game.
  Commit. PR III: gates, review pass, merge.

### Task 9: docs + close-out

- [ ] Run log `docs/team/runs/2026-07-18-jungle-notices-you.md` (decisions,
  review findings, byte deltas). Amend `docs/design/2026-07-08-the-lost-idol-design.md`
  pillar 1 with the approved tone boundary (one paragraph). Verify deploy on
  main after final merge; confirm live site.

## Self-review

- Spec coverage: birds ✓(T3) fish ✓(T4) monkeys ✓(T5) heist ✓(T6) jaguar
  ✓(T7) audio/FX ✓(T8) budget ✓(T1) tone-pillar doc ✓(T9). No gaps.
- No placeholders; signatures consistent (`ReactionTiming` consumed in T3/T5/
  T7; `FruitSteal` defined T6 where used).
- Types check: `FruitKind` imported from `forageStore.ts` in monkeys.
