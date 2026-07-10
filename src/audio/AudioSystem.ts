// Audio controller (pivot slice H, #184; carries forward #51/#52's seam) — the
// thin engine-side glue that turns game events into `AudioEngine` calls. It is
// a `System` so it runs in the render loop alongside everything else, but it
// owns no synthesis itself: that all lives in `AudioEngine`. Every dependency
// is injected (the engine, the stores, the explorer, the world's day phase and
// water depth, the mute setting), so it's unit-tested with fakes and no real
// Web Audio.
//
// Responsibilities:
//  - clue reveal (discovery store: discoveredCount rises) → chime, fired
//    exactly once per new find via a store subscription;
//  - footsteps: paced ticks while the explorer is actually moving (speed
//    over the walking floor), faster cadence while sprinting, a splashier
//    tone while wading — silenced for free the instant the session pauses,
//    because the explorer itself zeroes `state.speed` while paused;
//  - sprint engages → a soft breathing cue, on the rising edge each frame;
//  - drink (thirst rises) → gulp, eat (fruit eaten rises) → bite, health drops
//    sharply → hurt thud, alive falls → death sting — all edges off the
//    survival/forage stores;
//  - dig progress crosses a third → dig thud; the finale begins (dig complete)
//    → fanfare — edges off the quest store;
//  - a snake goes alert/strikes → rattle, on the rising edge of `anyAlert()`;
//  - the jaguar commits to a stalk → low growl, on the rising edge of
//    `isStalking()` (same polled-warning posture as the rattle);
//  - the ambient bed's day/night crossfade and river proximity, driven every
//    frame from the world's day phase and water-depth field, plus sparse
//    bird/owl one-shot accents on their own timer;
//  - keep the engine's mute in sync with the live settings store each frame;
//  - start the ambient bed once the world is running.

import type { System, FrameContext } from "../engine/types.ts";
import { AudioEngine, nightAmount } from "./AudioEngine.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

/** The explorer's per-frame state — position (for river proximity) and stride
 *  (for footstep pacing). `ExplorerSystem` satisfies it via `state`. */
export interface StrideSource {
  readonly state: {
    readonly position: { readonly x: number; readonly z: number };
    readonly speed: number;
    readonly sprinting: boolean;
    readonly wading: boolean;
  };
}

/** Live mute flag — a `SettingsStore` satisfies it via `getSnapshot().muted`. */
export interface MutedSource {
  getSnapshot(): { muted: boolean };
}

/** The day-cycle loop fraction — `World.dayCycle` satisfies it. */
export interface DayPhaseSource {
  getPhase(): number;
}

/** Still-water depth at a ground point, metres (`<= 0` = dry) — `World.waterDepthAt`
 *  satisfies it. Same shape the explorer itself reads. */
export type WaterDepthAt = (x: number, z: number) => number;

/** Survival's live read — thirst/health rises and falls, alive flips. A
 *  `SurvivalStore` satisfies it via `getSnapshot()`. */
export interface SurvivalSource {
  getSnapshot(): { thirst: number; health: number; alive: boolean };
}

/** Foraging's live read — fruit eaten this expedition. A `ForageStore`
 *  satisfies it via `getSnapshot()`. */
export interface ForageSource {
  getSnapshot(): { eaten: number };
}

/** The quest's live read — dig progress, the finale window and the win flag.
 *  A `QuestStore` satisfies it via `getSnapshot()`. */
export interface QuestSource {
  getSnapshot(): { digProgress: number | null; finaleActive: boolean; treasureFound: boolean };
}

/** Whether any snake is alert or mid-strike right now — polled (not a
 *  callback) so this module stays decoupled from the wildlife module's shape,
 *  same posture as `HurtFn`. `SnakesSystem` satisfies it via `anyAlert()`. */
export interface SnakeAlertSource {
  anyAlert(): boolean;
}

/** Whether the jaguar is committed to the player (stalk or charge) — polled
 *  on the same posture as {@link SnakeAlertSource}. `JaguarSystem` satisfies
 *  it via `isStalking()`. The growl is the warning: hearing it means head for
 *  the camp, the water, or open ground. */
export interface JaguarStalkSource {
  isStalking(): boolean;
}

// --- Tuning (pacing/thresholds, no magic numbers below) ---------------------

