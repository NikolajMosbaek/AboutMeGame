import { describe, expect, it } from "vitest";
import { resolveActionPriority, type ActionPriorityInput } from "./actionPriority.ts";

function input(over: Partial<ActionPriorityInput> = {}): ActionPriorityInput {
  return {
    alive: true,
    digProgress: null,
    digOwnsKey: false,
    missingPages: 0,
    siteInRange: false,
    forageFruit: null,
    canDrink: false,
    ...over,
  };
}

describe("resolveActionPriority — the one interact-key ladder", () => {
  it("returns null with nothing available", () => {
    expect(resolveActionPriority(input())).toBeNull();
  });

  it("the dead get no action, no matter what else is available", () => {
    expect(resolveActionPriority(input({ alive: false, canDrink: true }))).toBeNull();
  });

  it("dig progress outranks everything", () => {
    const p = resolveActionPriority(
      input({ digProgress: 0.42, digOwnsKey: true, siteInRange: true, canDrink: true }),
    );
    expect(p).toEqual({ kind: "dig-progress", icon: "⛏", label: "Digging… 42%" });
  });

  it("dig-owns-key outranks a site in range, forage and drink", () => {
    const p = resolveActionPriority(
      input({ digOwnsKey: true, siteInRange: true, forageFruit: "mango", canDrink: true }),
    );
    expect(p).toEqual({ kind: "dig", icon: "⛏", label: "Dig" });
  });

  it("dig-locked sits between dig and a site in range, and is not pressable", () => {
    const p = resolveActionPriority(
      input({ missingPages: 3, siteInRange: true, forageFruit: "mango", canDrink: true }),
    );
    expect(p).toEqual({
      kind: "dig-locked",
      icon: "🔒",
      label: "The place is right — 3 pages still missing",
      disabled: true,
    });
  });

  it("dig-locked speaks singular for one missing page", () => {
    const p = resolveActionPriority(input({ missingPages: 1 }));
    expect(p?.label).toBe("The place is right — 1 page still missing");
  });

  it("dig-owns-key outranks dig-locked (all pages read means it can't be locked)", () => {
    const p = resolveActionPriority(input({ digOwnsKey: true, missingPages: 1 }));
    expect(p?.kind).toBe("dig");
  });

  it("a site in range outranks forage and drink", () => {
    const p = resolveActionPriority(input({ siteInRange: true, forageFruit: "banana", canDrink: true }));
    expect(p).toEqual({ kind: "read", icon: "📖", label: "Read" });
  });

  it("forage outranks drink and carries the fruit kind", () => {
    const p = resolveActionPriority(input({ forageFruit: "berries", canDrink: true }));
    expect(p).toEqual({ kind: "forage", icon: "🍌", label: "Eat", fruit: "berries" });
  });

  it("drink is the last resort", () => {
    expect(resolveActionPriority(input({ canDrink: true }))).toEqual({
      kind: "drink",
      icon: "💧",
      label: "Drink",
    });
  });
});
