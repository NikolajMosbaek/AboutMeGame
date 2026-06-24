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

/**
 * Declaration block(s) whose selector list, as authored, EXACTLY equals
 * `selector` (so `.menu` does not match `.onboarding, .menu`). The selector is
 * the text after the previous `}` or `{`, trimmed and whitespace-collapsed.
 * Mirrors the harness in tokens.mob2.dvh.css.test.ts / tokens.css.test.ts. Used
 * for Group B's standalone base rules (.hud-top-right, .hud-menu-btn), which sit
 * outside any @media block and own their declarations alone.
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

describe("tokens.css — MOB2 #155 Group B (belt-and-suspenders base floor)", () => {
  it(".hud-top-right clears the notch via top/right: max(var(--space-1), var(--safe-top|--safe-right)) (~:623-624)", () => {
    // The HUD's top-right cluster (menu button + progress badge) is position:fixed
    // and would tuck under the notch / status bar without the safe-area max(); the
    // floor keeps the base --space-1 inset and grows it to the inset on a notched
    // device. Bound to the .hud-top-right base rule's own decls, which own these
    // longhands alone (no sibling shares them) — a reshuffle fails loud below.
    const base = blocksFor(css, ".hud-top-right")[0];
    expect(base, ".hud-top-right base rule must exist").toBeTruthy();
    expect(blocksFor(css, ".hud-top-right").length).toBeGreaterThan(0);
    expect(base).toMatch(/top:\s*max\(\s*var\(--space-1\)\s*,\s*var\(--safe-top\)\s*\)/);
    expect(base).toMatch(/right:\s*max\(\s*var\(--space-1\)\s*,\s*var\(--safe-right\)\s*\)/);
  });

  it(".hud-menu-btn base sets width AND height: var(--tap-min) (~:660-661)", () => {
    // The Settings/menu button's own base footprint is the >=44px floor, before
    // any @media(pointer:coarse) min-* reinforcement — so the button is tappable
    // on every device, not only those reporting a coarse pointer. Bound to the
    // .hud-menu-btn base rule's own decls (the :hover/active siblings carry no
    // width/height), so a selector reshuffle that drops the base sizing fails loud.
    const base = blocksFor(css, ".hud-menu-btn")[0];
    expect(base, ".hud-menu-btn base rule must exist").toBeTruthy();
    expect(blocksFor(css, ".hud-menu-btn").length).toBeGreaterThan(0);
    expect(base).toMatch(/width:\s*var\(--tap-min\)/);
    expect(base).toMatch(/height:\s*var\(--tap-min\)/);
  });
});

describe("tokens.css — MOB2 #155 Group C (the four dvh caps + .text-view negative)", () => {
  /*
   * INTENTIONAL ADDITIVE OVERLAP (DEC6): these four cap assertions and the
   * .text-view negative re-state guards that tokens.mob2.dvh.css.test.ts (#154)
   * also holds. This is NOT a refactor of that file and #155 must never be framed
   * as editing it — the duplication is cheap insurance keyed to #155's own anchors
   * so a regression fails in TWO places. A future cap-ratio change (e.g.
   * 0.86 -> 0.88) must therefore update BOTH files; the run log records that.
   */

  it("the two base panels cap via calc(var(--vh-dynamic) * 0.86), and .text-view carries the additive safe-bottom pad with NO max-height", () => {
    // .reveal-panel base (~:418) and .completion-panel base (~:545) are centred
    // dialogs, so they cap their height off the dvh-aware token. .text-view (~:889)
    // is a full-bleed scrolling PAGE — it floors its end-of-document dismiss
    // control above the home indicator with an ADDITIVE bottom pad and, being no
    // dialog, must NOT gain a max-height that would clip the scroll.
    const reveal = blocksFor(css, ".reveal-panel")[0];
    expect(reveal, ".reveal-panel base rule must exist").toBeTruthy();
    expect(blocksFor(css, ".reveal-panel").length).toBeGreaterThan(0);
    expect(reveal).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/);

    const completion = blocksFor(css, ".completion-panel")[0];
    expect(completion, ".completion-panel base rule must exist").toBeTruthy();
    expect(blocksFor(css, ".completion-panel").length).toBeGreaterThan(0);
    expect(completion).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/);

    const textView = blocksFor(css, ".text-view")[0];
    expect(textView, ".text-view base rule must exist").toBeTruthy();
    expect(blocksFor(css, ".text-view").length).toBeGreaterThan(0);
    expect(textView).toMatch(
      /padding-bottom:\s*max\(\s*var\(--space-4\)\s*,\s*calc\(\s*var\(--space-4\)\s*\+\s*var\(--safe-bottom\)\s*\)\s*\)/,
    );
    expect(textView).not.toMatch(/max-height/);
  });

  it("the @media(max-width:480px) caps read calc(var(--vh-dynamic) * 0.92), never raw vh", () => {
    // The narrow-viewport overlays size from the dvh-aware token so they track the
    // visible viewport as the iOS URL bar collapses, instead of over-talling off a
    // static vh on the small iPhone the P0 targets.
    const body = mediaBody("max-width: 480px");
    expect(body.length, "@media(max-width:480px) body must be non-empty").toBeGreaterThan(0);

    const reveal = blocksFor(body, ".reveal-panel").join("\n");
    expect(reveal.length, ".reveal-panel cap rule must exist in this media block").toBeGreaterThan(0);
    expect(reveal).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/);
    expect(reveal).not.toMatch(/max-height:\s*\d+vh/);

    const shared = blocksFor(body, ".onboarding, .menu").join("\n");
    expect(shared.length, ".onboarding,.menu cap rule must exist in this media block").toBeGreaterThan(0);
    expect(shared).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/);
    expect(shared).not.toMatch(/max-height:\s*\d+vh/);
  });

  it("the @media(max-height:480px) caps read calc(var(--vh-dynamic) * 0.96), never raw vh", () => {
    // The short-viewport (landscape) caps tighten to 0.96 of the dvh-aware token
    // for the same reason — the URL bar eats more of an already-short viewport.
    const body = mediaBody("max-height: 480px");
    expect(body.length, "@media(max-height:480px) body must be non-empty").toBeGreaterThan(0);

    const reveal = blocksFor(body, ".reveal-panel").join("\n");
    expect(reveal.length, ".reveal-panel cap rule must exist in this media block").toBeGreaterThan(0);
    expect(reveal).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/);
    expect(reveal).not.toMatch(/max-height:\s*\d+vh/);

    const shared = blocksFor(body, ".onboarding, .menu").join("\n");
    expect(shared.length, ".onboarding,.menu cap rule must exist in this media block").toBeGreaterThan(0);
    expect(shared).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/);
    expect(shared).not.toMatch(/max-height:\s*\d+vh/);
  });

  it(":root declares --vh-dynamic: 100vh and upgrades it to 100dvh behind @supports(height:100dvh)", () => {
    // The fallback is declared FIRST and is non-negotiable (iOS <15.4 / any non-dvh
    // engine keeps 100vh); the dvh upgrade is layered behind @supports so it only
    // applies where the browser understands dvh. All four caps above resolve
    // through this token, so this is the single seam that makes them dvh-aware.
    const root = css.match(/:root\s*\{([\s\S]*?)\}/);
    expect(root, ":root rule must exist").toBeTruthy();
    expect(root![1]).toMatch(/--vh-dynamic:\s*100vh/);

    const supports = css.match(/@supports\s*\(height:\s*100dvh\)\s*\{([\s\S]*?--vh-dynamic:[^;]*;[\s\S]*?)\}/);
    expect(supports, "@supports(height:100dvh) block must exist").toBeTruthy();
    expect(supports![1]).toMatch(/--vh-dynamic:\s*100dvh/);
  });
});
