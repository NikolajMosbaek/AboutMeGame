import { useSyncExternalStore } from "react";
import type { DangerStore } from "../wildlife/dangerWarning.ts";

export interface DangerIndicatorProps {
  danger: DangerStore;
}

/**
 * Visual + screen-reader alternative to the audio threat warnings (the snake
 * rattle and jaguar growl): a HUD banner while a threat is active, so a deaf or
 * hard-of-hearing player is warned like everyone else. Static — colour + icon +
 * text, no motion — so it needs no reduced-motion gate; `role="status"` with
 * `aria-live="assertive"` also announces the threat once on its rising edge.
 */
export function DangerIndicator({ danger }: DangerIndicatorProps) {
  const d = useSyncExternalStore(danger.subscribe, danger.getSnapshot);
  if (!d.snake && !d.predator) return null;
  // The predator is the graver threat, so it names the banner when both fire.
  const label = d.predator
    ? "Predator stalking — move away"
    : "Snake ready to strike — back off";
  return (
    <div className="danger-indicator" role="status" aria-live="assertive">
      <span className="danger-indicator__icon" aria-hidden="true">
        ⚠
      </span>
      <span className="danger-indicator__text">{label}</span>
    </div>
  );
}
