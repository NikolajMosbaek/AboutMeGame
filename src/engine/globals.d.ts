// Test/automation hooks the running game exposes on `window`, per the
// develop-web-game convention. `GameCanvas` attaches these on mount and removes
// them on unmount, so the Playwright harness can step frames deterministically
// (`advanceTime`) and read state without visuals (`render_game_to_text`).
import type { EngineState } from "./types.ts";

declare global {
  interface Window {
    /** Advance the simulation by `ms` and render once. */
    advanceTime?: (ms: number) => void;
    /** Current engine + system state as a JSON string. */
    render_game_to_text?: () => string;
    /** The live state object (handy in the devtools console). */
    __ENGINE_STATE__?: () => EngineState;
    /** Aim the camera at a view (eye → target) and render one frame, halting the
     *  live loop so a camera-following system can't overwrite it. The Playwright
     *  smoke verifier calls this to frame each landmark deterministically. */
    __frameView__?: (
      eye: [number, number, number],
      target: [number, number, number],
    ) => void;
  }
}

export {};
