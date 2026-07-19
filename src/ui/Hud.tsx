import { useSyncExternalStore } from "react";
import type { HudStore } from "./hudStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

export interface HudProps {
  hud: HudStore;
  discovery: DiscoveryStore;
  /** Open the pause/settings menu (the gear button + Escape both call this). */
  onOpenMenu: () => void;
  /** Open the in-game journal (the book button + J both call this). */
  onOpenJournal: () => void;
}

/**
 * In-game HUD (#42) + discovery progress (#45). A thin, non-intrusive overlay:
 *  • top-left the cardinal compass point (or SPRINT while sprinting) — the sole
 *    diegetic wayfinding cue now that GPS markers and the vehicle-era speed
 *    readout are gone,
 *  • top-right the single "Pages N / total" progress badge (moved here from
 *    RevealPanel so there's exactly one) plus a menu button,
 *  • a small controls reminder along the bottom.
 * Reads the throttled hud store and the discovery store via useSyncExternalStore;
 * the stores only push whole-number changes, so this re-renders rarely. The menu
 * button is the only interactive part (pointer-events), so the HUD never eats the
 * world's drag input.
 */
export function Hud({ hud, discovery, onOpenMenu, onOpenJournal }: HudProps) {
  const h = useSyncExternalStore(hud.subscribe, hud.getSnapshot);
  const d = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);
  const remaining = d.total - d.discoveredCount;

  return (
    <>
      <div className="hud-telemetry" role="status" aria-label="explorer status">
        <span className={`hud-mode${h.sprinting ? " hud-mode--sprint" : ""}`}>
          {h.sprinting ? "SPRINT" : h.compass}
        </span>
      </div>

      <div className="hud-top-right">
        {/* Static visual progress. The spoken update lives in DiscoveryAnnouncer
            (a single polite live region that names the page), so this badge
            is not a live region — that avoids a bare "N / 6" double-announce.
            The remaining-count momentum line is a subordinate, aria-hidden cue;
            its meaning folds into this one aria-label so there's no second
            announcer and no double-announce. The completed branch is driven off
            the store's d.completed (guarded by total > 0), never remaining === 0,
            so an empty/unloaded store never reads as complete or "0 to go". */}
        <div
          className="discovery-progress"
          aria-label={
            d.completed
              ? `All ${d.total} pages found`
              : `${d.discoveredCount} of ${d.total} pages found, ${remaining} to go`
          }
        >
          Pages {d.discoveredCount} / {d.total}
          <span className="discovery-remaining" aria-hidden="true">
            {d.completed ? "All found" : `${remaining} to go`}
          </span>
        </div>
        <button
          type="button"
          className="hud-menu-btn"
          aria-label="Open journal"
          title="Journal (J)"
          onClick={onOpenJournal}
        >
          📖
        </button>
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
        WASD move · Mouse look · Shift sprint · E use · J journal · Esc menu
      </p>
    </>
  );
}

