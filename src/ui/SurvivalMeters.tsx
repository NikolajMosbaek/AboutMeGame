import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";

export interface SurvivalMetersProps {
  survival: SurvivalStore;
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
 * The survival cluster (pivot slice D): four slim meters bottom-left. The
 * contextual action hint lives in ActionHint (slice E) — one component owns
 * every meaning of the interact key. Values are carried for AT via one
 * aria-label per bar (a live region per meter would chatter; the labels update
 * silently and the death overlay is the loud consequence). The low-flash
 * animation is CSS, suppressed under both reduced-motion gates in tokens.css.
 */
export function SurvivalMeters({ survival }: SurvivalMetersProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);

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
    </>
  );
}
