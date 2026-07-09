// Shared test doubles for the player module. One copy of the scripted-input
// fake (its consume semantics — drain-once look, edge-triggered interact — are
// exactly the subtle part of the contract) so the explorer and camera suites
// can never drift onto different input contracts. Not shipped: imported only
// by *.test.ts.

import * as THREE from "three";
import type { PlayerInputSnapshot, MoveState, LookDelta } from "./input.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import type { WaterDepthAt } from "./explorer.ts";
import type { FrameContext } from "../engine/types.ts";
import { WORLD } from "../world/worldConfig.ts";

/** One 60fps frame. */
export const FRAME: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

/** A scripted input: tests write `state`/`look` directly, `interact` via press. */
export function fakeInput() {
  const state: MoveState = { moveX: 0, moveZ: 0, sprint: false };
  const look: LookDelta = { dx: 0, dy: 0 };
  let interact = false;
  const snap: PlayerInputSnapshot = {
    state,
    consumeLook: () => {
      const d = { ...look };
      look.dx = 0;
      look.dy = 0;
      return d;
    },
    consumeInteract: () => {
      const v = interact;
      interact = false;
      return v;
    },
  };
  return { snap, state, look, press: () => (interact = true) };
}

/** Flat terrain at a fixed height, or any custom height field. */
export function fakeTerrain(height = 0, heightAt?: (x: number, z: number) => number): Terrain {
  return { heightAt: heightAt ?? (() => height) } as unknown as Terrain;
}

/** Boundaries that never clamp (an endless world). */
export function openBounds(): Boundaries {
  return { clampToBounds: () => {} } as unknown as Boundaries;
}

/** The production water rule over a given terrain: depth below WORLD.seaLevel. */
export function seaLevelWater(terrain: Terrain): WaterDepthAt {
  return (x, z) => WORLD.seaLevel - terrain.heightAt(x, z);
}

/** Dry-land water rule: never any water anywhere. */
export function noWater(): WaterDepthAt {
  return () => -1;
}
