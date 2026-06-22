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

// ---- T5: panel content ----
// Thirteen ordered landmarks (the real island has 13). The panel only ever
// appears once every landmark is found, so every row is a discovered row: each
// must carry a text label (not a glyph alone — WCAG 1.4.1), and the titles must
// render in `order`.
const THIRTEEN = Array.from({ length: 13 }, (_, i) => ({
  order: i + 1,
  title: `Landmark ${i + 1}`,
}));

function driveToShown(store: ReturnType<typeof createDiscoveryStore>) {
  // 13th find arrives with its reveal open, then the player closes it.
  act(() => {
    store.openPoi({ id: "p13", order: 13, title: "Landmark 13", body: "…" });
    store.setDiscovered(THIRTEEN.map((_, i) => `p${i + 1}`));
  });
  act(() => store.closePoi());
}

describe("CompletionPanel content", () => {
  it("renders all 13 titles in order", () => {
    const store = createDiscoveryStore(13);
    render(<CompletionPanel store={store} pois={THIRTEEN} onReplay={() => {}} />);
    driveToShown(store);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(13);
    expect(items.map((li) => li.textContent)).toEqual(
      THIRTEEN.map((p) => expect.stringContaining(p.title)),
    );
  });

  it("marks each discovered row with a text label, not a glyph alone", () => {
    const store = createDiscoveryStore(13);
    render(<CompletionPanel store={store} pois={THIRTEEN} onReplay={() => {}} />);
    driveToShown(store);

    // Every row exposes the textual "Discovered" status to assistive tech — the
    // checkmark glyph alone would fail WCAG 1.4.1 (use of colour/glyph alone).
    const labels = screen.getAllByText(/discovered/i);
    expect(labels).toHaveLength(13);
  });

  it("exposes both CTAs by accessible role and name", () => {
    const store = createDiscoveryStore(13);
    render(<CompletionPanel store={store} pois={THIRTEEN} onReplay={() => {}} />);
    driveToShown(store);

    expect(screen.getByRole("button", { name: /replay/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /keep exploring/i })).toBeTruthy();
  });

  it("invokes onReplay when 'Replay' is clicked", () => {
    const store = createDiscoveryStore(13);
    let calls = 0;
    render(
      <CompletionPanel store={store} pois={THIRTEEN} onReplay={() => (calls += 1)} />,
    );
    driveToShown(store);

    act(() => {
      screen.getByRole("button", { name: /replay/i }).click();
    });
    expect(calls).toBe(1);
  });

  it("lowers the panel when 'Keep exploring' is clicked", () => {
    const store = createDiscoveryStore(13);
    render(<CompletionPanel store={store} pois={THIRTEEN} onReplay={() => {}} />);
    driveToShown(store);
    expect(screen.getByRole("dialog")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: /keep exploring/i }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
