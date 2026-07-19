import type { Engine } from "../engine/Engine.ts";
import type { FrameContext, System } from "../engine/types.ts";
import { buildTerrain, type Terrain } from "./terrain.ts";
import { buildSky, type Sky } from "./sky.ts";
import { buildBoundaries, type Boundaries } from "./boundaries.ts";
import { buildLandmarks, type Landmarks } from "./landmarks.ts";
import { buildProps } from "./props.ts";
import { buildWaterfall, WaterfallSystem } from "./waterfall.ts";
import { applyCanopyShade } from "./canopyShade.ts";
import { FloraCullSystem } from "./floraCullSystem.ts";
import { buildGroundingShadows } from "./groundingShadows.ts";
import { WaterSystem } from "./waterSystem.ts";
import { DayCycleSystem } from "./dayCycleSystem.ts";
import { UnderwaterFxSystem } from "./underwaterFxSystem.ts";
import { buildAquatic } from "./aquatic.ts";
import { ShadowFrustumSystem } from "./shadowFrustumSystem.ts";
import { StarfieldSystem } from "./starfield.ts";
import { CloudSystem } from "./clouds.ts";
import { WindSystem, type WindUniforms } from "./windSystem.ts";
import { WeatherSystem } from "./weatherSystem.ts";
import { RainSystem } from "./rainLayer.ts";
import type { WeatherSnapshot } from "./weather.ts";
import { AmbientMotesSystem } from "../fx/AmbientMotesSystem.ts";
import type { FloraUpgradeHandle } from "./floraUpgrade.ts";
import type { LandmarksUpgradeHandle } from "./landmarksUpgrade.ts";
import { WORLD } from "./worldConfig.ts";
import { QUALITY_TIERS, type QualityConfig } from "../perf/quality.ts";

/** The reduced-motion signal the world reads to hold its beacon pulse (#49). A
 *  `SettingsStore` satisfies it (`getSnapshot().reducedMotion`); tests pass a
 *  fake. Optional everywhere — absent means "motion on". */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

/** Half-extent of the player-following shadow frustum (visual-overhaul slice
 *  2, `ShadowFrustumSystem`) — within the design's 60-90-unit range. At this
 *  size (full width 140) the SAME `shadowMapSize` per tier yields texels
 *  roughly 3x smaller than the old whole-island frame (`islandRadius * 1.1`
 *  full width 440): 1024/140 ≈ 0.137 m/texel vs the old ≈ 0.43 m/texel on
 *  medium, ≈0.068 vs ≈0.21 on high — a real, measured sharpening, short of the
 *  design doc's illustrative "~10x" (that figure would need a ~44-unit full
 *  frustum, well outside the stated 60-90 range; recorded here as a deviation
 *  rather than silently claimed). */
const SHADOW_FRUSTUM_HALF_EXTENT = 70;

/** The assembled world. The player reads `terrain`/`boundaries`/`waterDepthAt`;
 *  discovery reads `landmarks.placed`. Shared by reference — the DI seam. */
export interface World {
  terrain: Terrain;
  sky: Sky;
  boundaries: Boundaries;
  landmarks: Landmarks;
  /** Still water depth at a ground point, metres (`<= 0` = dry land). The ONE
   *  definition of "where water is": today the sea plane at `WORLD.seaLevel`
   *  over anything the terrain dips below it — the same `seaLevel - height`
   *  the foam bake uses. Movement (wading/blocking), and later drinking,
   *  audio and FX all ask here, so a reshaped river changes one function. */
  waterDepthAt(x: number, z: number): number;
  /** The living-sky loop's current phase (pivot slice F wildlife seam),
   *  current palette (visual-overhaul slice 2's `EnvLightSystem` seam), and
   *  live sun direction (visual-overhaul slice 5's god-rays seam) — see
   *  `DayCycleSystem.getPhase()`/`getPalette()`/`getSunDirection()`. Exposed
   *  as this narrow accessor, never the System itself, so a consumer can't
   *  reach into the sky/dome/fog handles. `EnvLightSystem` and the
   *  post-processing compositor's god rays are both built OUTSIDE `buildWorld`
   *  (by `GameCanvas`, which owns the real renderer they each need) and read
   *  this same accessor. */
  dayCycle: Pick<DayCycleSystem, "getPhase" | "getPalette" | "getSunDirection">;
  /** The live weather (W1 #226): the rain layer, EnvLight dim and audio read
   *  `snapshot()`; the thunder rumble drains `justThundered()`. */
  weather: { snapshot(): WeatherSnapshot; justThundered(): boolean };
  dispose(): void;
}

