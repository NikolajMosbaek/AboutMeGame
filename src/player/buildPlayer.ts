import type { Engine } from "../engine/Engine.ts";
import type { System, FrameContext } from "../engine/types.ts";
import type { World } from "../world/buildWorld.ts";
import type { GameSession } from "../gameSession.ts";
import { createPlayerInput, type PlayerInputController } from "./input.ts";
import { ExplorerSystem } from "./explorer.ts";
import { FirstPersonCameraSystem, type MotionSource } from "./fpCamera.ts";

export interface Player {
  input: PlayerInputController;
  explorer: ExplorerSystem;
}

/**
 * Wire input → explorer → first-person camera into the engine, in update order
 * (pivot slice B — replaces buildMovement's vehicle/flight rig). Input polls
 * first so the control state is fresh, the explorer advances next, and the
 * camera reads the updated state last. `overlay` is the DOM element the touch
 * controls mount into and the pointer-lock target. Spawns at the origin facing
 * +Z; the world slice moves the spawn to the expedition camp.
 */
export function buildPlayer(
  engine: Engine,
  world: World,
  overlay: HTMLElement,
  session: GameSession,
  motion?: MotionSource,
): Player {
  const input = createPlayerInput(overlay);
  engine.addSystem(new InputPollSystem(input, session));

  const explorer = new ExplorerSystem(input, world.terrain, world.boundaries, { x: 0, z: 0, yaw: 0 }, session);
  engine.addSystem(explorer);

  engine.addSystem(new FirstPersonCameraSystem(engine, explorer, motion));

  return { input, explorer };
}

/** Polls all input sources once per frame, before the explorer reads them. Owns
 *  the input controller's teardown, and releases pointer lock whenever the
 *  session pauses (a panel or menu is up) so the cursor is available to it. */
class InputPollSystem implements System {
  readonly id = "input";
  constructor(
    private readonly input: PlayerInputController,
    private readonly session?: GameSession,
  ) {}
  update(_ctx: FrameContext): void {
    this.input.update();
    if (this.session?.paused && typeof document !== "undefined" && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }
  describe(): Record<string, unknown> {
    return { touch: this.input.touchActive };
  }
  dispose(): void {
    this.input.dispose();
  }
}