/** Below this speed (m/s) the explorer isn't really walking — no ticks. */
const FOOTSTEP_MIN_SPEED = 0.5;
/** Seconds between ticks at a walk vs. a sprint (faster cadence sprinting). */
const FOOTSTEP_WALK_INTERVAL = 0.46;
const FOOTSTEP_SPRINT_INTERVAL = 0.3;

/** A health drop of at least this much in one store update reads as a sharp
 *  hit (a snake strike, a fall) rather than the slow hunger/thirst drain. */
const HURT_DROP_THRESHOLD = 5;

/** Beyond this distance (world units) from the nearest wet point, the river
 *  layer is silent; at the bank (distance 0) it's full. */
const RIVER_SILENCE_DIST = 25;
/** Ring-sample radii used to estimate distance-to-water around the player —
 *  the world only exposes point depth (`waterDepthAt`), not a distance field,
 *  so this is a coarse search, not a survey. It drives an ambient gain
 *  crossfade, not gameplay, so approximate is enough. */
const RIVER_SAMPLE_RADII = [0, 5, 10, 15, 20, 25] as const;
const RIVER_SAMPLE_DIRS = 8;

/** Sparse bird/owl accent pacing — a random interval in this range, re-rolled
 *  after every call, so a run of them never reads as a mechanical loop. */
const CRITTER_MIN_INTERVAL = 4;
const CRITTER_MAX_INTERVAL = 11;

/**
 * Approximate distance from `(x, z)` to the nearest wet point, by sampling a
 * ring at each of `radii`. Returns `Infinity` if nothing within the outermost
 * ring is wet. Pure (no THREE, no engine), so it's unit-testable with a fake
 * `WaterDepthAt`.
 */
