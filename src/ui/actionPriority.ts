// The ONE priority ladder for the interact key's meaning (mobile-controls
// upgrade — Q3). ActionHint (the desktop text hint) and TouchActionButton (the
// on-screen action button) both call this pure resolver instead of each
// re-deriving the order, so the two surfaces can never disagree about which
// action a press would trigger. Order, highest first: the treasure dig (the
// game's climax) > a clue site in range (read its page) > the locked dig (right
// place, pages missing — informational, never pressable) > foraging > drinking
// > nothing. Read outranks the locked dig so the ancient fig — which is both a
// clue site and the dig patch — tells you to READ its page rather than showing
// a "pages still missing" lock over the very page you're standing on.
import type { FruitKind } from "../forage/forageStore.ts";

export type ActionKind = "dig-progress" | "dig" | "dig-locked" | "read" | "forage" | "drink";

export interface ActionPriority {
  kind: ActionKind;
  /** Icon + short caption for the touch button. Dig-progress carries the live
   *  percentage, dig-locked the missing-page count; the rest are fixed words. */
  icon: string;
  label: string;
  /** Only set for kind "forage" — which fruit ActionHint's full phrase names. */
  fruit?: FruitKind;
  /** Only set for kind "dig-locked": a press would do nothing — the surfaces
   *  render it as information (dimmed hint / disabled button), never a CTA. */
  disabled?: true;
}

export interface ActionPriorityInput {
  alive: boolean;
  /** 0..1 while the dig is running, null otherwise (quest store). */
  digProgress: number | null;
  /** True once every clue is read and the dig press is live (quest store). */
  digOwnsKey: boolean;
  /** Pages still unread while standing at the dig patch (quest store) — the
   *  dig is LOCKED, not absent; 0 anywhere else. */
  missingPages: number;
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
  // A readable site in range wins over the dig-locked hint. At the ancient fig
  // (a clue site AND the dig patch) with its page unread, the player must be
  // told to READ it — not shown a lock over that page. Once read, the site is
  // discovered so `siteInRange` flips false and dig-locked resumes if earlier
  // clues are still missing.
  if (input.siteInRange) return { kind: "read", icon: "📖", label: "Read" };
  if (input.missingPages > 0) {
    const pages = input.missingPages === 1 ? "1 page" : `${input.missingPages} pages`;
    return {
      kind: "dig-locked",
      icon: "🔒",
      label: `The place is right — ${pages} still missing`,
      disabled: true,
    };
  }
  if (input.forageFruit) return { kind: "forage", icon: "🍌", label: "Eat", fruit: input.forageFruit };
  if (input.canDrink) return { kind: "drink", icon: "💧", label: "Drink" };
  return null;
}
