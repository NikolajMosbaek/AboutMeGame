import * as THREE from "three";
import { makeNoise2D } from "./noise.ts";
import { WORLD } from "./worldConfig.ts";

export interface Terrain {
  /** The renderable mesh (flat-shaded, vertex-coloured low-poly). */
  mesh: THREE.Mesh;
  /** Ground height at any world (x,z). Pure — Epic 3 movement follows it and
   *  Epic 2 props/landmarks sit on it. Below sea level means underwater. */
  heightAt(x: number, z: number): number;
  dispose(): void;
}

/**
 * Build the island terrain (#17 mesh/heightmap, #18 materials).
 *
 * `heightAt` is the contract: a continuous height field combining fractal noise
 * (rolling hills + sharper ridges) with a radial island falloff that sinks the
 * edges below sea level into a coastline, and a flattened spawn plaza at the
 * origin. The mesh just samples it on a grid. Vertex colours band the surface
 * sand → grass → rock → snow by elevation; `flatShading` gives the faceted
 * low-poly look the art direction calls for, so no terrain textures are
 * downloaded (kind to the asset budget).
 */
export function buildTerrain(): Terrain {
  const noise = makeNoise2D(WORLD.seed);
  const { coastRadius, islandRadius, maxHeight, landBase, shoreDrop, spawnPlazaRadius } =
    WORLD;

  const heightAt = (x: number, z: number): number => {
    const d = Math.hypot(x, z);
    // Island mask: a full-height plateau out to coastRadius, then a smooth ramp
    // down to 0 at islandRadius. Keeps the whole interior (and every POI) on
    // solid land, with the coastline confined to the outer ring.
    const mask =
      d <= coastRadius
        ? 1
        : d >= islandRadius
          ? 0
          : smooth(1 - (d - coastRadius) / (islandRadius - coastRadius));

    const hills = noise.fbm(x * 0.006 + 100, z * 0.006 - 50, 5); // broad relief
    const ridges = Math.pow(noise.fbm(x * 0.013, z * 0.013, 3), 2); // sharper tops
    const relief = (hills * 0.75 + ridges * 0.55) * maxHeight;

    // Land base keeps inland valleys above water; shoreDrop sinks the masked rim.
    let h = landBase + relief * mask - shoreDrop * (1 - mask);

    // Spawn plaza: ease toward a gentle, near-flat pad around the origin.
    if (d < spawnPlazaRadius * 1.6) {
      const t = clamp01(d / (spawnPlazaRadius * 1.6));
      const plaza = landBase + 0.5;
      h = plaza + (h - plaza) * smooth(t);
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
    colorForHeight(y, c);
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Elevation → stylised colour band. Mutates and returns `out`. */
function colorForHeight(y: number, out: THREE.Color): THREE.Color {
  if (y < 1.4) return out.setHex(0xd9c79a); // beach sand (coastal ramp)
  if (y < 13) return out.setHex(0x5b8f4a); // grass (most of the island)
  if (y < 22) return out.setHex(0x49753c); // deeper grass / wooded hills
  if (y < 28) return out.setHex(0x7a6f63); // rock — only the high ground
  return out.setHex(0xeef2f5); // snow caps — true peaks only
}
