// Observable discovery state — the seam between the engine's DiscoverySystem
// (writer, inside the render loop) and the React reveal UI (reader, via
// useSyncExternalStore). A plain framework-agnostic store: no singleton, created
// per game and injected, so tests construct their own.

export interface NearbyInfo {
  id: string;
  order: number;
  title: string;
  teaser: string;
  /** True when close enough to trigger the reveal (shows the "interact" hint). */
  inRange: boolean;
}

export interface OpenInfo {
  id: string;
  order: number;
  title: string;
  body: string;
}

export interface DiscoverySnapshot {
  /** The nearest POI within teaser range, or null. */
  nearby: NearbyInfo | null;
  /** The POI whose body is open in the reveal panel, or null. */
  open: OpenInfo | null;
  /** Ids of every discovered POI — the nav hints (#44) hide markers for these. */
  discoveredIds: string[];
  discoveredCount: number;
  total: number;
}

export interface DiscoveryStore {
  getSnapshot(): DiscoverySnapshot;
  subscribe(listener: () => void): () => void;
  setNearby(nearby: NearbyInfo | null): void;
  openPoi(open: OpenInfo): void;
  closePoi(): void;
  /** Set the discovered set; count is derived so the two never drift. */
  setDiscovered(ids: string[]): void;
}

export function createDiscoveryStore(total: number): DiscoveryStore {
  const listeners = new Set<() => void>();
  // Cached snapshot — a new object only when state changes, so
  // useSyncExternalStore doesn't loop (it compares by reference).
  let snapshot: DiscoverySnapshot = {
    nearby: null,
    open: null,
    discoveredIds: [],
    discoveredCount: 0,
    total,
  };

  const emit = () => {
    for (const l of listeners) l();
  };
  const set = (next: Partial<DiscoverySnapshot>) => {
    snapshot = { ...snapshot, ...next };
    emit();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setNearby(nearby) {
      const cur = snapshot.nearby;
      // Skip churn when nothing meaningful changed.
      if (cur === nearby) return;
      if (
        cur &&
        nearby &&
        cur.id === nearby.id &&
        cur.inRange === nearby.inRange
      ) {
        return;
      }
      set({ nearby });
    },
    openPoi(open) {
      set({ open });
    },
    closePoi() {
      if (snapshot.open) set({ open: null });
    },
    setDiscovered(ids) {
      // Skip churn when the set is unchanged (same length + same members, in the
      // stable persistence order). Keeps the snapshot reference stable for React.
      if (
        ids.length === snapshot.discoveredIds.length &&
        ids.every((id, i) => id === snapshot.discoveredIds[i])
      ) {
        return;
      }
      set({ discoveredIds: ids, discoveredCount: ids.length });
    },
  };
}
