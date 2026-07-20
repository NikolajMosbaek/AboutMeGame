// Observable HUD state — the seam between the engine's HudSystem (writer, inside
// the render loop) and the React Hud (reader, via useSyncExternalStore). Same
// pattern as discoveryStore: framework-agnostic, no singleton, created per game
// and injected, with a cached snapshot so React doesn't loop.

export interface HudSnapshot {
  /** Sprinting right now (the HUD shows the exertion state). */
  sprinting: boolean;
  /** Compass heading in whole degrees, 0..359 (0 = north = -Z… the world's +Z
   *  spawn axis; what matters is that it's stable and the ring reads true). */
  heading: number;
  /** The 8-wind compass point, with hysteresis: it flips to a neighbour only
   *  once the heading is a clear margin past the sector boundary, so walking
   *  with micro look-adjustments near a boundary can't flicker N↔NE. */
  compass: CompassPoint;
}

export type CompassPoint = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

const POINTS: readonly CompassPoint[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Half a sector (22.5°) plus this margin must be exceeded to leave a sector. */
const HYSTERESIS_DEG = 8;

/** The sector for a heading given the currently-shown sector: sticky within
 *  22.5° + margin of the current centre, exact otherwise. Pure — exported for
 *  the tests that pin the no-flicker contract. */
export function compassWithHysteresis(heading: number, prev: CompassPoint): CompassPoint {
  const prevIdx = POINTS.indexOf(prev);
  const centre = prevIdx * 45;
  // Smallest signed angular distance heading→centre, in -180..180.
  const diff = ((((heading - centre) % 360) + 540) % 360) - 180;
  if (Math.abs(diff) <= 22.5 + HYSTERESIS_DEG) return prev;
  return POINTS[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
}

export interface HudStore {
  getSnapshot(): HudSnapshot;
  subscribe(listener: () => void): () => void;
  /** Write the latest explorer read (the compass point is derived here, with
   *  hysteresis). Values are rounded and the store only allocates + emits when
   *  a rounded value actually changed (throttle). */
  set(next: Omit<HudSnapshot, "compass">): void;
}

export function createHudStore(): HudStore {
  const listeners = new Set<() => void>();
  // Cached snapshot — a new object only on a real change, so
  // useSyncExternalStore (which compares by reference) doesn't loop.
  let snapshot: HudSnapshot = { sprinting: false, heading: 0, compass: "N" };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const sprinting = next.sprinting;
      const heading = ((Math.round(next.heading) % 360) + 360) % 360;
      const compass = compassWithHysteresis(heading, snapshot.compass);
      // Skip the allocation + notify when nothing the HUD shows changed.
      if (sprinting === snapshot.sprinting && heading === snapshot.heading) {
        return;
      }
      snapshot = { sprinting, heading, compass };
      for (const l of listeners) l();
    },
  };
}
