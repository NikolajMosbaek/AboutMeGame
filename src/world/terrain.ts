import * as THREE from "three";
import { makeNoise2D } from "./noise.ts";
import { WORLD, RIVER, LAGOON, SPAWN } from "./worldConfig.ts";
import { loadTexture } from "../engine/assets.ts";
import {
  SPLAT_CHANNELS,
  computeSplatWeights,
  packSplatWeights,
  slopeFromNormalY,
  type SplatChannel,
} from "./terrainSplat.ts";
import { makeTerrainMaterialPatch } from "./terrainMaterialPatch.ts";
import { QUALITY_TIERS, type QualityConfig } from "../perf/quality.ts";

export interface Terrain {
  /** The renderable mesh (smooth-shaded, PBR-splatted with a surviving
   *  vertex-colour macro tint — visual-overhaul slice 3). */
  mesh: THREE.Mesh;
  /** Ground height at any world (x,z). Pure — movement follows it and
   *  props/sites sit on it. Below sea level means underwater. */
  heightAt(x: number, z: number): number;
  /** Resolves once the async ground-texture load has settled (attached on
   *  success, logged-and-skipped on failure) — never rejects. Tests/verifiers
   *  can await it for a deterministic "textures are in" point; production
   *  code never needs to (the terrain renders its vertex-colour look the
   *  instant `buildTerrain` returns, and upgrades in place with one material
   *  recompile when this settles — see `attachTerrainTextures`'s doc). */
  texturesReady: Promise<void>;
  dispose(): void;
}

/** Injectable texture loader — defaults to the cached, `assetUrl`-resolving
 *  `loadTexture` (`src/engine/assets.ts`). Matches its signature exactly so
 *  tests can substitute a stub that never touches the network/jsdom `Image`
 *  loading path. */
export type TerrainTextureLoader = (path: string) => Promise<THREE.Texture>;

const TEXTURE_DIR = "assets/textures/terrain/";

/** kebab-case file stems per splat channel — the one place the on-disk names
 *  (`scripts/process-textures.mjs`'s output, `public/assets/textures/terrain/`)
 *  are spelled out. */
const TEXTURE_STEM: Record<SplatChannel, string> = {
  jungleFloor: "jungle-floor",
  leafLitter: "leaf-litter",
  rock: "rock",
  sand: "sand",
};

function albedoPath(channel: SplatChannel): string {
  return `${TEXTURE_DIR}${TEXTURE_STEM[channel]}-albedo.webp`;
}
function normalPath(channel: SplatChannel): string {
  return `${TEXTURE_DIR}${TEXTURE_STEM[channel]}-normal.webp`;
}
function uniformSuffix(channel: SplatChannel): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

/**
 * Build the island terrain for The Lost Idol (pivot slice C; PBR splatting,
 * visual-overhaul slice 3).
 *
 * `heightAt` is the contract: a continuous height field combining fractal noise
 * with a radial island falloff (coastline), a **northern highland** (the river's
 * source country), a **river channel** carved along `RIVER.points` and a
 * **lagoon** basin at the south shore — both carved below sea level so the
 * single water plane fills them — plus a cleared, flattened pad at the camp.
 * The mesh just samples it on a grid. **Unchanged by this slice** — every
 * gameplay-relevant sample (movement, props, sites, wildlife) reads the exact
 * same height field as before.
 *
 * What DOES change is the surface: vertex colours still band the surface
 * river-mud → jungle floor → deep jungle → highland rock by elevation (the
 * same `colorForHeight`), but they now serve as a MACRO TINT over 4 real CC0
 * ground textures (jungle floor / leaf litter / rock / sand,
 * `public/assets/LICENSES.md`), splatted by a per-vertex blend
 * (`terrainSplat.ts`) driven by the same height bands plus slope (steep
 * ground reads as rock regardless of elevation) and noise (mottling the
 * jungle-floor/leaf-litter split, same idiom as the old lightness mottle). The
 * mesh is smooth-shaded (`computeVertexNormals`, no more `flatShading`) so the
 * normal-mapped detail (medium/high) has a continuous surface to perturb.
 *
 * Texture loading is ASYNC: `buildTerrain` returns immediately with the
 * vertex-colour look rendering (today's look, unchanged) while the 4 (+4
 * normal, medium/high) textures load in the background; `texturesReady`
 * resolves once they attach (or the load fails and is logged) — see
 * `attachTerrainTextures`.
 */