/**
 * Compose the whole environment into the engine and return the handle later
 * epics build on. For Epic 2 it also installs a slow cinematic preview camera
 * so the world can be seen and verified before movement exists (Epic 3 replaces
 * it with the follow camera) and a gentle beacon pulse.
 *
 * `quality` (the resolved tier from the scaler, #47) tunes the build-time cost:
 * prop density and the sun's shadow map / fog. Defaults to full (high) so tests
 * and previews keep the old behaviour without passing it. `reducedMotion` (#49)
 * lets the beacon pulse hold still when the player has asked for less motion;
 * read live each frame, so toggling the setting takes effect at once.
 */
export function buildWorld(
  engine: Engine,
  quality: QualityConfig = QUALITY_TIERS.high,
  reducedMotion?: ReducedMotionSource,
): World {
  const { scene } = engine;

  const terrain = buildTerrain(quality);
  scene.add(terrain.mesh);

  const sky = buildSky(scene, {
    shadows: quality.shadows,
    shadowMapSize: quality.shadowMapSize,
    fog: quality.fog,
  });
  scene.add(sky.group);

  const boundaries = buildBoundaries(
    terrain.heightAt,
    quality.waterDisplacement,
    quality.waterDetail === "full",
    quality.textureAnisotropy,
  );
  scene.add(boundaries.group);

  const landmarks = buildLandmarks(terrain);
  scene.add(landmarks.group);

  // The CC0 object model upgrade (Objects slice 1, "make the objects look
  // like what they really are") — medium/high only (`quality.objectDetail
  // === "full"`), the exact `floraUpgrade` lazy-chunk/async-swap/procedural-
  // fallback precedent above. `landmarks.group` already renders the FULL
  // procedural site set synchronously, byte-identical to before this slice;
  // this is a background swap-in, never a gate on the world being visible.
  let landmarksUpgradeCancelled = false;
  let landmarksUpgradeHandle: LandmarksUpgradeHandle | null = null;
  if (quality.objectDetail === "full") {
    import("./landmarksUpgrade.ts").then(
      ({ upgradeLandmarks }) => {
        if (landmarksUpgradeCancelled) return;
        landmarksUpgradeHandle = upgradeLandmarks(landmarks);
      },
      (err) => {
        console.error("landmark model upgrade chunk failed to load — keeping procedural sites:", err);
      },
    );
  }

  // `fullFoliage` (enlarged crowns + eye-height tall ferns) rides the same
  // knob as the model upgrade: the tiers that can afford the fill get the
  // jungle look; low keeps the original silhouettes at the original cost.
  const props = buildProps(terrain, quality.propDensity, quality.floraDetail === "full");
  scene.add(props.group);

  // Bake the under-canopy ground shade into the terrain's vertex colours
  // (every tier — the splat patch multiplies vColor into its blended albedo,
  // and low's terrain look IS its vertex colours). Zero per-frame cost.
  applyCanopyShade(terrain.mesh.geometry, props.canopyCrowns);

  // Blob grounding shadows (G5 #160) — ONLY on tiers without a real shadow
  // pass (`quality.groundingShadows`, i.e. low), where trees/rocks/sites
  // would otherwise float. One InstancedMesh over the props' own placement
  // points plus a wider, softer disc per landmark site. Zero asset bytes.
  let groundingShadows: ReturnType<typeof buildGroundingShadows> | null = null;
  if (quality.groundingShadows) {
    const SITE_GROUND_RADIUS = 3;
    const sitePoints = landmarks.placed.map((l) => ({
      x: l.position.x,
      y: l.position.y,
      z: l.position.z,
      radius: SITE_GROUND_RADIUS,
    }));
    groundingShadows = buildGroundingShadows(
      [...props.groundPoints, ...sitePoints],
      terrain.heightAt,
    );
    scene.add(groundingShadows.mesh);
  }

  // The CC0 flora model upgrade (visual-overhaul slice 6) — medium/high only
  // (`quality.floraDetail === "full"`). `props.group` above already renders
  // the FULL procedural vegetation synchronously, byte-identical to before
  // this slice (`props.ts` is untouched); this is a background swap-in, never
  // a gate on the world being visible. `floraUpgrade.ts` is reached ONLY
  // through this dynamic `import()` (the `GameCanvas`/`loadCompositor` lazy-
  // chunk idiom — see that module's own doc), so the low tier never downloads
  // a byte of it. `windUniforms` is the one shared `{uTime}` handle every
  // wind-patched flora/grass material binds by reference; `WindSystem` is
  // registered only here, alongside the tiers that actually attach a wind-
  // patched material (mirrors `ShadowFrustumSystem`'s `quality.shadows` gate:
  // no point advancing a clock nothing reads).
  let floraUpgradeCancelled = false;
  let floraUpgradeHandle: FloraUpgradeHandle | null = null;
  let windSystem: WindSystem | undefined;
  let cloudSystem: CloudSystem | undefined;
  if (quality.floraDetail === "full") {
    const windUniforms: WindUniforms = { uTime: { value: 0 } };
    windSystem = new WindSystem(windUniforms, reducedMotion);
    engine.addSystem(windSystem);
    import("./floraUpgrade.ts").then(
      ({ upgradeFlora }) => {
        if (floraUpgradeCancelled) return;
        floraUpgradeHandle = upgradeFlora(props.group, terrain, quality.propDensity, windUniforms);
      },
      (err) => {
        console.error("flora upgrade chunk failed to load — keeping procedural props:", err);
      },
    );
    // Distance-cull the understory chunk meshes the swap will deliver
    // (jungle-density epic): reads the chunk list through the handle each
    // frame — empty until the swap lands, empty again after teardown.
    engine.addSystem(new FloraCullSystem(() => floraUpgradeHandle?.understoryChunks() ?? []));
  }

  // Aquatic life (#184): kelp beds + lily pads in the lagoon (2 draw calls,
  // deterministic). The sway system registers below, gated by reduced motion.
  const aquatic = buildAquatic(terrain);
  scene.add(aquatic.group);

  // The waterfall at the river's gorge head (living-water epic) — every tier
  // (≤ 6 draws, ~200 tris, each mesh frustum-culled on its own local bounds,
  // all colocated on the far north side).
  const waterfall = buildWaterfall();
  scene.add(waterfall.group);

  // Constructed here (not inline in the `addSystem` call below) so `World.dayCycle`
  // can close over the live instance — the single production importer of
  // `./dayCycle` (the chain that wires the pure palette into the bundle) stays
  // unchanged; only WHERE the reference is held moves.
  const dayCycleSystem = new DayCycleSystem(sky.sun, sky.dome, sky.fog, reducedMotion);

  const world: World = {
    terrain,
    sky,
    boundaries,
    landmarks,
    waterDepthAt: (x, z) => WORLD.seaLevel - terrain.heightAt(x, z),
    dayCycle: {
      getPhase: () => dayCycleSystem.getPhase(),
      getPalette: () => dayCycleSystem.getPalette(),
      getSunDirection: () => dayCycleSystem.getSunDirection(),
    },
    // Lazy closures: `weatherSystem` is constructed (and registered) below,
    // after the cloud/wind systems it drives exist. Callers only invoke these
    // once the world is running.
    weather: {
      snapshot: () => weatherSystem.snapshot(),
      justThundered: () => weatherSystem.justThundered(),
    },
    dispose() {
      floraUpgradeCancelled = true; // an in-flight model load must not attach to a torn-down world
      floraUpgradeHandle?.dispose();
      landmarksUpgradeCancelled = true;
      landmarksUpgradeHandle?.dispose();
      terrain.dispose();
      sky.dispose();
      boundaries.dispose();
      landmarks.dispose();
      props.dispose();
      groundingShadows?.dispose();
      aquatic.dispose();
      waterfall.dispose();
    },
  };

  engine.camera.far = WORLD.size * 2;
  engine.camera.updateProjectionMatrix();
  // The sites census — a zero-cost system whose describe() feeds
  // render_game_to_text (`systems.sites.poiCount`), replacing the retired
  // beacon pulse's census now that sites carry no sky-beacons.
  engine.addSystem(new SitesCensusSystem(world));

  // The water swell clock — installed ONLY on medium/high, where
  // `quality.waterDisplacement` compiled the vertex swell and `buildBoundaries`
  // exposes the live `uTime` uniform. On low the water is the static slice-2
  // surface (no `waterUniforms`), so no clock is owed and none is paid.
  if (boundaries.waterUniforms) {
    engine.addSystem(
      new WaterSystem(boundaries.waterUniforms, reducedMotion),
    );
  }

  // The living-sky day cycle (G3) — registered UNCONDITIONALLY, since the sun
  // and dome exist on every tier and the fog handle is
  // null-guarded for the low tier. Injected the three live sky handles
  // individually (never the whole World/Sky), and the reduced-motion gate so it
  // pins to golden hour and holds when the player asks for less motion.
  // Drifting clouds (visual-overhaul slice 5) — ONE InstancedMesh draw call,
  // medium/high only (`quality.cloudDetail`). Constructed BEFORE weather so
  // the storm-dark knob has a real sink (they poll it, so update order is free).
  if (quality.cloudDetail === "full") {
    cloudSystem = new CloudSystem(scene, dayCycleSystem, reducedMotion);
    engine.addSystem(cloudSystem);
  }

  engine.addSystem(dayCycleSystem);
  // Weather (W1 #226) — AFTER the day cycle (its per-frame sun/fog writes are
  // what weather multiplies), BEFORE UnderwaterFxSystem (whose absolute
  // submerged fog must win). EnvLightSystem (GameCanvas) dims itself via the
  // injected weatherDim read.
  const weatherSystem = new WeatherSystem(sky, dayCycleSystem, cloudSystem, windSystem);
  engine.addSystem(weatherSystem);
  // Rain streaks (W1 #227) — medium/high only (`quality.rainDetail`), reading
  // the snapshot the weather system just refreshed this frame.
  if (quality.rainDetail === "full") {
    engine.addSystem(new RainSystem(scene, weatherSystem, reducedMotion));
  }

  // The player-following, texel-snapped shadow frustum (visual-overhaul slice
  // 2) — visual-only, registered here alongside the sky/water systems, NOT the
  // interact-key chain. Only where shadows actually run (`quality.shadows`):
  // on low there is no shadow map to sharpen, so nothing is registered (a
  // system that only ever repositioned an inert light would be pure waste).
  // AFTER the day cycle so it reads THIS frame's freshly-written sun
  // direction before recentering (see `ShadowFrustumSystem`'s own doc for why
  // one frame of lag would be harmless either way).
  if (quality.shadows) {
    engine.addSystem(
      new ShadowFrustumSystem(sky.sun, dayCycleSystem, {
        halfExtent: SHADOW_FRUSTUM_HALF_EXTENT,
        mapSize: quality.shadowMapSize,
      }),
    );
  }

  // Underwater fog (#184) — AFTER the day cycle, which owns the fog colour:
  // this layers the submerged teal + density on top and restores exactly on
  // surfacing. Null-fog (low tier) makes it a no-op, like the day cycle's own
  // fog write.
  engine.addSystem(new UnderwaterFxSystem(sky.fog));

  // Kelp sway (#184) — gentle and non-essential, so it holds still under the
  // same live reduced-motion gate the water swell reads.
  engine.addSystem(aquatic.sway(reducedMotion));

  // Starfield (visual-overhaul slice 5) — ONE cheap Points draw call, every
  // tier (it's too cheap to gate). Reads the day cycle's sun direction (its
  // own accessor, not `./dayCycle`) to fade in as the sun gets low and holds
  // its twinkle/rotation still under reduced motion, mirroring the aquatic
  // sway's gate.
  engine.addSystem(new StarfieldSystem(scene, dayCycleSystem, reducedMotion));


  // Ambient jungle motes (visual-overhaul slice 7, polish) — 2 more `Points`
  // draw calls (dust/pollen + falling leaves), medium/high only
  // (`quality.ambientParticles`): a bake-at-mount knob, like `cloudDetail`, so
  // it "applies on reload".
  if (quality.ambientParticles === "full") {
    engine.addSystem(new AmbientMotesSystem(scene, terrain.heightAt, reducedMotion));
  }

  // The falling water animates on every tier (a texture-offset scroll, no
  // shader patch); reduced motion holds it still, like the water swell.
  engine.addSystem(new WaterfallSystem(waterfall, undefined, reducedMotion));

  return world;
}

/**
 * The sites census: no per-frame work, but its describe() keeps the site count
 * visible in the render_game_to_text state the smoke tooling reads (the beacon
 * pulse that used to carry this census retired with the sky-beacons — jungle
 * sites are found by reading clues, not by glowing pillars).
 */
class SitesCensusSystem implements System {
  readonly id = "sites";

  constructor(private readonly world: World) {}

  update(_ctx: FrameContext): void {}

  describe(): Record<string, unknown> {
    return { poiCount: this.world.landmarks.placed.length };
  }
}
