import * as THREE from "three";
import { assetUrl } from "../engine/assets.ts";
import { loadFloraGlb } from "./floraGlb.ts";
import { makeWindPatch } from "./windPatch.ts";
import type { WindUniforms } from "./windSystem.ts";
import { buildGrass } from "./grass.ts";
import type { Terrain } from "./terrain.ts";

// The CC0 flora model upgrade (visual-overhaul slice 6, flora & fauna) —
// swaps `props.ts`'s procedural cylinder/cross-plane vegetation for real
// low-poly CC0 tree/palm/understory/rock models AT THE SAME SEEDED
// PLACEMENTS, plus builds the wind-swayed grass layer. Medium/high only
// (`quality.floraDetail === "full"`).
//
// LAZY BY DESIGN: `buildWorld.ts` reaches this module ONLY through a dynamic
// `import()` behind that gate (the `GameCanvas`/`loadCompositor` idiom) — the
// low tier, which never sets `floraDetail: "full"`, never downloads a byte of
// this module or fetches a single model. Nothing in this file is imported
// eagerly from anywhere else, so Vite's default code-splitting puts it (and
// its only-here-reached dependents, `grass.ts`/`windPatch.ts`/`windSway.ts`)
// in their own lazy chunk with no `manualChunks` entry needed — unlike
// `postprocessing`/`n8ao`, nothing here is a heavy third-party library, so the
// eager-JS cost of this whole feature is just the tiny dynamic-`import()`
// call site itself (measured in `docs/perf-budget.md`).
//
// ASYNC, NEVER BLOCKS THE WORLD: `props.ts`'s procedural meshes render from
// frame one, exactly as before this slice (byte-identical placement —
// `props.ts` itself is untouched). This module loads the GLBs in the
// background and, once ALL of a category's variants are ready, atomically
// swaps that category's `InstancedMesh`(es) for model-backed ones built at
// the SAME transforms (read directly off the procedural meshes'
// `instanceMatrix`, never re-derived from the RNG — so there is exactly one
// placement algorithm, `props.ts`'s, and this module can never disagree with
// it). On ANY load failure the whole upgrade aborts and logs ONCE: the
// procedural props stay exactly as built, forever (the terrain/water texture-
// attach precedent's "keep the pre-upgrade look on failure" contract).
//
// MATERIALS ARE OURS, NOT THE GLTF'S: `scripts/process-models.mjs` bakes each
// source model's flat per-material colours into a single `COLOR_0` vertex
// attribute and merges every primitive into ONE geometry; only that geometry
// is read here (`extractGeometry`) — the glTF's own (`KHR_materials_unlit`)
// material is discarded, and this module builds its own lit, flat-shaded
// `MeshStandardMaterial` (vertexColors, matching the renderer's SRGB/ACES lit
// convention every other surface in this world uses, `docs/art-direction.md`).

const CANOPY_MODELS = ["canopy-a", "canopy-b"];
const PALM_MODELS = ["palm-a"];
const UNDERSTORY_MODELS = ["understory-a", "understory-b"];
const ROCK_MODELS = ["rock-a", "rock-b"];

/** Sway amplitude at the top of each category's model, world units — trees
 *  and palm fronds read as visibly swaying canopies; understory only gently
 *  nods (it is much shorter, so the SAME angular sway would read as violent
 *  shaking relative to its own height). Rocks get no wind patch at all (not
 *  foliage). Grass has its own constant in `grass.ts`. */
const CANOPY_WIND_STRENGTH = 0.4;
const PALM_WIND_STRENGTH = 0.6;
const UNDERSTORY_WIND_STRENGTH = 0.15;

export interface LoadedVariant {
  geometry: THREE.BufferGeometry;
  maxHeight: number;
}

/** The model-loading seam — injectable so tests can substitute a synthetic
 *  geometry instead of a real network fetch + GLTF parse (neither of which
 *  jsdom supports); defaults to the real `loadGeometry` below. Mirrors
 *  `GameCanvas`'s `CompositorLoader` DI seam. */
export type GeometryLoader = (name: string) => Promise<LoadedVariant>;

function modelUrl(name: string): string {
  return assetUrl(`assets/models/flora/${name}.glb`);
}

/** Load one processed GLB and extract its single merged, vertex-coloured
 *  geometry via `floraGlb.ts`'s minimal parser (NOT the general glTF loader —
 *  `assets.ts`'s own header doc records the measured byte-budget finding that
 *  motivated the swap, and the general `loadModel`/`GLTFLoader` seam has since
 *  been deleted as dead code). Every call re-fetches independently — never
 *  cached by URL (`floraGlb.ts`'s own header doc: a replay-fragility finding),
 *  so a second `upgradeFlora` mount after `exitToTitle` → `playing` never
 *  receives a geometry the first mount's teardown already disposed. The
 *  geometry comes back already in the SAME local convention `props.ts`'s
 *  procedural geometry uses (base at local origin, scaled to this world's
 *  units — baked at process time, `scripts/process-models.mjs`), so no
 *  runtime scale fudge factor is needed at the instancing call site. */
