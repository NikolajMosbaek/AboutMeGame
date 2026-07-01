import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CompletionPanel } from "./CompletionPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { ShareCapabilities } from "./useShare.ts";

// T4 (F1 slice 3, #131) — the Share CTA on the completion panel.
//
// Everything here injects plain fakes through the panel's optional DI props
// (shareCapabilities / shareUrl) — no navigator stubbing, no user-event dep.
// The clipboard-only default desktop path, the native-disabled pending state
// (exactly-once across a double click; re-enabled on EVERY outcome including
// "cancelled" — a dismissed iOS sheet must not brick the CTA), and the
// critic-mandated dismiss-mid-pending case proving setPending(false) is an
// UNCONDITIONAL finally: the panel renders null while hidden but never
// unmounts, so a liveness-gated clear would leave Share bricked for the
// session.

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

    // Second click while pending: native disabled blocks activation outright.
    await act(async () => {
      fireEvent.click(shareBtn);
    });
    expect(calls).toBe(1);

    await act(async () => {
      d.resolve();
    });
    expect(shareBtn).toBeEnabled();
  });

  it("re-enables Share after a cancelled share sheet (pending clears on every outcome)", async () => {
    const d = deferred();
    mountWithShare({ share: () => d.promise });

    const shareBtn = screen.getByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(shareBtn);
    });
    expect(shareBtn).toBeDisabled();

    // The user dismisses the OS sheet — an AbortError-named rejection maps to
    // "cancelled". The CTA must come back; a dismissed sheet is not a broken one.
    await act(async () => {
      d.reject({ name: "AbortError" });
    });
    expect(shareBtn).toBeEnabled();
  });

  it("cannot stick the pending latch: dismiss mid-pending, resolve, re-raise — Share is enabled", async () => {
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

    await act(async () => {
      d.resolve();
    });

    // Re-raise via a fresh completion edge (reset, then re-complete).
    act(() => store.setDiscovered([]));
    driveToShown(store);
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
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