export function nearestWaterDistance(
  waterDepthAt: WaterDepthAt,
  x: number,
  z: number,
  radii: readonly number[] = RIVER_SAMPLE_RADII,
): number {
  for (const r of radii) {
    if (r === 0) {
      if (waterDepthAt(x, z) > 0) return 0;
      continue;
    }
    for (let i = 0; i < RIVER_SAMPLE_DIRS; i++) {
      const a = (i / RIVER_SAMPLE_DIRS) * Math.PI * 2;
      if (waterDepthAt(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0) return r;
    }
  }
  return Infinity;
}

export class AudioSystem implements System {
  readonly id = "audio";

  private lastDiscovered: number;
  private musicStarted = false;
  private unsubscribe: () => void;

  private footstepTimer = 0;
  private lastSprinting = false;
  private critterTimer = CRITTER_MIN_INTERVAL;

  private lastThirst: number;
  private lastHealth: number;
  private lastAlive: boolean;
  private lastEaten: number;
  private lastDigThird = 0;
  /** True once the celebration (finale OR the win it ends in) has begun —
   *  the fanfare fires on this edge, i.e. at dig completion, not 4.5 s later
   *  when the panel's pause lands. */
  private lastCelebrating: boolean;
  private lastSnakeAlert = false;
  private lastJaguarStalking = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly discovery: DiscoveryStore,
    private readonly explorer: StrideSource,
    private readonly muted: MutedSource,
    private readonly dayPhase: DayPhaseSource,
    private readonly waterDepthAt: WaterDepthAt,
    private readonly survival: SurvivalSource,
    private readonly forage: ForageSource,
    private readonly quest: QuestSource,
    private readonly snakes: SnakeAlertSource,
    private readonly jaguar: JaguarStalkSource,
  ) {
    // Apply the persisted mute before anything plays.
    this.engine.setMuted(this.muted.getSnapshot().muted);

    // Clue reveal → chime, exactly once per *new* discovery. Subscribing
    // (rather than diffing the count each frame) keeps it event-driven and
    // matches how the FX burst listens to the same store. The initial count
    // is captured so restored saved progress at mount never re-chimes.
    this.lastDiscovered = this.discovery.getSnapshot().discoveredCount;
    this.unsubscribe = this.discovery.subscribe(() => {
      const count = this.discovery.getSnapshot().discoveredCount;
      if (count > this.lastDiscovered) this.engine.chime();
      this.lastDiscovered = count;
    });

    // Baselines captured at mount so restored/initial state never fires an
    // edge on the first frame (same "no re-fire on mount" posture as chime).
    const sv = this.survival.getSnapshot();
    this.lastThirst = sv.thirst;
    this.lastHealth = sv.health;
    this.lastAlive = sv.alive;
    this.lastEaten = this.forage.getSnapshot().eaten;
    const q = this.quest.getSnapshot();
    this.lastCelebrating = q.finaleActive || q.treasureFound;
  }

  update(ctx: FrameContext): void {
    // Keep mute in sync with the live setting (the pause menu writes it).
    this.engine.setMuted(this.muted.getSnapshot().muted);

    // Start the ambient bed once, when the world first runs. Doing it here (not
    // in the constructor) means it begins after the engine starts, so the
    // context is more likely to be unlocked by then.
    if (!this.musicStarted) {
      this.engine.startMusic();
      this.musicStarted = true;
    }

    const state = this.explorer.state;

    // Ambient bed: day/night crossfade + river proximity, driven live.
    this.engine.setAmbientPhase(this.dayPhase.getPhase());
    const dist = nearestWaterDistance(this.waterDepthAt, state.position.x, state.position.z);
    const riverAmount = dist === Infinity ? 0 : Math.max(0, 1 - dist / RIVER_SILENCE_DIST);
    this.engine.setRiverProximity(riverAmount);

    // Sparse bird/owl accents, on their own random-interval timer.
    this.critterTimer -= ctx.dt;
    if (this.critterTimer <= 0) {
      if (nightAmount(this.dayPhase.getPhase()) > 0.5) this.engine.owlHoot();
      else this.engine.birdChirp();
      this.critterTimer =
        CRITTER_MIN_INTERVAL + Math.random() * (CRITTER_MAX_INTERVAL - CRITTER_MIN_INTERVAL);
    }

    // Footsteps: paced ticks while actually moving. Stopping (including the
    // session pausing, which zeroes `state.speed`) resets the timer so the
    // very next step after resuming fires immediately rather than picking up
    // a stale countdown.
    if (state.speed > FOOTSTEP_MIN_SPEED) {
      this.footstepTimer -= ctx.dt;
      if (this.footstepTimer <= 0) {
        this.engine.footstep(state.wading);
        this.footstepTimer = state.sprinting ? FOOTSTEP_SPRINT_INTERVAL : FOOTSTEP_WALK_INTERVAL;
      }
    } else {
      this.footstepTimer = 0;
    }

    // Sprint rising edge → soft breathing cue.
    if (state.sprinting && !this.lastSprinting) this.engine.breathe();
    this.lastSprinting = state.sprinting;

    // Survival edges: drink (thirst rises), a sharp health drop, death.
    const sv = this.survival.getSnapshot();
    if (sv.thirst > this.lastThirst) this.engine.gulp();
    if (sv.health < this.lastHealth - HURT_DROP_THRESHOLD) this.engine.hurtThud();
    if (this.lastAlive && !sv.alive) this.engine.deathSting();
    this.lastThirst = sv.thirst;
    this.lastHealth = sv.health;
    this.lastAlive = sv.alive;

    // Forage edge: fruit eaten rises.
    const eaten = this.forage.getSnapshot().eaten;
    if (eaten > this.lastEaten) this.engine.bite();
    this.lastEaten = eaten;

    // Quest edges: dig progress crosses a third; treasure found.
    const q = this.quest.getSnapshot();
    if (q.digProgress === null) {
      this.lastDigThird = 0;
    } else {
      const third = Math.min(3, Math.floor(q.digProgress * 3));
      if (third > this.lastDigThird) this.engine.digThud();
      this.lastDigThird = third;
    }
    // Fanfare on the celebration's rising edge — finale start (dig complete).
    // `finaleActive || treasureFound` stays true across the finale→won
    // handover, so the win itself never re-fires it.
    const celebrating = q.finaleActive || q.treasureFound;
    if (celebrating && !this.lastCelebrating) this.engine.fanfare();
    this.lastCelebrating = celebrating;

    // Snake alert rising edge → rattle warning.
    const alert = this.snakes.anyAlert();
    if (alert && !this.lastSnakeAlert) this.engine.snakeAlert();
    this.lastSnakeAlert = alert;

    // Jaguar stalk rising edge → low growl (the predator's own warning seam).
    const stalking = this.jaguar.isStalking();
    if (stalking && !this.lastJaguarStalking) this.engine.growl();
    this.lastJaguarStalking = stalking;
  }

  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
  }
}