export function buildTerrain(
  quality: Pick<QualityConfig, "terrainDetail" | "terrainAnisotropy"> = QUALITY_TIERS.high,
  loadTerrainTexture: TerrainTextureLoader = loadTexture,
): Terrain {
  const noise = makeNoise2D(WORLD.seed);
  const { coastRadius, islandRadius, maxHeight, landBase, shoreDrop, highlandBoost, campClearRadius } =
    WORLD;

  const heightAt = (x: number, z: number): number => {
    const d = Math.hypot(x, z);
    // Island mask: a full-height plateau out to coastRadius, then a smooth ramp
    // down past islandRadius. Keeps the whole interior (and every site) on
    // solid land, with the coastline confined to the outer ring.
    const mask =
      d <= coastRadius
        ? 1
        : d >= islandRadius
          ? 0
          : smooth(1 - (d - coastRadius) / (islandRadius - coastRadius));

    const hills = noise.fbm(x * 0.006 + 100, z * 0.006 - 50, 5); // broad relief
    const ridges = Math.pow(noise.fbm(x * 0.013, z * 0.013, 3), 2); // sharper tops
    // The highland: relief swells toward the far north, where the river rises.
    const north = smooth(clamp01((-z - 30) / 130));
    const relief = (hills * 0.7 + ridges * 0.5) * maxHeight + north * highlandBoost;

    // Land base keeps inland valleys above water; shoreDrop sinks the masked rim.
    let h = landBase + relief * mask - shoreDrop * (1 - mask);

    // The lagoon: a basin blended in around its centre, carved below sea level.
    const dl = Math.hypot(x - LAGOON.x, z - LAGOON.z);
    if (dl < LAGOON.radius + LAGOON.shoreRamp) {
      const bed = WORLD.seaLevel - LAGOON.depth;
      const t = clamp01((dl - LAGOON.radius) / LAGOON.shoreRamp);
      h = bed + (h - bed) * smooth(t);
    }

    // The river: carve a channel along the course. Distance to the polyline
    // blends from full-depth bed (inside bedHalfWidth) back to the untouched
    // terrain (past bankHalfWidth) — banks form naturally through any relief.
    const dr = distToRiver(x, z);
    if (dr < RIVER.bankHalfWidth) {
      const bed = WORLD.seaLevel - RIVER.depth;
      const t = clamp01((dr - RIVER.bedHalfWidth) / (RIVER.bankHalfWidth - RIVER.bedHalfWidth));
      const carved = bed + (h - bed) * smooth(t);
      h = Math.min(h, carved);
    }

    // The camp clearing: ease toward a gentle, near-flat pad (kept just above
    // the lagoon shore blend so the tents stay dry).
    const dc = Math.hypot(x - SPAWN.x, z - SPAWN.z);
    if (dc < campClearRadius * 1.8) {
      const t = clamp01(dc / (campClearRadius * 1.8));
      const pad = landBase + 0.4;
      h = pad + (h - pad) * smooth(t);
    }
    return h;
  };

  const geo = new THREE.PlaneGeometry(
    WORLD.size,
    WORLD.size,
    WORLD.segments,
    WORLD.segments,
  );
  geo.rotateX(-Math.PI / 2); // lie flat in the XZ plane

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    colorForHeight(y, x, z, noise, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Splat weights (visual-overhaul slice 3): a second pass, now that per-vertex
  // normals exist (smooth shading — no more `flatShading`), packs the
  // CPU-computed texture-blend weights (`terrainSplat.ts`) into a vec4
  // attribute; the material patch's fragment shader interpolates it and blends
  // 4 albedo (+4 normal, medium/high) samples by it. Reads the SAME detail
  // noise sample `colorForHeight`'s mottle does (`fbm(x*0.05+7, z*0.05-3, 2)`)
  // so the texture read and the surviving vertex-colour tint mottle together
  // rather than fighting each other.
  const normalAttr = geo.attributes.normal as THREE.BufferAttribute;
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const slope = slopeFromNormalY(normalAttr.getY(i));
    const detailNoise = noise.fbm(x * 0.05 + 7, z * 0.05 - 3, 2);
    const [r, g, b, a] = packSplatWeights(computeSplatWeights(y, slope, detailNoise));
    splat[i * 4] = r;
    splat[i * 4 + 1] = g;
    splat[i * 4 + 2] = b;
    splat[i * 4 + 3] = a;
  }
  geo.setAttribute("splatWeight", new THREE.BufferAttribute(splat, 4));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";

  let disposed = false;
  // Populated by `attachTerrainTextures` the moment it attaches (the happy
  // path) so `dispose()` below can release the GPU-uploaded textures too —
  // the unmount-race branch already disposes its own load-in-flight textures,
  // this array only ever fills on a successful attach.
  const attachedTextures: THREE.Texture[] = [];
  const texturesReady = attachTerrainTextures(mat, quality, loadTerrainTexture, () => disposed, attachedTextures);

  return {
    mesh,
    heightAt,
    texturesReady,
    dispose() {
      disposed = true;
      geo.dispose();
      mat.dispose();
      for (const tex of attachedTextures) tex.dispose();
    },
  };
}

