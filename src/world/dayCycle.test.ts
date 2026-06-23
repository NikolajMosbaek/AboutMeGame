import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_T,
  KEYFRAMES,
  MIN_DOME_BOTTOM_LUMA,
  MIN_SUN_INTENSITY,
  dayPalette,
} from "./dayCycle.ts";

// Directory of THIS test file, used to read source for the static (grep-style)
// isolation/tree-shaking guards below. Declared up top so the `describe`
// factories — which run synchronously at registration — can read it. Mirrors
// the same pattern in waterSurface.test.ts (the G1 slice-1 source-of-truth that
// preceded this one).
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Rec.709 relative luma of an sRGB-0..1 tuple, matching the convention named in
 *  the {@link MIN_DOME_BOTTOM_LUMA} jsdoc — the dome-readability metric the floor
 *  is measured against. */
function luma709(c: readonly [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

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
 * strings like `#cfe4f2`. Destroys import specifiers — never use it for the
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

// --- (d) THE no-night / readability floor (the first test, by the plan) ------
// The most load-bearing invariant: across a DENSE sweep of the whole [0,1) loop
// (and a few wrapping inputs), every sampled palette keeps the sun at or above
// MIN_SUN_INTENSITY and the dome BOTTOM at or above MIN_DOME_BOTTOM_LUMA. The
// floor is held BY CONSTRUCTION of the keyframe table (no runtime Math.max), so
// linear interpolation — a convex combination — can never dip below the dimmest
// keyframe. This is what makes the "never night-dark, always readable" promise a
// provable property of the function, not a hope.
describe("no-night / readability floor (swept invariant over the whole loop)", () => {
  it("every sample's sunIntensity >= MIN_SUN_INTENSITY across a dense 0..1 sweep", () => {
    const STEPS = 1000;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS; // 0 .. 1 inclusive (t=1 wraps to t=0)
      const p = dayPalette(t);
      expect(
        p.sunIntensity,
        `t=${t}: sunIntensity ${p.sunIntensity} fell below the no-night floor ` +
          `MIN_SUN_INTENSITY=${MIN_SUN_INTENSITY}`,
      ).toBeGreaterThanOrEqual(MIN_SUN_INTENSITY);
    }
  });

  it("every sample's domeBottom luma >= MIN_DOME_BOTTOM_LUMA across a dense 0..1 sweep", () => {
    const STEPS = 1000;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const p = dayPalette(t);
      const luma = luma709(p.domeBottom);
      expect(
        luma,
        `t=${t}: domeBottom luma ${luma.toFixed(4)} fell below the readability ` +
          `floor MIN_DOME_BOTTOM_LUMA=${MIN_DOME_BOTTOM_LUMA}`,
      ).toBeGreaterThanOrEqual(MIN_DOME_BOTTOM_LUMA);
    }
  });

  it("the floor still holds for inputs OUTSIDE [0,1) (they wrap into the loop)", () => {
    // Negative, >1, and on-keyframe wraps must all land on in-loop palettes that
    // respect the floor — the floor is a property of EVERY return, total-function.
    for (const t of [-2.7, -0.3, 1.0, 1.5, 3.25, 17.9]) {
      const p = dayPalette(t);
      expect(p.sunIntensity).toBeGreaterThanOrEqual(MIN_SUN_INTENSITY);
      expect(luma709(p.domeBottom)).toBeGreaterThanOrEqual(MIN_DOME_BOTTOM_LUMA);
    }
  });
});

