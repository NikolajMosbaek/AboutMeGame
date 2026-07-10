import { describe, expect, it } from "vitest";
import { resolveActionPriority, type ActionPriorityInput } from "./actionPriority.ts";

function input(over: Partial<ActionPriorityInput> = {}): ActionPriorityInput {
  return {
    alive: true,
    digProgress: null,
    digOwnsKey: false,
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
