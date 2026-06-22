// Observable nav-marker state — the seam between the engine's NavSystem (writer,
// projects undiscovered POIs to screen space each frame) and React's NavMarkers
// (reader, via useSyncExternalStore). Same cached-snapshot pattern as the other
// stores so React doesn't loop; the NavSystem only pushes a new snapshot when the
// rounded marker layout actually changes.

export interface NavMarker {
  id: string;
  /** Hex landmark colour (e.g. 0xffcb47) for the dot/arrow tint. */
  color: number;
  /** Human label — the distance in whole metres (e.g. "84 m"). */
  label: string;
  /** True when the POI is within the camera frustum (show a dot at x%,y%). */
  onScreen: boolean;
  /** Screen position as a percentage, 0..100 (only meaningful when onScreen). */
  x: number;
  y: number;
  /** Radians, screen-space angle to point an edge arrow (only off-screen). */
  edgeAngle: number;
}

export interface NavSnapshot {
  markers: NavMarker[];
}

export interface NavStore {
  getSnapshot(): NavSnapshot;
  subscribe(listener: () => void): () => void;
  /** Replace the marker list. No-op (no emit, stable snapshot) when the new
   *  list is layout-equivalent to the current one. */
  set(markers: NavMarker[]): void;
}

export function createNavStore(): NavStore {
  const listeners = new Set<() => void>();
  // Cached snapshot — reference is stable until the layout genuinely changes.
  let snapshot: NavSnapshot = { markers: [] };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(markers) {
      if (sameLayout(snapshot.markers, markers)) return;
      snapshot = { markers };
      for (const l of listeners) l();
    },
  };
}

/** Cheap equality on the rounded fields the UI renders, so per-frame jitter that
 *  rounds to the same pixels/label doesn't churn React. */
function sameLayout(a: NavMarker[], b: NavMarker[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const m = a[i];
    const n = b[i];
    if (
      m.id !== n.id ||
      m.onScreen !== n.onScreen ||
      m.label !== n.label ||
      m.x !== n.x ||
      m.y !== n.y ||
      m.edgeAngle !== n.edgeAngle
    ) {
      return false;
    }
  }
  return true;
}
