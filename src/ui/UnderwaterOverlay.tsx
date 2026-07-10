import { useSyncExternalStore } from "react";
import type { SurvivalStore } from "../survival/survivalStore.ts";

export interface UnderwaterOverlayProps {
  survival: SurvivalStore;
}

/**
 * The underwater wash (#184): a static, translucent teal DOM overlay while the
 * eye is below the surface — the cheapest clean seam for "you are under" (no
 * shader pass, no per-frame work; React flips one node on the survival store's
 * `submerged` flag, which SurvivalSystem mirrors from the explorer every
 * frame). The 3D depth cue — fog colour/density — is UnderwaterFxSystem's job;
 * this wash is the instant, whole-screen read. `pointer-events: none` so it
 * can never eat a click, and it carries no text — purely visual, hidden from
 * AT (the breath meter is the accessible signal).
 */
export function UnderwaterOverlay({ survival }: UnderwaterOverlayProps) {
  const s = useSyncExternalStore(survival.subscribe, survival.getSnapshot);
  if (!s.submerged) return null;
  return <div className="underwater-overlay" data-testid="underwater-overlay" aria-hidden="true" />;
}