// --- (a) keyframe exactness — f==0 early-return ------------------------------
// At each authored keyframe's `t`, dayPalette returns that keyframe's EXACT
// tuples/scalars (toEqual / toBe), with no lerp rounding — the f==0 early-return
// that backs the bit-exact noon==sky.ts and keyframe-exactness guarantees. The
// closing row (t=1) is the seam-repeat of dawn (t=0): dayPalette(1) wraps to
// t=0, so it yields dawn's azimuth (DAWN_AZIMUTH), not the closing row's
// DAWN_AZIMUTH+2π — the seam itself is the wrap suite's job, so here we assert
// exactness only for the authored interior keyframes (t < 1).
describe("keyframe exactness (f==0 early-return)", () => {
  it("returns each interior keyframe's exact palette at its keyframe t", () => {
    for (const k of KEYFRAMES.filter((kf) => kf.t < 1)) {
      const p = dayPalette(k.t);
      expect(p.sunColor).toEqual(k.sunColor);
      expect(p.sunIntensity).toBe(k.sunIntensity);
      expect(p.sunElevation).toBe(k.sunElevation);
      expect(p.sunAzimuth).toBe(k.sunAzimuth);
      expect(p.domeTop).toEqual(k.domeTop);
      expect(p.domeBottom).toEqual(k.domeBottom);
      expect(p.fogColor).toEqual(k.fogColor);
    }
  });

  it("returns a fresh palette object per call (callers can't mutate the table)", () => {
    // paletteOf copies the authored tuples; two calls must not alias each other
    // nor the KEYFRAMES rows, so a consumer writing into one return is harmless.
    const a = dayPalette(0.25);
    const b = dayPalette(0.25);
    expect(a).not.toBe(b);
    expect(a.sunColor).not.toBe(b.sunColor);
    expect(a).toEqual(b); // …but value-equal
  });
});

// --- (b) monotonic + continuous interpolation across ONE adjacent pair -------
// Pick the dawn→noon segment [0, 0.25] and sample its midpoint t=0.125 (local
// fraction f=0.5). Each field must equal the EXACT per-component linear midpoint
// of the two endpoints (continuity), and for every component that actually
// DIFFERS between the endpoints the midpoint must lie STRICTLY between them
// (monotone, no flat/overshoot). sunColor's red channel is 1.0 at both ends, so
// "strictly between" is asserted only where the endpoints differ.
describe("interpolation is continuous + monotone across one adjacent pair (dawn→noon)", () => {
  const dawn = KEYFRAMES[0]; // t = 0
  const noon = KEYFRAMES[1]; // t = 0.25
  const mid = dayPalette((dawn.t + noon.t) / 2); // t = 0.125, f = 0.5

  const betweenOrEqualChannel = (m: number, a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    // exact linear midpoint (continuity)
    expect(m).toBeCloseTo((a + b) / 2, 12);
    expect(m).toBeGreaterThanOrEqual(lo);
    expect(m).toBeLessThanOrEqual(hi);
    // monotone where the endpoints differ → strictly inside
    if (a !== b) {
      expect(m).toBeGreaterThan(lo);
      expect(m).toBeLessThan(hi);
    }
  };

  it("each colour channel is the exact midpoint, strictly between where it varies", () => {
    for (const field of ["sunColor", "domeTop", "domeBottom", "fogColor"] as const) {
      for (let c = 0; c < 3; c++) {
        betweenOrEqualChannel(mid[field][c], dawn[field][c], noon[field][c]);
      }
    }
  });

  it("each scalar/angle is the exact midpoint, strictly between (all three differ here)", () => {
    for (const field of ["sunIntensity", "sunElevation", "sunAzimuth"] as const) {
      betweenOrEqualChannel(mid[field], dawn[field], noon[field]);
    }
  });
});

