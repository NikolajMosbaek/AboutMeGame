// Observable foraging state — what the React shell needs to draw the pick
// hint. Same store idiom as survivalStore: framework-agnostic, injected, a
// cached snapshot that only re-allocates on a real change.

export type FruitKind = "berries" | "banana" | "mango";

export interface ForageSnapshot {
  /** The ripe plant in reach right now (the HUD shows "pick & eat"). */
  nearby: { kind: FruitKind } | null;
  /** Fruit eaten this expedition (the completion screen tells). */
  eaten: number;
}

export interface ForageStore {
  getSnapshot(): ForageSnapshot;
  subscribe(listener: () => void): () => void;
  set(next: ForageSnapshot): void;
}

export function createForageStore(): ForageStore {
  const listeners = new Set<() => void>();
  let snapshot: ForageSnapshot = { nearby: null, eaten: 0 };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const sameNearby =
        (next.nearby === null && snapshot.nearby === null) ||
        (next.nearby !== null && snapshot.nearby !== null && next.nearby.kind === snapshot.nearby.kind);
      if (sameNearby && next.eaten === snapshot.eaten) return;
      snapshot = { nearby: next.nearby ? { kind: next.nearby.kind } : null, eaten: next.eaten };
      for (const l of listeners) l();
    },
  };
}
