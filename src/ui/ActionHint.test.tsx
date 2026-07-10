import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ActionHint } from "./ActionHint.tsx";
import { createSurvivalStore, type SurvivalSnapshot } from "../survival/survivalStore.ts";
import { createForageStore } from "../forage/forageStore.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

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

  it("the dead get no hints", () => {
    const s = stores();
    act(() => s.survival.set(snapshot({ canDrink: true, alive: false, health: 0 })));
    const { container } = render(<ActionHint {...s} />);
    expect(container.firstChild).toBeNull();
  });
});
