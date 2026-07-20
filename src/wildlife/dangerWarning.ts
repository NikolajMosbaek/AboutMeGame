import type { System, FrameContext } from "../engine/types.ts";

export interface DangerSnapshot {
  /** A snake is reared within warning range — the same posture the rattle plays on. */
  snake: boolean;
  /** The jaguar is stalking you — the same posture the growl plays on. */
  predator: boolean;
}

export interface DangerStore {
  getSnapshot(): DangerSnapshot;
  subscribe(listener: () => void): () => void;
  /** Write the latest threat posture (the DangerSystem calls this each frame;
   *  only a real change allocates + notifies, so React doesn't churn). */
  set(next: DangerSnapshot): void;
}

/**
 * Observable wildlife-threat state — the VISUAL seam beside the audio warnings
 * (the snake rattle and jaguar growl). The DangerSystem writes it each frame and
 * the DangerIndicator reads it, so a deaf or hard-of-hearing player gets the same
 * warning the audio gives everyone else. Same cached-snapshot pattern as hudStore.
 */
export function createDangerStore(): DangerStore {
  const listeners = new Set<() => void>();
  let snapshot: DangerSnapshot = { snake: false, predator: false };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (next.snake === snapshot.snake && next.predator === snapshot.predator) return;
      snapshot = { snake: next.snake, predator: next.predator };
      for (const l of listeners) l();
    },
  };
}

/**
 * Mirrors the polled threat posture the AudioSystem warns on
 * (`snakes.anyAlert()` / `jaguar.isStalking()`) into the danger store for the
 * HUD. Registered after the wildlife systems so it reads their post-update
 * state; the store de-dupes, so running every frame never churns React.
 */
export class DangerSystem implements System {
  readonly id = "danger";
  constructor(
    private readonly snakes: { anyAlert(): boolean },
    private readonly jaguar: { isStalking(): boolean },
    private readonly store: DangerStore,
  ) {}

  update(_ctx: FrameContext): void {
    this.store.set({ snake: this.snakes.anyAlert(), predator: this.jaguar.isStalking() });
  }
}
