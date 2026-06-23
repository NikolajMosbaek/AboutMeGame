import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { JournalPanel } from "./JournalPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { JournalPoi } from "../content/discoverablePois.ts";

// A position-free fixture mirroring `game.discovery.journalPois`: id/order/title/
// teaser/body/color (+ optional interaction). Out-of-order so the panel must sort
// by `order`. Titles/teasers are distinctive so their presence/absence in the DOM
// is a faithful structural-masking probe.
const JOURNAL_POIS: JournalPoi[] = [
  {
    id: "poi-b",
    order: 2,
    title: "The One-Sentence Overlook",
    teaser: "Name the end state first.",
    body: "Before I touch a single file.",
    color: 0x44cc88,
  },
  {
    id: "poi-a",
    order: 1,
    title: "The Arrivals Gate",
    teaser: "Welcome to the spawn point.",
    body: "Welcome, traveller.",
    color: 0xff8800,
  },
  {
    id: "poi-c",
    order: 3,
    title: "The Staff-Engineer Gate",
    teaser: "Would a staff engineer approve?",
    body: "Proof, not my word.",
    color: 0x3366ff,
  },
];

const LOCK_LABEL = "Undiscovered landmark";

function renderPanel(
  opts: {
    discoveredIds?: string[];
    onClose?: () => void;
    consumeInteract?: () => boolean;
  } = {},
) {
  const store = createDiscoveryStore(JOURNAL_POIS.length);
  if (opts.discoveredIds && opts.discoveredIds.length) {
    act(() => store.setDiscovered(opts.discoveredIds!));
  }
  const onClose = opts.onClose ?? vi.fn();
  const consumeInteract = opts.consumeInteract ?? vi.fn(() => false);
  const utils = render(
    <JournalPanel
      store={store}
      journalPois={JOURNAL_POIS}
      onClose={onClose}
      consumeInteract={consumeInteract}
    />,
  );
  return { store, onClose, consumeInteract, ...utils };
}

describe("JournalPanel (T7)", () => {
  it("is a labelled modal dialog", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // aria-labelledby points at a present element carrying the journal title.
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toBeTruthy();
  });

  it("renders all entries ordered by order", () => {
    renderPanel({ discoveredIds: ["poi-a", "poi-b", "poi-c"] });
    const titles = ["The Arrivals Gate", "The One-Sentence Overlook", "The Staff-Engineer Gate"];
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => titles.some((t) => b.textContent?.includes(t)));
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining("The Arrivals Gate"),
      expect.stringContaining("The One-Sentence Overlook"),
      expect.stringContaining("The Staff-Engineer Gate"),
    ]);
  });

  it("shows an unlocked entry's title + teaser in an enabled button", () => {
    renderPanel({ discoveredIds: ["poi-a"] });
    const btn = screen.getByRole("button", { name: /The Arrivals Gate/ });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.textContent).toContain("The Arrivals Gate");
    expect(btn.textContent).toContain("Welcome to the spawn point.");
  });

  it("renders a locked entry as a disabled button named by the generic lock label, with its title absent from the DOM", () => {
    // Nothing discovered: every row is locked.
    renderPanel();

    // No discovered title/teaser/body text reaches the DOM (structural masking).
    expect(screen.queryByText("The Arrivals Gate")).toBeNull();
    expect(screen.queryByText("The One-Sentence Overlook")).toBeNull();
    expect(screen.queryByText("The Staff-Engineer Gate")).toBeNull();
    expect(screen.queryByText("Welcome to the spawn point.")).toBeNull();

    // Each locked row is a disabled button whose accessible name is the generic
    // lock label.
    const locked = screen.getAllByRole("button", { name: LOCK_LABEL });
    expect(locked).toHaveLength(JOURNAL_POIS.length);
    for (const b of locked) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.hasAttribute("disabled")).toBe(true);
    }
  });

  it("focus lands inside the dialog on open", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape invokes onClose", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click invokes onClose, a click inside the dialog does not", () => {
    const onClose = vi.fn();
    const { container } = renderPanel({ onClose });
    const backdrop = container.querySelector(".menu-backdrop")!;
    act(() => {
      fireEvent.click(backdrop);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // A click landing on the dialog itself is not a backdrop dismiss.
    act(() => {
      fireEvent.click(screen.getByRole("dialog"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("carries a dialog-scoped polite sr-only live region (GuessBody pattern)", () => {
    const { container } = renderPanel();
    const live = container.querySelector(".sr-only[role=status]");
    expect(live).toBeTruthy();
    expect(live!.getAttribute("aria-live")).toBe("polite");
    // It is inside the dialog (the Hud single-live-region invariant is held by
    // the panel scoping its own announcer).
    expect(screen.getByRole("dialog").contains(live)).toBe(true);
  });
  it("traps Tab focus within the dialog (wraps last→first and first→last)", () => {
    // All discovered so every row is an enabled, focusable button: the trap has
    // a real ring of stops to wrap across.
    const { container } = renderPanel({ discoveredIds: ["poi-a", "poi-b", "poi-c"] });
    const dialog = screen.getByRole("dialog");
    const stops = Array.from(
      dialog.querySelectorAll<HTMLElement>("button"),
    ).filter((b) => !b.hasAttribute("disabled"));
    expect(stops.length).toBeGreaterThan(1);
    const first = stops[0];
    const last = stops[stops.length - 1];

    // Tab on the last stop wraps to the first.
    act(() => {
      last.focus();
      fireEvent.keyDown(window, { key: "Tab" });
    });
    expect(document.activeElement).toBe(first);

    // Shift+Tab on the first stop wraps to the last.
    act(() => {
      first.focus();
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    });
    expect(document.activeElement).toBe(last);
    void container;
  });

  it("does nothing when a locked entry is activated (zero openPoi calls)", () => {
    // Locked rows are disabled native buttons — not clickable — and even a
    // forced click cannot open undiscovered content (the open path lives only on
    // the unlocked branch and re-checks journalCanOpen).
    const { store } = renderPanel();
    const spy = vi.spyOn(store, "openPoi");
    const locked = screen.getAllByRole("button", { name: "Undiscovered landmark" });
    act(() => {
      locked[0].click();
    });
    expect(spy).not.toHaveBeenCalled();
    expect(store.getSnapshot().open).toBeNull();
  });
});
