import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildProps,
  CANOPY_TREE_COUNT,
  PALM_COUNT,
  UNDERSTORY_COUNT,
  ROCK_COUNT,
} from "./props.ts";
import { buildTerrain, distToRiver } from "./terrain.ts";
import { RIVER, SPAWN, WORLD } from "./worldConfig.ts";

/** Every `InstancedMesh` in the prop group, in insertion order. */
function instancedMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) out.push(o);
  });
  return out;
}

function byName(group: THREE.Group, name: string): THREE.InstancedMesh {
  const mesh = instancedMeshes(group).find((m) => m.name === name);
  if (!mesh) throw new Error(`no InstancedMesh named "${name}"`);
  return mesh;
}

/** Ground-anchored world positions (x/y/z) of every placed instance. */
function positionsOf(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(pos, q, s);
    out.push(pos.clone());
  }
  return out;
}

function totalInstances(group: THREE.Group): number {
  return instancedMeshes(group).reduce((sum, mesh) => sum + mesh.count, 0);
}

describe("buildProps jungle vegetation (pivot slice C)", () => {
  const terrain = buildTerrain();

  it("builds at most 12 draw calls (InstancedMesh children)", () => {
    const props = buildProps(terrain);
    expect(instancedMeshes(props.group).length).toBeLessThanOrEqual(12);
    props.dispose();
  });

  it("places a well-populated jungle at density 1 (default), within budget", () => {
    const props = buildProps(terrain);
    const total = totalInstances(props.group);
    const budget = CANOPY_TREE_COUNT * 2 + PALM_COUNT * 2 + UNDERSTORY_COUNT + ROCK_COUNT;
    expect(total).toBeGreaterThan(budget * 0.3);
    expect(total).toBeLessThanOrEqual(budget);
    props.dispose();
  });

  it("thins every layer on the low tier (~40% density)", () => {
    const full = buildProps(terrain, 1);
    const low = buildProps(terrain, 0.4);
    for (const name of ["canopy-trunk", "canopy-cross", "palm-trunk", "palm-frond", "understory", "rocks"]) {
      const f = byName(full.group, name).count;
      const l = byName(low.group, name).count;
      expect(l).toBeLessThan(f);
    }
    expect(totalInstances(low.group)).toBeLessThan(totalInstances(full.group));
    full.dispose();
    low.dispose();
  });

  it("never allocates zero instances in any layer, even at density 0", () => {
    const min = buildProps(terrain, 0);
    for (const name of ["canopy-trunk", "canopy-cross", "palm-trunk", "palm-frond", "understory", "rocks"]) {
      expect(byName(min.group, name).count).toBeGreaterThanOrEqual(1);
    }
    min.dispose();
  });

  it("never places a canopy tree, palm, understory plant or rock inside the river channel", () => {
    const props = buildProps(terrain);
    for (const name of ["canopy-trunk", "palm-trunk", "understory", "rocks"]) {
      for (const p of positionsOf(byName(props.group, name))) {
        expect(distToRiver(p.x, p.z)).toBeGreaterThanOrEqual(RIVER.bankHalfWidth + 1 - 1e-6);
      }
    }
    props.dispose();
  });

  it("never places a canopy tree, palm, understory plant or rock inside the camp clearing", () => {
    const props = buildProps(terrain);
    const clearRadius = WORLD.campClearRadius + 4;
    for (const name of ["canopy-trunk", "palm-trunk", "understory", "rocks"]) {
      for (const p of positionsOf(byName(props.group, name))) {
        const d = Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z);
        expect(d).toBeGreaterThanOrEqual(clearRadius - 1e-6);
      }
    }
    props.dispose();
  });

  it("places every instance within the world boundary", () => {
    const props = buildProps(terrain);
    for (const name of ["canopy-trunk", "palm-trunk", "understory", "rocks"]) {
      for (const p of positionsOf(byName(props.group, name))) {
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(WORLD.boundaryRadius - 4 + 1e-6);
      }
    }
    props.dispose();
  });

  it("exposes a ground point per solid prop (trees, palms, rocks — not understory)", () => {
    const props = buildProps(terrain);
    const trees = byName(props.group, "canopy-trunk").count;
    const palms = byName(props.group, "palm-trunk").count;
    const rocks = byName(props.group, "rocks").count;
    // One grounding point per solid placed instance; the (thousands of)
    // understory crosses are deliberately excluded (no visual gain).
    expect(props.groundPoints.length).toBe(trees + palms + rocks);
    for (const p of props.groundPoints) {
      expect(p.radius).toBeGreaterThan(0);
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
    props.dispose();
  });

  it("dispose() releases every geometry/material/texture without throwing", () => {
    const props = buildProps(terrain);
    const meshes = instancedMeshes(props.group);
    expect(() => props.dispose()).not.toThrow();
    // Geometry/material dispose is fire-and-forget (frees GPU buffers); the
    // meaningful assertion is that dispose runs clean over every layer.
    expect(meshes.length).toBeGreaterThan(0);
  });

  it("reads as JUNGLE, not parkland: the valley canopy closes at full density", () => {
    // User finding (2026-07-19): "it feels like an island with some trees
    // on". 450 trees over this island was one tree per ~190 m² — open
    // woodland. Canopy closure needs both count and crown size.
    const props = buildProps(terrain);
    expect(byName(props.group, "canopy-trunk").count).toBeGreaterThanOrEqual(650);
    props.dispose();
  });

  it("crowds the jungle floor: understory in the thousands at full density", () => {
    const props = buildProps(terrain);
    expect(byName(props.group, "understory").count).toBeGreaterThanOrEqual(1800);
    props.dispose();
  });

  it("breaks sightlines at eye height: a fair share of the understory is TALL ferns", () => {
    // Enclosure comes from foliage at eye level, not knee level. Roughly a
    // third of the understory should stand 1.8×+ scale (≈ 2.2 u+ tall).
    const props = buildProps(terrain);
    const mesh = byName(props.group, "understory");
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let tall = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      if (s.y >= 1.8) tall++;
    }
    const share = tall / mesh.count;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.45); // still a MIX — not a wall of ferns
    props.dispose();
  });

  it("without fullFoliage (the low tier) keeps the ORIGINAL silhouettes: no tall ferns, original crown band", () => {
    // Low is fill-rate bound — its floor is the original cutout area, not
    // just the original instance count. fullFoliage=false must reproduce the
    // pre-epic scale bands exactly.
    const props = buildProps(terrain, 0.2, false);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const under = byName(props.group, "understory");
    for (let i = 0; i < under.count; i++) {
      under.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(s.y).toBeLessThanOrEqual(1.3 + 1e-6);
    }
    const trunks = byName(props.group, "canopy-trunk");
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(s.y).toBeLessThanOrEqual(1.3 + 1e-6);
    }
    props.dispose();
  });

  it("tall ferns only stand on near-flat ground — no floating footprints on slopes", () => {
    const props = buildProps(terrain);
    const under = byName(props.group, "understory");
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < under.count; i++) {
      under.getMatrixAt(i, m);
      m.decompose(p, q, s);
      if (s.y < 1.8) continue; // regular shrubs may sit on rougher ground
      // Local relief within ~1.5 u of the base stays shallow (the placement
      // slope guard) — the fern's footprint can't float off a hillside.
      const y0 = terrain.heightAt(p.x, p.z);
      for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]] as const) {
        expect(Math.abs(terrain.heightAt(p.x + dx, p.z + dz) - y0)).toBeLessThan(1.2);
      }
    }
    props.dispose();
  });

  it("is deterministic: two builds place identical first-instance transforms per layer", () => {
    const a = buildProps(terrain);
    const b = buildProps(terrain);
    for (const name of ["canopy-trunk", "canopy-cross", "palm-trunk", "palm-frond", "understory", "rocks"]) {
      const ma = byName(a.group, name);
      const mb = byName(b.group, name);
      expect(mb.count).toBe(ma.count);
      const m1 = new THREE.Matrix4();
      const m2 = new THREE.Matrix4();
      ma.getMatrixAt(0, m1);
      mb.getMatrixAt(0, m2);
      expect(m2.toArray()).toEqual(m1.toArray());
    }
    a.dispose();
    b.dispose();
  });
});
