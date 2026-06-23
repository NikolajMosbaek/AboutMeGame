import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  A1,
  A2,
  FOAM_DEPTH_END,
  FOAM_DEPTH_START,
  WATER_DEEP,
  WATER_SHALLOW,
  clamp01,
  shorelineFoam,
  smoothstep,
  waterColor,
  waveHeight,
} from "./waterSurface.ts";

// Directory of THIS test file, used to read source for the static (grep-style)
// isolation/tree-shaking guards below. Declared up top so the `describe`
// factories — which run synchronously at registration — can read it.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Strip `//` and block comments only, preserving string/template literals.
 * Used by the import scan (which must read the quoted module specifier) so a
 * commented-out `import "three"` is ignored but a real one is not. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments (incl. jsdoc)
    .replace(/\/\/[^\n]*/g, " "); // line comments
}

/** Strip comments AND string/template literals so keyword scans (`three`,
 * `document`, `Math.random`, …) don't trip over prose in jsdoc or token
 * strings like `#2e6f9e`. Destroys import specifiers — never use it for the
 * import scan; use {@link stripComments} there. */
function stripCommentsAndStrings(src: string): string {
  return stripComments(src)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, "``"); // template literals
}

/** Collect the module specifier of every `import ... from "x"` / `import "x"` /
 * dynamic `import("x")` / `require("x")` in code (comments stripped, strings
 * preserved so the specifier survives). */
function importSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const specs: string[] = [];
  const patterns = [
    /\bimport\b[^;]*?\bfrom\s*["']([^"']+)["']/g, // import ... from "x"
    /\bimport\s*["']([^"']+)["']/g, // bare import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("smoothstep (GLSL-equivalent)", () => {
  it("clamps both tails", () => {
    // Below edge0 → 0, above edge1 → 1, exactly at the edges too.
    expect(smoothstep(2, 5, -10)).toBe(0);
    expect(smoothstep(2, 5, 2)).toBe(0);
    expect(smoothstep(2, 5, 5)).toBe(1);
    expect(smoothstep(2, 5, 100)).toBe(1);
  });

  it("is monotonic non-decreasing across the band", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const x = 2 + (5 - 2) * (i / 20);
      const v = smoothstep(2, 5, x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("hits the cubic midpoint at the band centre", () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("clamp01", () => {
  it("pins out-of-range values to [0,1]", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(7)).toBe(1);
  });
});

describe("waveHeight (two-sine swell)", () => {
  it("stays within |h| <= A1 + A2 over a sampled (x,z,t) grid", () => {
    const bound = A1 + A2;
    // Fractional and negative coords, several times — the construction bound
    // must hold everywhere.
    for (let xi = -4; xi <= 4; xi++) {
      for (let zi = -4; zi <= 4; zi++) {
        for (let ti = 0; ti <= 6; ti++) {
          const x = xi * 3.7 - 0.25;
          const z = zi * 2.9 + 0.5;
          const t = ti * 0.83;
          const h = waveHeight(x, z, t);
          expect(Number.isFinite(h)).toBe(true);
          expect(Math.abs(h)).toBeLessThanOrEqual(bound + 1e-9);
        }
      }
    }
  });

  it("varies across two distinct t at a fixed position", () => {
    const a = waveHeight(2.5, -1.3, 0);
    const b = waveHeight(2.5, -1.3, 1.7);
    expect(a).not.toBe(b);
  });

  it("varies across two distinct positions at a fixed t", () => {
    const a = waveHeight(1.1, 0.4, 0.9);
    const b = waveHeight(-2.3, 3.6, 0.9);
    expect(a).not.toBe(b);
  });

  it("is deterministic for identical args (incl. fractional/negative)", () => {
    expect(waveHeight(-3.14, 2.72, 0.5)).toBe(waveHeight(-3.14, 2.72, 0.5));
  });
});

describe("water palette", () => {
  it("WATER_SHALLOW is the #2e6f9e Water token in sRGB 0..1", () => {
    expect(WATER_SHALLOW[0]).toBeCloseTo(0x2e / 255, 6);
    expect(WATER_SHALLOW[1]).toBeCloseTo(0x6f / 255, 6);
    expect(WATER_SHALLOW[2]).toBeCloseTo(0x9e / 255, 6);
  });

  it("WATER_DEEP is darker than WATER_SHALLOW per channel", () => {
    expect(WATER_DEEP[0]).toBeLessThan(WATER_SHALLOW[0]);
    expect(WATER_DEEP[1]).toBeLessThan(WATER_SHALLOW[1]);
    expect(WATER_DEEP[2]).toBeLessThan(WATER_SHALLOW[2]);
  });

  it("both blues are in-gamut sRGB tuples", () => {
    for (const c of [...WATER_SHALLOW, ...WATER_DEEP]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("waterColor (art-direction depth/fresnel ramp)", () => {
  it("fresnel=0 (head-on) channel-equals WATER_SHALLOW", () => {
    const out: [number, number, number] = [0, 0, 0];
    waterColor(0, out);
    expect(out[0]).toBeCloseTo(WATER_SHALLOW[0], 6);
    expect(out[1]).toBeCloseTo(WATER_SHALLOW[1], 6);
    expect(out[2]).toBeCloseTo(WATER_SHALLOW[2], 6);
  });

  it("fresnel=1 (grazing) channel-equals WATER_DEEP", () => {
    const out: [number, number, number] = [0, 0, 0];
    waterColor(1, out);
    expect(out[0]).toBeCloseTo(WATER_DEEP[0], 6);
    expect(out[1]).toBeCloseTo(WATER_DEEP[1], 6);
    expect(out[2]).toBeCloseTo(WATER_DEEP[2], 6);
  });

  it("fresnel=0.5 is a monotonic blend strictly between the endpoints per channel", () => {
    const out: [number, number, number] = [0, 0, 0];
    waterColor(0.5, out);
    for (let c = 0; c < 3; c++) {
      const lo = Math.min(WATER_SHALLOW[c], WATER_DEEP[c]);
      const hi = Math.max(WATER_SHALLOW[c], WATER_DEEP[c]);
      expect(out[c]).toBeGreaterThan(lo);
      expect(out[c]).toBeLessThan(hi);
      // Linear mix at 0.5 is the exact per-channel midpoint.
      expect(out[c]).toBeCloseTo((WATER_SHALLOW[c] + WATER_DEEP[c]) / 2, 6);
    }
  });

  it("writes into and returns the caller-owned out (allocates nothing)", () => {
    const out: [number, number, number] = [9, 9, 9];
    const ret = waterColor(0.3, out);
    expect(ret).toBe(out);
  });

  it("is deterministic for identical args", () => {
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    waterColor(0.37, a);
    waterColor(0.37, b);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
    expect(a[2]).toBe(b[2]);
  });

  it("clamps out-of-range and degenerate fresnel to a finite, in-gamut colour", () => {
    const out: [number, number, number] = [0, 0, 0];
    for (const f of [-3, 7, NaN, Infinity, -Infinity]) {
      waterColor(f, out);
      for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(out[c])).toBe(true);
        expect(out[c]).toBeGreaterThanOrEqual(0);
        expect(out[c]).toBeLessThanOrEqual(1);
      }
    }
    // Above-range fresnel clamps to the deep endpoint.
    waterColor(7, out);
    expect(out[0]).toBeCloseTo(WATER_DEEP[0], 6);
    // Below-range fresnel clamps to the shallow endpoint.
    waterColor(-3, out);
    expect(out[0]).toBeCloseTo(WATER_SHALLOW[0], 6);
  });
});

describe("shorelineFoam (1 - smoothstep(START, END, depth))", () => {
  it("uses the sanctioned edge order START < END (no reversed-edge form)", () => {
    expect(FOAM_DEPTH_START).toBeLessThan(FOAM_DEPTH_END);
  });

  it("is ~0 in deep/open water (depth >= FOAM_DEPTH_END)", () => {
    expect(shorelineFoam(FOAM_DEPTH_END)).toBe(0);
    expect(shorelineFoam(FOAM_DEPTH_END + 0.5)).toBe(0);
    expect(shorelineFoam(50)).toBe(0);
  });

  it("ramps to the foam value (1) at the shore (depth = FOAM_DEPTH_START)", () => {
    expect(shorelineFoam(FOAM_DEPTH_START)).toBe(1);
  });

  it("is monotonic non-decreasing as depth decreases toward shore", () => {
    // Walk from open water in toward the shore; foam must never drop.
    let prev = -Infinity;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      // depth goes high → low across the band as i grows
      const depth = FOAM_DEPTH_END - (FOAM_DEPTH_END - FOAM_DEPTH_START) * (i / steps);
      const v = shorelineFoam(depth);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("hits a partial foam value strictly between 0 and 1 inside the band", () => {
    const mid = (FOAM_DEPTH_START + FOAM_DEPTH_END) / 2;
    const v = shorelineFoam(mid);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it("equals the clamped tails exactly beyond both edges", () => {
    // Past FOAM_DEPTH_END → exactly 0; at/under FOAM_DEPTH_START → exactly the
    // full foam value (1).
    expect(shorelineFoam(FOAM_DEPTH_END + 100)).toBe(0);
    expect(shorelineFoam(FOAM_DEPTH_START - 100)).toBe(1);
  });

  it("keeps degenerate/negative depth finite and in-gamut [0,1]", () => {
    for (const d of [-5, NaN, Infinity, -Infinity]) {
      const v = shorelineFoam(d);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for identical args (incl. fractional)", () => {
    expect(shorelineFoam(0.73)).toBe(shorelineFoam(0.73));
  });
});

// --- T5: cross-function determinism + degenerate-input guard ---------------
// One consolidated suite proving every exported function is pure and total:
// a second identical call returns bit-identical output (`toBe`), including
// fractional/negative coords, and NaN/Infinity/out-of-range fresnel and depth
// flow through the clamps to finite, in-gamut results. No Math.random/Date.now.
describe("determinism across all exports", () => {
  it("waveHeight returns toBe-identical output on a second identical call (fractional/negative)", () => {
    const cases: Array<[number, number, number]> = [
      [-3.14, 2.72, 0.5],
      [0.0, 0.0, 0.0],
      [-12.7, -8.3, 4.21],
      [7.77, -0.001, 19.9],
    ];
    for (const [x, z, t] of cases) {
      expect(waveHeight(x, z, t)).toBe(waveHeight(x, z, t));
    }
  });

  it("waterColor returns toBe-identical channels on a second identical call (fractional)", () => {
    for (const f of [-0.4, 0.0, 0.137, 0.5, 1.0, 1.6]) {
      const a: [number, number, number] = [0, 0, 0];
      const b: [number, number, number] = [0, 0, 0];
      waterColor(f, a);
      waterColor(f, b);
      expect(a[0]).toBe(b[0]);
      expect(a[1]).toBe(b[1]);
      expect(a[2]).toBe(b[2]);
    }
  });

  it("shorelineFoam returns toBe-identical output on a second identical call (fractional/negative)", () => {
    for (const d of [-2.5, 0.0, 0.31, 0.73, 1.49, 12.3]) {
      expect(shorelineFoam(d)).toBe(shorelineFoam(d));
    }
  });

  it("the shared helpers are deterministic too (clamp01, smoothstep)", () => {
    expect(clamp01(0.327)).toBe(clamp01(0.327));
    expect(clamp01(-9.1)).toBe(clamp01(-9.1));
    expect(smoothstep(2, 5, 3.3)).toBe(smoothstep(2, 5, 3.3));
    expect(smoothstep(0, 1, -0.7)).toBe(smoothstep(0, 1, -0.7));
  });

  it("uses no nondeterministic source (no Math.random / Date.now in the module)", () => {
    const src = readFileSync(join(MODULE_DIR, "waterSurface.ts"), "utf8");
    const code = stripCommentsAndStrings(src);
    expect(code).not.toMatch(/Math\s*\.\s*random/);
    expect(code).not.toMatch(/Date\s*\.\s*now/);
    expect(code).not.toMatch(/\bnew\s+Date\b/);
    expect(code).not.toMatch(/performance\s*\.\s*now/);
  });
});

describe("degenerate inputs stay finite and in-gamut", () => {
  const DEGENERATE = [NaN, Infinity, -Infinity, 1e308, -1e308];

  it("clamp01 maps any degenerate scalar into [0,1]", () => {
    for (const v of DEGENERATE) {
      const c = clamp01(v);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("smoothstep stays finite in [0,1] for degenerate x (interpolant clamp)", () => {
    for (const x of DEGENERATE) {
      const s = smoothstep(2, 5, x);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("waterColor keeps all channels finite and in-gamut for degenerate/out-of-range fresnel", () => {
    const out: [number, number, number] = [0, 0, 0];
    for (const f of [...DEGENERATE, -50, 50]) {
      waterColor(f, out);
      for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(out[c])).toBe(true);
        expect(out[c]).toBeGreaterThanOrEqual(0);
        expect(out[c]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("shorelineFoam stays finite in [0,1] for degenerate/out-of-range depth", () => {
    for (const d of [...DEGENERATE, -50, 50]) {
      const v = shorelineFoam(d);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// --- T5: import isolation + tree-shaking guard -----------------------------
// The headless seam only holds if the module imports nothing outside `src/world`
// (no `three`/DOM/WebGL) AND no world-wiring file imports it — so the bundler
// tree-shakes it out until the later visual slice pulls it in. Asserted by
// reading the source rather than runtime probing, mirroring the static contract.
describe("import isolation (headless, world-only)", () => {
  const src = readFileSync(join(MODULE_DIR, "waterSurface.ts"), "utf8");

  it("imports nothing — and certainly nothing outside src/world", () => {
    const specs = importSpecifiers(src);
    // Every import must resolve within the same folder (relative `./…`); a bare
    // specifier (`three`, `react`, …) or any `../` escape fails the seam.
    for (const spec of specs) {
      expect(
        spec.startsWith("./"),
        `forbidden import of "${spec}" — module must only import from src/world`,
      ).toBe(true);
    }
    // This slice's module is fully self-contained: it imports nothing at all.
    expect(specs).toHaveLength(0);
  });

  it("contains no three / DOM / WebGL / AudioContext reference in its code", () => {
    const code = stripCommentsAndStrings(src);
    expect(code).not.toMatch(/\bthree\b/i);
    expect(code).not.toMatch(/\bTHREE\b/);
    expect(code).not.toMatch(/\bwindow\b/);
    expect(code).not.toMatch(/\bdocument\b/);
    expect(code).not.toMatch(/\bWebGL/);
    expect(code).not.toMatch(/\bcanvas\b/i);
    expect(code).not.toMatch(/\bAudioContext\b/);
    expect(code).not.toMatch(/\bnavigator\b/);
  });
});

// --- T10: tree-shaking guard FLIP — a deliberate PR #116 contract change -----
// BEFORE (the G1 slice-1 seam guard): "NO src file imports `./waterSurface`",
// so the bundler tree-shook the whole module out until a visual slice pulled it
// in. That slice (G1 slice 2) is now landing: `boundaries.ts` assembles the
// water material from the palette/foam single source of truth, importing it
// directly (the foam-edge symbols) and transitively via `waterUniforms.ts` (the
// sRGB→linear palette transport, T1). So the guard is INVERTED — from
// "stays unimported" to a positive "boundaries.ts (and only the sanctioned
// wiring) imports it" assertion. This is the NAMED, intentional contract update
// for PR #116, not an incidental defeat of a guard (AC10). The single-source
// "no re-declared hex / inline foam-edge literal" half of AC1 is owned in full
// by boundaries.sourceOfTruth.test.ts (T9); here we lock the importer SET.
const SRC_ROOT = join(MODULE_DIR, "..");

/** Walk `src/` and return every non-test `.ts`/`.tsx` file (absolute path). */
function nonTestSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    if (statSync(p).isDirectory()) {
      out.push(...nonTestSourceFiles(p));
    } else if (
      (p.endsWith(".ts") || p.endsWith(".tsx")) &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".test.tsx")
    ) {
      out.push(p);
    }
  }
  return out;
}

/** True if a module specifier resolves to `./…/waterSurface` (±`.ts`). */
function isWaterSurfaceSpec(spec: string): boolean {
  return /(^|\/)waterSurface(\.ts)?$/.test(spec);
}

describe("waterSurface is imported by boundaries — PR #116 tree-shaking guard flip", () => {
  // The set of production (non-test) src files that REALLY import the module —
  // a real `import … from "./…/waterSurface"`, comments stripped so a
  // commented-out import never counts. Paths are project-root-relative for
  // readable assertion messages.
  const importers = nonTestSourceFiles(SRC_ROOT)
    .filter((f) => importSpecifiers(readFileSync(f, "utf8")).some(isWaterSurfaceSpec))
    .map((f) => relative(SRC_ROOT, f).split("\\").join("/"))
    .sort();

  it("boundaries.ts is now in the set of files importing ./waterSurface (the flip)", () => {
    // PR #116, G1 slice 2: the previously-tree-shaken module is now wired into
    // the water material in boundaries.ts. This positive assertion REPLACES the
    // old "no src file imports ./waterSurface" negative — a deliberate contract
    // change, not a regression.
    expect(
      importers,
      "PR #116 (G1 slice 2): boundaries.ts must import ./waterSurface — the " +
        "intentional flip of the slice-1 tree-shaking guard. Importers found: " +
        `[${importers.join(", ")}]`,
    ).toContain("world/boundaries.ts");
  });

  it("ONLY the sanctioned water-wiring files import it — no other file pulls it in", () => {
    // The inverse half of the old guard: the module stays narrowly scoped to the
    // water material assembly. boundaries.ts imports the foam-edge symbols
    // directly; waterUniforms.ts is the sRGB→linear palette transport it owns.
    // Any NEW importer here is unexpected and must be added knowingly (PR #116).
    const SANCTIONED = ["world/boundaries.ts", "world/waterUniforms.ts"];
    expect(
      importers,
      "Only the water-material wiring may import ./waterSurface; an unexpected " +
        `importer appeared. Found [${importers.join(", ")}], expected a subset ` +
        `of [${SANCTIONED.join(", ")}]. Add new consumers here knowingly.`,
    ).toEqual(SANCTIONED);
  });
});
