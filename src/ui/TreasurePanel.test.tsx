import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TreasurePanel, formatPlayTime } from "./TreasurePanel.tsx";
import { createQuestStore, type QuestSnapshot } from "../quest/questStore.ts";
import type { ShareCapabilities } from "./useShare.ts";

function won(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
  return {
    cluesFound: 6,
    cluesTotal: 6,
    digOwnsKey: false,
    missingPages: 0,
    digProgress: null,
    finaleActive: false,
    treasureFound: true,
    playSeconds: 754,
    deaths: 2,
    fruitEaten: 9,
    ...over,
  };
}

const noShare: ShareCapabilities = {}; // no navigator.share, no clipboard → "failed"

function mount(store = createQuestStore(6)) {
  const onKeepExploring = vi.fn();
  const onReplay = vi.fn();
  const view = render(
    <TreasurePanel
      quest={store}
      onKeepExploring={onKeepExploring}
      onReplay={onReplay}
      shareCapabilities={noShare}
      shareUrl="https://example.test/game"
    />,
  );
  return { store, onKeepExploring, onReplay, view };
}

describe("TreasurePanel (pivot slice G)", () => {
  it("opens on the treasureFound rising edge with the frozen stats", () => {
    const { store } = mount();
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => store.set(won()));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("The Emerald Idol is yours.")).toBeInTheDocument();
    expect(screen.getByText("12:34")).toBeInTheDocument(); // 754 s
    expect(screen.getByText("6 / 6")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("never opens for a session restored already-won (reload guard)", () => {
    const store = createQuestStore(6);
    store.set(won()); // won BEFORE mount = restored state
    mount(store);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses Replay on open; CTAs in order Replay/Share/Keep exploring", () => {
    const { store, onReplay } = mount();
    act(() => store.set(won()));
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Replay", "Share", "Keep exploring"]);
    expect(buttons[0]).toHaveFocus();
    fireEvent.click(buttons[0]);
    expect(onReplay).toHaveBeenCalledOnce();
  });

  it("keep exploring dismisses and stays dismissed; Escape does the same", () => {
    const { store, onKeepExploring } = mount();
    act(() => store.set(won()));
    fireEvent.click(screen.getByRole("button", { name: "Keep exploring" }));
    expect(onKeepExploring).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();

    // A later store emit must not resurrect the panel.
    act(() => store.set(won({ playSeconds: 999 })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape keeps exploring (least destructive dismissal)", () => {
    const { store, onKeepExploring } = mount();
    act(() => store.set(won()));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onKeepExploring).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("share announces its outcome in the one polite live region", async () => {
    const { store } = mount();
    act(() => store.set(won()));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    // canShare/canCopy both false → outcome "failed" → the failure copy lands.
    const region = await screen.findByRole("status");
    expect(region.textContent!.length).toBeGreaterThan(0);
  });
});

describe("formatPlayTime", () => {
  it("renders mm:ss with zero-padded seconds", () => {
    expect(formatPlayTime(0)).toBe("0:00");
    expect(formatPlayTime(61)).toBe("1:01");
    expect(formatPlayTime(754)).toBe("12:34");
  });
});
