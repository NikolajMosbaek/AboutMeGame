import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ActionHint } from "./ActionHint.tsx";
import { createSurvivalStore, type SurvivalSnapshot } from "../survival/survivalStore.ts";
import { createForageStore } from "../forage/forageStore.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import { createQuestStore, type QuestSnapshot } from "../quest/questStore.ts";

function questSnapshot(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
  return {
    cluesFound: 0,
    cluesTotal: 6,
    digOwnsKey: false,
    missingPages: 0,
    digProgress: null,
    finaleActive: false,
    treasureFound: false,
    playSeconds: 0,
    deaths: 0,
    fruitEaten: 0,
    ...over,
  };
}

function snapshot(over: Partial<SurvivalSnapshot> = {}): SurvivalSnapshot {
  return {
    health: 100,
    stamina: 100,
    hunger: 100,
    thirst: 100,
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

describe("ActionHint (pivot slice E) — one meaning for the interact key", () => {
  it("shows nothing with no action available", () => {
    const s = stores();
    const { container } = render(<ActionHint {...s} />);
    expect(container.firstChild).toBeNull();
  });

  it("offers a drink near water", () => {
    const s = stores();
    act(() => s.survival.set(snapshot({ canDrink: true })));
    render(<ActionHint {...s} />);
    expect(screen.getByText(/to drink/i)).toBeInTheDocument();
  });

  it("a pickable fruit outranks the drink", () => {
    const s = stores();
    act(() => {
      s.survival.set(snapshot({ canDrink: true }));
      s.forage.set({ nearby: { kind: "mango" }, eaten: 0 });
    });
    render(<ActionHint {...s} />);
    expect(screen.getByText(/pick & eat a mango/i)).toBeInTheDocument();
    expect(screen.queryByText(/to drink/i)).toBeNull();
  });

  it("a clue prompt in range silences every hint (the reveal prompt owns the key)", () => {
    const s = stores();
    act(() => {
      s.survival.set(snapshot({ canDrink: true }));
      s.forage.set({ nearby: { kind: "berries" }, eaten: 0 });
      s.discovery.setNearby({ id: "a", order: 1, title: "T", teaser: "t", inRange: true });
    });
    const { container } = render(<ActionHint {...s} />);
    expect(container.firstChild).toBeNull();
  });

  it("dig-locked: explains the locked dig in the design doc's voice, with the count", () => {
    const s = stores();
    act(() => {
      s.survival.set(snapshot({ canDrink: true }));
      s.quest.set(questSnapshot({ cluesFound: 3, missingPages: 3 }));
    });
    render(<ActionHint {...s} />);
    const hint = screen.getByRole("status");
    expect(hint).toHaveTextContent(/You're sure this is the place — but sure isn't certain\./);
    expect(hint).toHaveTextContent(/3 pages still missing/);
    expect(hint.className).toContain("drink-hint--dig-locked");
    // Informational only — never an interactive control.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dig-locked speaks singular for one missing page (the fig's own note counts)", () => {
    const s = stores();
    act(() => s.quest.set(questSnapshot({ cluesFound: 5, missingPages: 1 })));
    render(<ActionHint {...s} />);
    expect(screen.getByRole("status")).toHaveTextContent(/1 page still missing/);
  });

  it("the dead get no hints", () => {
    const s = stores();
    act(() => s.survival.set(snapshot({ canDrink: true, alive: false, health: 0 })));
    const { container } = render(<ActionHint {...s} />);
    expect(container.firstChild).toBeNull();
  });
});
