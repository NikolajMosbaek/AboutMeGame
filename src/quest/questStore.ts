// Observable quest state — the seam between the engine's QuestSystem (writer)
// and the React shell (dig prompt, treasure panel). Store idiom as everywhere:
// injected, framework-agnostic, snapshot re-allocates only on a real change.

export interface QuestSnapshot {
  /** Expedition pages read (all six sites, the fig's included). */
  cluesFound: number;
  cluesTotal: number;
  /** Standing at the dig patch with every page read, treasure still buried —
   *  the dig owns the interact key right now. */
  digOwnsKey: boolean;
  /** 0..1 while digging; null when not. Cancelled by walking away. */
  digProgress: number | null;
  /** The idol is out of the ground — the expedition is over. */
  treasureFound: boolean;
  /** Play-time seconds (pauses excluded), whole seconds for display. */
  playSeconds: number;
  /** Mirrored for the completion stats. */
  deaths: number;
  fruitEaten: number;
}

export interface QuestStore {
  getSnapshot(): QuestSnapshot;
  subscribe(listener: () => void): () => void;
  set(next: QuestSnapshot): void;
}

export function createQuestStore(cluesTotal: number): QuestStore {
  const listeners = new Set<() => void>();
  let snapshot: QuestSnapshot = {
    cluesFound: 0,
    cluesTotal,
    digOwnsKey: false,
    digProgress: null,
    treasureFound: false,
    playSeconds: 0,
    deaths: 0,
    fruitEaten: 0,
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const progress =
        next.digProgress === null ? null : Math.round(next.digProgress * 100) / 100;
      const playSeconds = Math.floor(next.playSeconds);
      if (
        next.cluesFound === snapshot.cluesFound &&
        next.digOwnsKey === snapshot.digOwnsKey &&
        progress === snapshot.digProgress &&
        next.treasureFound === snapshot.treasureFound &&
        playSeconds === snapshot.playSeconds &&
        next.deaths === snapshot.deaths &&
        next.fruitEaten === snapshot.fruitEaten
      ) {
        return;
      }
      snapshot = {
        cluesFound: next.cluesFound,
        cluesTotal: snapshot.cluesTotal,
        digOwnsKey: next.digOwnsKey,
        digProgress: progress,
        treasureFound: next.treasureFound,
        playSeconds,
        deaths: next.deaths,
        fruitEaten: next.fruitEaten,
      };
      for (const l of listeners) l();
    },
  };
}