// --- (c) seamless wrap — closing segment, approach-from-below ----------------
// The loop must close with NO jump. Proven not as the trivial dayPalette(0) ===
// dayPalette(1), but as a real CLOSING SEGMENT: as t → 1⁻ along the last
// keyframe pair [0.75, 1], every field must CONVERGE to the t=0 (dawn) value —
// INCLUDING azimuth. Azimuth is authored monotone-unwrapped, so the closing row
// carries DAWN_AZIMUTH + 2π; the approach-from-below limit therefore converges to
// dawn's azimuth + 2π (i.e. dawn azimuth mod 2π), which is the seamless sweep.
describe("seamless wrap (closing segment, approach-from-below → dawn)", () => {
  const dawn = dayPalette(0);
  // The closing keyframe (t=1) carries the unwrapped azimuth DAWN_AZIMUTH + 2π.
  const closing = KEYFRAMES[KEYFRAMES.length - 1];

  it("colour/intensity/elevation converge to the dawn values as t → 1⁻", () => {
    // A sequence approaching 1 from below; the gap to dawn must shrink toward 0.
    let prevGap = Infinity;
    for (const t of [0.9, 0.99, 0.999, 0.9999, 0.99999]) {
      const p = dayPalette(t);
      const gap =
        Math.abs(p.sunColor[0] - dawn.sunColor[0]) +
        Math.abs(p.sunColor[1] - dawn.sunColor[1]) +
        Math.abs(p.sunColor[2] - dawn.sunColor[2]) +
        Math.abs(p.domeTop[0] - dawn.domeTop[0]) +
        Math.abs(p.domeBottom[0] - dawn.domeBottom[0]) +
        Math.abs(p.fogColor[0] - dawn.fogColor[0]) +
        Math.abs(p.sunIntensity - dawn.sunIntensity) +
        Math.abs(p.sunElevation - dawn.sunElevation);
      expect(gap).toBeLessThan(prevGap); // strictly closing
      prevGap = gap;
    }
    // The limit: at t = 1 - tiny the palette is within epsilon of dawn's values.
    const near = dayPalette(1 - 1e-7);
    expect(near.sunColor[0]).toBeCloseTo(dawn.sunColor[0], 5);
    expect(near.sunColor[1]).toBeCloseTo(dawn.sunColor[1], 5);
    expect(near.sunColor[2]).toBeCloseTo(dawn.sunColor[2], 5);
    expect(near.domeTop[0]).toBeCloseTo(dawn.domeTop[0], 5);
    expect(near.domeBottom[0]).toBeCloseTo(dawn.domeBottom[0], 5);
    expect(near.fogColor[0]).toBeCloseTo(dawn.fogColor[0], 5);
    expect(near.sunIntensity).toBeCloseTo(dawn.sunIntensity, 5);
    expect(near.sunElevation).toBeCloseTo(dawn.sunElevation, 5);
  });

  it("azimuth converges to dawn's azimuth + 2π (the monotone-unwrapped seam)", () => {
    // As t → 1⁻ the azimuth approaches the closing row's value, which IS dawn's
    // azimuth plus a full turn — proving the sun sweep is continuous mod 2π and
    // does not snap backward at the seam.
    let prevGap = Infinity;
    for (const t of [0.9, 0.99, 0.999, 0.9999, 0.99999]) {
      const gap = Math.abs(dayPalette(t).sunAzimuth - closing.sunAzimuth);
      expect(gap).toBeLessThan(prevGap);
      prevGap = gap;
    }
    const near = dayPalette(1 - 1e-7);
    expect(near.sunAzimuth).toBeCloseTo(closing.sunAzimuth, 5);
    // The seam is continuous mod 2π: the limit equals dawn's azimuth + a full turn.
    expect(closing.sunAzimuth - 2 * Math.PI).toBeCloseTo(dawn.sunAzimuth, 12);
    expect(near.sunAzimuth - 2 * Math.PI).toBeCloseTo(dawn.sunAzimuth, 5);
  });

  it("dayPalette(1) wraps to exactly dayPalette(0) (the seam endpoints coincide)", () => {
    // Belt-and-braces: t=1 euclidean-wraps to t=0, so the two ends are identical
    // palettes (azimuth = DAWN_AZIMUTH, the wrapped value — not the +2π form).
    expect(dayPalette(1)).toEqual(dayPalette(0));
  });
});

