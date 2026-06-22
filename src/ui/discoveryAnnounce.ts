// Discovery announcement (#49 accessibility).
//
// A pure function deriving the polite screen-reader message from a pair of
// discovery snapshots. Kept separate from the rendering component so the logic
// — "announce only on a *new* discovery, naming the landmark and the running
// count" — is unit-testable without the DOM. The `DiscoveryAnnouncer` component
// just pipes the store's snapshots through this and writes the result into an
// `aria-live="polite"` region.

import type { DiscoverySnapshot } from "../discovery/discoveryStore.ts";

/**
 * The announcement to make when the discovery state advances `prev → next`, or
 * `null` for "say nothing". It speaks exactly once per newly-discovered
 * landmark: when the discovered count rises *and* a landmark is open (so we have
 * its title). A `null` prev is the initial mount — never announce stale saved
 * progress.
 */
export function announcementFor(
  prev: DiscoverySnapshot | null,
  next: DiscoverySnapshot,
): string | null {
  if (!prev) return null; // initial snapshot — don't read out saved progress
  if (next.discoveredCount <= prev.discoveredCount) return null; // no new find
  if (!next.open) return null; // a new find always opens its panel; guard anyway
  return `Discovered ${next.open.title} — ${next.discoveredCount} of ${next.total}`;
}
