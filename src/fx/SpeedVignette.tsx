import { useSyncExternalStore } from "react";
import type { HudStore } from "../ui/hudStore.ts";
import type { SettingsStore } from "../settings/settingsStore.ts";
import { vignetteOpacity } from "./speedVignette.ts";

export interface SpeedVignetteProps {
  hud: HudStore;
  settings: SettingsStore;
}

/**
 * Speed vignette (#53 movement feedback) — a subtle edge-darkening overlay that
 * grows with the craft's speed, so going fast *feels* fast. A pure DOM element
 * (zero WebGL draw calls), driven by the throttled hud store via
 * useSyncExternalStore — the store only pushes whole-number speed changes, so it
 * re-renders rarely. The intensity curve lives in `vignetteOpacity`.
 *
 * It's non-essential motion, so it's gated two ways: the in-game reduced-motion
 * setting (read here from the live settings store) zeroes it, and the OS
 * `prefers-reduced-motion` media query hides `.speed-vignette` in tokens.css. The
 * element is purely decorative (aria-hidden, pointer-events: none).
 */
export function SpeedVignette({ hud, settings }: SpeedVignetteProps) {
  const h = useSyncExternalStore(hud.subscribe, hud.getSnapshot);
  const s = useSyncExternalStore(settings.subscribe, settings.getSnapshot);

  const opacity = s.reducedMotion ? 0 : vignetteOpacity(h.speed);

  return (
    <div
      className="speed-vignette"
      aria-hidden="true"
      style={{ opacity }}
      data-testid="speed-vignette"
    />
  );
}
