import type { System, FrameContext } from "../engine/types.ts";
import type { ExplorerSystem, WaterDepthAt } from "../player/explorer.ts";
import { forwardXZFromYaw } from "../player/explorer.ts";
import type { GameSession } from "../gameSession.ts";
import type { SurvivalStore } from "./survivalStore.ts";
import { FULL } from "./survivalStore.ts";

/** The interact edge the system consumes for drinking — player input satisfies
 *  it. Registered AFTER DiscoverySystem, so a press near a clue site is used by
 *  the site (clues outrank a drink); whatever survives arrives here, and the
 *  system drains it every frame so no stale press fires later. */
export interface InteractSource {
  consumeInteract(): boolean;
}

/** Whether a site interaction currently owns the E key (in-range prompt up) —
 *  the discovery store satisfies it. Lets the drink hint hide while a clue
 *  prompt is showing, so the player is never shown two meanings for one key. */
export interface SitePromptSource {
  getSnapshot(): { nearby: { inRange: boolean } | null };
}

export const TUNE = {
  /** Thirst: full → empty in ~7 minutes of play. */
  thirstPerSec: FULL / (7 * 60),
  /** Sprinting parches you faster. */
  sprintThirstFactor: 1.6,
  /** Hunger: full → empty in ~11 minutes. */
  hungerPerSec: FULL / (11 * 60),
  /** Stamina: ~6 s of sprint, ~10 s to recover. */
  staminaDrainPerSec: FULL / 6,
  staminaRegenPerSec: FULL / 10,
  /** Swimming costs stamina too (#184): a fraction of the sprint rate at
   *  cruise, a third at sprint-swim — and the river's grip wrings you at the
   *  FULL sprint rate whether you fight it or not. */
  swimStaminaFactor: 1 / 8,
  sprintSwimStaminaFactor: 1 / 3,
  /** Breath (#184): ~30 s underwater, refilled in ~3 s at the surface. */
  breathDrainPerSec: FULL / 30,
  breathRegenPerSec: FULL / 3,
  /** Health loss per second while breath is empty (drowning). */
  drownDrainPerSec: 4,
  /** Sprint re-engages only above this (the explorer's gate reads it). */
  sprintMinStamina: 10,
  /** Health drain per second PER empty meter (both empty stack to 4/s). */
  starveDrainPerSec: 2,
  /** Health regen per second while fed AND watered (both above half). */
  regenPerSec: 1,
  regenThreshold: 50,
  /** One gulp of river water. */
  drinkPerGulp: 30,
  /** Water within reach: at your feet, or this far ahead of you. */
  drinkReach: 1.9,
  /** Minimum depth that counts as drinkable water. */
  drinkMinDepth: 0.05,
  /** Meters after waking back at camp — weakened, not fresh. */
  respawnLevel: 75,
} as const;

/**
 * The survival rules (pivot slice D): hunger and thirst decay while you play,
 * sprint spends stamina (the explorer's sprint gate reads the store), empty
 * meters drain health, food-and-water above half slowly heal you, and reaching
 * water lets you drink with the interact key — one gulp per press. Health
 * reaching zero pauses the session under the "death" reason and flips
 * `alive:false`; the React death overlay calls `respawn()` to wake the player
 * back at camp with quest progress kept (deaths are counted for the completion
 * screen). All rates live in TUNE; the store rounds for display, the system
 * keeps full precision here.
 *
 * Eating arrives with the foraging slice via {@link eat} — the seam exists so
 * fruit restores hunger without that slice touching the decay rules.
 */
export class SurvivalSystem implements System {
  readonly id = "survival";

  private health = FULL;
  private stamina = FULL;
  private hunger = FULL;
  private thirst = FULL;
  private breath = FULL;
  private submerged = false;
  private alive = true;
  private deaths = 0;
  private canDrink = false;

  constructor(
    private readonly explorer: ExplorerSystem,
    private readonly input: InteractSource,
    private readonly waterDepthAt: WaterDepthAt,
    private readonly store: SurvivalStore,
    private readonly sitePrompt: SitePromptSource,
    private readonly session: GameSession,
    private readonly respawnPoint: { x: number; z: number; yaw?: number },
  ) {
    this.push();
  }

  /** The explorer's sprint gate: stamina left, and you're not dying/dead. */
  canSprint = (): boolean => this.alive && this.stamina > TUNE.sprintMinStamina;

  /** Restore hunger (foraging slice feeds this). Clamped; no-op while dead. */
  eat(amount: number): void {
    if (!this.alive) return;
    this.hunger = Math.min(FULL, this.hunger + amount);
    this.push();
  }

