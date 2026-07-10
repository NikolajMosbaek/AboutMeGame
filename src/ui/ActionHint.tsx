import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { ForageStore, FruitKind } from "../forage/forageStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

export interface ActionHintProps {
  survival: SurvivalStore;
  forage: ForageStore;
  discovery: DiscoveryStore;
}

const FRUIT_LABEL: Record<FruitKind, string> = {
  berries: "pick & eat berries",
  banana: "pick & eat a banana",
  mango: "pick & eat a mango",
};

/**
 * The one contextual action hint (pivot slice E — replaces the slice-D drink
 * hint). Exactly one meaning for the interact key is ever shown, in the same
 * priority order the systems consume it: a clue site in range shows its own
 * reveal prompt (so this renders nothing), then foraging, then drinking.
 * Dead players get no hints — the death overlay owns the screen.
 */
export function ActionHint({ survival, forage, discovery }: ActionHintProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);
  const f = useSyncExternalStore(forage.subscribe, forage.getSnapshot);
  const d = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);

  if (!s.alive) return null;
  if (d.nearby?.inRange) return null; // the reveal prompt owns the key

  const label = f.nearby
    ? FRUIT_LABEL[f.nearby.kind]
    : s.canDrink
      ? "drink"
      : null;
  if (!label) return null;

  return (
    <p className="drink-hint" role="status">
      Press E · or USE to {label}
    </p>
  );
}
