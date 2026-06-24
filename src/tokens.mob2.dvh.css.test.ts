import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * MOB2 #154 (epic #149) slice guard — the two reachability gaps MOB1 left.
 *
 * HONESTY CONTRACT (DEC9): this is a TOKEN-CONSUMPTION proof, NOT a rendered-
 * geometry proof. jsdom resolves no env()/dvh and evaluates no @media query, so
 * getComputedStyle returns the authored string verbatim. We assert against the
 * AUTHORED rule TEXT only. The on-device clearance — the .text-view footer/back
 * link clearing the home indicator, and the .onboarding "got it" / .menu close
 * controls staying visible against a collapsing iOS URL bar in portrait AND
 * landscape — is flagged "needs verification on a physical iPhone" in the run
 * log; a green run here proves the tokens are consumed, never the pixels.
 *
 * Two gaps, two idioms (verified against the MOB1-shipped siblings):
 *  (1) .text-view is a full-bleed scrolling PAGE, so its end-of-document dismiss
 *      control clears the home indicator via an ADDITIVE bottom pad floored at
 *      the base --space-4: padding-bottom: max(--space-4, calc(--space-4 +
 *      --safe-bottom)). It is NOT a centred dialog, so it gains NO max-height.
 *  (2) The shared .onboarding,.menu caps are scrolling overlays, so — like the
 *      already-split .reveal-panel siblings — they size from var(--vh-dynamic)
 *      (which carries its own 100vh->100dvh @supports fallback), never raw vh.
 *
 * This file is authored RED: against the current tree .text-view has no
 * padding-bottom longhand and the .onboarding,.menu caps still read raw vh.
 */

const css = stripComments(readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8"));

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Declaration block(s) whose selector list, as authored, EXACTLY equals
 * `selector` (so `.menu` does not match `.onboarding, .menu`). The selector is
 * the text after the previous `}` or `{`, trimmed and whitespace-collapsed.
 * Mirrors the harness in tokens.mob2.css.test.ts / tokens.css.test.ts.
 */
function blocksFor(source: string, selector: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[{}])([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel === selector) out.push(m[2]);
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

describe("tokens.css — MOB2 #154 reachability gaps (slice guard, token consumption)", () => {
  it("Gap 1 — .text-view footer clears the home indicator via padding-bottom max(--space-4, calc(--space-4 + --safe-bottom))", () => {
    // The full-bleed scrolling page's only end-of-document dismiss control is
    // the footer back link; with no safe-area bottom term it strands under the
    // home indicator. The floor form keeps the base at --space-4 and ADDS the
    // inset on a notch — independently assertable as its own longhand.
    const base = blocksFor(css, ".text-view")[0];
    expect(base, ".text-view rule must exist").toBeTruthy();
    expect(base).toMatch(
      /padding-bottom:\s*max\(\s*var\(--space-4\)\s*,\s*calc\(\s*var\(--space-4\)\s*\+\s*var\(--safe-bottom\)\s*\)\s*\)/,
    );
    // It resolves through the env()-backed --safe-bottom token, not raw env().
    expect(base).toMatch(/--safe-bottom/);
    // Top/sides stay the plain shorthand — the longhand only overrides bottom.
    expect(base).toMatch(/padding:\s*var\(--space-4\)\s*var\(--space-3\)/);
  });

  it("Gap 1 — .text-view is a scrolling page, NOT a centred dialog: it gains NO max-height", () => {
    // Guard the negative explicitly: a max-height would clip the scrolling page.
    const base = blocksFor(css, ".text-view")[0];
    expect(base, ".text-view rule must exist").toBeTruthy();
    expect(base).not.toMatch(/max-height/);
  });

  it("Gap 2 — the @media(max-width:480px) .onboarding,.menu cap reads calc(var(--vh-dynamic) * 0.92), never raw vh", () => {
    const body = mediaBody("max-width: 480px");
    const cap = blocksFor(body, ".onboarding, .menu").join("\n");
    expect(cap.length, "the .onboarding,.menu cap rule must exist in this media block").toBeGreaterThan(0);
    expect(cap).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/);
    expect(cap).not.toMatch(/max-height:\s*\d+vh/);
  });

  it("Gap 2 — the @media(max-height:480px) .onboarding,.menu cap reads calc(var(--vh-dynamic) * 0.96), never raw vh", () => {
    const body = mediaBody("max-height: 480px");
    const cap = blocksFor(body, ".onboarding, .menu").join("\n");
    expect(cap.length, "the .onboarding,.menu cap rule must exist in this media block").toBeGreaterThan(0);
    expect(cap).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/);
    expect(cap).not.toMatch(/max-height:\s*\d+vh/);
  });

  it("Regression — the four MOB1 max-height caps still read calc(var(--vh-dynamic) * N) (byte-unchanged)", () => {
    // .reveal-panel base, .completion-panel base, and the two split-out
    // .reveal-panel media caps are out of this slice's scope and must not shift.
    expect(blocksFor(css, ".reveal-panel")[0]).toMatch(
      /max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/,
    );
    expect(blocksFor(css, ".completion-panel")[0]).toMatch(
      /max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/,
    );
    const wide = blocksFor(mediaBody("max-width: 480px"), ".reveal-panel").join("\n");
    expect(wide).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/);
    const short = blocksFor(mediaBody("max-height: 480px"), ".reveal-panel").join("\n");
    expect(short).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/);
  });

  it("Regression — the width-only .onboarding / .menu base rules gain NO max-height", () => {
    // The base rules constrain width only; this slice must not invent a cap on
    // them (the only caps live in the two media blocks asserted above).
    const onboarding = blocksFor(css, ".onboarding")[0];
    expect(onboarding, ".onboarding base rule must exist").toBeTruthy();
    expect(onboarding).toMatch(/max-width:\s*min\(30rem,\s*92vw\)/);
    expect(onboarding).not.toMatch(/max-height/);

    const menu = blocksFor(css, ".menu")[0];
    expect(menu, ".menu base rule must exist").toBeTruthy();
    expect(menu).toMatch(/width:\s*min\(26rem,\s*92vw\)/);
    expect(menu).not.toMatch(/max-height/);
  });
});
