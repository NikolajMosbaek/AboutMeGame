import * as THREE from "three";
import { makeNoise2D } from "./noise.ts";
import { WORLD, RIVER, LAGOON, SPAWN } from "./worldConfig.ts";

export interface Terrain {
  /** The renderable mesh (flat-shaded, vertex-coloured low-poly). */
  mesh: THREE.Mesh;
  /** Ground height at any world (x,z). Pure — movement follows it and
   *  props/sites sit on it. Below sea level means underwater. */
  heightAt(x: number, z: number): number;
  dispose(): void;
}

/**
 * Build the island terrain for The Lost Idol (pivot slice C).
 *
 * `heightAt` is the contract: a continuous height field combining fractal noise
 * with a radial island falloff (coastline), a **northern highland** (the river's
 * source country), a **river channel** carved along `RIVER.points` and a
 * **lagoon** basin at the south shore — both carved below sea level so the
 * single water plane fills them — plus a cleared, flattened pad at the camp.
 * The mesh just samples it on a grid. Vertex colours band the surface river-mud
 * → jungle floor → deep jungle → highland rock by elevation; `flatShading`
 * keeps the faceted look and the zero-texture terrain budget.
 */
export function buildTerrain(): Terrain {
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

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";

  return {
    mesh,
    heightAt,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
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
 *  floor doesn't read as one flat green sheet. Mutates and returns `out`. */
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
