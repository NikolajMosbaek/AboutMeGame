import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DiscoveryAnnouncer } from "./DiscoveryAnnouncer.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

describe("DiscoveryAnnouncer", () => {
  it("starts silent and ignores pre-existing saved progress", () => {
    const store = createDiscoveryStore(13);
    store.setDiscovered(["a", "b"]); // saved progress before mount
    render(<DiscoveryAnnouncer store={store} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces a newly-discovered landmark politely with the count", () => {
    const store = createDiscoveryStore(13);
    render(<DiscoveryAnnouncer store={store} />);

    act(() => {
      // The discovery system opens the panel and bumps the discovered set in the
      // same beat; the announcer reads the open title + the new count.
      store.openPoi({ id: "c", order: 5, title: "Root-Cause Quarry", body: "…" });
      store.setDiscovered(["c"]);
    });

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Found Root-Cause Quarry — page 1 of 13");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("does not re-announce when re-opening an already-discovered landmark", () => {
    const store = createDiscoveryStore(13);
    render(<DiscoveryAnnouncer store={store} />);
    act(() => {
      store.openPoi({ id: "c", order: 5, title: "Root-Cause Quarry", body: "…" });
      store.setDiscovered(["c"]);
    });
    act(() => store.closePoi());
    act(() => store.openPoi({ id: "c", order: 5, title: "Root-Cause Quarry", body: "…" }));
    // Still the first announcement — no second find.
    expect(screen.getByRole("status")).toHaveTextContent("Found Root-Cause Quarry — page 1 of 13");
  });
});
