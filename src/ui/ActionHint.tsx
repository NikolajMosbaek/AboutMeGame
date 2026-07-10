import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { ForageStore, FruitKind } from "../forage/forageStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { QuestStore, QuestSnapshot } from "../quest/questStore.ts";
import { resolveActionPriority } from "./actionPriority.ts";

export interface ActionHintProps {
  survival: SurvivalStore;
  /** Optional so a minimal build with survival-but-no-foraging keeps its
   *  drink hint (the fields are independently optional on GameHandle). */
  forage?: ForageStore;
  discovery: DiscoveryStore;
  /** Optional: the dig prompt (quest slice) outranks every other hint. */
  quest?: QuestStore;
  /** True while touch controls are active — TouchActionButton is then the one
   *  on-screen truth for the interact key, so this text hint stays hidden
   *  rather than duplicate (and risk disagreeing with) the button. */
  touchActive?: boolean;
}

const FRUIT_LABEL: Record<FruitKind, string> = {
  berries: "pick & eat berries",
  banana: "pick & eat a banana",
  mango: "pick & eat a mango",
};

const NO_FORAGE = { nearby: null, eaten: 0 } as const;

const NO_QUEST: QuestSnapshot = {
  cluesFound: 0,
  cluesTotal: 0,
  digOwnsKey: false,
  missingPages: 0,
  digProgress: null,
  finaleActive: false,
  treasureFound: false,
  playSeconds: 0,
  deaths: 0,
  fruitEaten: 0,
};

/**
 * The one contextual action hint (pivot slice E; re-plumbed onto the shared
 * `resolveActionPriority` ladder for the mobile-controls upgrade). Exactly one
 * meaning for the interact key is ever shown, in the same priority order the
 * systems consume it: the dig, then a clue site in range (its own reveal
 * prompt owns that one — this renders nothing), then foraging, then drinking.
 * Dead players get no hints — the death overlay owns the screen. Hides
 * entirely while touch controls are active: TouchActionButton is the single
 * on-screen truth then (never two surfaces naming the same key differently).
 */
export function ActionHint({ survival, forage, discovery, quest, touchActive }: ActionHintProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);
  const f = useSyncExternalStore(
    forage?.subscribe ?? (() => () => {}),
    forage?.getSnapshot ?? (() => NO_FORAGE),
  );
  const d = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);
  const q = useSyncExternalStore(
    quest?.subscribe ?? (() => () => {}),
    quest?.getSnapshot ?? (() => NO_QUEST),
  );

  if (touchActive) return null;

  const priority = resolveActionPriority({
    alive: s.alive,
    digProgress: q.digProgress,
    digOwnsKey: q.digOwnsKey,
    missingPages: q.missingPages,
    siteInRange: d.nearby?.inRange ?? false,
    forageFruit: f.nearby?.kind ?? null,
    canDrink: s.canDrink,
  });
  if (!priority) return null;
  if (priority.kind === "read") return null; // the reveal prompt owns the key

  if (priority.kind === "dig-locked") {
    // Not an action — the one hint that explains itself instead of naming a
    // key: the place is right, the journal isn't complete yet.
    const pages = q.missingPages === 1 ? "1 page" : `${q.missingPages} pages`;
    return (
      <p className="drink-hint drink-hint--dig-locked" role="status">
        You're sure this is the place — but sure isn't certain. {pages} still missing.
      </p>
    );
  }
  if (priority.kind === "dig-progress") {
    return (
      <p className="drink-hint drink-hint--dig" role="status">
        Digging… hold your ground
      </p>
    );
  }
  if (priority.kind === "dig") {
    return (
      <p className="drink-hint drink-hint--dig" role="status">
        Press E to dig
      </p>
    );
  }

  const label = priority.kind === "forage" ? FRUIT_LABEL[priority.fruit!] : "drink";
  return (
    <p className="drink-hint" role="status">
      Press E to {label}
    </p>
  );
}
