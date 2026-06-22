// Observable discovery state — the seam between the engine's DiscoverySystem
// (writer, inside the render loop) and the React reveal UI (reader, via
// useSyncExternalStore). A plain framework-agnostic store: no singleton, created
// per game and injected, so tests construct their own.

import type { PoiInteraction } from "../content/contentModel.ts";

export interface NearbyInfo {
  id: string;
  order: number;
  title: string;
  teaser: string;
  /** True when close enough to trigger the reveal (shows the "interact" hint). */
  inRange: boolean;
}

/** What a caller supplies to open a POI. `interaction` is optional — callers
 *  that don't know (or don't carry) one get `plain` in the snapshot. The richer
 *  per-open guess state (`guessChoice`, `bodyUnlocked`) is owned by the store,
 *  not the caller, so it lives only on the snapshot `OpenInfo`. */
export interface OpenPoiInput {
  id: string;
  order: number;
  title: string;
  body: string;
  interaction?: PoiInteraction;
}

export interface OpenInfo {
  id: string;
  order: number;
  title: string;
  body: string;
  /** Always present in the snapshot — defaulted to `{ type: "plain" }` when the
   *  opening caller omits one. Carried whole for slice 3's exhaustive switch. */
  interaction: PoiInteraction;
  /** The committed guess option index, or null before a pick (or for a
   *  non-guess interaction). A number-or-null index, not a boolean, so the UI
   *  can show which option was picked and tell null from option zero. */
  guessChoice: number | null;
  /** Derived: true when the body should be shown — always for plain/highlight,
   *  and for guess only once a choice is committed. Never stored independently. */
  bodyUnlocked: boolean;
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
  /** True once every POI is discovered — derived from count and total in set(). */
  completed: boolean;
}

export interface DiscoveryStore {
  getSnapshot(): DiscoverySnapshot;
  subscribe(listener: () => void): () => void;
  setNearby(nearby: NearbyInfo | null): void;
  openPoi(open: OpenPoiInput): void;
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
    completed: false,
  };

  const emit = () => {
    for (const l of listeners) l();
  };
  const set = (next: Partial<DiscoverySnapshot>) => {
    const merged = { ...snapshot, ...next };
    // Derive completion here (not in a setter's argument path) so a snapshot
    // mutated via openPoi/setNearby never carries a stale completed. The
    // total > 0 guard stops an empty store reading as instantly complete.
    merged.completed = merged.discoveredCount === merged.total && merged.total > 0;
    snapshot = merged;
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
    openPoi(input) {
      const interaction: PoiInteraction = input.interaction ?? { type: "plain" };
      // A guess starts locked (no pick yet); plain/highlight are unlocked at once.
      const open: OpenInfo = {
        id: input.id,
        order: input.order,
        title: input.title,
        body: input.body,
        interaction,
        guessChoice: null,
        bodyUnlocked: interaction.type !== "guess",
      };
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
