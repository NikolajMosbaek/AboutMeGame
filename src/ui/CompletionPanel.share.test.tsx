import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CompletionPanel } from "./CompletionPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { ShareCapabilities } from "./useShare.ts";

// T4 (F1 slice 3, #131) — the Share CTA on the completion panel.
//
// Everything in this file injects plain fakes through the panel's optional DI
// props (shareCapabilities / shareUrl) — no navigator stubbing, no user-event
// dep. This block pins the CTA row's order and the clipboard-only default
// desktop path; the announcement surfaces live in T5 below, the
// pending/latch matrix in T6.

const THIRTEEN = Array.from({ length: 13 }, (_, i) => ({
  order: i + 1,
  title: `Landmark ${i + 1}`,
}));

const SHARE_URL = "https://example.test/injected-base/";

function driveToShown(store: ReturnType<typeof createDiscoveryStore>) {
  // 13th find arrives with its reveal open, then the player closes it.
  act(() => {
    store.openPoi({ id: "p13", order: 13, title: "Landmark 13", body: "…" });
    store.setDiscovered(THIRTEEN.map((_, i) => `p${i + 1}`));
  });
  act(() => store.closePoi());
}

function mountWithShare(capabilities: ShareCapabilities) {
  const store = createDiscoveryStore(13);
  render(
    <CompletionPanel
      store={store}
      pois={THIRTEEN}
      onReplay={() => {}}
      shareCapabilities={capabilities}
      shareUrl={SHARE_URL}
    />,
  );
  driveToShown(store);
  return { store };
}

/** A promise whose settlement the test controls — for pinning pending state. */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CompletionPanel share CTA (T4)", () => {
  it("clicking Share writes the injected URL via the injected clipboard, with CTAs in DOM order Replay, Share, Keep exploring", async () => {
    const writes: string[] = [];
    mountWithShare({
      clipboard: {
        writeText: async (text) => {
          writes.push(text);
        },
      },
    });

    // DOM order = visual order = tab order: Replay, Share, Keep exploring.
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Replay",
      "Share",
      "Keep exploring",
    ]);

    // Default desktop path (share absent): the clipboard fake receives the
    // injected URL — not a navigator read, not a location read.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });
    expect(writes).toEqual([SHARE_URL]);
  });
});

// T5 (F1 slice 3, #131) — the announcement plumbing.
//
// A PERSISTENT sr-only role=status aria-live=polite aria-atomic region
// (DiscoveryAnnouncer's pattern verbatim) mounted EMPTY from panel open and
// INSIDE the aria-modal dialog, plus a one-line visible aria-hidden mirror
// under the CTAs so a sighted mouse user isn't left with a silently-dead
// button. Only the non-null outcomes ("copied"/"failed") surface anywhere;
// "cancelled" and "shared" are asserted as region-STAYS-EMPTY, not merely
// "not Link copied". Both surfaces reset on dismiss (the component never
// unmounts, so stale state would otherwise survive to a re-raise), and the
// announcement — unlike the pending clear — sits behind a generation guard,
// so a share resolving after a dismissal never speaks onto a re-raised panel.

function mirrorLine(): Element | null {
  return screen
    .getByRole("dialog")
    .querySelector('p[aria-hidden="true"]');
}

