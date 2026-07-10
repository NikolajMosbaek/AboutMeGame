import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * MOB1 #148 slice 1 — safe-area + dvh layout-token CONSUMPTION (T1).
 *
 * HONESTY CONTRACT (D5): this is a token-consumption proof, NOT a geometry or
 * clearance proof. jsdom has no viewport: getComputedStyle returns env()/dvh as
 * the literal authored string and evaluates no @media query. So we assert
 * against the AUTHORED rule TEXT — and crucially against the SPECIFIC media-query
 * rules, not only the base rule — so the D2(d) gap (a static-vh max-height that
 * WINS by source order on the small/short iPhone) cannot silently pass. The
 * rendered safe-area/dvh result is flagged "needs verification on a physical
 * iPhone" in the run log.
 */

// Strip /* … */ comments up front so a comment never leaks into a selector
// match (the file leads with a banner comment directly above :root).
const css = stripComments(readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8"));

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extract the declaration block(s) for a rule whose selector list, as authored,
 * EXACTLY equals `selector` (so `.reveal-panel` does not match the grouped
 * `.reveal-panel, .onboarding, .menu` rule). The selector is taken as the text
 * after the previous `}` or `{` (so an at-rule prelude can't bleed in), trimmed
 * and whitespace-collapsed. Returns every match in source order.
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

describe("tokens.css — safe-area + dvh layout-token consumption (MOB1 #148 T1)", () => {
  it(":root defines the safe-area inset tokens with a 0px fallback", () => {
    const root = blocksFor(css, ":root")[0];
    expect(root).toMatch(/--safe-top:\s*env\(safe-area-inset-top,\s*0px\)/);
    expect(root).toMatch(/--safe-right:\s*env\(safe-area-inset-right,\s*0px\)/);
    expect(root).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
    expect(root).toMatch(/--safe-left:\s*env\(safe-area-inset-left,\s*0px\)/);
  });

  it(":root declares --vh-dynamic as 100vh first, then 100dvh under @supports (vh-first ladder)", () => {
    const root = blocksFor(css, ":root")[0];
    expect(root).toMatch(/--vh-dynamic:\s*100vh/);
    // The dvh upgrade lives behind @supports (height: 100dvh) and comes AFTER
    // the vh fallback in source order so non-dvh engines keep today's behaviour.
    const supportsAt = css.indexOf("@supports (height: 100dvh)");
    expect(supportsAt, "@supports (height: 100dvh) must exist").toBeGreaterThanOrEqual(0);
    expect(css.slice(supportsAt)).toMatch(/--vh-dynamic:\s*100dvh/);
    expect(css.indexOf("--vh-dynamic: 100vh")).toBeLessThan(supportsAt);
  });

  it("base .reveal-panel max-height resolves through var(--vh-dynamic), not raw vh", () => {
    const base = blocksFor(css, ".reveal-panel")[0];
    expect(base).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/);
    expect(base).not.toMatch(/max-height:\s*\d/); // no raw "max-height: 86vh"
  });

  it("the max-width:480px .reveal-panel max-height sizes from var(--vh-dynamic), never static vh (D2d gap)", () => {
    // The D2(d) flaw: a static-vh max-height grouped with .onboarding/.menu that
    // WINS by source order on the small iPhone. So: no max-height may reach
    // .reveal-panel from the grouped rule, and the split-out rule sets the dvh
    // calc. .onboarding/.menu (out of scope) keep their static 92vh.
    const body = mediaBody("max-width: 480px");
    const grouped = blocksFor(body, ".reveal-panel, .onboarding, .menu").join("\n");
    expect(grouped).not.toMatch(/max-height/);
    const own = blocksFor(body, ".reveal-panel");
    expect(own.length).toBeGreaterThan(0);
    const joined = own.join("\n");
    expect(joined).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/);
    expect(joined).not.toMatch(/max-height:\s*\d+vh/);
    // .onboarding/.menu now share the dvh token too (converted in MOB2 #154).
    expect(blocksFor(body, ".onboarding, .menu").join("\n")).toMatch(
      /max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/,
    );
  });

  it("the max-height:480px .reveal-panel max-height sizes from var(--vh-dynamic), never static vh (D2d gap)", () => {
    const body = mediaBody("max-height: 480px");
    const grouped = blocksFor(body, ".reveal-panel, .onboarding, .menu").join("\n");
    expect(grouped).not.toMatch(/max-height/);
    const own = blocksFor(body, ".reveal-panel");
    expect(own.length).toBeGreaterThan(0);
    const joined = own.join("\n");
    expect(joined).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/);
    expect(joined).not.toMatch(/max-height:\s*\d+vh/);
    // .onboarding/.menu now share the dvh token too (converted in MOB2 #154).
    expect(blocksFor(body, ".onboarding, .menu").join("\n")).toMatch(
      /max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/,
    );
  });

  it(".touch-action-btn bottom offset resolves through var(--safe-bottom)", () => {
    const base = blocksFor(css, ".touch-action-btn")[0];
    expect(base).toMatch(/bottom:\s*calc\(7vh\s*\+\s*var\(--safe-bottom\)\)/);
  });
});