// --- (e) noon keyframe == sky.ts constants (incl. fog #cfe4f2) ---------------
// The brightest case must reproduce today's shipped sky.ts look BIT-EXACT in
// sRGB-0..1, so slice 2's dome/light/fog refactor is a provable no-op at noon
// and G2 bloom tuning sees the same anchor. sky.ts is the ORIGIN of these
// literals; we re-derive them here from the SAME hex/direction numbers (not by
// importing sky.ts, which is Three-bound and would break the headless seam).
describe("noon keyframe reproduces sky.ts bit-exact (incl. fogColor #cfe4f2)", () => {
  const noon = dayPalette(0.25); // t=0.25 is the noon keyframe — f==0 early-return

  /** sky.ts hex → sRGB-0..1 tuple, the SAME decomposition the module uses. */
  const hex = (h: number): [number, number, number] => [
    ((h >> 16) & 255) / 255,
    ((h >> 8) & 255) / 255,
    (h & 255) / 255,
  ];

  it("domeTop == sky.ts SKY_TOP #3a78c2", () => {
    expect(noon.domeTop).toEqual(hex(0x3a78c2));
  });

  it("domeBottom == sky.ts SKY_BOTTOM #cfe4f2", () => {
    expect(noon.domeBottom).toEqual(hex(0xcfe4f2));
  });

  it("fogColor == sky.ts horizon (= SKY_BOTTOM) #cfe4f2 — closes the fog gap", () => {
    // sky.ts sets fog = horizon = SKY_BOTTOM; pinning fog here makes the slice-2
    // fog refactor a provable no-op at noon.
    expect(noon.fogColor).toEqual(hex(0xcfe4f2));
  });

  it("sunColor == sky.ts DirectionalLight colour #fff1d6", () => {
    expect(noon.sunColor).toEqual(hex(0xfff1d6));
  });

  it("sunIntensity == sky.ts DirectionalLight intensity 1.6", () => {
    expect(noon.sunIntensity).toBe(1.6);
  });

  it("sun elevation/azimuth are derived from sky.ts sun direction (0.6, 1, 0.4)", () => {
    // sky.ts: sun.position.set(0.6, 1, 0.4). Elevation above the XZ plane is
    // atan2(y, |xz|); azimuth clockwise from +Z toward +X is atan2(x, z).
    const x = 0.6;
    const y = 1;
    const z = 0.4;
    expect(noon.sunElevation).toBe(Math.atan2(y, Math.hypot(x, z)));
    expect(noon.sunAzimuth).toBe(Math.atan2(x, z));
  });

  it("GOLDEN_T pins the golden-dusk keyframe (slice-4 reduced-motion still)", () => {
    // The exported GOLDEN_T must name a real keyframe `t` (the dusk row), so the
    // reduced-motion pin lands on the authored golden look, not a lerped sample.
    expect(KEYFRAMES.some((k) => k.t === GOLDEN_T)).toBe(true);
  });
});