describe("CompletionPanel share announcement (T5)", () => {
  it("mounts the polite live region EMPTY inside the dialog from panel open", () => {
    mountWithShare({ clipboard: { writeText: async () => {} } });

    const region = screen.getByRole("status");
    expect(screen.getByRole("dialog")).toContainElement(region);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toHaveClass("sr-only");
    expect(region.textContent).toBe("");
    // No visible status line before any outcome either.
    expect(mirrorLine()).toBeNull();
  });

  it("announces 'Link copied' in the region AND the visible aria-hidden mirror, without moving focus", async () => {
    mountWithShare({ clipboard: { writeText: async () => {} } });

    // Entry focus sits on Replay; the announcement must not move it.
    const before = document.activeElement;
    expect(before).toBe(screen.getByRole("button", { name: "Replay" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    expect(screen.getByRole("status").textContent).toBe("Link copied");
    expect(mirrorLine()?.textContent).toBe("Link copied");
    expect(document.activeElement).toBe(before);
  });

  it("announces the recoverable address-bar copy on 'failed'", async () => {
    // No usable capability at all → performShare resolves "failed".
    mountWithShare({});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    const expected = "Couldn't share — copy the link from the address bar";
    expect(screen.getByRole("status").textContent).toBe(expected);
    expect(mirrorLine()?.textContent).toBe(expected);
  });

  it("stays silent on 'cancelled': the region text STAYS empty and no visible line renders", async () => {
    mountWithShare({ share: () => Promise.reject({ name: "AbortError" }) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    expect(screen.getByRole("status").textContent).toBe("");
    expect(mirrorLine()).toBeNull();
  });

  it("stays silent on 'shared': the region text STAYS empty and no visible line renders", async () => {
    mountWithShare({ share: async () => {} });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    expect(screen.getByRole("status").textContent).toBe("");
    expect(mirrorLine()).toBeNull();
  });

  it("resets both message surfaces on dismiss so a re-raised panel carries no stale text", async () => {
    const { store } = mountWithShare({
      clipboard: { writeText: async () => {} },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });
    expect(screen.getByRole("status").textContent).toBe("Link copied");

    fireEvent.keyDown(window, { key: "Escape" });
    act(() => store.setDiscovered([]));
    driveToShown(store);

    expect(screen.getByRole("status").textContent).toBe("");
    expect(mirrorLine()).toBeNull();
  });

  it("drops a stale announcement resolving after dismissal (generation guard): the re-raised panel stays silent", async () => {
    const d = deferred();
    const { store } = mountWithShare({
      clipboard: { writeText: () => d.promise },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    // Dismiss mid-pending, then re-raise BEFORE the share settles: the panel
    // is shown again, so a shown-only liveness check would announce the stale
    // outcome — the generation guard must not.
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => store.setDiscovered([]));
    driveToShown(store);

    await act(async () => {
      d.resolve();
    });

    expect(screen.getByRole("status").textContent).toBe("");
    expect(mirrorLine()).toBeNull();
    // The pending clear stays UNGATED: the stale resolution re-enables Share.
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  });
});

// T6 (F1 slice 3, #131) — the critic-mandated pending/latch matrix, all
// against DEFERRED promises so each test holds the share in flight and
// controls exactly when — and how — it settles.
//
// The latch under test: handleShare sets pending, invokes the injected
// capability, and clears pending in an UNCONDITIONAL finally. The panel
// renders null while hidden but never unmounts, so a liveness-gated clear
// would brick Share for the session (the material flaw the Quality critic
// caught); only the announcement + focus-restore cosmetics are
// generation-gated.

type Deferred = ReturnType<typeof deferred>;

describe("CompletionPanel share pending latch (T6)", () => {
  it("carries native disabled while pending and invokes the capability exactly once across a double click", async () => {
    const d = deferred();
    let calls = 0;
    mountWithShare({
      clipboard: {
        writeText: () => {
          calls += 1;
          return d.promise;
        },
      },
    });

    const shareBtn = screen.getByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(shareBtn);
    });
    expect(shareBtn).toBeDisabled();

    // Second click while pending: native disabled blocks the click event
    // outright — stronger double-activation protection than a handler guard.
    await act(async () => {
      fireEvent.click(shareBtn);
    });
    expect(calls).toBe(1);

    await act(async () => {
      d.resolve();
    });
    expect(shareBtn).toBeEnabled();
  });

  // Pending must clear on EVERY member of the ShareOutcome union — including
  // "cancelled": a dismissed iOS share sheet is not a broken button, and a
  // latch cleared only on success would brick the CTA the first time a user
  // changed their mind. Each row drives performShare's real classification
  // (resolve → shared/copied; AbortError-named rejection → cancelled;
  // non-abort rejection with no fallback → failed) rather than stubbing the
  // hook.
  const OUTCOMES: {
    outcome: string;
    capabilities: (d: Deferred) => ShareCapabilities;
    settle: (d: Deferred) => void;
  }[] = [
    {
      outcome: "shared",
      capabilities: (d) => ({ share: () => d.promise }),
      settle: (d) => d.resolve(),
    },
    {
      outcome: "copied",
      capabilities: (d) => ({ clipboard: { writeText: () => d.promise } }),
      settle: (d) => d.resolve(),
    },
    {
      outcome: "cancelled",
      capabilities: (d) => ({ share: () => d.promise }),
      settle: (d) => d.reject({ name: "AbortError" }),
    },
    {
      outcome: "failed",
      capabilities: (d) => ({ clipboard: { writeText: () => d.promise } }),
      settle: (d) => d.reject({ name: "NotAllowedError" }),
    },
  ];

  it.each(OUTCOMES)(
    "re-enables Share when the in-flight share settles as '$outcome'",
    async ({ capabilities, settle }) => {
      const d = deferred();
      mountWithShare(capabilities(d));

      const shareBtn = screen.getByRole("button", { name: "Share" });
      await act(async () => {
        fireEvent.click(shareBtn);
      });
      expect(shareBtn).toBeDisabled();

      await act(async () => {
        settle(d);
      });
      expect(shareBtn).toBeEnabled();
    },
  );

  it("cannot stick the latch: dismiss mid-pending → resolve → no announcement, no throw → re-raise → Share enabled", async () => {
    const d = deferred();
    const { store } = mountWithShare({
      clipboard: { writeText: () => d.promise },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    // Dismiss while the share is still in flight — the panel renders null but
    // stays mounted, so the resolution's setState must be safe and must clear
    // pending UNCONDITIONALLY (no liveness gate on the latch itself).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Settle after the dismissal. "No throw" is load-bearing: share() never
    // rejects and the finally is unconditional, so nothing escapes here — an
    // unhandled rejection would fail the Vitest run.
    await act(async () => {
      d.resolve();
    });

    // Re-raise via a fresh completion edge (reset, then re-complete): the
    // stale resolution must have cleared pending WITHOUT announcing — Share
    // enabled, live region still empty, no visible status line.
    act(() => store.setDiscovered([]));
    driveToShown(store);
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(mirrorLine()).toBeNull();
  });
});
