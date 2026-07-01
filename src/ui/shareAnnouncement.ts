// F1 slice 3 (#131) — share-outcome announcement copy.
//
// A pure, exhaustive map from a share attempt's outcome to the message the
// CompletionPanel speaks through its polite live region (and mirrors in the
// visible status line), or `null` for "say nothing". Kept separate from the
// rendering component so the copy decisions are unit-testable without the DOM
// (house pattern: discoveryAnnounce.ts).

import type { ShareOutcome } from "./useShare.ts";

/**
 * The announcement for one {@link ShareOutcome}, per the useShare contract's
 * recommended copy:
 *
 * - `"copied"` → **"Link copied"** — nothing visible happened otherwise, so
 *   silence would read as a broken button.
 * - `"failed"` → recoverable copy pointing at the address bar.
 * - `"cancelled"` → `null` — the user dismissed the sheet deliberately; do
 *   not nag, and positively no consolation clipboard write.
 * - `"shared"` → `null` — the OS share sheet is its own confirmation.
 *
 * The `default` arm types `outcome` as `never`, so adding a member to
 * `ShareOutcome` fails compilation here until it is mapped.
 */
export function shareAnnouncementFor(outcome: ShareOutcome): string | null {
  switch (outcome) {
    case "copied":
      return "Link copied";
    case "failed":
      return "Couldn't share — copy the link from the address bar";
    case "cancelled":
      return null;
    case "shared":
      return null;
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled share outcome: ${String(exhaustive)}`);
    }
  }
}
