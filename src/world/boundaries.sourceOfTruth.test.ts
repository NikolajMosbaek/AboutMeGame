import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FOAM_DEPTH_END,
  FOAM_DEPTH_START,
} from "./waterSurface.ts";

// T9 — AC1 single-source-of-truth grep guard (G1 slice 2, #116).
//
// `waterSurface.ts` is the ONE source of the water look: the two palette blues
// (`WATER_SHALLOW` `#2e6f9e` / `WATER_DEEP` `#193d57`), the foam-band edges
// (`FOAM_DEPTH_START` / `FOAM_DEPTH_END`) and the foam math (`shorelineFoam`).
// The boundaries water-material assembly must re-USE all five — never re-declare
// the centralised hex or inline the foam-edge numbers (which would silently
// drift from the token). This is a static (grep-style) guard over the source:
// it reads the files, strips comments/strings, and asserts the contract.
//
// The assembly is boundaries.ts plus the two helper modules it directly owns for
// the patch — `waterUniforms.ts` (the sRGB→linear palette transport) and
// `waterPatch.ts` (the GLSL transcription, incl. the embedded shader strings).
// Each of the five symbols must trace back to `waterSurface.ts` as its sole
// origin across that assembly, and NO file in it may re-declare the palette hex
// or an inline foam-edge literal (AC1, AC10).

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Strip `//` and block comments only, preserving string/template literals so
 *  the quoted module specifier of an `import` survives the import scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** Strip comments AND string/template literals so numeric/keyword scans don't
 *  trip over prose in jsdoc or token strings like `#2e6f9e`. NOTE: this also
 *  destroys the GLSL embedded in `waterPatch.ts` template/quoted strings — which
 *  is intentional for the hex/literal scan: the GLSL must not contain a raw hex
 *  or foam-edge number either, so we run a SEPARATE scan over the raw GLSL. */
function stripCommentsAndStrings(src: string): string {
  return stripComments(src)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** Module specifier of every `import ... from "x"` (comments stripped, strings
 *  preserved so the specifier survives). */
function importSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const specs: string[] = [];
  const re = /\bimport\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) specs.push(m[1]);
  return specs;
}

/** True if `spec` resolves to `./waterSurface` (with or without the `.ts`). */
function isWaterSurfaceSpec(spec: string): boolean {
  return /(^|\/)waterSurface(\.ts)?$/.test(spec);
}

function read(name: string): string {
  return readFileSync(join(MODULE_DIR, name), "utf8");
}

const PALETTE_HEX = /0x2e6f9e|0x193d57/i;
// The per-channel decomposition of the same tokens (e.g. `0x2e / 255`) is just
// the hex spelled another way — equally forbidden outside waterSurface.ts.
const PALETTE_CHANNELS = /0x2e\s*\/\s*255|0x19\s*\/\s*255/i;

// The foam-band edge values, as they would appear inline if someone hardcoded
// them instead of importing the symbols. `FOAM_DEPTH_START` is 0.0 (too common
// to ban as a bare number), so we guard the distinctive `FOAM_DEPTH_END` value
// in its `1.5` spellings — any of which would be silent drift from the token.
const FOAM_END_LITERAL = /\b1\.5\b|\b1\.50\b/;

