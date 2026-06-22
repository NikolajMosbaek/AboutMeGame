import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DiscoveryStore, DiscoverySnapshot } from "../discovery/discoveryStore.ts";
import { completionFor } from "./discoveryComplete.ts";

export interface CompletionPanelProps {
  store: DiscoveryStore;
  /** Ordered landmark list (from game.discovery.pois, sorted by `order`). */
  pois: { order: number; title: string }[];
  /** Restart discovery from zero (wired to game.discovery.reset()). */
  onReplay: () => void;
  /**
   * The canvas container — focus returns here on dismiss/replay, since the panel
   * has no opener element to restore to. Optional so the panel can mount before
   * the container exists; focus return is simply skipped until it does.
   */
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Notified when the panel raises/lowers, so the shell can lift a
   * `completionOpen` flag and make its Escape menu-opener bail while the panel
   * is up (mirrors Onboarding's `onOpenChange`).
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * The completion moment (the panel shown once the final landmark's reveal is
 * closed). Detection lives entirely here, in a direct store subscriber, using a
 * PERSISTENT `armed` latch rather than a one-frame consumed edge:
 *
 *  • On each snapshot, `completionFor(prev, next)` flags the rising edge of
 *    `completed`. That edge occurs on the 13th-find frame while a reveal is
 *    still open (`open != null`), so we cannot show the panel then. Instead we
 *    set `armed` and leave it set — it survives every snapshot in between.
 *  • On each snapshot we also check `armed && next.open === null`; only then do
 *    we raise the visible panel and clear `armed`. Gating the *show* (not the
 *    *arm*) on `open === null` is what makes the latch immune to the edge
 *    landing while the final reveal is open.
 *
 * Subscribed directly (not via useSyncExternalStore) because it needs the
 * previous snapshot to detect the edge; seeds `prevRef` from `getSnapshot()`
 * before subscribing so a 13/13 reload never fires for already-saved progress.
 *
 * Accessibility (T6): a `role="dialog"` `aria-modal` surface labelled by its
 * header. The sim is NOT paused under this panel (it never writes store.open),
 * so a focus trap — not pause — is what stops keyboard input leaking to the
 * vehicle controls while it's up: focus enters on the primary CTA and Tab /
 * Shift+Tab cycle within the two CTAs. Escape and a backdrop click dismiss to
 * free-roam; on any dismiss focus returns to the canvas container.
 */
export function CompletionPanel({
  store,
  pois,
  onReplay,
  containerRef,
  onOpenChange,
}: CompletionPanelProps) {
  const [shown, setShown] = useState(false);
  const prevRef = useRef<DiscoverySnapshot | null>(null);
  const armedRef = useRef(false);
  const replayRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Seed the baseline so saved progress at mount isn't read as a fresh edge.
    prevRef.current = store.getSnapshot();
    const onChange = () => {
      const next = store.getSnapshot();
      // Persistent arm on the rising edge — never cleared per-frame.
      if (completionFor(prevRef.current, next)) armedRef.current = true;
      prevRef.current = next;
      // Raise the panel only once the final reveal has closed.
      if (armedRef.current && next.open === null) {
        armedRef.current = false;
        setShown(true);
      }
    };
    return store.subscribe(onChange);
  }, [store]);

  // Lift the open/close state so GameCanvas's Escape menu-opener bails while up.
  useEffect(() => {
    onOpenChange?.(shown);
  }, [shown, onOpenChange]);

  // Lower the panel and return focus to the canvas container (the panel has no
  // opener to restore to). `onDismiss` lets GameCanvas clear `completionOpen`.
  const dismiss = useCallback(() => {
    setShown(false);
    containerRef?.current?.focus();
  }, [containerRef]);

  const handleReplay = useCallback(() => {
    onReplay();
    dismiss();
  }, [onReplay, dismiss]);

  // Move focus to the primary CTA on open; trap Tab between the two CTAs so
  // keyboard input can't leak to the unpaused vehicle controls; Escape closes.
  useEffect(() => {
    if (!shown) return;
    replayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const first = replayRef.current;
      const last = keepRef.current;
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !(active === first || active === last)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !(active === first || active === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, dismiss]);

  if (!shown) return null;

  // The panel is raised only once every landmark is discovered, so every row is
  // a discovered row. Each is marked with a checkmark glyph (decorative, hidden
  // from assistive tech) PAIRED WITH a textual "Discovered" status — never a
  // glyph or colour alone (WCAG 1.4.1).
  return (
    <div
      className="completion-panel-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        className="completion-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completion-title"
      >
        <h2 id="completion-title" className="completion-panel__title">
          You found everything
        </h2>
        <ol className="completion-panel__list">
          {pois.map((p) => (
            <li key={p.order} className="completion-panel__item">
              <span className="completion-panel__check" aria-hidden="true">
                {"\u2713"}
              </span>
              <span className="completion-panel__item-title">{p.title}</span>
              <span className="completion-panel__item-status">Discovered</span>
            </li>
          ))}
        </ol>
        <button
          ref={replayRef}
          type="button"
          className="cta"
          onClick={handleReplay}
        >
          Replay
        </button>
        <button
          ref={keepRef}
          type="button"
          className="cta"
          onClick={dismiss}
        >
          Keep exploring
        </button>
      </div>
    </div>
  );
}