  /** Take damage (the wildlife slice feeds this — snake strikes). Death via
   *  hurt() follows the same pause/overlay path as starving. */
  hurt(amount: number): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.deaths += 1;
      this.session.setPaused("death", true);
    }
    this.push();
  }

  /** Wake back at camp: meters to respawnLevel, position reset, quest kept.
   *  The React death overlay calls this; it's idempotent while alive. */
  respawn(): void {
    if (this.alive) return;
    this.health = TUNE.respawnLevel;
    this.stamina = FULL;
    this.hunger = TUNE.respawnLevel;
    this.thirst = TUNE.respawnLevel;
    this.breath = FULL; // you wake on dry land
    this.submerged = false;
    this.alive = true;
    this.explorer.respawn(this.respawnPoint);
    this.session.setPaused("death", false);
    this.push();
  }

  update(ctx: FrameContext): void {
    if (this.session.paused || !this.alive) {
      // Hold all decay while a panel/menu (or death) owns the screen, and
      // drain the interact edge so a press behind an overlay can't fire a
      // drink on resume (the same discipline the explorer applies to look).
      this.input.consumeInteract();
      return;
    }

    const dt = ctx.dt;
    const s = this.explorer.state;

    // Decay. Sprinting parches; existing is hungry work either way.
    this.thirst -= TUNE.thirstPerSec * (s.sprinting ? TUNE.sprintThirstFactor : 1) * dt;
    this.hunger -= TUNE.hungerPerSec * dt;

    // Stamina: on land sprint spends and rest recovers; in the water the
    // swimming itself costs (#184) — a sliver at cruise, a third of sprint at
    // sprint-swim, and the river's grip wrings you at the FULL sprint rate
    // even adrift. A still float rests like standing still does.
    if (s.mode === "swim") {
      const factor = s.gripped
        ? 1
        : s.sprinting
          ? TUNE.sprintSwimStaminaFactor
          : s.speed > 0.1
            ? TUNE.swimStaminaFactor
            : 0;
      if (factor > 0) this.stamina -= TUNE.staminaDrainPerSec * factor * dt;
      else this.stamina += TUNE.staminaRegenPerSec * dt;
    } else if (s.sprinting) this.stamina -= TUNE.staminaDrainPerSec * dt;
    else this.stamina += TUNE.staminaRegenPerSec * dt;

    // Breath (#184): drains while the eye is under, refills fast surfaced.
    this.submerged = s.submerged;
    if (this.submerged) this.breath -= TUNE.breathDrainPerSec * dt;
    else this.breath += TUNE.breathRegenPerSec * dt;

    // Water within reach: underfoot or a step ahead of where you face.
    const fwd = forwardXZFromYaw(s.yaw);
    this.canDrink =
      this.waterDepthAt(s.position.x, s.position.z) > TUNE.drinkMinDepth ||
      this.waterDepthAt(
        s.position.x + fwd.x * TUNE.drinkReach,
        s.position.z + fwd.z * TUNE.drinkReach,
      ) > TUNE.drinkMinDepth;

    // Drink: one gulp per interact press. The edge is consumed EVERY frame
    // (used or not) so a press in the dry jungle can't fire minutes later;
    // DiscoverySystem runs first and keeps presses that open/close clues.
    const pressed = this.input.consumeInteract();
    const siteOwnsKey = this.sitePrompt.getSnapshot().nearby?.inRange ?? false;
    if (pressed && this.canDrink && !siteOwnsKey) {
      this.thirst = Math.min(FULL, this.thirst + TUNE.drinkPerGulp);
    }

    // Empty meters bite; a fed, watered explorer slowly mends. Drowning
    // (breath empty) bites hardest and blocks regen like starving does.
    let drain = 0;
    if (this.thirst <= 0) drain += TUNE.starveDrainPerSec;
    if (this.hunger <= 0) drain += TUNE.starveDrainPerSec;
    if (this.breath <= 0) drain += TUNE.drownDrainPerSec;
    if (drain > 0) {
      this.health -= drain * dt;
    } else if (
      this.health < FULL &&
      this.thirst > TUNE.regenThreshold &&
      this.hunger > TUNE.regenThreshold
    ) {
      this.health += TUNE.regenPerSec * dt;
    }

    this.clamp();

    // Death: pause the world under its own reason; the overlay owns the rest.
    if (this.health <= 0 && this.alive) {
      this.alive = false;
      this.deaths += 1;
      this.session.setPaused("death", true);
    }

    this.push();
  }

  private clamp(): void {
    this.health = Math.min(FULL, Math.max(0, this.health));
    this.stamina = Math.min(FULL, Math.max(0, this.stamina));
    this.hunger = Math.min(FULL, Math.max(0, this.hunger));
    this.thirst = Math.min(FULL, Math.max(0, this.thirst));
    this.breath = Math.min(FULL, Math.max(0, this.breath));
  }

  private push(): void {
    this.store.set({
      health: this.health,
      stamina: this.stamina,
      hunger: this.hunger,
      thirst: this.thirst,
      breath: this.breath,
      submerged: this.submerged,
      alive: this.alive,
      deaths: this.deaths,
      canDrink: this.canDrink,
    });
  }

  describe(): Record<string, unknown> {
    return {
      health: Math.round(this.health),
      stamina: Math.round(this.stamina),
      hunger: Math.round(this.hunger),
      thirst: Math.round(this.thirst),
      breath: Math.round(this.breath),
      submerged: this.submerged,
      alive: this.alive,
      deaths: this.deaths,
      canDrink: this.canDrink,
    };
  }
}
