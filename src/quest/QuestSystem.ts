import type { System, FrameContext } from "../engine/types.ts";
import type { GameSession } from "../gameSession.ts";
import type { QuestStore } from "./questStore.ts";

export const TUNE = {
  /** How close to the dig patch counts as digging distance. */
  digReach: 5,
  /** Seconds of digging to raise the chest. */
  digSeconds: 3,
} as const;

/** Where the player is — the explorer satisfies it. */
export interface PositionSource {
  readonly state: { position: { x: number; z: number } };
}

/** The interact edge. This system registers BEFORE DiscoverySystem: once every
 *  page is read, the dig outranks re-opening the fig's clue text. It consumes
 *  ONLY the press that starts a dig; everything else flows to the site/forage/
 *  drink chain unchanged. */
export interface InteractSource {
  consumeInteract(): boolean;
}

/** The read pages — late-bound to the discovery store (built after this
 *  system registers, because registration order is key priority). */
export type DiscoveredIds = () => readonly string[];

/** Session-stat sources mirrored into the completion stats. */
export interface DeathsSource {
  getSnapshot(): { deaths: number };
}
export interface EatenSource {
  getSnapshot(): { eaten: number };
}

/**
 * The treasure quest (pivot slice G) — the game's win condition. Every site
 * page must be read (the fig's own page ends "Dig."); then, standing at the
 * dig patch between the fig's roots, one press starts a ~3 s dig that
 * completes only if you hold your ground — walking off cancels. Completion
 * reveals the idol (the injected `revealTreasure` shows the buried prop),
 * pauses the session under the "treasure" reason, and freezes the expedition
 * stats (play time, deaths, fruit eaten) the TreasurePanel shows. The panel's
 * "keep exploring" clears the pause via the session; `treasureFound` stays
 * true for the rest of the session (dig once).
 */
export class QuestSystem implements System {
  readonly id = "quest";

  private playSeconds = 0;
  private digProgress: number | null = null;
  private treasureFound = false;

  constructor(
    private readonly clueIds: readonly string[],
    private readonly digPoint: { x: number; z: number },
    private readonly player: PositionSource,
    private readonly input: InteractSource,
    private readonly discovered: DiscoveredIds,
    private readonly deaths: DeathsSource,
    private readonly eaten: EatenSource,
    private readonly store: QuestStore,
    private readonly session: GameSession,
    private readonly revealTreasure?: () => void,
    /** Owns the buried prop's teardown (geometries/materials). */
    private readonly disposeTreasure?: () => void,
  ) {}

  dispose(): void {
    this.disposeTreasure?.();
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) {
      this.push();
      return;
    }

    this.playSeconds += ctx.dt;

    const found = this.discovered();
    const cluesFound = this.clueIds.filter((id) => found.includes(id)).length;
    const allRead = cluesFound === this.clueIds.length;

    const p = this.player.state.position;
    const atDig =
      Math.hypot(p.x - this.digPoint.x, p.z - this.digPoint.z) <= TUNE.digReach;

    const digOwnsKey = allRead && atDig && !this.treasureFound;

    if (this.digProgress !== null) {
      // Digging: hold your ground. Walking off (or the treasure appearing —
      // impossible mid-dig, but harmless) cancels; time completes it.
      if (!atDig) {
        this.digProgress = null;
      } else {
        this.digProgress += ctx.dt / TUNE.digSeconds;
        if (this.digProgress >= 1) {
          this.digProgress = null;
          this.treasureFound = true;
          this.revealTreasure?.();
          // The win moment: pause under our own reason; the TreasurePanel's
          // "keep exploring" lifts it through the session.
          this.session.setPaused("treasure", true);
        }
      }
    } else if (digOwnsKey && this.input.consumeInteract()) {
      this.digProgress = 0;
    }

    this.push(cluesFound, digOwnsKey);
  }

  private push(cluesFound?: number, digOwnsKey?: boolean): void {
    const found = cluesFound ?? this.clueIds.filter((id) => this.discovered().includes(id)).length;
    this.store.set({
      cluesFound: found,
      cluesTotal: this.clueIds.length,
      digOwnsKey: digOwnsKey ?? false,
      digProgress: this.digProgress,
      treasureFound: this.treasureFound,
      playSeconds: this.playSeconds,
      deaths: this.deaths.getSnapshot().deaths,
      fruitEaten: this.eaten.getSnapshot().eaten,
    });
  }

  describe(): Record<string, unknown> {
    const s = this.store.getSnapshot();
    return {
      clues: `${s.cluesFound}/${s.cluesTotal}`,
      digging: s.digProgress,
      treasure: s.treasureFound,
      playSeconds: s.playSeconds,
    };
  }
}
