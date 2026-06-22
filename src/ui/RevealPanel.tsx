import { useEffect, useRef, useSyncExternalStore } from "react";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

export interface RevealPanelProps {
  store: DiscoveryStore;
}

/**
 * The discovery UI (issue #38): three states driven by the discovery store.
 *  • A "Discovered N / total" badge, always visible.
 *  • A teaser prompt near a landmark (with an interact hint when in range).
 *  • The full reveal panel (a modal dialog) when a landmark is opened.
 * Reads the store via `useSyncExternalStore`; closing calls `store.closePoi()`,
 * which the DiscoverySystem observes to resume the paused sim. Epic 5 layers the
 * richer HUD/nav hints on top; this is the core reveal experience.
 */
export function RevealPanel({ store }: RevealPanelProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog when it opens; close on Escape.
  useEffect(() => {
    if (!snap.open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.closePoi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap.open, store]);

  return (
    <>
      <div className="discovery-progress" role="status" aria-live="polite">
        Discovered {snap.discoveredCount} / {snap.total}
      </div>

      {!snap.open && snap.nearby && (
        <div className="reveal-prompt" role="status">
          <span className="reveal-prompt__title">{snap.nearby.title}</span>
          <span className="reveal-prompt__teaser">{snap.nearby.teaser}</span>
          {snap.nearby.inRange && (
            <span className="reveal-prompt__hint">Press E · or USE to reveal</span>
          )}
        </div>
      )}

      {snap.open && (
        <div
          className="reveal-panel-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) store.closePoi();
          }}
        >
          <div
            className="reveal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reveal-title"
          >
            <p className="reveal-panel__eyebrow">
              Landmark {snap.open.order} of {snap.total}
            </p>
            <h2 id="reveal-title" className="reveal-panel__title">
              {snap.open.title}
            </h2>
            <p className="reveal-panel__body">{snap.open.body}</p>
            <button
              ref={closeRef}
              type="button"
              className="cta reveal-panel__close"
              onClick={() => store.closePoi()}
            >
              Drive on
            </button>
          </div>
        </div>
      )}
    </>
  );
}
