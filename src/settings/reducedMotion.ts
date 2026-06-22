// Reduced-motion bridge (#49).
//
// The settings store's `reducedMotion` flag (user-chosen, in the pause menu)
// needs to reach CSS so it can suppress UI motion alongside the OS-level
// `prefers-reduced-motion` media query. We reflect it as a single attribute on
// the document root (`<html data-reduced-motion="true">`), which tokens.css
// keys its no-transition / no-animation rules off. Kept a pure DOM mutator here
// so it's unit-testable; `useReducedMotion` wires it to the live store.

import { useEffect } from "react";
import type { SettingsStore } from "./settingsStore.ts";

/** Set/clear `data-reduced-motion` on the root. Removing it (rather than
 *  setting "false") lets the OS media query remain the sole signal when the
 *  in-game toggle is off. No-ops if there's no element (SSR/guard). */
export function applyReducedMotion(root: Element | null, on: boolean): void {
  if (!root) return;
  if (on) root.setAttribute("data-reduced-motion", "true");
  else root.removeAttribute("data-reduced-motion");
}

/** Subscribe the document root's reduced-motion attribute to the settings store.
 *  Applies immediately and on every change; tears the subscription down (and
 *  clears the attribute) on unmount so a remount starts clean. A null/undefined
 *  store (e.g. before the game is built) is a no-op, so callers can pass an
 *  optional store without violating the rules of hooks. */
export function useReducedMotion(settings: SettingsStore | null | undefined): void {
  useEffect(() => {
    if (!settings) return;
    const root = typeof document !== "undefined" ? document.documentElement : null;
    const apply = () => applyReducedMotion(root, settings.getSnapshot().reducedMotion);
    apply();
    const unsubscribe = settings.subscribe(apply);
    return () => {
      unsubscribe();
      applyReducedMotion(root, false);
    };
  }, [settings]);
}
