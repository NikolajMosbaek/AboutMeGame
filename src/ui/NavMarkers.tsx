import { useSyncExternalStore } from "react";
import type { NavStore, NavMarker } from "./navStore.ts";

export interface NavMarkersProps {
  nav: NavStore;
}

/** Inset (in % of the viewport) at which off-screen edge arrows ride the rim. */
const EDGE_INSET = 6;

/**
 * Navigation hints (#44): renders the markers the NavSystem projects.
 *  • On-screen landmarks get a small colour-tinted dot with the distance under
 *    it, positioned at the projected x%/y%.
 *  • Off-screen landmarks get an arrow pinned to the viewport rim, rotated by the
 *    marker's edge angle so it points toward the landmark (capped to the nearest
 *    few by the NavSystem). Hidden entirely once a POI is discovered.
 * Pure presentation over the store; pointer-events stay off so it never blocks
 * the world's input.
 */
export function NavMarkers({ nav }: NavMarkersProps) {
  const { markers } = useSyncExternalStore(nav.subscribe, nav.getSnapshot);

  return (
    <div className="nav-markers" aria-hidden="true">
      {markers.map((m) => (m.onScreen ? <OnScreen key={m.id} m={m} /> : <EdgeArrow key={m.id} m={m} />))}
    </div>
  );
}

function OnScreen({ m }: { m: NavMarker }) {
  return (
    <div className="nav-dot" style={{ left: `${m.x}%`, top: `${m.y}%`, "--nav-color": hex(m.color) } as React.CSSProperties}>
      <span className="nav-dot__pip" />
      <span className="nav-dot__label">{m.label}</span>
    </div>
  );
}

function EdgeArrow({ m }: { m: NavMarker }) {
  // Ride a centred ellipse inset from the rim, in the marker's screen direction.
  const cx = 50 + Math.cos(m.edgeAngle) * (50 - EDGE_INSET);
  const cy = 50 + Math.sin(m.edgeAngle) * (50 - EDGE_INSET);
  const deg = (m.edgeAngle * 180) / Math.PI;
  return (
    <div
      className="nav-arrow"
      style={{ left: `${cx}%`, top: `${cy}%`, "--nav-color": hex(m.color) } as React.CSSProperties}
    >
      <span className="nav-arrow__glyph" style={{ transform: `rotate(${deg}deg)` }}>
        ➤
      </span>
      <span className="nav-arrow__label">{m.label}</span>
    </div>
  );
}

/** 0xrrggbb number → "#rrggbb" CSS string. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