/**
 * Load the 4 albedo (+4 normal, `terrainDetail === "full"`) ground textures and
 * attach them to the terrain material in ONE atomic step: builds the uniform
 * bag, wires `mat.onBeforeCompile`/`customProgramCacheKey` from
 * `makeTerrainMaterialPatch`, and flips `mat.needsUpdate` — the single
 * recompile the design accepts happening once, at load. Never rejects: a
 * failed load is logged and the vertex-colour look simply never upgrades
 * (same degrade-quietly idiom `GameCanvas`'s lazy compositor load follows).
 *
 * `isDisposed` guards the unmount race: if `Terrain.dispose()` ran while the
 * load was in flight, the just-uploaded textures are disposed instead of
 * attached to a dead material — no GPU leak from a fast mount/unmount.
 *
 * `outAttachedTextures` collects every texture on a successful attach (the
 * `props.ts` explicit-texture-dispose convention) so the caller's
 * `Terrain.dispose()` can release them too on the happy path — the unmount-
 * race branch above disposes its own textures directly and never pushes here.
 */
function attachTerrainTextures(
  mat: THREE.MeshStandardMaterial,
  quality: Pick<QualityConfig, "terrainDetail" | "terrainAnisotropy">,
  loadTerrainTexture: TerrainTextureLoader,
  isDisposed: () => boolean,
  outAttachedTextures: THREE.Texture[],
): Promise<void> {
  const hasNormalMaps = quality.terrainDetail === "full";

  return Promise.all([
    Promise.all(SPLAT_CHANNELS.map((ch) => loadTerrainTexture(albedoPath(ch)))),
    hasNormalMaps
      ? Promise.all(SPLAT_CHANNELS.map((ch) => loadTerrainTexture(normalPath(ch))))
      : Promise.resolve<THREE.Texture[]>([]),
  ])
    .then(([albedoTextures, normalTextures]) => {
      if (isDisposed()) {
        for (const tex of [...albedoTextures, ...normalTextures]) tex.dispose();
        return;
      }

      const uniforms: Record<string, { value: unknown }> = {};
      SPLAT_CHANNELS.forEach((ch, i) => {
        const tex = albedoTextures[i];
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = quality.terrainAnisotropy;
        uniforms[`uAlbedo${uniformSuffix(ch)}`] = { value: tex };
      });
      if (hasNormalMaps) {
        SPLAT_CHANNELS.forEach((ch, i) => {
          const tex = normalTextures[i];
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = quality.terrainAnisotropy;
          // Normal-map data is NOT perceptual colour — it must never go
          // through an sRGB decode, so override `loadTexture`'s colour-map
          // default (docs/asset-pipeline.md's sRGB-tagging is for albedo).
          tex.colorSpace = THREE.NoColorSpace;
          uniforms[`uNormal${uniformSuffix(ch)}`] = { value: tex };
        });
      }

      const patch = makeTerrainMaterialPatch({ hasNormalMaps, uniforms });
      mat.onBeforeCompile = patch.onBeforeCompile;
      mat.customProgramCacheKey = patch.customProgramCacheKey;
      mat.needsUpdate = true;
      outAttachedTextures.push(...albedoTextures, ...normalTextures);
    })
    .catch((err: unknown) => {
      console.error("terrain textures failed to load — keeping the vertex-colour fallback:", err);
    });
}

/** Horizontal distance from (x,z) to the river polyline (min over segments). */
export function distToRiver(x: number, z: number): number {
  const pts = RIVER.points;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const apx = x - a.x;
    const apz = z - a.z;
    const lenSq = abx * abx + abz * abz;
    const t = lenSq > 0 ? clamp01((apx * abx + apz * abz) / lenSq) : 0;
    const dx = apx - abx * t;
    const dz = apz - abz * t;
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  return best;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Elevation → jungle colour band, with a little noise-driven mottling so the
 *  floor doesn't read as one flat green sheet. Mutates and returns `out`.
 *  Survives PBR splatting as the macro tint the splatted albedo is multiplied
 *  by (`terrainMaterialPatch.ts`'s ordering: our albedo write lands before
 *  three's own `diffuseColor.rgb *= vColor`) — unchanged by this slice. */
function colorForHeight(
  y: number,
  x: number,
  z: number,
  noise: { fbm(x: number, z: number, octaves: number): number },
  out: THREE.Color,
): THREE.Color {
  if (y < 0.7) {
    out.setHex(0x8a7a55); // river mud / wet sand at the waterline
  } else if (y < 12) {
    out.setHex(0x3f6b33); // jungle floor
  } else if (y < 20) {
    out.setHex(0x35592c); // deep jungle / wooded hills
  } else {
    out.setHex(0x6e6557); // highland rock above the treeline
  }
  // Mottle: ±8% lightness from slow noise — leaf litter, moss, damp patches.
  const m = (noise.fbm(x * 0.05 + 7, z * 0.05 - 3, 2) - 0.5) * 0.16;
  out.offsetHSL(0, 0, m);
  return out;
}
