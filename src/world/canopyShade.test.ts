import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  OPEN_FLOOR_MAX,
  SHADE_MAX,
  applyCanopyShade,
  applyOpenFloorShade,
  coverageGrid,
  lowBandWeight,
} from "./canopyShade.ts";
import { buildProps } from "./props.ts";
import { buildTerrain } from "./terrain.ts";

function flatColoredPlane(size = 40, segments = 20): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3).fill(1);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A flat colored plane lifted to a fixed world height `y` — lets the
 *  open-floor tests place ground in (or out of) the low elevation band. */
function coloredPlaneAtHeight(y: number, size = 40, segments = 20): THREE.BufferGeometry {
  const geo = flatColoredPlane(size, segments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, y);
  pos.needsUpdate = true;
  return geo;
}

describe("coverageGrid", () => {
  it("is full under a crown centre, fades toward the rim, zero beyond", () => {
    const grid = coverageGrid([{ x: 0, z: 0, r: 3 }]);
    expect(grid.get(0, 0)).toBeGreaterThan(0.8);
    expect(grid.get(2.4, 0)).toBeGreaterThan(0);
    expect(grid.get(2.4, 0)).toBeLessThan(grid.get(0, 0));
    expect(grid.get(8, 0)).toBe(0);
  });

  it("overlapping crowns saturate at 1 — a grove is dark, never over-dark", () => {
    const crowns = [
      { x: 0, z: 0, r: 3 },
      { x: 1, z: 0, r: 3 },
      { x: 0, z: 1, r: 3 },
      { x: 1, z: 1, r: 3 },
    ];
    const grid = coverageGrid(crowns);
    expect(grid.get(0.5, 0.5)).toBeLessThanOrEqual(1);
    expect(grid.get(0.5, 0.5)).toBeGreaterThan(0.9);
  });
});

describe("applyCanopyShade", () => {
  it("darkens ground under crowns, leaves open ground untouched, never exceeds SHADE_MAX", () => {
    const geo = flatColoredPlane();
    applyCanopyShade(geo, [{ x: 0, z: 0, r: 4 }]);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    let shadedMin = 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const g = col.getY(i);
      const d = Math.hypot(x, z);
      if (d < 1) shadedMin = Math.min(shadedMin, g);
      if (d > 8) expect(g).toBe(1); // open ground untouched
      expect(g).toBeGreaterThanOrEqual(1 - SHADE_MAX - 1e-6);
    }
    expect(shadedMin).toBeLessThan(1 - SHADE_MAX * 0.5); // real darkening under the crown
  });

  it("shades green-biased: red drops at least as much as green (jungle shade, not soot)", () => {
    const geo = flatColoredPlane();
    applyCanopyShade(geo, [{ x: 0, z: 0, r: 4 }]);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i), pos.getZ(i)) < 1) {
        expect(col.getX(i)).toBeLessThanOrEqual(col.getY(i) + 1e-6);
      }
    }
  });

  it("flags the color attribute for re-upload (version bump)", () => {
    const geo = flatColoredPlane();
    const col = geo.attributes.color as THREE.BufferAttribute;
    const before = col.version;
    applyCanopyShade(geo, [{ x: 0, z: 0, r: 4 }]);
    expect(col.version).toBeGreaterThan(before);
  });
});

describe("lowBandWeight", () => {
  it("is zero on the waterline-mud band and the highland band, positive in between", () => {
    expect(lowBandWeight(0.3)).toBe(0); // wet sand / river mud — leave alone
    expect(lowBandWeight(0.7)).toBe(0); // exactly the mud/floor boundary
    expect(lowBandWeight(12)).toBe(0); // exactly the floor/deep-jungle boundary
    expect(lowBandWeight(15)).toBe(0); // highland rock — leave alone
    expect(lowBandWeight(6)).toBeGreaterThan(0.9); // valley floor core — full weight
  });

  it("ramps smoothly in from the waterline and out toward the deep-jungle band", () => {
    // Monotone non-decreasing rising off the low edge, non-increasing toward
    // the top edge — no hard seam where the wash meets mud or deep jungle.
    expect(lowBandWeight(1.2)).toBeGreaterThan(lowBandWeight(0.8));
    expect(lowBandWeight(6)).toBeGreaterThanOrEqual(lowBandWeight(1.2));
    expect(lowBandWeight(11.5)).toBeLessThan(lowBandWeight(9));
  });
});

