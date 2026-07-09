import type { System, FrameContext } from "../engine/types.ts";
import type { ExplorerSystem } from "../player/explorer.ts";
import type { HudStore } from "./hudStore.ts";

/**
 * HUD feed: each frame, read the explorer's speed/sprint/heading and push them
 * into the hud store. The store rounds and de-dupes, so this can run every frame
 * without churning React — only a whole-number change reaches the UI. Registered
 * after the explorer so it reads the post-update state. Explorer and store are
 * injected, so it's unit-tested without a renderer.
 *
 * Heading: the explorer's yaw is radians counter-clockwise-positive around +Y
 * with 0 facing +Z. The compass calls -Z "N" (the spawn looks south down the
 * island), so degrees = yaw normalised to 0..360 with 0 at -Z.
 */
export class HudSystem implements System {
  readonly id = "hud";

  constructor(
    private readonly explorer: ExplorerSystem,
    private readonly store: HudStore,
  ) {}

  update(_ctx: FrameContext): void {
    const s = this.explorer.state;
    const deg = (s.yaw * 180) / Math.PI;
    this.store.set({ speed: s.speed, sprinting: s.sprinting, heading: 180 - deg });
  }
}
