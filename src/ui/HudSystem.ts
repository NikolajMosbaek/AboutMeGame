import type { System, FrameContext } from "../engine/types.ts";
import { compassDegFromYaw, type ExplorerSystem } from "../player/explorer.ts";
import type { HudStore } from "./hudStore.ts";

/**
 * HUD feed: each frame, read the explorer's sprint/heading and push them into
 * the hud store. The store rounds and de-dupes, so this can run every frame
 * without churning React — only a whole-number change reaches the UI. Registered
 * after the explorer so it reads the post-update state. Explorer and store are
 * injected, so it's unit-tested without a renderer. Heading comes from the one
 * yaw→compass helper the explorer module owns.
 */
export class HudSystem implements System {
  readonly id = "hud";

  constructor(
    private readonly explorer: ExplorerSystem,
    private readonly store: HudStore,
  ) {}

  update(_ctx: FrameContext): void {
    const s = this.explorer.state;
    this.store.set({ sprinting: s.sprinting, heading: compassDegFromYaw(s.yaw) });
  }
}
