import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { CompletionPanel } from "./CompletionPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

// Three of thirteen titles is enough to exercise the latch; the panel's full
// title list / CTA / focus behaviour is covered by later tasks. Here we prove
// the persistent `armed` latch fires the visible panel exactly once.
const POIS = [
  { order: 1, title: "Alpha" },
  { order: 2, title: "Beta" },
  { order: 3, title: "Gamma" },
];

function open(store: ReturnType<typeof createDiscoveryStore>) {
  store.openPoi({ id: "c", order: 3, title: "Gamma", body: "…" });
}

describe("CompletionPanel latch", () => {
  it("arms on the completing find (open!=null) without showing, then shows once on close", () => {
    const store = createDiscoveryStore(3);
    render(<CompletionPanel store={store} pois={POIS} onReplay={() => {}} />);

    // Discover #3 (the final one) — the reveal is open in the same beat. The
    // rising edge of `completed` arms the latch but must NOT show the panel
    // while a reveal is open.
    act(() => {
      open(store);
      store.setDiscovered(["a", "b", "c"]);
    });
    expect(store.getSnapshot().completed).toBe(true);
    expect(store.getSnapshot().open).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    // Close the final reveal — armed && open===null raises the panel exactly once.
    act(() => store.closePoi());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("does not re-pop when the final landmark is re-opened and re-closed", () => {
    const store = createDiscoveryStore(3);
    const { unmount } = render(
      <CompletionPanel store={store} pois={POIS} onReplay={() => {}} />,
    );

    act(() => {
      open(store);
      store.setDiscovered(["a", "b", "c"]);
    });
    act(() => store.closePoi());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    unmount();
    // Re-interacting with the already-discovered final landmark and re-closing
    // produces another open->null-while-completed edge, but the latch was
    // consumed, so the panel must not re-pop.
    render(<CompletionPanel store={store} pois={POIS} onReplay={() => {}} />);
    act(() => open(store));
    act(() => store.closePoi());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
