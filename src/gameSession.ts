// A tiny shared, injected pause flag for the simulation. Multiple things can
// request a pause (a reveal panel, the settings menu) — the sim is paused while
// ANY reason is active, so closing one overlay doesn't unpause if another is
// still open. The vehicle reads `paused` and holds still. Plain object, no
// singleton, injected so tests build their own.

export interface GameSession {
  /** True while any pause reason is active. */
  readonly paused: boolean;
  /** Add (`true`) or clear (`false`) a named pause reason. */
  setPaused(reason: string, paused: boolean): void;
}

export function createSession(): GameSession {
  const reasons = new Set<string>();
  return {
    get paused() {
      return reasons.size > 0;
    },
    setPaused(reason, paused) {
      if (paused) reasons.add(reason);
      else reasons.delete(reason);
    },
  };
}
