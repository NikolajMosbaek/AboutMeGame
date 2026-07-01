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