export const loadGeometry: GeometryLoader = async (name) => {
  const geometry = await loadFloraGlb(modelUrl(name));
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  return { geometry, maxHeight: Math.max(0.01, bbox.max.y) };
};

/** Deterministic integer-index → variant-index split (a cheap Wang-style bit
 *  mix, NOT `props.ts`'s seeded noise — this only needs to spread indices
 *  across variants without favouring one, never a placement decision, so a
 *  plain hash keeps this module free of any RNG-sequence coupling to
 *  `props.ts`). Pure and exported for the test to assert an even-ish split. */
export function variantIndexOf(i: number, variantCount: number): number {
  let h = (i ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % variantCount;
}

function findMesh(group: THREE.Group, name: string): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  group.traverse((o) => {
    if (!found && o instanceof THREE.InstancedMesh && o.name === name) found = o;
  });
  return found;
}

export interface Disposable {
  dispose(): void;
}

/**
 * Replace one category's procedural `InstancedMesh`(es) with model-backed
 * variants at the SAME transforms. `sourceMesh` is read for its per-instance
 * matrices (every mesh in `oldMeshes` shares that same index space in
 * `props.ts` — trunk+cross, or trunk+frond — so reading just one is enough).
 * Returns the new meshes (already added to `group`) and their disposer.
 * Exported so the test can exercise the swap/dispose lifecycle directly
 * against synthetic `InstancedMesh`/`LoadedVariant` fixtures, without a real
 * network fetch.
 */
export function swapCategory(
  group: THREE.Group,
  oldMeshes: (THREE.InstancedMesh | undefined)[],
  sourceMesh: THREE.InstancedMesh | undefined,
  variants: LoadedVariant[],
  options: { namePrefix: string; castShadow: boolean; wind?: { strength: number; uniforms: WindUniforms } },
): Disposable {
  if (!sourceMesh || variants.length === 0) {
    return { dispose() {} };
  }

  const count = sourceMesh.count;
  const perVariantMatrices: THREE.Matrix4[][] = variants.map(() => []);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    sourceMesh.getMatrixAt(i, m);
    perVariantMatrices[variantIndexOf(i, variants.length)].push(m.clone());
  }

  const newMeshes: THREE.InstancedMesh[] = [];
  const materials: THREE.Material[] = [];
  variants.forEach((variant, vi) => {
    const matrices = perVariantMatrices[vi];
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    if (options.wind) {
      const patch = makeWindPatch({
        maxHeight: variant.maxHeight,
        strength: options.wind.strength,
        uniforms: { uTime: options.wind.uniforms.uTime },
      });
      material.onBeforeCompile = patch.onBeforeCompile;
      material.customProgramCacheKey = patch.customProgramCacheKey;
    }
    materials.push(material);

    const mesh = new THREE.InstancedMesh(variant.geometry, material, Math.max(1, matrices.length));
    mesh.name = `${options.namePrefix}-${vi}`;
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = true;
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    newMeshes.push(mesh);
  });

  for (const old of oldMeshes) {
    if (old) group.remove(old);
  }

  return {
    dispose() {
      for (const mesh of newMeshes) {
        group.remove(mesh);
        mesh.dispose();
      }
      for (const material of materials) material.dispose();
      for (const variant of variants) variant.geometry.dispose();
    },
  };
}

export interface FloraUpgradeHandle {
  dispose(): void;
}

/**
 * Kick off the async model load + swap. Returns immediately with a handle
 * whose `dispose()` is safe to call at ANY time — before the load resolves
 * (guarded by a `cancelled` flag, the `GameCanvas` compositor-load idiom) or
 * after (releases the swapped-in resources). `terrain`/`propDensity` feed the
 * grass layer's own placement (`grass.ts`); `windUniforms` is the ONE shared
 * `{uTime}` handle `WindSystem` advances, bound by every wind-patched
 * material this module and `grass.ts` create.
 */
