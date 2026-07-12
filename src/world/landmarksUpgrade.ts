import * as THREE from "three";
import { assetUrl } from "../engine/assets.ts";
import { loadFloraGlb } from "./floraGlb.ts";
import { buildSite, type Landmarks } from "./landmarks.ts";
import { POI_ANCHORS, type SiteArchetype } from "./worldConfig.ts";

// The CC0 object model upgrade (Objects slice 1, "make the objects look like
// what they really are") — swaps `landmarks.ts`'s plain-procedural camp/
// canoe/ruin primitives for real low-poly CC0 tent/campfire/crate/barrel/
// bedroll/rowboat/worked-stone models AT THE SAME SITE ANCHORS, and adds the
// lost expedition's dropped tools to the remains site. Medium/high only
// (`quality.objectDetail === "full"`) — mirrors `floraUpgrade.ts`'s precedent
// exactly (lazy chunk, async load, procedural-forever fallback on failure).
//
// LAZY BY DESIGN: reached ONLY through `buildWorld.ts`'s dynamic `import()`
// behind that gate, so the low tier never downloads a byte of this module or
// fetches a single model — the same `floraUpgrade.ts`/`GameCanvas` idiom.
//
// ASYNC, NEVER BLOCKS THE WORLD: `buildLandmarks`'s plain-procedural sites
// render from frame one, exactly as before this slice. This module loads the
// object GLBs in the background and, once EVERY model has loaded, calls
// `buildSite` a SECOND time per upgradeable site (with the loaded geometry
// map) and swaps the whole per-site sub-group for the freshly-built one — the
// SAME shared `stone`/`accent` materials (`landmarks.materials`), never a new
// material context. On ANY load failure the whole upgrade aborts and logs
// ONCE: the procedural sites stay exactly as built, forever (the flora
// upgrade's own "keep the pre-upgrade look on failure" contract).
//
// DISPOSAL: the OLD per-site group's geometries stay tracked in
// `buildLandmarks`'s own closure (`Landmarks.dispose()` disposes them
// regardless of whether they're still in the scene graph) — this module only
// tracks and disposes the NEW geometry it creates, exactly mirroring
// `floraUpgrade.ts`'s `swapCategory` (`group.remove(old)`, never
// `old.geometry.dispose()`, since `props.dispose()` still owns that).

/** Which sites get a model swap, and which named models each one needs
 *  (`landmarks.ts`'s `buildSite` model branch is the single source of truth
 *  for HOW they're placed — this is only the fetch list). Overhang and
 *  figtree have no CC0 model swap (upgraded procedurally, unconditionally, in
 *  `landmarks.ts` itself); remains ADDS tools alongside its still-procedural
 *  cairn/pack/bones. */
const MODEL_NAMES_BY_ARCHETYPE: Partial<Record<SiteArchetype, string[]>> = {
  camp: ["tent", "campfire", "crate", "crate-open", "barrel", "bedroll"],
  canoe: ["canoe-hull"],
  ruin: ["ruin-wall", "ruin-wall-damaged", "ruin-column", "ruin-debris"],
  remains: ["tool-axe", "tool-shovel"],
};

function modelUrl(name: string): string {
  return assetUrl(`assets/models/objects/${name}.glb`);
}

/** The model-loading seam — injectable so tests can substitute a synthetic
 *  geometry instead of a real network fetch + GLB parse (mirrors
 *  `floraUpgrade.ts`'s `GeometryLoader`). Defaults to the real loader, which
 *  reuses `floraGlb.ts`'s minimal parser (the pipeline's output shape is
 *  identical for flora and object models — one mesh, one quantized
 *  primitive — so the SAME parser applies unchanged). */
export type ObjectGeometryLoader = (name: string) => Promise<THREE.BufferGeometry>;

export const loadObjectGeometry: ObjectGeometryLoader = (name) => loadFloraGlb(modelUrl(name));

export interface LandmarksUpgradeHandle {
  dispose(): void;
}

/**
 * Kick off the async model load + per-site swap. Returns immediately with a
 * handle whose `dispose()` is safe to call at ANY time — before the load
 * resolves (guarded by a `cancelled` flag) or after (releases the swapped-in
 * geometry, matching the flora upgrade's own dispose contract).
 */
export function upgradeLandmarks(
  landmarks: Landmarks,
  load: ObjectGeometryLoader = loadObjectGeometry,
): LandmarksUpgradeHandle {
  let cancelled = false;
  const disposables: Array<{ dispose(): void }> = [];

  (async () => {
    try {
      const uniqueNames = [...new Set(Object.values(MODEL_NAMES_BY_ARCHETYPE).flat())];
      const settled = await Promise.allSettled(
        uniqueNames.map(async (name): Promise<[string, THREE.BufferGeometry]> => [name, await load(name)]),
      );

      const firstRejection = settled.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstRejection) {
        for (const r of settled) {
          if (r.status === "fulfilled") r.value[1].dispose();
        }
        throw firstRejection.reason;
      }

      if (cancelled) {
        for (const r of settled as PromiseFulfilledResult<[string, THREE.BufferGeometry]>[]) {
          r.value[1].dispose();
        }
        return;
      }

      const geometryByName = new Map(
        (settled as PromiseFulfilledResult<[string, THREE.BufferGeometry]>[]).map((r) => r.value),
      );

      for (const placedSite of landmarks.placed) {
        const anchor = POI_ANCHORS.find((a) => a.poiId === placedSite.poiId);
        const archetype = anchor?.archetype;
        if (!archetype || !MODEL_NAMES_BY_ARCHETYPE[archetype]) continue;

        const oldGroup = placedSite.object.children[0];
        const newGroup = buildSite(
          archetype,
          landmarks.materials.stone,
          landmarks.materials.accent,
          disposables,
          geometryByName,
        );
        if (oldGroup) placedSite.object.remove(oldGroup);
        placedSite.object.add(newGroup);
      }

      // Every loaded geometry was only ever a TEMPLATE `buildSite`'s model
      // branch `.clone()`d from (`modelGeo` in `landmarks.ts`) — the clones
      // are what actually got merged into the new sites' meshes (tracked in
      // `disposables` above), so the originals are safe to release now.
      for (const geometry of geometryByName.values()) geometry.dispose();
    } catch (err) {
      console.error("landmark model upgrade failed to load — keeping procedural sites:", err);
    }
  })();

  return {
    dispose() {
      cancelled = true;
      for (const d of disposables) d.dispose();
    },
  };
}
