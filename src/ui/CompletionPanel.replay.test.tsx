import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { CompletionPanel } from "./CompletionPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

// T8 — Replay / re-arm across the store-emit flow.
//
// The 'Replay' CTA is wired to game.discovery.reset(), which is just
// store.setDiscovered([]). The SAME store subscriber inside CompletionPanel
// observes that emission: prevRef advances through the completed=false
// snapshot and `armed` is already cleared (it was consumed when the panel was
// raised). A subsequent genuine 13th find is therefore a fresh rising edge that
// re-arms — proving re-arming is a pure consequence of the store emitting
// completed=false, with no engine-owned latch and no cross-seam reset coupling.
//
// SettingsMenu's 'Reset progress' path routes through the same store mutation
// (setDiscovered([])), so it is covered by this same flow.

const POIS = [
  { order: 1, title: "Alpha" },
  { order: 2, title: "Beta" },
  { order: 3, title: "Gamma" },
];
const IDS = ["a", "b", "c"];

function reachThirteen(store: ReturnType<typeof createDiscoveryStore>) {
  // The final find arrives with its reveal still open, then the player closes it.
  act(() => {
    store.openPoi({ id: "c", order: 3, title: "Gamma", body: "…" });
    store.setDiscovered(IDS);
  });
  act(() => store.closePoi());
}

describe("CompletionPanel replay / re-arm", () => {
  it("Replay resets to 0/total, the panel does not re-fire, and re-completing fires it exactly once again", () => {
    const store = createDiscoveryStore(3);
    // onReplay mirrors game.discovery.reset() — the single store mutation that
    // both the panel's Replay CTA and SettingsMenu's Reset progress route through.
    const reset = () => store.setDiscovered([]);

    render(<CompletionPanel store={store} pois={POIS} onReplay={reset} />);

    // Reach 13/13 and close the final reveal — the panel shows once.
    reachThirteen(store);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    // Click Replay: it invokes reset() (setDiscovered([])) and lowers the panel.
    act(() => {
      screen.getByRole("button", { name: /replay/i }).click();
    });

    // reset() dropped progress to 0/total with completed=false…
    const afterReset = store.getSnapshot();
    expect(afterReset.discoveredCount).toBe(0);
    expect(afterReset.completed).toBe(false);
    // …and the panel is gone (Replay lowers it synchronously, no lingering frame).
    expect(screen.queryByRole("dialog")).toBeNull();

    // The completed=false snapshot is observed by the SAME subscriber: prevRef
    // advances through it and `armed` was already cleared, so the panel must NOT
    // immediately re-fire even though we just emitted a snapshot.
    expect(screen.queryByRole("dialog")).toBeNull();

    // Re-completing is a fresh rising edge (false -> true) and re-arms the latch.
    reachThirteen(store);
    expect(store.getSnapshot().completed).toBe(true);

    // The panel fires exactly once again — a single dialog, not two.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("re-arms through a partial-then-full path after Replay (no stale latch)", () => {
    const store = createDiscoveryStore(3);
    const reset = () => store.setDiscovered([]);
    render(<CompletionPanel store={store} pois={POIS} onReplay={reset} />);

    reachThirteen(store);
    act(() => {
      screen.getByRole("button", { name: /replay/i }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Walk back up through a partial state before completing — the latch must
    // stay disarmed until the genuine false->true edge at full discovery.
    act(() => store.setDiscovered(["a", "b"]));
    expect(store.getSnapshot().completed).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();

    reachThirteen(store);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