export function upgradeFlora(
  propsGroup: THREE.Group,
  terrain: Terrain,
  propDensity: number,
  windUniforms: WindUniforms,
  load: GeometryLoader = loadGeometry,
): FloraUpgradeHandle {
  let cancelled = false;
  let applied: Disposable | null = null;

  (async () => {
    try {
      // `Promise.allSettled` at BOTH levels (per-category AND per-variant
      // within a category), NOT `Promise.all` — a plain `Promise.all`
      // rejecting the instant any ONE model rejects (one 404s, say) silently
      // drops every fulfilled sibling's value, including siblings WITHIN the
      // same category's own `Promise.all` (e.g. `canopy-a` resolves fine
      // while `canopy-b` 404s: the category-level `Promise.all` itself
      // rejects, discarding `canopy-a`'s already-parsed geometry too) — and
      // nothing ever called `.dispose()` on those real `THREE.BufferGeometry`
      // instances (code-review finding 5). Settling every category AND every
      // variant lets this sweep every fulfilled geometry, at any depth,
      // before aborting — matching the existing "log once, keep the
      // procedural props forever" fallback contract exactly; only the
      // disposal path is new.
      const perCategory = await Promise.all([
        Promise.allSettled(CANOPY_MODELS.map(load)),
        Promise.allSettled(PALM_MODELS.map(load)),
        Promise.allSettled(UNDERSTORY_MODELS.map(load)),
        Promise.allSettled(ROCK_MODELS.map(load)),
      ]);
      const settled = perCategory.flat();

      const firstRejection = settled.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstRejection) {
        for (const r of settled) {
          if (r.status === "fulfilled") r.value.geometry.dispose();
        }
        throw firstRejection.reason;
      }

      const [canopy, palm, understory, rock] = perCategory.map((category) =>
        category.map((r) => (r as PromiseFulfilledResult<LoadedVariant>).value),
      );

      if (cancelled) {
        for (const v of [...canopy, ...palm, ...understory, ...rock]) v.geometry.dispose();
        return;
      }

      // DELIBERATE shadow-convention change, canopy/palm ONLY (code-review
      // finding 2). `props.ts`'s pre-slice-6 convention (#5) was
      // "only solid trunk/rock geometry casts — the thin foliage crosses
      // don't, at real fill-rate cost for little gain" — `canopyCross`/
      // `palmFronds` were `castShadow: false` there. Each model-backed
      // category here is `scripts/process-models.mjs`'s ONE merged mesh
      // (trunk fused with its canopy/frond crown into a single primitive),
      // so there is exactly one `castShadow` flag per category, not a
      // separate trunk/foliage pair to split — `castShadow: true` on
      // canopy/palm therefore now ALSO casts the foliage silhouette, not just
      // the trunk. This is an intentional visual upgrade, not an accidental
      // carry-over: real low-poly canopy/frond geometry casting dappled,
      // broken light through the jungle canopy is a deliberate part of this
      // slice's look (the flat foliage-cross alpha cutout `props.ts` shipped
      // was never going to cast a convincing shadow anyway, which is WHY that
      // convention existed pre-slice-6 — a real merged canopy mesh doesn't
      // have that problem). Understory/rock below are UNCHANGED from the
      // `props.ts` convention: understory stays non-casting (still thin,
      // still short — the pre-slice-6 reasoning still applies at its scale),
      // rock stays casting (solid geometry, always did). The measured shadow-
      // pass fps/frame-time cost of this canopy/palm flip is recorded in
      // `docs/perf-budget.md`'s slice-6 section.
      const disposers: Disposable[] = [];
      disposers.push(
        swapCategory(
          propsGroup,
          [findMesh(propsGroup, "canopy-trunk"), findMesh(propsGroup, "canopy-cross")],
          findMesh(propsGroup, "canopy-trunk"),
          canopy,
          { namePrefix: "canopy-model", castShadow: true, wind: { strength: CANOPY_WIND_STRENGTH, uniforms: windUniforms } },
        ),
      );
      disposers.push(
        swapCategory(
          propsGroup,
          [findMesh(propsGroup, "palm-trunk"), findMesh(propsGroup, "palm-frond")],
          findMesh(propsGroup, "palm-trunk"),
          palm,
          { namePrefix: "palm-model", castShadow: true, wind: { strength: PALM_WIND_STRENGTH, uniforms: windUniforms } },
        ),
      );
      disposers.push(
        swapCategory(
          propsGroup,
          [findMesh(propsGroup, "understory")],
          findMesh(propsGroup, "understory"),
          understory,
          {
            namePrefix: "understory-model",
            castShadow: false,
            wind: { strength: UNDERSTORY_WIND_STRENGTH, uniforms: windUniforms },
          },
        ),
      );
      disposers.push(
        swapCategory(propsGroup, [findMesh(propsGroup, "rocks")], findMesh(propsGroup, "rocks"), rock, {
          namePrefix: "rock-model",
          castShadow: true,
        }),
      );

      const grass = buildGrass(terrain, propDensity, windUniforms);
      propsGroup.add(grass.group);
      disposers.push(grass);

      applied = {
        dispose() {
          for (const d of disposers) d.dispose();
        },
      };
    } catch (err) {
      console.error("flora model upgrade failed to load — keeping procedural props:", err);
    }
  })();

  return {
    dispose() {
      cancelled = true;
      applied?.dispose();
    },
  };
}
