// Observable HUD state — the seam between the engine's HudSystem (writer, inside
// the render loop) and the React Hud (reader, via useSyncExternalStore). Same
// pattern as discoveryStore: framework-agnostic, no singleton, created per game
// and injected, with a cached snapshot so React doesn't loop.

export interface HudSnapshot {
  /** Whole metres-per-second; rounded so per-frame jitter doesn't churn React. */
  speed: number;
  /** Sprinting right now (the HUD shows the exertion state). */
  sprinting: boolean;
  /** Compass heading in whole degrees, 0..359 (0 = north = -Z… the world's +Z
   *  spawn axis; what matters is that it's stable and the ring reads true). */
  heading: number;
}

export interface HudStore {
  getSnapshot(): HudSnapshot;
  subscribe(listener: () => void): () => void;
  /** Write the latest explorer read. Values are rounded and the store only
   *  allocates + emits when a rounded value actually changed (throttle). */
  set(next: HudSnapshot): void;
}

export function createHudStore(): HudStore {
  const listeners = new Set<() => void>();
  // Cached snapshot — a new object only on a real change, so
  // useSyncExternalStore (which compares by reference) doesn't loop.
  let snapshot: HudSnapshot = { speed: 0, sprinting: false, heading: 0 };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const speed = Math.round(next.speed);
      const sprinting = next.sprinting;
      const heading = ((Math.round(next.heading) % 360) + 360) % 360;
      // Skip the allocation + notify when nothing the HUD shows changed.
      if (speed === snapshot.speed && sprinting === snapshot.sprinting && heading === snapshot.heading) {
        return;
      }
      snapshot = { speed, sprinting, heading };
      for (const l of listeners) l();
    },
  };
}