describe("applyOpenFloorShade", () => {
  it("deepens open low-band ground, never past OPEN_FLOOR_MAX", () => {
    const geo = coloredPlaneAtHeight(6);
    applyOpenFloorShade(geo, []); // no canopy anywhere → fully open
    const col = geo.attributes.color;
    let minGreen = 1;
    for (let i = 0; i < col.count; i++) minGreen = Math.min(minGreen, col.getY(i));
    expect(minGreen).toBeLessThan(1 - OPEN_FLOOR_MAX * 0.5); // real deepening
    expect(minGreen).toBeGreaterThanOrEqual(1 - OPEN_FLOOR_MAX - 1e-6);
  });

  it("deepens green-biased: red drops at least as much as green (lush, not muddy)", () => {
    const geo = coloredPlaneAtHeight(6);
    applyOpenFloorShade(geo, []);
    const col = geo.attributes.color;
    for (let i = 0; i < col.count; i++) {
      expect(col.getX(i)).toBeLessThanOrEqual(col.getY(i) + 1e-6);
    }
  });

  it("leaves the waterline-mud and highland bands untouched", () => {
    for (const y of [0.3, 15]) {
      const geo = coloredPlaneAtHeight(y);
      applyOpenFloorShade(geo, []);
      const col = geo.attributes.color;
      for (let i = 0; i < col.count; i++) {
        expect(col.getX(i)).toBe(1);
        expect(col.getY(i)).toBe(1);
        expect(col.getZ(i)).toBe(1);
      }
    }
  });

  it("keys off (1 − coverage): under a crown stays near-open-bright, the open rim deepens", () => {
    const geo = coloredPlaneAtHeight(6);
    // One crown blankets the centre; the plane's rim (d > 8) is open.
    applyOpenFloorShade(geo, [{ x: 0, z: 0, r: 6 }]);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    let coveredGreen = 0; // near the crown centre — should barely deepen
    let openGreen = 1; // out past the crown — should deepen most
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      const g = col.getY(i);
      if (d < 1) coveredGreen = Math.max(coveredGreen, g);
      if (d > 12) openGreen = Math.min(openGreen, g);
    }
    expect(coveredGreen).toBeGreaterThan(openGreen); // shaded ground kept brighter
    expect(coveredGreen).toBeGreaterThan(1 - OPEN_FLOOR_MAX * 0.3); // barely touched under canopy
  });

  it("is monotonic in coverage — more open ⇒ deeper", () => {
    const geo = coloredPlaneAtHeight(6);
    applyOpenFloorShade(geo, [{ x: 0, z: 0, r: 10 }]);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    // Green falls off with distance from the crown centre (coverage drops,
    // openness rises) across the covered→rim gradient.
    const near = sampleGreenAt(pos, col, 0, 0);
    const mid = sampleGreenAt(pos, col, 6, 0);
    const far = sampleGreenAt(pos, col, 14, 0);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it("composes with applyCanopyShade: open floor deepens only where canopy shade did not", () => {
    // Under a full crown, canopy shade owns the darkening and open-floor adds
    // almost nothing; in the open, the reverse. Apply both and compare against
    // canopy-shade-alone at a covered vertex.
    const both = coloredPlaneAtHeight(6);
    applyCanopyShade(both, [{ x: 0, z: 0, r: 6 }]);
    applyOpenFloorShade(both, [{ x: 0, z: 0, r: 6 }]);

    const canopyOnly = coloredPlaneAtHeight(6);
    applyCanopyShade(canopyOnly, [{ x: 0, z: 0, r: 6 }]);

    const bothCentre = sampleGreenAt(both.attributes.position, both.attributes.color, 0, 0);
    const canopyCentre = sampleGreenAt(
      canopyOnly.attributes.position,
      canopyOnly.attributes.color,
      0,
      0,
    );
    // Open-floor barely perturbs the fully-shaded centre (coverage≈1 ⇒ open≈0).
    expect(Math.abs(bothCentre - canopyCentre)).toBeLessThan(0.03);
  });

  it("flags the color attribute for re-upload (version bump)", () => {
    const geo = coloredPlaneAtHeight(6);
    const col = geo.attributes.color as THREE.BufferAttribute;
    const before = col.version;
    applyOpenFloorShade(geo, []);
    expect(col.version).toBeGreaterThan(before);
  });
});

type AttrLike = Pick<THREE.BufferAttribute, "count" | "getX" | "getY" | "getZ">;

function sampleGreenAt(pos: AttrLike, col: AttrLike, x: number, z: number): number {
  let best = Infinity;
  let green = 1;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i) - x, pos.getZ(i) - z);
    if (d < best) {
      best = d;
      green = col.getY(i);
    }
  }
  return green;
}

describe("props canopyCrowns", () => {
  it("exposes one crown per placed canopy tree, radii scaled to the instance", () => {
    const terrain = buildTerrain();
    const props = buildProps(terrain);
    let trunks = 0;
    props.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name === "canopy-trunk") trunks = o.count;
    });
    expect(props.canopyCrowns.length).toBe(trunks);
    for (const c of props.canopyCrowns) {
      expect(c.r).toBeGreaterThan(0.8);
      expect(c.r).toBeLessThan(6);
      expect(Number.isFinite(c.x + c.z)).toBe(true);
    }
    props.dispose();
  });
});
