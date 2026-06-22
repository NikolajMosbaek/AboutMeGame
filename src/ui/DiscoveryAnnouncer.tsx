import { useEffect, useRef, useState } from "react";
import type { DiscoveryStore, DiscoverySnapshot } from "../discovery/discoveryStore.ts";
import { announcementFor } from "./discoveryAnnounce.ts";

export interface DiscoveryAnnouncerProps {
  store: DiscoveryStore;
}

/**
 * Polite screen-reader announcement of a new discovery (#49). A visually-hidden
 * `aria-live="polite"` region that, each time the discovery store advances,
 * speaks "Discovered <title> — N of 13" exactly once per newly-found landmark
 * (see `announcementFor`). Subscribed directly (not via useSyncExternalStore)
 * because it needs the *previous* snapshot to decide, and it must not re-render
 * the visible UI — it owns only its own live region. Unsubscribes on unmount.
 */
export function DiscoveryAnnouncer({ store }: DiscoveryAnnouncerProps) {
  const [message, setMessage] = useState("");
  const prevRef = useRef<DiscoverySnapshot | null>(null);

  useEffect(() => {
    // Seed the baseline so saved progress at mount isn't read out as "new".
    prevRef.current = store.getSnapshot();
    const onChange = () => {
      const next = store.getSnapshot();
      const msg = announcementFor(prevRef.current, next);
      prevRef.current = next;
      if (msg) setMessage(msg);
    };
    return store.subscribe(onChange);
  }, [store]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
