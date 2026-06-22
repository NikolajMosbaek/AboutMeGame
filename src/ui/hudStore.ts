// Observable HUD state — the seam between the engine's HudSystem (writer, inside
// the render loop) and the React Hud (reader, via useSyncExternalStore). Same
// pattern as discoveryStore: framework-agnostic, no singleton, created per game
// and injected, with a cached snapshot so React doesn't loop.

import type { DriveMode } from "../movement/vehicle.ts";

export interface HudSnapshot {
  mode: DriveMode;
  /** Whole metres-per-second; rounded so per-frame jitter doesn't churn React. */
  speed: number;
  /** Whole metres above the ground; only meaningful (shown) in fly mode. */
  altitude: number;
}

export interface HudStore {
  getSnapshot(): HudSnapshot;
  subscribe(listener: () => void): () => void;
  /** Write the latest vehicle read. Speed/altitude are rounded and the store
   *  only allocates + emits when a rounded value actually changed (throttle). */
  set(next: HudSnapshot): void;
}

export function createHudStore(): HudStore {
  const listeners = new Set<() => void>();
  // Cached snapshot — a new object only on a real change, so
  // useSyncExternalStore (which compares by reference) doesn't loop.
  let snapshot: HudSnapshot = { mode: "drive", speed: 0, altitude: 0 };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const mode = next.mode;
      const speed = Math.round(next.speed);
      const altitude = Math.round(next.altitude);
      // Skip the allocation + notify when nothing the HUD shows changed.
      if (mode === snapshot.mode && speed === snapshot.speed && altitude === snapshot.altitude) {
        return;
      }
      snapshot = { mode, speed, altitude };
      for (const l of listeners) l();
    },
  };
}
