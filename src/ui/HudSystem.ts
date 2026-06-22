import type { System, FrameContext } from "../engine/types.ts";
import type { VehicleSystem } from "../movement/vehicle.ts";
import type { HudStore } from "./hudStore.ts";

/**
 * HUD feed (#42): each frame, read the vehicle's mode/speed/altitude and push
 * them into the hud store. The store rounds and de-dupes, so this can run every
 * frame without churning React — only a whole-number change reaches the UI.
 * Registered after the vehicle so it reads the post-update state. Vehicle and
 * store are injected, so it's unit-tested without a renderer.
 */
export class HudSystem implements System {
  readonly id = "hud";

  constructor(
    private readonly vehicle: VehicleSystem,
    private readonly store: HudStore,
  ) {}

  update(_ctx: FrameContext): void {
    const s = this.vehicle.state;
    this.store.set({ mode: s.mode, speed: s.speed, altitude: s.altitude });
  }
}
