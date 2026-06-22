import { describe, expect, it, vi } from "vitest";
import { loadContent, contentById } from "./contentModel.ts";
import type { PoiInteraction } from "./contentModel.ts";
import { buildDiscoverablePois } from "./discoverablePois.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import * as THREE from "three";

describe("PoiInteraction union (#34, M2)", () => {
  // Exhaustive switch over the full union: each arm narrows, and the `never`
  // default is a compile-time guard that fails to typecheck if a variant is
  // left unhandled (catches discriminant-vs-consumer drift).
  function describeInteraction(i: PoiInteraction): string {
    switch (i.type) {
      case "plain":
        return "plain";
      case "guess":
        return `guess:${i.prompt}:${i.options.length}`;
      case "highlight":
        return `highlight:${i.emphasis}`;
      default: {
        const _exhaustive: never = i;
        return _exhaustive;
      }
    }
  }

  it("accepts { type: 'plain' } without a cast and narrows exhaustively", () => {
    const i: PoiInteraction = { type: "plain" };
    expect(describeInteraction(i)).toBe("plain");
  });
});

describe("content model (#34)", () => {
  it("loads 13 validated POIs with required string fields", () => {
    const set = loadContent();
    expect(set.pois).toHaveLength(13);
    for (const p of set.pois) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.teaser.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
      // The current dataset carries no interaction, so every POI resolves to
      // the default `plain` variant — guards against silent content drift.
      expect(p.interaction).toEqual({ type: "plain" });
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

  it("resolves every real anchor without throwing", () => {
    expect(() => buildDiscoverablePois(() => new THREE.Vector3())).not.toThrow();
  });
});

// Exercise the safety net: if content is missing for an anchor, binding throws
// rather than silently dropping a landmark's reveal.
describe("POI binding throw path", () => {
  it("throws when an anchor has no matching content", async () => {
    vi.resetModules();
    vi.doMock("./contentModel.ts", () => ({
      contentById: () => new Map(), // no content for any anchor
    }));
    const { buildDiscoverablePois: bind } = await import("./discoverablePois.ts");
    expect(() => bind(() => new THREE.Vector3())).toThrow(/no content for anchor/);
    vi.doUnmock("./contentModel.ts");
    vi.resetModules();
  });
});
