// Observable survival state — the seam between the engine's SurvivalSystem
// (writer, inside the render loop) and the React meters/overlays (readers, via
// useSyncExternalStore). Same pattern as hudStore: framework-agnostic, no
// singleton, created per game and injected, with a cached snapshot that only
// re-allocates when a *displayed* value changes so React doesn't churn.

export interface SurvivalSnapshot {
  /** 0..100, whole numbers (display resolution — the system keeps fractions). */
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
  /** False from the moment health hits 0 until the respawn. */
  alive: boolean;
  /** Times the jungle has won this session (the completion screen tells). */
  deaths: number;
  /** Reachable water right now — the HUD shows the drink hint. */
  canDrink: boolean;
}

export interface SurvivalStore {
  getSnapshot(): SurvivalSnapshot;
  subscribe(listener: () => void): () => void;
  /** Write the latest survival read (the system calls this every frame; values
   *  are rounded and only a real change allocates + notifies). */
  set(next: SurvivalSnapshot): void;
}

export const FULL = 100;

export function createSurvivalStore(): SurvivalStore {
  const listeners = new Set<() => void>();
  let snapshot: SurvivalSnapshot = {
    health: FULL,
    stamina: FULL,
    hunger: FULL,
    thirst: FULL,
    alive: true,
    deaths: 0,
    canDrink: false,
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const health = Math.round(next.health);
      const stamina = Math.round(next.stamina);
      const hunger = Math.round(next.hunger);
      const thirst = Math.round(next.thirst);
      if (
        health === snapshot.health &&
        stamina === snapshot.stamina &&
        hunger === snapshot.hunger &&
        thirst === snapshot.thirst &&
        next.alive === snapshot.alive &&
        next.deaths === snapshot.deaths &&
        next.canDrink === snapshot.canDrink
      ) {
        return;
      }
      snapshot = {
        health,
        stamina,
        hunger,
        thirst,
        alive: next.alive,
        deaths: next.deaths,
        canDrink: next.canDrink,
      };
      for (const l of listeners) l();
    },
  };
}
