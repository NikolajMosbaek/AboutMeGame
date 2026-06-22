// Discovery-complete edge (completion moment).
//
// A pure function deriving the rising edge of `completed` from a pair of
// discovery snapshots. It mirrors announcementFor's CONTRACT (a null prev is
// the initial mount — never react to stale saved progress) but not its
// per-frame consumption: callers latch the result persistently rather than
// consuming it on the next frame. Kept separate from the rendering component so
// the "fire exactly once when discovery completes" logic is unit-testable
// without the DOM.

import type { DiscoverySnapshot } from "../discovery/discoveryStore.ts";

/**
 * True exactly on the transition where discovery becomes complete
 * (`prev.completed === false && next.completed === true`). A `null` prev is the
 * initial mount / reload seed — return false so a 13/13 reload never fires the
 * completion panel for already-saved progress.
 */
export function completionFor(
  prev: DiscoverySnapshot | null,
  next: DiscoverySnapshot,
): boolean {
  if (!prev) return false; // initial snapshot — don't react to saved progress
  return !prev.completed && next.completed;
}
