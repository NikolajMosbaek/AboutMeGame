import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * MOB2 #153 slice 1 — top-HUD safe-area CLEARANCE token CONSUMPTION (T1).
 *
 * HONESTY CONTRACT (D5): this is a token-consumption proof, NOT a geometry or
 * clearance proof. jsdom has no viewport: getComputedStyle returns env()/@media
 * as the literal authored string and evaluates no @media query. So we assert
 * against the AUTHORED rule TEXT — and crucially against the SPECIFIC
 * @media (max-width: 480px) .hud-telemetry rule, not only the base rule — so the
 * D2(d) gap (a static left:var(--space-1) that WINS by source order on the
 * small/notched iPhone in landscape) cannot silently pass. The rendered
 * notch/Dynamic-Island clearance is flagged "needs verification on a physical
 * iPhone" in the run log.
 *
 * IDIOM (D1): the top HUD is a fixed clearance gutter, so each offset is wrapped
 * as max(var(--space-N), var(--safe-*)) — the max() clamp with MOB1's --safe-*
 * tokens (env(safe-area-inset-*, 0px)) INSIDE max(): NOT raw env() at the call
 * site, NOT the additive calc() form reserved for the vh-stacked bottom
 * controls. On a zero-inset desktop root the raw token wins (byte-identical
 * fallback); on a notch the inset wins.
 */

// Strip /* … */ comments up front so a comment never leaks into a selector
// match (the file leads with a banner comment directly above :root).
const css = stripComments(readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8"));

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extract the declaration block(s) for a rule whose selector list, as authored,
 * EXACTLY equals `selector` (so `.discovery-progress` does not match the nested
 * `.hud-top-right .discovery-progress` override rule). The selector is taken as
 * the text after the previous `}` or `{` (so an at-rule prelude can't bleed in),
 * trimmed and whitespace-collapsed. Returns every match in source order.
 */
function blocksFor(source: string, selector: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[{}])([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel === selector) out.push(m[2]);
    // Step back one char so a closing brace can also open the next match.
    re.lastIndex = m.index + m[0].length - 1;
  }
  return out;
}

/** The body of the first `@media (<query>) { ... }` at-rule (balanced braces). */
function mediaBody(query: string): string {
  const start = css.indexOf(`@media (${query})`);
  expect(start, `@media (${query}) must exist`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced @media (${query})`);
}

// A `prop: max(var(--space-N), var(--safe-DIR))` matcher — the D1 idiom: the
// raw token first (desktop fallback), the safe-area inset second (notch wins).
function maxClamp(prop: string, space: string, dir: string): RegExp {
  return new RegExp(
    `${prop}:\\s*max\\(\\s*var\\(--space-${space}\\)\\s*,\\s*var\\(--safe-${dir}\\)\\s*\\)`,
  );
}

describe("tokens.css — top-HUD safe-area clearance token consumption (MOB2 #153 T1)", () => {
  it("base .stats-overlay clears via top max(--space-1,--safe-top) + left max(--space-1,--safe-left)", () => {
    const base = blocksFor(css, ".stats-overlay")[0];
    expect(base).toMatch(maxClamp("top", "1", "top"));
    expect(base).toMatch(maxClamp("left", "1", "left"));
    // No raw bare token left on an in-scope offset.
    expect(base).not.toMatch(/top:\s*var\(--space-1\)\s*;/);
    expect(base).not.toMatch(/left:\s*var\(--space-1\)\s*;/);
  });

  it("base .discovery-progress clears via top max(--space-1,--safe-top) + right max(--space-2,--safe-right)", () => {
    // The standalone (position:fixed) render path; the actual authored offsets
    // are top:--space-1, right:--space-2 (D2(b)).
    const base = blocksFor(css, ".discovery-progress")[0];
    expect(base).toMatch(maxClamp("top", "1", "top"));
    expect(base).toMatch(maxClamp("right", "2", "right"));
    expect(base).not.toMatch(/top:\s*var\(--space-1\)\s*;/);
    expect(base).not.toMatch(/right:\s*var\(--space-2\)\s*;/);
  });

  it("base .hud-telemetry clears via top max(--space-1,--safe-top) ONLY — keeps left:50% + translateX (no inset added)", () => {
    const base = blocksFor(css, ".hud-telemetry")[0];
    expect(base).toMatch(maxClamp("top", "1", "top"));
    expect(base).not.toMatch(/top:\s*var\(--space-1\)\s*;/);
    // Reposition-only: centring is preserved, and NO left/right inset is added
    // (a horizontal inset would skew the centred chip).
    expect(base).toMatch(/left:\s*50%/);
    expect(base).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(base).not.toMatch(/--safe-left/);
    expect(base).not.toMatch(/--safe-right/);
  });

  it("base .hud-top-right (journal + menu/Settings) clears via top max(--space-1,--safe-top) + right max(--space-1,--safe-right)", () => {
    // D2(d): the authored right is --space-1 (NOT the brief's stale --space-2);
    // wrapping the ACTUAL value keeps desktop byte-identical.
    const base = blocksFor(css, ".hud-top-right")[0];
    expect(base).toMatch(maxClamp("top", "1", "top"));
    expect(base).toMatch(maxClamp("right", "1", "right"));
    expect(base).not.toMatch(/top:\s*var\(--space-1\)\s*;/);
    expect(base).not.toMatch(/right:\s*var\(--space-1\)\s*;/);
  });

  it("the @media (max-width: 480px) .hud-telemetry override wraps its left as max(--space-1,--safe-left) (D2(d) in-media guard)", () => {
    // The accepted material flaw: after the base fix, the small-phone override
    // re-anchors to left:var(--space-1) with no inset, so a landscape-left notch
    // would re-clip telemetry by source order. Assert the IN-MEDIA rule, not the
    // base, so this gap cannot silently pass.
    const body = mediaBody("max-width: 480px");
    const own = blocksFor(body, ".hud-telemetry");
    expect(own.length).toBeGreaterThan(0);
    const joined = own.join("\n");
    expect(joined).toMatch(maxClamp("left", "1", "left"));
    expect(joined).not.toMatch(/left:\s*var\(--space-1\)\s*;/);
  });
});
