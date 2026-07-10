import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

export interface SurvivalMetersProps {
  survival: SurvivalStore;
  /** The drink hint hides while a clue prompt owns the E key. */
  discovery: DiscoveryStore;
}

const METERS = [
  { key: "health", label: "Health", icon: "♥", className: "meter--health" },
  { key: "stamina", label: "Stamina", icon: "⚡", className: "meter--stamina" },
  { key: "hunger", label: "Hunger", icon: "🍖", className: "meter--hunger" },
  { key: "thirst", label: "Thirst", icon: "💧", className: "meter--thirst" },
] as const;

/** A meter flashes for attention at or below this. */
export const LOW_METER = 25;

/**
 * The survival cluster (pivot slice D): four slim meters bottom-left, plus the
 * centred "drink" hint whenever water is in reach and no clue prompt owns the
 * interact key. Reads both stores via useSyncExternalStore (they emit only on
 * whole-number changes). Meters are real <meter>-like bars built from divs —
 * the value is carried for AT via one aria-label per bar (a live region per
 * meter would chatter; the labels update silently and the death overlay is the
 * loud consequence). The low-flash animation is CSS, suppressed under both
 * reduced-motion gates in tokens.css.
 */
export function SurvivalMeters({ survival, discovery }: SurvivalMetersProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);
  const d = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);

  const sitePromptUp = d.nearby?.inRange ?? false;
  const showDrink = s.canDrink && !sitePromptUp && s.alive;

  return (
    <>
      <div className="survival" aria-label="survival status">
        {METERS.map((m) => {
          const value = s[m.key];
          const low = value <= LOW_METER;
          return (
            <div
              key={m.key}
              className={`meter ${m.className}${low ? " meter--low" : ""}`}
              role="img"
              aria-label={`${m.label} ${value} of 100`}
            >
              <span className="meter__icon" aria-hidden="true">
                {m.icon}
              </span>
              <span className="meter__track" aria-hidden="true">
                <span className="meter__fill" style={{ width: `${value}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      {showDrink && (
        <p className="drink-hint" role="status">
          Press E · or USE to drink
        </p>
      )}
    </>
  );
}
