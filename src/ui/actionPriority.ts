// The ONE priority ladder for the interact key's meaning (mobile-controls
// upgrade — Q3). ActionHint (the desktop text hint) and TouchActionButton (the
// on-screen action button) both call this pure resolver instead of each
// re-deriving the order, so the two surfaces can never disagree about which
// action a press would trigger. Order, highest first: the treasure dig (the
// game's climax) > a clue site in range > foraging > drinking > nothing.
import type { FruitKind } from "../forage/forageStore.ts";

export type ActionKind = "dig-progress" | "dig" | "read" | "forage" | "drink";

export interface ActionPriority {
  kind: ActionKind;
  /** Icon + short caption for the touch button. Dig-progress carries the live
   *  percentage; every other kind is a fixed word. */
  icon: string;
  label: string;
  /** Only set for kind "forage" — which fruit ActionHint's full phrase names. */
  fruit?: FruitKind;
}

export interface ActionPriorityInput {
  alive: boolean;
  /** 0..1 while the dig is running, null otherwise (quest store). */
  digProgress: number | null;
  /** True once every clue is read and the dig press is live (quest store). */
  digOwnsKey: boolean;
  /** A discovery site's reveal prompt is in range (its own card owns the UI). */
  siteInRange: boolean;
  /** The fruit kind in reach, or null (forage store). */
  forageFruit: FruitKind | null;
  canDrink: boolean;
}

/** Pure: no store reads, no DOM — just the ladder. */
export function resolveActionPriority(input: ActionPriorityInput): ActionPriority | null {
  if (!input.alive) return null;
  if (input.digProgress !== null) {
    const pct = Math.round(input.digProgress * 100);
    return { kind: "dig-progress", icon: "⛏", label: `Digging… ${pct}%` };
  }
  if (input.digOwnsKey) return { kind: "dig", icon: "⛏", label: "Dig" };
  if (input.siteInRange) return { kind: "read", icon: "📖", label: "Read" };
  if (input.forageFruit) return { kind: "forage", icon: "🍌", label: "Eat", fruit: input.forageFruit };
  if (input.canDrink) return { kind: "drink", icon: "💧", label: "Drink" };
  return null;
}
