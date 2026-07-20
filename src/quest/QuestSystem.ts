import type { System, FrameContext } from "../engine/types.ts";
import type { GameSession } from "../gameSession.ts";
import type { QuestStore } from "./questStore.ts";
import type { WinRecord } from "./winRecord.ts";

export const TUNE = {
  /** How close to the dig patch counts as digging distance. */
  digReach: 5,
  /** Seconds of digging to raise the chest. */
  digSeconds: 3,
  /** Seconds of unpaused completion spectacle (motes, idol glow, startled
   *  birds, fanfare) between the dig finishing and the win panel's pause. */
  finaleSeconds: 4.5,
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

/** Whether a reveal panel is open RIGHT NOW (the store flag, which flips
 *  synchronously on open — unlike the session's "reveal" pause reason, which
 *  DiscoverySystem derives a frame later). Guards the one-frame window where
 *  a press meant to close the just-opened fig page could start a phantom dig. */
export type SitePanelOpen = () => boolean;

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
 * completes only if you hold your ground — walking off cancels. Standing at
 * the patch with pages still missing publishes `missingPages`, the count the
 * dig-locked hint explains itself with (owner note: "why can't I dig?").
 *
 * Completing the dig starts the FINALE (owner note: "something amazing must
 * happen"): `revealTreasure` shows the chest, `onFinaleStart` fires (birds
 * startle, and the fanfare's audio edge is the store's `finaleActive` rise),
 * and the world stays live for ~{@link TUNE.finaleSeconds} while the mote
 * spiral plays. Only at the finale's end does `treasureFound` flip — the
 * TreasurePanel's rising edge — with the session paused under the "treasure"
 * reason and the expedition stats (play time, deaths, fruit eaten) frozen.
 * The panel's "keep exploring" clears the pause via the session;
 * `treasureFound` stays true for the rest of the session (dig once).
 */
export class QuestSystem implements System {
  readonly id = "quest";

  private playSeconds = 0;
  private digProgress: number | null = null;
  /** Seconds of finale remaining; null when no finale is running. */
  private finaleRemaining: number | null = null;
  private treasureFound = false;
  private lastCluesFound = 0;
  /** The win is written exactly once — guards the per-frame update loop and a
   *  restored-already-won session from re-saving. */
  private winPersisted = false;

  constructor(
    private readonly clueIds: readonly string[],
    private readonly digPoint: { x: number; z: number },
    private readonly player: PositionSource,
    private readonly input: InteractSource,
    private readonly discovered: DiscoveredIds,
    private readonly sitePanelOpen: SitePanelOpen,
    private readonly deaths: DeathsSource,
    private readonly eaten: EatenSource,
    private readonly store: QuestStore,
    private readonly session: GameSession,
    private readonly revealTreasure?: () => void,
    /** Owns the buried prop's teardown (geometries/materials). */
    private readonly disposeTreasure?: () => void,
    /** Fires once, the instant the dig completes and the finale begins —
     *  buildGame wires the bird startle through it. */
    private readonly onFinaleStart?: () => void,
    /** Persist the win the instant the dig completes (finale start), so a
     *  reload during the ~4.5 s finale window still keeps the win. Called at
     *  most once. */
    private readonly persistWin?: (record: WinRecord) => void,
    /** Rebuilt from a persisted win: start already-won so the idol stays dug up
     *  (buildGame reveals it) and the win panel never re-pops — its baseline
     *  reads treasureFound=true from the seed push below. */
    restoredWin = false,
  ) {
    if (restoredWin) {
      this.treasureFound = true;
      this.winPersisted = true;
      // Seed the store synchronously (before React mounts the TreasurePanel /
      // GameCanvas edge watcher) so their baseline snapshot already reads
      // treasureFound=true — otherwise the false→true seam would fire a phantom
      // win pop on every reload of a finished run.
      this.push(0, false, 0);
    }
  }

  dispose(): void {
    this.disposeTreasure?.();
  }

  update(ctx: FrameContext): void {
    // Hold while paused, AND while a reveal panel is open per the store —
    // the store flag flips synchronously on open, the session's "reveal"
    // reason a frame later; without the store check, the press meant to
    // close the just-opened fig page could start a phantom dig (review).
    if (this.session.paused || this.sitePanelOpen()) {
      this.push(this.lastCluesFound, false, 0);
      return;
    }

    this.playSeconds += ctx.dt;

    // The finale clock runs while the world is still live; at zero the win
    // lands: treasureFound flips (the TreasurePanel's rising edge) and the
    // session pauses under our own reason — the panel's "keep exploring"
    // lifts it through the session.
    if (this.finaleRemaining !== null) {
      this.finaleRemaining -= ctx.dt;
      if (this.finaleRemaining <= 0) {
        this.finaleRemaining = null;
        this.treasureFound = true;
        this.session.setPaused("treasure", true);
      }
    }

    const found = this.discovered();
    const cluesFound = this.clueIds.filter((id) => found.includes(id)).length;
    this.lastCluesFound = cluesFound;
    const allRead = cluesFound === this.clueIds.length;

    const p = this.player.state.position;
    const atDig =
      Math.hypot(p.x - this.digPoint.x, p.z - this.digPoint.z) <= TUNE.digReach;

    // Once the finale runs (or the treasure is out), the dig is spent: it
    // neither owns the key nor counts missing pages ever again.
    const digLive = !this.treasureFound && this.finaleRemaining === null;
    const digOwnsKey = allRead && atDig && digLive;
    const missingPages = atDig && digLive ? this.clueIds.length - cluesFound : 0;

    if (this.digProgress !== null) {
      // Digging: hold your ground. Walking off cancels; time completes it.
      if (!atDig) {
        this.digProgress = null;
      } else {
        this.digProgress += ctx.dt / TUNE.digSeconds;
        if (this.digProgress >= 1) {
          // Dig complete ⇒ the finale, not the pause: chest up, birds off,
          // the world stays live for the spectacle.
          this.digProgress = null;
          this.finaleRemaining = TUNE.finaleSeconds;
          this.revealTreasure?.();
          this.onFinaleStart?.();
          // Persist NOW, at the dig's completion — not at the treasureFound flip
          // 4.5 s later — so a reload during the finale still keeps the win.
          this.persistCompletion();
        }
      }
    } else if (digOwnsKey && this.input.consumeInteract()) {
      this.digProgress = 0;
    }

    // Re-check liveness: if the dig completed THIS frame, the finale owns the
    // moment — never publish a stale "press E to dig" alongside it.
    const stillLive = !this.treasureFound && this.finaleRemaining === null;
    this.push(cluesFound, digOwnsKey && stillLive, stillLive ? missingPages : 0);
  }

  /** Freeze the completion stats and hand them to the persistence seam, once. A
   *  dig only ever completes with every page read, so cluesFound is the full
   *  set. */
  private persistCompletion(): void {
    if (this.winPersisted) return;
    this.winPersisted = true;
    this.persistWin?.({
      playSeconds: Math.floor(this.playSeconds),
      cluesFound: this.clueIds.length,
      cluesTotal: this.clueIds.length,
      deaths: this.deaths.getSnapshot().deaths,
      fruitEaten: this.eaten.getSnapshot().eaten,
    });
  }

  private push(cluesFound?: number, digOwnsKey?: boolean, missingPages?: number): void {
    const found =
      cluesFound ?? this.clueIds.filter((id) => this.discovered().includes(id)).length;
    this.lastCluesFound = found;
    this.store.set({
      cluesFound: found,
      cluesTotal: this.clueIds.length,
      digOwnsKey: digOwnsKey ?? false,
      missingPages: missingPages ?? 0,
      digProgress: this.digProgress,
      finaleActive: this.finaleRemaining !== null,
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
      missingPages: s.missingPages,
      finale: s.finaleActive,
      treasure: s.treasureFound,
      playSeconds: s.playSeconds,
    };
  }
}
