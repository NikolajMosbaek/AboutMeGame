// A tiny shared, injected flag for "the simulation is paused" — set when a
// reveal panel (or, later, a menu) is open. The vehicle skips integrating motion
// while paused, so the craft holds still behind the panel without the engine
// needing to know anything about UI. Plain object, no singleton.

export interface GameSession {
  paused: boolean;
}

export function createSession(): GameSession {
  return { paused: false };
}
