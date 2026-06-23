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

  it("activating an unlocked entry drains the interact edge BEFORE openPoi, re-deriving body/interaction from journalPois, and does not clear the journal", () => {
    // poi-a is discovered, so its row is an enabled button on the unlocked branch.
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push("close"));
    const consumeInteract = vi.fn(() => {
      calls.push("consumeInteract");
      return false;
    });
    const { store } = renderPanel({ discoveredIds: ["poi-a"], onClose, consumeInteract });
    const openPoi = vi.spyOn(store, "openPoi").mockImplementation(() => {
      calls.push("openPoi");
    });

    const btn = screen.getByRole("button", { name: /The Arrivals Gate/ });
    act(() => {
      btn.click();
    });

    // consumeInteract drained the queued edge exactly once, strictly before the
    // open commit (flaw one): the next DiscoverySystem.update can't close it.
    expect(consumeInteract).toHaveBeenCalledTimes(1);
    expect(openPoi).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["consumeInteract", "openPoi"]);

    // The open input is re-derived in full from the position-free journalPois
    // projection at select time — never carried on a (maskable) row — so the
    // body and interaction reach the reveal.
    expect(openPoi).toHaveBeenCalledWith({
      id: "poi-a",
      order: 1,
      title: "The Arrivals Gate",
      body: "Welcome, traveller.",
      interaction: undefined,
    });

    // The activate itself does NOT close/clear the journal (flaw three): a
    // GameCanvas effect clears journalOpen only once store.open is observed
    // non-null, so the journal pause reason overlaps the reveal reason.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-derives a present interaction from journalPois into the open input", () => {
    // An entry carrying a highlight interaction: the open action must forward it
    // intact (re-derived from journalPois, not a row), so the reveal path gets
    // the full OpenPoiInput {id, order, title, body, interaction}.
    const pois: JournalPoi[] = [
      {
        id: "poi-h",
        order: 1,
        title: "The Highlight",
        teaser: "Look here.",
        body: "The body.",
        color: 0x112233,
        interaction: { type: "highlight", emphasis: "The point." },
      },
    ];
    const store = createDiscoveryStore(pois.length);
    act(() => store.setDiscovered(["poi-h"]));
    const openPoi = vi.spyOn(store, "openPoi");
    render(
      <JournalPanel
        store={store}
        journalPois={pois}
        onClose={vi.fn()}
        consumeInteract={vi.fn(() => false)}
      />,
    );
    act(() => {
      screen.getByRole("button", { name: /The Highlight/ }).click();
    });
    expect(openPoi).toHaveBeenCalledWith({
      id: "poi-h",
      order: 1,
      title: "The Highlight",
      body: "The body.",
      interaction: { type: "highlight", emphasis: "The point." },
    });
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

// A full 13-landmark, position-free fixture (the real world has 13). Built
// out-of-order so the panel must sort by `order`; each title/teaser is unique so
// its presence in the DOM is an unambiguous unlock probe.
const ALL_13: JournalPoi[] = Array.from({ length: 13 }, (_, i) => {
  const order = i + 1;
  return {
    id: `poi-${String(order).padStart(2, "0")}`,
    order,
    title: `Landmark ${order} Title`,
    teaser: `Landmark ${order} teaser.`,
    body: `Landmark ${order} body.`,
    color: 0x100000 + order,
  };
}).reverse(); // reversed so input order != render order

const LOCK = "Undiscovered landmark";

/** Render the journal over a 13-landmark store seeded with the given discovered
 *  ids — modelling exactly how `buildGame`/GameCanvas constructs the store (the
 *  persisted set restored before first render) so seeding *is* reload reflection. */
function render13(discoveredIds: string[]) {
  const store = createDiscoveryStore(ALL_13.length);
  if (discoveredIds.length) act(() => store.setDiscovered(discoveredIds));
  const utils = render(
    <JournalPanel
      store={store}
      journalPois={ALL_13}
      onClose={vi.fn()}
      consumeInteract={vi.fn(() => false)}
    />,
  );
  return { store, ...utils };
}