// --- (f) degenerate-input contract -------------------------------------------
// dayPalette is TOTAL: a Number.isFinite(t) guard folds NaN/±Infinity to the
// loop start before the euclidean modulo-1, and the modulo wraps any real t
// (negative, >1, exactly 1.0) into [0,1). EVERY input must therefore return a
// finite, in-gamut (colours ∈ [0,1]), non-night (floors held) palette.
describe("degenerate-input contract (total function — finite, in-gamut, non-night)", () => {
  const cases = [-3.7, -1.0, -0.25, 0, 1.0, 1.5, 42.123, NaN, Infinity, -Infinity];

  const assertSane = (t: number) => {
    const p = dayPalette(t);
    for (const tuple of [p.sunColor, p.domeTop, p.domeBottom, p.fogColor]) {
      for (const ch of tuple) {
        expect(Number.isFinite(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
    expect(Number.isFinite(p.sunIntensity)).toBe(true);
    expect(Number.isFinite(p.sunElevation)).toBe(true);
    expect(Number.isFinite(p.sunAzimuth)).toBe(true);
    // non-night floors hold for ANY input
    expect(p.sunIntensity).toBeGreaterThanOrEqual(MIN_SUN_INTENSITY);
    expect(luma709(p.domeBottom)).toBeGreaterThanOrEqual(MIN_DOME_BOTTOM_LUMA);
  };

  for (const t of cases) {
    it(`t=${t} returns a finite, in-gamut, non-night palette`, () => assertSane(t));
  }

  it("NaN and ±Infinity all fold to the loop start (dawn), identical to t=0", () => {
    const dawn = dayPalette(0);
    expect(dayPalette(NaN)).toEqual(dawn);
    expect(dayPalette(Infinity)).toEqual(dawn);
    expect(dayPalette(-Infinity)).toEqual(dawn);
  });

  it("is deterministic — a second call with the same t is value-identical", () => {
    for (const t of [0.137, 0.5, 0.812, -2.3, 1.0, NaN]) {
      expect(dayPalette(t)).toEqual(dayPalette(t));
    }
  });
});

// --- (g) import isolation — headless, world-only -----------------------------
// The headless seam holds only if the module imports nothing touching
// Three.js/DOM/WebGL/audio AND nothing outside src/world — and, per the design,
// NOT even ./waterSurface (clamp01 is INLINED, so this stays the only new
// dependency-free file and never becomes a fifth ./waterSurface importer that
// would break that module's locked SANCTIONED guard). Asserted by reading the
// source, mirroring waterSurface.test.ts's static contract.
describe("import isolation (headless, world-only, no ./waterSurface)", () => {
  const src = readFileSync(join(MODULE_DIR, "dayCycle.ts"), "utf8");

  it("imports nothing — and certainly nothing outside src/world", () => {
    const specs = importSpecifiers(src);
    for (const spec of specs) {
      expect(
        spec.startsWith("./"),
        `forbidden import of "${spec}" — module must only import from src/world`,
      ).toBe(true);
    }
    // This slice's module is fully self-contained: it imports nothing at all.
    expect(specs).toHaveLength(0);
  });

  it("does NOT import ./waterSurface (clamp01 is inlined, two-files-only fence)", () => {
    const specs = importSpecifiers(src);
    expect(
      specs.some((s) => /(^|\/)waterSurface(\.ts)?$/.test(s)),
      "dayCycle.ts must NOT import ./waterSurface — importing clamp01 would make " +
        "it a fifth importer and break waterSurface.test.ts's SANCTIONED guard.",
    ).toBe(false);
  });

  it("contains no three / DOM / WebGL / AudioContext / navigator reference in its code", () => {
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

// --- (h) tree-shaking guard — imported by exactly world/dayCycleSystem.ts -----
// The G3 "living sky" slice wires the pure palette into the world via ONE
// production importer: world/dayCycleSystem.ts (buildWorld → dayCycleSystem →
// dayCycle is the chain that defeats tree-shaking). We walk src/ (the same
// nonTestSourceFiles walk waterSurface.test.ts uses) and assert the importer set
// equals exactly that file — nothing else may pull dayCycle in, and sky.ts in
// particular stays import-free (locked separately by sky.test.ts:262). This is
// the named, intentional contract FLIP from the earlier no-bytes guard (which
// asserted an empty importer set), exactly as PR #116 did for water.
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

/** True if a module specifier resolves to `./…/dayCycle` (±`.ts`). */
function isDayCycleSpec(spec: string): boolean {
  return /(^|\/)dayCycle(\.ts)?$/.test(spec);
}

describe("dayCycle is imported by exactly world/dayCycleSystem.ts", () => {
  const importers = nonTestSourceFiles(SRC_ROOT)
    .filter((f) => importSpecifiers(readFileSync(f, "utf8")).some(isDayCycleSpec))
    .map((f) => relative(SRC_ROOT, f).split("\\").join("/"))
    .sort();

  it("exactly world/dayCycleSystem.ts imports ./dayCycle (the single production importer)", () => {
    expect(
      importers,
      "dayCycle.ts must be imported by exactly world/dayCycleSystem.ts — the single " +
        "production importer that wires the pure palette to the live sky handles and " +
        "defeats tree-shaking (buildWorld → dayCycleSystem → dayCycle). Found: " +
        `[${importers.join(", ")}]`,
    ).toEqual(["world/dayCycleSystem.ts"]);
  });
});
