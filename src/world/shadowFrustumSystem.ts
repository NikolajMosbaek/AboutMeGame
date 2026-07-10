// Player-following, texel-snapped shadow frustum (visual-overhaul slice 2).
//
// Today's static shadow camera frames the WHOLE 520-unit island through one
// fixed map (`sky.ts`'s sane baseline — a full ortho half-extent of
// `islandRadius * 1.1`): at `mapSize` 1024 that is ~0.43 m/texel, mushy at any
// distance the player can actually stand at. Re-centering a MUCH smaller
// frustum (tens of units, not hundreds) on the player every frame yields
// several times sharper texels on the SAME map size; snapping that recenter
// to the shadow map's own texel grid (`shadowFrustum.ts`, pure) keeps the
// frustum from shimmering as the player moves continuously.
//
// Visual-only, no gameplay state: registered alongside the sky/water systems
// in `buildWorld`, NOT the interact-key chain, AFTER `DayCycleSystem` (pinned by
// `buildWorld.shadowFrustum.test.ts`). Re-centering the shadow camera on the
// player every frame WITHOUT changing the light's direction never affects
// diffuse lighting — only which slice of the world casts/receives shadows.
// Distant terrain outside the frustum simply casts no shadow — acceptable,
// since fog and draw distance already hide it (confirmed visually via
// `npm run verify`, see the slice-2 run log).
//
// Direction ownership (review fix, #see run log): this System does NOT derive
// the light's direction from `sun.position - sun.target.position`. That
// difference is only meaningful while `sun.target` sits at the origin
// `DayCycleSystem` assumes — but THIS System is the one that parks `sun.target`
// at the player, so re-deriving direction from the scene graph would feed back
// a direction skewed by the player's own world position, permanently, from the
// second frame on. Instead it receives the day cycle's authoritative unit
// direction via {@link SunDirectionSource} injection and reconstructs both
// `sun.target.position` (snapped to the player) and `sun.position` (target +
// direction * `SUN_DISTANCE`) from that, every frame — one owner for "which way
// is the sun", full stop.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { SUN_DISTANCE } from "./dayCycleSystem.ts";
import { lightBasis, snapToTexelGrid, type Vec3 } from "./shadowFrustum.ts";

/** The seam this System reads the sun's unit direction through — satisfied by
 *  the live `DayCycleSystem` (structural typing, like `ReducedMotionSource`),
 *  never the whole System or a re-derivation from `sun.position`/`sun.target`.
 *  Kept narrow so a test can inject a plain fake with no day-cycle machinery. */
export interface SunDirectionSource {
  /** The current unit sun direction (a live, reused vector — read it, never
   *  retain or mutate it across frames). */
  getSunDirection(): THREE.Vector3;
}

export interface ShadowFrustumConfig {
  /** Half-extent of the ortho shadow frustum around the player, world units
   *  (the design's 60-90 range). */
  halfExtent: number;
  /** Shadow-map resolution (matches `sun.shadow.mapSize`) — used to size a
   *  texel for grid-snapping (`frustum full width / mapSize`). */
  mapSize: number;
}

/** Depth bias tuned for the tighter frustum. A much smaller world-units-per-
 *  texel footprint than the old whole-island frame needs a smaller bias
 *  magnitude to avoid a visible gap (peter-panning), and `normalBias` (offset
 *  along the surface normal rather than along the light) — unused by the old
 *  setup — helps suppress acne on the terrain's shallow slopes without
 *  needing a larger depth bias. */
const SHADOW_BIAS = -0.00015;
const SHADOW_NORMAL_BIAS = 0.08;

/**
 * Re-centers the sun's shadow-camera frustum on the player every frame.
 * Constructed with the config already resolved (the tier's `shadowMapSize`),
 * so it can size the frustum and tune bias once, at construction.
 */
export class ShadowFrustumSystem implements System {
  readonly id = "shadowFrustum";

  private readonly texelSize: number;

  constructor(
    private readonly sun: THREE.DirectionalLight,
    private readonly sunDirection: SunDirectionSource,
    config: ShadowFrustumConfig,
  ) {
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -config.halfExtent;
    cam.right = config.halfExtent;
    cam.top = config.halfExtent;
    cam.bottom = -config.halfExtent;
    cam.updateProjectionMatrix();

    sun.shadow.bias = SHADOW_BIAS;
    sun.shadow.normalBias = SHADOW_NORMAL_BIAS;

    this.texelSize = (config.halfExtent * 2) / config.mapSize;
  }

  update(ctx: FrameContext): void {
    const { sun } = this;
    // The authoritative unit direction the day cycle wrote THIS frame — the
    // ONLY source of "which way is the sun" this System ever reads. Never
    // `sun.position - sun.target.position`: once the recenter below parks
    // `sun.target` at the player, that difference stops equalling the day
    // cycle's direction (see this file's header doc).
    const dir = this.sunDirection.getSunDirection();
    const direction: Vec3 = [dir.x, dir.y, dir.z];
    const basis = lightBasis(direction);
    const player: Vec3 = [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z];
    const snapped = snapToTexelGrid(player, basis, this.texelSize);

    sun.target.position.set(snapped[0], snapped[1], snapped[2]);
    sun.position.set(
      snapped[0] + dir.x * SUN_DISTANCE,
      snapped[1] + dir.y * SUN_DISTANCE,
      snapped[2] + dir.z * SUN_DISTANCE,
    );
  }
}