describe("JournalPanel live-update + reload reflection (T15)", () => {
  it("all-locked first visit: an empty discovered set renders all 13 as locked rows with no titles/teasers in the DOM", () => {
    render13([]);
    // 13 disabled, generically-labelled lock rows — and nothing else.
    const locked = screen.getAllByRole("button", { name: LOCK });
    expect(locked).toHaveLength(13);
    for (const b of locked) expect(b.hasAttribute("disabled")).toBe(true);
    // No real content text leaked through the structural mask.
    for (const poi of ALL_13) {
      expect(screen.queryByText(poi.title)).toBeNull();
      expect(screen.queryByText(poi.teaser)).toBeNull();
      expect(screen.queryByText(poi.body)).toBeNull();
    }
  });

  it("live-updates the affected rows as landmarks are discovered (useSyncExternalStore on the store)", () => {
    const { store } = render13([]);
    expect(screen.getAllByRole("button", { name: LOCK })).toHaveLength(13);

    // Discover one — only that row flips to an enabled button carrying its title
    // + teaser; the other 12 stay locked. No re-mount, no prop change: the panel
    // reflects the store live via useSyncExternalStore.
    act(() => store.setDiscovered(["poi-01"]));
    expect(screen.getAllByRole("button", { name: LOCK })).toHaveLength(12);
    const one = screen.getByRole("button", { name: /Landmark 1 Title/ });
    expect(one.hasAttribute("disabled")).toBe(false);
    expect(one.textContent).toContain("Landmark 1 teaser.");

    // Discover a second; both unlocked rows now show, 11 remain locked.
    act(() => store.setDiscovered(["poi-01", "poi-07"]));
    expect(screen.getAllByRole("button", { name: LOCK })).toHaveLength(11);
    expect(screen.getByRole("button", { name: /Landmark 7 Title/ })).toBeTruthy();
    // The first unlock is unaffected by the second discovery.
    expect(screen.getByRole("button", { name: /Landmark 1 Title/ }).textContent).toContain(
      "Landmark 1 teaser.",
    );
  });

  it("reload reflection: a store seeded from persisted discovery renders those rows unlocked on first render (no live event needed)", () => {
    // Modelling a reload: the persisted set is restored into the store BEFORE the
    // panel mounts. The very first render must already show those rows unlocked —
    // the panel's initial read goes through useSyncExternalStore's getSnapshot.
    render13(["poi-02", "poi-05"]);
    expect(screen.getAllByRole("button", { name: LOCK })).toHaveLength(11);
    const two = screen.getByRole("button", { name: /Landmark 2 Title/ });
    const five = screen.getByRole("button", { name: /Landmark 5 Title/ });
    expect(two.hasAttribute("disabled")).toBe(false);
    expect(two.textContent).toContain("Landmark 2 teaser.");
    expect(five.hasAttribute("disabled")).toBe(false);
    expect(five.textContent).toContain("Landmark 5 teaser.");
  });

  it("all-13-discovered: every row is an enabled button with title + teaser and zero locked placeholders remain", () => {
    render13(ALL_13.map((p) => p.id));
    // No locked rows survive.
    expect(screen.queryAllByRole("button", { name: LOCK })).toHaveLength(0);
    // Every landmark shows its real title + teaser, in `order` (the fixture was
    // built reversed, so this also pins the sort).
    const contentButtons = screen
      .getAllByRole("button")
      .filter((b) => /Landmark \d+ Title/.test(b.textContent ?? ""));
    expect(contentButtons).toHaveLength(13);
    expect(contentButtons.map((b) => b.textContent)).toEqual(
      Array.from({ length: 13 }, (_, i) =>
        expect.stringContaining(`Landmark ${i + 1} Title`),
      ),
    );
    for (const poi of ALL_13) {
      expect(screen.getByText(poi.title)).toBeTruthy();
      expect(screen.getByText(poi.teaser)).toBeTruthy();
    }
  });
});
