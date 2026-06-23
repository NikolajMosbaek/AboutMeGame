import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

const LOCK_LABEL = "Undiscovered landmark";

/** The focusable stops inside a node, in document order, skipping disabled ones
 *  (the locked rows). Used to seat focus on open and to wrap Tab/Shift+Tab. */
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute("disabled"));
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
 *
 * A11y: `role=dialog` + `aria-modal`, focus seated inside on open, a focus trap
 * that wraps Tab/Shift+Tab within the dialog, Escape and backdrop-click to close,
 * and a dialog-scoped polite `sr-only` live region (the GuessBody pattern) that
 * announces a newly discovered landmark while the journal is open. The announcer
 * is a sibling of the Hud's, scoped inside this dialog, so the Hud's single
 * live-region invariant holds.
 */
export function JournalPanel({ store, journalPois, onClose, consumeInteract }: JournalPanelProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const entries = buildJournalEntries(journalPois, snap.discoveredIds);

  const dialogRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const prevCountRef = useRef(snap.discoveredCount);

  // Seat focus inside the dialog on open, and wire Escape + a Tab focus trap.
  // The journal owns Escape while topmost (GameCanvas's opener defers to it).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      const first = focusable(dialog)[0];
      (first ?? dialog).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && dialog) {
        const stops = focusable(dialog);
        if (stops.length === 0) {
          e.preventDefault();
          return;
        }
        const firstStop = stops[0];
        const lastStop = stops[stops.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === firstStop) {
          e.preventDefault();
          lastStop.focus();
        } else if (!e.shiftKey && active === lastStop) {
          e.preventDefault();
          firstStop.focus();
        } else if (active && !dialog.contains(active)) {
          // Focus escaped the dialog (e.g. nothing inside was focused): pull it back.
          e.preventDefault();
          firstStop.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Politely announce a landmark unlocking while the journal is open. Guarded by
  // the previous count so it never fires on mount or on an unrelated re-render.
  useEffect(() => {
    if (snap.discoveredCount > prevCountRef.current) {
      setAnnouncement("New landmark discovered.");
    }
    prevCountRef.current = snap.discoveredCount;
  }, [snap.discoveredCount]);

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
      <div
        ref={dialogRef}
        className="menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-title"
        tabIndex={-1}
      >
        <h2 id="journal-title" className="menu__title">
          Journal
        </h2>
        <ul className="journal__list">
          {entries.map((entry) =>
            entry.locked ? (
              <li key={entry.id}>
                <button
                  type="button"
                  className="journal__entry journal__entry--locked"
                  disabled
                  aria-label={LOCK_LABEL}
                >
                  <span
                    className="journal__swatch"
                    style={{ background: `#${entry.color.toString(16).padStart(6, "0")}` }}
                    aria-hidden="true"
                  />
                  <span className="journal__locked-label">{LOCK_LABEL}</span>
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

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </div>
    </div>
  );
}
