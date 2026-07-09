// Audio controller (#51 SFX, #52 music) — the thin engine-side glue that turns
// game events into AudioEngine calls. It is a `System` so it runs in the render
// loop alongside everything else, but it owns no synthesis itself: that all
// lives in `AudioEngine`. Every dependency is injected (the engine, the discovery
// store, the mode/boost/mute sources), so it's unit-tested with fakes and no
// real Web Audio.
//
// Responsibilities:
//  - reveal (discovery store: discoveredCount rises) → chime, fired exactly once
//    per new landmark via a store subscription (the same event the FX burst uses);
//  - sprint engages → a soft exertion cue, on the rising edge each frame;
//  - keep the engine's mute in sync with the live settings store each frame;
//  - start the ambient bed once the world is running.

import type { System, FrameContext } from "../engine/types.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";

/** Whether sprint is held — the player input satisfies it via `state.sprint`. */
export interface SprintSource {
  readonly state: { sprint: boolean };
}

/** Live mute flag — a `SettingsStore` satisfies it via `getSnapshot().muted`. */
export interface MutedSource {
  getSnapshot(): { muted: boolean };
}

export class AudioSystem implements System {
  readonly id = "audio";

  private lastSprint = false;
  private lastDiscovered: number;
  private musicStarted = false;
  private unsubscribe: () => void;

  constructor(
    private readonly engine: AudioEngine,
    private readonly discovery: DiscoveryStore,
    private readonly sprint: SprintSource,
    private readonly muted: MutedSource,
  ) {
    // Apply the persisted mute before anything plays.
    this.engine.setMuted(this.muted.getSnapshot().muted);

    // Reveal → chime, exactly once per *new* discovery. Subscribing (rather than
    // diffing the count each frame) keeps it event-driven and matches how the FX
    // burst listens to the same store. The initial count is captured so restored
    // saved progress at mount never re-chimes.
    this.lastDiscovered = this.discovery.getSnapshot().discoveredCount;
    this.unsubscribe = this.discovery.subscribe(() => {
      const count = this.discovery.getSnapshot().discoveredCount;
      if (count > this.lastDiscovered) this.engine.chime();
      this.lastDiscovered = count;
    });
  }

  update(_ctx: FrameContext): void {
    // Keep mute in sync with the live setting (the pause menu writes it).
    this.engine.setMuted(this.muted.getSnapshot().muted);

    // Start the ambient bed once, when the world first runs. Doing it here (not
    // in the constructor) means it begins after the engine starts, so the
    // context is more likely to be unlocked by then.
    if (!this.musicStarted) {
      this.engine.startMusic();
      this.musicStarted = true;
    }

    // Sprint rising edge → soft exertion cue (the old boost synth carries over
    // until the jungle SFX slice replaces the palette wholesale).
    const sprint = this.sprint.state.sprint;
    if (sprint && !this.lastSprint) this.engine.boost();
    this.lastSprint = sprint;
  }

  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
  }
}
