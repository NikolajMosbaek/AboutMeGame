import { useEffect, useRef, useState } from "react";
import type { DiscoveryStore, DiscoverySnapshot } from "../discovery/discoveryStore.ts";
import { completionFor } from "./discoveryComplete.ts";

export interface CompletionPanelProps {
  store: DiscoveryStore;
  /** Ordered landmark list (from game.discovery.pois, sorted by `order`). */
  pois: { order: number; title: string }[];
  /** Restart discovery from zero (wired to game.discovery.reset()). */
  onReplay: () => void;
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
 */
export function CompletionPanel({ store, pois, onReplay }: CompletionPanelProps) {
  const [shown, setShown] = useState(false);
  const prevRef = useRef<DiscoverySnapshot | null>(null);
  const armedRef = useRef(false);

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

  if (!shown) return null;

  const discovered = new Set(store.getSnapshot().discoveredIds);
  // The list renders all titles in `order`; discovered marking and CTAs are
  // refined by later tasks. void to keep the prop wired without dead-code lint.
  void discovered;

  return (
    <div className="completion-panel-backdrop">
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
            <li key={p.order}>{p.title}</li>
          ))}
        </ol>
        <button type="button" className="cta" onClick={() => onReplay()}>
          Replay
        </button>
        <button type="button" className="cta" onClick={() => setShown(false)}>
          Keep exploring
        </button>
      </div>
    </div>
  );
}