describe("AC1 — waterSurface.ts is the single source of truth (T9)", () => {
  const boundariesSrc = read("boundaries.ts");
  const uniformsSrc = read("waterUniforms.ts");
  const patchSrc = read("waterPatch.ts");

  it("the foam-edge symbols carry the canonical values (anchor the guard)", () => {
    // Anchors the literal-scan below to the REAL token values, so the guard
    // tracks the source of truth instead of a copy that could itself drift.
    expect(FOAM_DEPTH_START).toBe(0.0);
    expect(FOAM_DEPTH_END).toBe(1.5);
  });

  it("boundaries.ts import-specifies ./waterSurface", () => {
    const specs = importSpecifiers(boundariesSrc);
    expect(
      specs.some(isWaterSurfaceSpec),
      "boundaries.ts must import directly from ./waterSurface (the source of truth)",
    ).toBe(true);
  });

  it("imports the foam-edge symbols FOAM_DEPTH_START / FOAM_DEPTH_END from waterSurface", () => {
    const code = stripComments(boundariesSrc);
    // Both edge symbols appear in the same import group that names waterSurface.
    const m = code.match(
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*waterSurface(?:\.ts)?["']/,
    );
    expect(m, "boundaries.ts must have a named import from ./waterSurface").not.toBeNull();
    const named = m![1];
    expect(named).toMatch(/\bFOAM_DEPTH_START\b/);
    expect(named).toMatch(/\bFOAM_DEPTH_END\b/);
  });

  it("uses FOAM_DEPTH_START / FOAM_DEPTH_END as the foam-edge uniforms (not inline numbers)", () => {
    const code = stripCommentsAndStrings(boundariesSrc);
    // The edges are wired into uniforms by symbol — never as a bare `1.5`.
    expect(code).toMatch(/uFoamStart[^=]*=\s*\{\s*value:\s*FOAM_DEPTH_START\s*\}/);
    expect(code).toMatch(/uFoamEnd[^=]*=\s*\{\s*value:\s*FOAM_DEPTH_END\s*\}/);
  });

  it("re-uses WATER_SHALLOW / WATER_DEEP (via the linear transport) sourced from waterSurface", () => {
    // The palette reaches the uniforms through waterUniforms.ts (the sRGB→linear
    // transport), whose ONLY palette origin is waterSurface.ts — never re-declared.
    const uniformSpecs = importSpecifiers(uniformsSrc);
    expect(uniformSpecs.some(isWaterSurfaceSpec)).toBe(true);

    const uniformCode = stripCommentsAndStrings(uniformsSrc);
    expect(uniformCode).toMatch(/\bWATER_SHALLOW\b/);
    expect(uniformCode).toMatch(/\bWATER_DEEP\b/);

    // boundaries.ts in turn consumes the decoded linear palette as uniforms.
    const boundariesCode = stripCommentsAndStrings(boundariesSrc);
    expect(boundariesCode).toMatch(/\bWATER_SHALLOW_LINEAR\b/);
    expect(boundariesCode).toMatch(/\bWATER_DEEP_LINEAR\b/);
  });

  it("transcribes shorelineFoam in the GLSL patch, sourced from waterSurface (1 - smoothstep)", () => {
    // shorelineFoam = 1 - smoothstep(FOAM_DEPTH_START, FOAM_DEPTH_END, depth) is
    // transcribed line-for-line into the patch GLSL, driven by the foam-edge
    // UNIFORMS (uFoamStart/uFoamEnd) — never re-derived from inline numbers.
    expect(patchSrc).toMatch(/1\.0\s*-\s*smoothstep\(\s*uFoamStart\s*,\s*uFoamEnd\s*,\s*depth\s*\)/);
    // The patch documents shorelineFoam as the source it transcribes.
    expect(patchSrc).toMatch(/shorelineFoam/);
  });

  describe("re-declares NO centralised palette hex or inline foam-edge literal (the grep guard)", () => {
    const files: ReadonlyArray<readonly [string, string]> = [
      ["boundaries.ts", boundariesSrc],
      ["waterUniforms.ts", uniformsSrc],
      ["waterPatch.ts", patchSrc],
    ];

    for (const [name, src] of files) {
      it(`${name}: no 0x2e6f9e / 0x193d57 palette hex`, () => {
        const code = stripCommentsAndStrings(src);
        expect(code, `${name} must not re-declare the Water-token hex`).not.toMatch(PALETTE_HEX);
        expect(code, `${name} must not re-declare the per-channel hex`).not.toMatch(PALETTE_CHANNELS);
      });

      it(`${name}: no inline FOAM_DEPTH_END (1.5) literal`, () => {
        const code = stripCommentsAndStrings(src);
        expect(
          code,
          `${name} must use the FOAM_DEPTH_END symbol, never an inline 1.5`,
        ).not.toMatch(FOAM_END_LITERAL);
      });
    }

    it("the GLSL embedded in waterPatch.ts contains no raw palette hex or foam-edge number", () => {
      // The hex/foam-edge scan above strips string literals — which removes the
      // GLSL. So scan the RAW patch source (comments stripped only) to prove the
      // shader strings themselves inject the palette/edges as uniforms, not as
      // baked-in numbers.
      const glsl = stripComments(patchSrc);
      expect(glsl).not.toMatch(PALETTE_HEX);
      expect(glsl).not.toMatch(PALETTE_CHANNELS);
      // No literal 1.5 in the GLSL: smoothstep takes uFoamStart/uFoamEnd uniforms.
      expect(glsl).not.toMatch(/smoothstep\([^)]*\b1\.5\b/);
    });
  });
});
