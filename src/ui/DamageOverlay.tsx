import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { SettingsStore } from "../settings/settingsStore.ts";

export interface DamageOverlayProps {
  survival: SurvivalStore;
  settings: SettingsStore;
}

/**
 * Damage feedback: a red edge-vignette that flashes when health drops, its peak
 * opacity scaled by the size of the hit. In first person there is no body to see
 * flinch, so without this a jaguar pounce (−45) or a snake strike (−25) reads as
 * nothing happening — the survival loop's central danger felt weightless.
 *
 * Opacity-only (no transform), so it is inherently reduced-motion safe; the
 * reducedMotion setting still halves the peak for a gentler wash rather than
 * removing the cue. A `key` bump replays the CSS flash on each fresh hit;
 * `pointer-events: none` and `aria-hidden` keep it purely visual — the health
 * bar remains the accessible signal. The fatal blow is left to the death overlay.
 */
export function DamageOverlay({ survival, settings }: DamageOverlayProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);
  const prevHealth = useRef(s.health);
  const flashId = useRef(0);
  const [flash, setFlash] = useState<{ id: number; peak: number } | null>(null);

  useEffect(() => {
    const drop = prevHealth.current - s.health;
    prevHealth.current = s.health;
    // Only a real hit while still alive flashes — never healing, the respawn
    // refill, or the drop to 0 (the death overlay owns that moment).
    if (drop > 0 && s.alive) {
      const raw = Math.min(0.72, 0.2 + (drop / 100) * 1.1);
      const peak = settings.getSnapshot().reducedMotion ? raw * 0.5 : raw;
      flashId.current += 1;
      setFlash({ id: flashId.current, peak });
    }
  }, [s.health, s.alive, settings]);

  if (!flash) return null;
  return (
    <div
      key={flash.id}
      className="damage-overlay"
      data-testid="damage-overlay"
      aria-hidden="true"
      style={{ "--damage-peak": flash.peak } as CSSProperties}
      onAnimationEnd={() => setFlash(null)}
    />
  );
}
