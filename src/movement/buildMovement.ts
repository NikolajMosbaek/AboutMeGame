import type { Engine } from "../engine/Engine.ts";
import type { System, FrameContext } from "../engine/types.ts";
import type { World } from "../world/buildWorld.ts";
import type { GameSession } from "../gameSession.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import { createInput, type InputController } from "./input.ts";
import { VehicleSystem } from "./vehicle.ts";
import { CameraRigSystem } from "./followCamera.ts";

export interface Movement {
  input: InputController;
  vehicle: VehicleSystem;
}

/**
 * Wire input → vehicle → camera into the engine, in update order. Input is
 * polled first (its own system) so the control state is fresh, the vehicle
 * advances next, and the camera reads the updated vehicle last. `overlay` is the
 * DOM element touch controls mount into. Spawns at the origin plaza facing the
 * Arrivals Gate (#1) so the first landmark is straight ahead.
 */
export function buildMovement(
  engine: Engine,
  world: World,
  overlay: HTMLElement,
  session: GameSession,
): Movement {
  const input = createInput(overlay);
  engine.addSystem(new InputPollSystem(input));

  const gate = POI_ANCHORS.find((a) => a.order === 1);
  const spawn = { x: 0, z: 0, yaw: gate && gate.z > 0 ? 0 : Math.PI };

  const vehicle = new VehicleSystem(input, world.terrain, world.boundaries, spawn, session);
  engine.scene.add(vehicle.object);
  engine.addSystem(vehicle);

  engine.addSystem(new CameraRigSystem(engine, vehicle, world.terrain));

  return { input, vehicle };
}

/** Polls all input sources once per frame, before the vehicle reads them. Owns
 *  the input controller's teardown (window listeners + touch DOM). */
class InputPollSystem implements System {
  readonly id = "input";
  constructor(private readonly input: InputController) {}
  update(_ctx: FrameContext): void {
    this.input.update();
  }
  describe(): Record<string, unknown> {
    return { touch: this.input.touchActive };
  }
  dispose(): void {
    this.input.dispose();
  }
}
