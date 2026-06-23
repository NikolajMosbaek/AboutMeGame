import { useEffect, useSyncExternalStore } from "react";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { JournalPoi } from "../content/discoverablePois.ts";
import {
  buildJournalEntries,
  journalCanOpen,
} from "../discovery/journalEntries.ts";

export interface JournalPanelProps {
  /** Live discovery state — drives the lock/unlock of each row and reflects new
   *  discoveries (and reload-restored progress) for free via useSyncExternalStore. */
  store: DiscoveryStore;
  /** Position-free landmark projection (content + colour, no THREE). */
  journalPois: JournalPoi[];
  /** Close the journal (resume the sim unless a reveal still holds the pause). */
  onClose: () => void;
  /** Drain the queued interact edge immediately before opening a reveal, so the
   *  next `DiscoverySystem.update` can't consume a stale Enter/e and close it. */
  consumeInteract: () => boolean;
}

/**
 * In-game Journal (M3). Its own component + state, never a mode flag. Lists all
 * landmarks ordered by `order`; discovered rows show title + teaser, undiscovered
 * rows are a locked placeholder with only the signature colour — no content keys
 * reach the DOM, because `buildJournalEntries` masks structurally.
 *
 * Selecting an unlocked entry re-checks `journalCanOpen` against the LIVE
 * discovered set, drains the queued interact edge, then opens the reveal via
 * `store.openPoi` re-deriving the full open input from `journalPois` (never from
 * a row, so no locked body can leak). GameCanvas owns the open/close state and
 * the pause handoff; this component is the surface + the guarded open action.
 */
export function JournalPanel({ store, journalPois, onClose, consumeInteract }: JournalPanelProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const entries = buildJournalEntries(journalPois, snap.discoveredIds);

  // The journal owns Escape while topmost (GameCanvas's opener defers to it), so
  // it closes itself here. Full focus-trap polish lands with the panel's own a11y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = (id: string) => {
    // Re-check against the live discovered set, never the row that may be stale.
    if (!journalCanOpen(id, store.getSnapshot().discoveredIds)) return;
    const poi = journalPois.find((p) => p.id === id);
    if (!poi) return;
    // Drain the queued interact edge before the open commits (flaw one).
    consumeInteract();
    store.openPoi({
      id: poi.id,
      order: poi.order,
      title: poi.title,
      body: poi.body,
      interaction: poi.interaction,
    });
  };

  return (
    <div
      className="menu-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="menu" role="dialog" aria-modal="true" aria-labelledby="journal-title">
        <h2 id="journal-title" className="menu__title">
          Journal
        </h2>
        <ul className="journal__list">
          {entries.map((entry) =>
            entry.locked ? (
              <li key={entry.id}>
                <button type="button" className="journal__entry journal__entry--locked" disabled>
                  <span
                    className="journal__swatch"
                    style={{ background: `#${entry.color.toString(16).padStart(6, "0")}` }}
                    aria-hidden="true"
                  />
                  <span className="journal__locked-label">Undiscovered landmark</span>
                </button>
              </li>
            ) : (
              <li key={entry.id}>
                <button
                  type="button"
                  className="journal__entry"
                  onClick={() => open(entry.id)}
                >
                  <span
                    className="journal__swatch"
                    style={{ background: `#${entry.color.toString(16).padStart(6, "0")}` }}
                    aria-hidden="true"
                  />
                  <span className="journal__title">{entry.title}</span>
                  <span className="journal__teaser">{entry.teaser}</span>
                </button>
              </li>
            ),
          )}
        </ul>
        <div className="menu__actions">
          <button type="button" className="cta" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
