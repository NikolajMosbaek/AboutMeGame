import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * MOB2 #155 (epic #149) slice guard — lock in the >=44px coarse tap floor that
 * #153/#154 shipped but left unguarded. This slice ships ZERO product CSS
 * change: every declaration asserted below already exists and is correct in
 * src/tokens.css. The slice's only diff is this test, its Group B/C siblings,
 * and a run-log lint — nothing in the Vite import graph.
 *
 * HONESTY CONTRACT (DEC2): this is an AUTHORED-TEXT / token-CONSUMPTION proof,
 * NEVER a rendered-pixel proof. jsdom resolves no @media query, no env(), and no
 * dvh unit, so getComputedStyle would only echo the authored string; we parse
 * the authored rule TEXT directly instead. The on-device clearance — the menu /
 * Settings button being tappable and uncovered, and each panel's close/back/next
 * control reachable, against a collapsing iOS URL bar and a notch in portrait AND
 * landscape — is flagged "needs verification on a physical iPhone" in the run
 * log. A green run here proves the tokens are consumed, never the pixels.
 *
 * WHY A PER-RULE BINDER, NOT blocksFor (DEC3): the six named tap-floor controls
 * live in ONE seven-selector group rule (src/tokens.css:1162-1168), so an
 * exact-match blocksFor('.hud-menu-btn') returns 0. A naive "body contains
 * '.hud-menu-btn' AND body contains min-height/min-width:var(--tap-min)
 * somewhere" check then FALSE-GREENS on realistic partial regressions (a control
 * split into a cosmetic-only rule; a single dimension dropped while a sibling
 * keeps both). The binder below parses the coarse-media body into per-rule
 * (selector-set, decls) pairs and binds each control to a rule that lists IT and
 * carries BOTH dimensions in its OWN decls — so a partial regression goes red.
 */

const css = stripComments(readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8"));

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
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

interface CssRule {
  /** The individual selectors of this rule's selector-set, trimmed. */
  selectors: string[];
  /** This rule's OWN declaration block text. */
  decls: string;
}

/**
 * Parse a (media-block or stylesheet) body into per-rule (selector-set, decls)
 * pairs. Each rule's `decls` is ONLY its own block — never a sibling's — so a
 * declaration matched against it is genuinely bound to that selector-set, not to
 * "somewhere in the same media block". This is the seam that makes the tap-floor
 * assertion sound against partial regressions.
 */
function rules(body: string): CssRule[] {
  const out: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const selectors = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ selectors, decls: m[2] });
  }
  return out;
}

/**
 * Does SOME rule in `body` list `control` in its selector-set AND carry BOTH
 * min-height and min-width:var(--tap-min) in its OWN decls? Subset/contains
 * semantics: extra selectors in the group (e.g. .title-textlink) are tolerated,
 * never forbidden — we bind to the rule that lists the control, not to an exact
 * group string.
 */
function bindsTapFloor(body: string, control: string): boolean {
  const minHeight = /min-height:\s*var\(--tap-min\)/;
  const minWidth = /min-width:\s*var\(--tap-min\)/;
  return rules(body).some(
    (r) => r.selectors.includes(control) && minHeight.test(r.decls) && minWidth.test(r.decls),
  );
}

describe("tokens.css — MOB2 #155 coarse-tap floor (slice guard, token consumption)", () => {
  it(":root defines --tap-min: 44px (the WCAG 2.5.5 / platform floor)", () => {
    const root = css.match(/:root\s*\{([\s\S]*?)\}/);
    expect(root, ":root rule must exist").toBeTruthy();
    expect(root![1].length, ":root block must be non-empty").toBeGreaterThan(0);
    expect(root![1]).toMatch(/--tap-min:\s*44px/);
  });

  it("Group A — the per-rule binder beats blocksFor: .hud-menu-btn resolves BOTH min-height AND min-width:var(--tap-min) in the SAME @media(pointer:coarse) rule that lists it", () => {
    // .hud-menu-btn shares the seven-selector group rule (tokens.css:1162-1168),
    // so an exact-match blocksFor('.hud-menu-btn') would be 0 here. The binder
    // finds the group rule that LISTS it and proves both dimensions live in that
    // rule's own decls — green against the real, compliant tree.
    const coarse = mediaBody("pointer: coarse");
    expect(coarse.length, "@media(pointer:coarse) body must be non-empty").toBeGreaterThan(0);
    expect(rules(coarse).length, "the coarse media block must hold rules").toBeGreaterThan(0);
    expect(
      bindsTapFloor(coarse, ".hud-menu-btn"),
      ".hud-menu-btn must carry both min-height and min-width:var(--tap-min) in the rule that lists it",
    ).toBe(true);
  });
});
