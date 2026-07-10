import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { ForageStore } from "../forage/forageStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { QuestStore, QuestSnapshot } from "../quest/questStore.ts";
import { resolveActionPriority } from "./actionPriority.ts";

export interface TouchActionButtonProps {
  survival: SurvivalStore;
  forage?: ForageStore;
  discovery: DiscoveryStore;
  quest?: QuestStore;
  /** Fires `PlayerInputController.pressInteract()` — the same edge the E key
   *  and (formerly) the DOM "USE" button queue. */
  onPress: () => void;
}

const NO_FORAGE = { nearby: null, eaten: 0 } as const;

const NO_QUEST: QuestSnapshot = {
  cluesFound: 0,
  cluesTotal: 0,
  digOwnsKey: false,
  digProgress: null,
  treasureFound: false,
  playSeconds: 0,
  deaths: 0,
  fruitEaten: 0,
};

/**
 * The one on-screen context-action button for touch (mobile-controls upgrade,
 * Q3) — replaces the old fixed "USE" button. Reads the SAME priority ladder
 * ActionHint does (`resolveActionPriority`), so the two can never name a
 * different action: dig progress/dig, a clue site in range, forage, drink, or
 * nothing (hidden — including while dead). GameCanvas mounts this only while
 * `PlayerInputController.touchActive` is true.
 */
export function TouchActionButton({ survival, forage, discovery, quest, onPress }: TouchActionButtonProps) {
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

  const priority = resolveActionPriority({
    alive: s.alive,
    digProgress: q.digProgress,
    digOwnsKey: q.digOwnsKey,
    siteInRange: d.nearby?.inRange ?? false,
    forageFruit: f.nearby?.kind ?? null,
    canDrink: s.canDrink,
  });
  if (!priority) return null;

  return (
    <button
      type="button"
      className="touch-action-btn"
      aria-label={priority.label}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
    >
      <span className="touch-action-btn__icon" aria-hidden="true">
        {priority.icon}
      </span>
      <span className="touch-action-btn__label">{priority.label}</span>
    </button>
  );
}
