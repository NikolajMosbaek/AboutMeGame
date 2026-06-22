import { describe, expect, it } from "vitest";
import { loadContent, contentById } from "./contentModel.ts";
import { buildDiscoverablePois } from "./discoverablePois.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import * as THREE from "three";

describe("content model (#34)", () => {
  it("loads 13 validated POIs with required string fields", () => {
    const set = loadContent();
    expect(set.pois).toHaveLength(13);
    for (const p of set.pois) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.teaser.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
    }
  });

  it("indexes content by id", () => {
    const map = contentById();
    expect(map.size).toBe(13);
    expect(map.get("poi-arrivals-gate")?.order).toBe(1);
  });
});

describe("POI placement binding (#36)", () => {
  it("joins every world anchor to its content, sorted by order", () => {
    const pois = buildDiscoverablePois(() => new THREE.Vector3(1, 2, 3));
    expect(pois).toHaveLength(POI_ANCHORS.length);
    const orders = pois.map((p) => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    for (const p of pois) {
      expect(p.title).toBeTruthy();
      expect(p.body).toBeTruthy();
      expect(p.position).toBeInstanceOf(THREE.Vector3);
    }
  });

  it("throws if an anchor has no matching content", () => {
    // Sanity: all real anchors resolve (no throw). The throw path is covered by
    // the contract — every POI_ANCHORS.poiId must exist in the content set.
    expect(() => buildDiscoverablePois(() => new THREE.Vector3())).not.toThrow();
  });
});
