import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TouchActionButton } from "./TouchActionButton.tsx";
import { createSurvivalStore, type SurvivalSnapshot } from "../survival/survivalStore.ts";
import { createForageStore } from "../forage/forageStore.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import { createQuestStore } from "../quest/questStore.ts";

function snapshot(over: Partial<SurvivalSnapshot> = {}): SurvivalSnapshot {
  return {
    health: 100,
    stamina: 100,
    hunger: 100,
    thirst: 100,
    breath: 100,
    submerged: false,
    alive: true,
    deaths: 0,
    canDrink: false,
    ...over,
  };
}

function stores() {
  return {
    survival: createSurvivalStore(),
    forage: createForageStore(),
    discovery: createDiscoveryStore(6),
    quest: createQuestStore(6),
  };
}

describe("TouchActionButton — the one on-screen context action for touch", () => {
  it("renders nothing with no action available", () => {
    const s = stores();
    const { container } = render(<TouchActionButton {...s} onPress={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the drink action and taps call onPress (the pressInteract edge)", () => {
    const s = stores();
    act(() => s.survival.set(snapshot({ canDrink: true })));
    const onPress = vi.fn();
    render(<TouchActionButton {...s} onPress={onPress} />);

    const btn = screen.getByRole("button", { name: "Drink" });
    expect(btn).toHaveTextContent("💧");
    fireEvent.pointerDown(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("a pickable fruit shows 'Eat' and outranks drink", () => {
    const s = stores();
    act(() => {
      s.survival.set(snapshot({ canDrink: true }));
      s.forage.set({ nearby: { kind: "mango" }, eaten: 0 });
    });
    render(<TouchActionButton {...s} onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Eat" })).toBeInTheDocument();
  });

  it("a clue site in range shows 'Read' (unlike ActionHint, which stays silent there)", () => {
    const s = stores();
    act(() => s.discovery.setNearby({ id: "a", order: 1, title: "T", teaser: "t", inRange: true }));
    render(<TouchActionButton {...s} onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Read" })).toBeInTheDocument();
  });

  it("dig-locked shows a disabled lock state that never fires onPress", () => {
    const s = stores();
    act(() =>
      s.quest.set({
        cluesFound: 4,
        cluesTotal: 6,
        digOwnsKey: false,
        missingPages: 2,
        digProgress: null,
        finaleActive: false,
        treasureFound: false,
        playSeconds: 0,
        deaths: 0,
        fruitEaten: 0,
      }),
    );
    const onPress = vi.fn();
    render(<TouchActionButton {...s} onPress={onPress} />);

    const btn = screen.getByRole("button", { name: /2 pages still missing/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("🔒");
    expect(btn.className).toContain("touch-action-btn--locked");
    fireEvent.pointerDown(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("hides while dead", () => {
    const s = stores();
    act(() => s.survival.set(snapshot({ canDrink: true, alive: false, health: 0 })));
    const { container } = render(<TouchActionButton {...s} onPress={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
