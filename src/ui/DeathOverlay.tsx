import { useEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";

export interface DeathOverlayProps {
  survival: SurvivalStore;
  /** Wake back at camp (buildGame's survival.respawn — meters reset, quest kept). */
  onRespawn: () => void;
}

/**
 * The death screen (pivot slice D): a full-screen modal when `alive` flips
 * false. The session is already paused under the "death" reason by the
 * survival system; this overlay's only job is the message and the one action.
 * Quest progress survives — the copy says so, so dying never reads as losing
 * the expedition. Focus moves to the action on open (it is the only control),
 * and Enter/Space activate it natively as a real <button>.
 */
export function DeathOverlay({ survival, onRespawn }: DeathOverlayProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!s.alive) btnRef.current?.focus();
  }, [s.alive]);

  if (s.alive) return null;

  return (
    <div className="death-overlay" role="dialog" aria-modal="true" aria-labelledby="death-title">
      <div className="death-overlay__card">
        <h2 id="death-title">The jungle keeps its secrets… this time.</h2>
        <p>
          Your clues and your journal survive. Your legs, less so — you wake back
          at camp, weaker and wiser.
        </p>
        <button ref={btnRef} type="button" className="cta" onClick={onRespawn}>
          Wake at camp
        </button>
      </div>
    </div>
  );
}
