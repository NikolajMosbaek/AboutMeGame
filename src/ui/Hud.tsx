import { useSyncExternalStore } from "react";
import type { HudStore } from "./hudStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

export interface HudProps {
  hud: HudStore;
  discovery: DiscoveryStore;
  /** Open the pause/settings menu (the gear button + Escape both call this). */
  onOpenMenu: () => void;
}

/**
 * In-game HUD (#42) + discovery progress (#45). A thin, non-intrusive overlay:
 *  • top-left telemetry — mode (DRIVE/FLY), speed, and altitude (fly only),
 *  • top-right the single "Discovered N / total" progress badge (moved here from
 *    RevealPanel so there's exactly one) plus a menu button,
 *  • a small controls reminder along the bottom.
 * Reads the throttled hud store and the discovery store via useSyncExternalStore;
 * the stores only push whole-number changes, so this re-renders rarely. The menu
 * button is the only interactive part (pointer-events), so the HUD never eats the
 * world's drag input.
 */
export function Hud({ hud, discovery, onOpenMenu }: HudProps) {
  const h = useSyncExternalStore(hud.subscribe, hud.getSnapshot);
  const d = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);
  const flying = h.mode === "fly";

  return (
    <>
      <div className="hud-telemetry" role="status" aria-label="vehicle telemetry">
        <span className={`hud-mode${flying ? " hud-mode--fly" : ""}`}>
          {flying ? "FLY" : "DRIVE"}
        </span>
        <span className="hud-stat">
          <span className="hud-stat__value">{h.speed}</span>
          <span className="hud-stat__unit">m/s</span>
        </span>
        {flying && (
          <span className="hud-stat">
            <span className="hud-stat__value">{h.altitude}</span>
            <span className="hud-stat__unit">m alt</span>
          </span>
        )}
      </div>

      <div className="hud-top-right">
        <div className="discovery-progress" role="status" aria-live="polite">
          Discovered {d.discoveredCount} / {d.total}
        </div>
        <button
          type="button"
          className="hud-menu-btn"
          aria-label="Open menu"
          title="Menu (Esc)"
          onClick={onOpenMenu}
        >
          ☰
        </button>
      </div>

      <p className="hud-controls" aria-hidden="true">
        WASD move · F fly · E reveal · Esc menu
      </p>
    </>
  );
}
