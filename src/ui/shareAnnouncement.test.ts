import { describe, expect, it } from "vitest";
import { shareAnnouncementFor } from "./shareAnnouncement.ts";
import type { ShareOutcome } from "./useShare.ts";

describe("shareAnnouncementFor", () => {
  it("announces 'Link copied' for a copied outcome", () => {
    expect(shareAnnouncementFor("copied")).toBe("Link copied");
  });

  it("announces the recoverable address-bar copy for a failed outcome", () => {
    expect(shareAnnouncementFor("failed")).toBe(
      "Couldn't share — copy the link from the address bar",
    );
  });

  it("says nothing for a cancelled outcome — deliberate dismissal, no nagging", () => {
    expect(shareAnnouncementFor("cancelled")).toBeNull();
  });

  it("says nothing for a shared outcome — the OS sheet is its own confirmation", () => {
    expect(shareAnnouncementFor("shared")).toBeNull();
  });

  it("covers every ShareOutcome member (compile-time exhaustiveness)", () => {
    // `satisfies Record<ShareOutcome, …>` makes this test fail to COMPILE if
    // ShareOutcome gains a member, forcing the map (and its never guard in
    // shareAnnouncement.ts) to be extended before the suite can go green.
    const expected = {
      shared: null,
      copied: "Link copied",
      cancelled: null,
      failed: "Couldn't share — copy the link from the address bar",
    } satisfies Record<ShareOutcome, string | null>;
    for (const outcome of Object.keys(expected) as ShareOutcome[]) {
      expect(shareAnnouncementFor(outcome)).toBe(expected[outcome]);
    }
  });
});
