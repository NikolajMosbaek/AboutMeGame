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
// in `buildWorld`, NOT the interact-key chain. Moving the sun's `position`/
// `target.position` together by the same delta re-centers the shadow camera
// WITHOUT changing the light's direction (only their difference matters for
// shading), so this never affects diffuse lighting — only which slice of the
// world casts/receives shadows. Distant terrain outside the frustum simply
// casts no shadow — acceptable, since fog and draw distance already hide it
// (confirmed visually via `npm run verify`, see the slice-2 run log).

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { lightBasis, snapToTexelGrid, type Vec3 } from "./shadowFrustum.ts";

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
    const target = sun.target.position;
    // The direction (target -> sun, i.e. eye - target) the day cycle wrote
    // THIS frame — reading it BEFORE the recenter below is safe: translating
    // both position and target by the same delta preserves their difference
    // (and therefore the light's shading direction) exactly.
    const direction: Vec3 = [
      sun.position.x - target.x,
      sun.position.y - target.y,
      sun.position.z - target.z,
    ];
    const basis = lightBasis(direction);
    const player: Vec3 = [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z];
    const snapped = snapToTexelGrid(player, basis, this.texelSize);

    target.set(snapped[0], snapped[1], snapped[2]);
    sun.position.set(
      snapped[0] + direction[0],
      snapped[1] + direction[1],
      snapped[2] + direction[2],
    );
  }
}
