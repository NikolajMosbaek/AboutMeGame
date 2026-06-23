import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * MOB1 #148 slice 1 — QUALITY-side token-consumption assertion (T3 / AC2).
 *
 * HONESTY CONTRACT (D5): this is a token-CONSUMPTION proof, explicitly NOT a
 * geometry or clearance proof. jsdom has no layout viewport — getComputedStyle
 * returns env()/dvh as the literal authored string and evaluates no @media — so
 * the rendered safe-area/dvh clearance is flagged "needs verification on a
 * physical iPhone" in the run log. What this file proves is that the AUTHORED
 * CSS for the USE->reveal path consumes the inset/dvh tokens in EVERY in-scope
 * rule, including the SPECIFIC split-out media-query rules (the max-width:480px
 * and max-height:480px blocks), so the D2(d) gap — a static-vh value that wins
 * by source order on the small/short iPhone the P0 targets — cannot silently
 * pass while a base-rule-only test stays green.
 *
 * This file is the quality lens on AC2: the .touch-use offset, the reveal/
 * completion panel max-heights, the backdrop home-indicator padding, and the
 * in-media offset migration (D2e) — i.e. that NO raw bottom-vh or static-vh
 * max-height survives in any in-scope rule, portrait OR landscape.
 */

const css = stripComments(readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8"));

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Declaration block(s) for a rule whose selector list, as authored, EXACTLY
 * equals `selector` (so `.reveal-panel` never matches the grouped
 * `.reveal-panel, .onboarding, .menu`). Selector text is taken after the prior
 * `}`/`{` so an at-rule prelude cannot bleed in. Returns every match in source
 * order, searching within `source` (the whole file or a single @media body).
 */
function blocksFor(source: string, selector: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[{}])([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel === selector) out.push(m[2]);
    re.lastIndex = m.index + m[0].length - 1; // a `}` can also open the next match
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

/** Every `bottom:` value declared in a block, in source order. */
function bottomValues(block: string): string[] {
  return [...block.matchAll(/bottom:\s*([^;}]+)/g)].map((m) => m[1].trim());
}

describe("tokens.css — AC2 quality: USE->reveal path consumes safe-area/dvh tokens (MOB1 #148 T3)", () => {
  // ---- .touch-use: the core verb's button must clear the home indicator ----

  it("base .touch-use bottom adds var(--safe-bottom) to its vh offset, no raw bottom vh", () => {
    const base = blocksFor(css, ".touch-use")[0];
    expect(base, ".touch-use base rule must exist").toBeTruthy();
    expect(base).toMatch(/bottom:\s*calc\(\s*7vh\s*\+\s*var\(--safe-bottom\)\s*\)/);
    // No bottom declaration that is a bare vh (the regression we are guarding).
    for (const v of bottomValues(base)) {
      expect(v, `.touch-use base bottom "${v}" must not be raw vh`).not.toMatch(/^\d+vh$/);
    }
  });

  it("the landscape .touch-fly, .touch-use bottom also adds var(--safe-bottom) (D2e, in-media)", () => {
    // @media (max-height: 480px) re-declares the offsets; the migration must
    // reach INSIDE the media query or a notch clips the button in landscape.
    const body = mediaBody("max-height: 480px");
    const grouped = blocksFor(body, ".touch-fly, .touch-use");
    expect(grouped.length, "landscape .touch-fly, .touch-use rule must exist").toBeGreaterThan(0);
    const joined = grouped.join("\n");
    expect(joined).toMatch(/bottom:\s*calc\(\s*4vh\s*\+\s*var\(--safe-bottom\)\s*\)/);
    for (const v of bottomValues(joined)) {
      expect(v, `landscape touch bottom "${v}" must not be raw vh`).not.toMatch(/^\d+vh$/);
    }
  });

  // ---- The reveal prompt (the "press USE" affordance) ----

  it("the portrait .reveal-prompt override (max-width:480px) adds var(--safe-bottom) (D2e)", () => {
    const body = mediaBody("max-width: 480px");
    const prompt = blocksFor(body, ".reveal-prompt").join("\n");
    expect(prompt, "portrait .reveal-prompt override must exist").toBeTruthy();
    expect(prompt).toMatch(/bottom:\s*calc\(\s*16vh\s*\+\s*var\(--safe-bottom\)\s*\)/);
    expect(prompt).not.toMatch(/bottom:\s*\d+vh\b/);
  });

  it("the landscape .reveal-prompt override (max-height:480px) adds var(--safe-bottom) (D2e)", () => {
    const body = mediaBody("max-height: 480px");
    const prompt = blocksFor(body, ".reveal-prompt").join("\n");
    expect(prompt, "landscape .reveal-prompt override must exist").toBeTruthy();
    expect(prompt).toMatch(/bottom:\s*calc\(\s*4vh\s*\+\s*var\(--safe-bottom\)\s*\)/);
    expect(prompt).not.toMatch(/bottom:\s*\d+vh\b/);
  });

  // ---- Reveal + completion panels: max-height through the dvh token, in every
  //      in-scope rule INCLUDING the split-out media rules (the D2d gap) ----

  it("the .completion-panel (the reveal-flow end panel) max-height reads var(--vh-dynamic)", () => {
    const base = blocksFor(css, ".completion-panel")[0];
    expect(base, ".completion-panel base rule must exist").toBeTruthy();
    expect(base).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/);
    expect(base).not.toMatch(/max-height:\s*\d+vh\b/);
  });

  it("D2d gap closed — the max-width:480px .reveal-panel is split out and reads var(--vh-dynamic)", () => {
    // The flaw: a static 92vh grouped with .onboarding/.menu would WIN by source
    // order on the small iPhone and silently revert the panel to raw vh, while a
    // base-rule-only test stays green (jsdom evaluates no @media). So assert the
    // SPECIFIC split-out rule, and that the grouped rule no longer sets a panel
    // max-height at all.
    const body = mediaBody("max-width: 480px");
    expect(blocksFor(body, ".reveal-panel, .onboarding, .menu").join("\n")).not.toMatch(/max-height/);
    const own = blocksFor(body, ".reveal-panel");
    expect(own.length, "split-out .reveal-panel (max-width:480px) must exist").toBeGreaterThan(0);
    const joined = own.join("\n");
    expect(joined).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\)/);
    expect(joined).not.toMatch(/max-height:\s*\d+vh\b/);
    // The out-of-scope siblings must be left on their original vh, untouched.
    expect(blocksFor(body, ".onboarding, .menu").join("\n")).toMatch(/max-height:\s*92vh/);
  });

  it("D2d gap closed — the max-height:480px .reveal-panel is split out and reads var(--vh-dynamic)", () => {
    const body = mediaBody("max-height: 480px");
    expect(blocksFor(body, ".reveal-panel, .onboarding, .menu").join("\n")).not.toMatch(/max-height/);
    const own = blocksFor(body, ".reveal-panel");
    expect(own.length, "split-out .reveal-panel (max-height:480px) must exist").toBeGreaterThan(0);
    const joined = own.join("\n");
    expect(joined).toMatch(/max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\)/);
    expect(joined).not.toMatch(/max-height:\s*\d+vh\b/);
    expect(blocksFor(body, ".onboarding, .menu").join("\n")).toMatch(/max-height:\s*96vh/);
  });

  // ---- Backdrops: a centred panel's footer must clear the home indicator ----

  it("the reveal + completion backdrops pad the bottom by var(--safe-bottom) (D2f)", () => {
    for (const sel of [".reveal-panel-backdrop", ".completion-panel-backdrop"]) {
      const block = blocksFor(css, sel)[0];
      expect(block, `${sel} rule must exist`).toBeTruthy();
      expect(block, `${sel} must add the bottom inset`).toMatch(
        /padding-bottom:\s*calc\(var\(--space-2\)\s*\+\s*var\(--safe-bottom\)\)/,
      );
      expect(block, `${sel} must add the top inset`).toMatch(
        /padding-top:\s*calc\(var\(--space-2\)\s*\+\s*var\(--safe-top\)\)/,
      );
    }
  });

  // ---- Global guard: NO raw bottom-vh anywhere on the in-scope selectors ----

  it("no in-scope bottom-pinned rule (portrait OR landscape) leaves a raw bottom vh", () => {
    // The exhaustive D2 invariant across base + both media blocks. Every place a
    // .touch-* / .reveal-prompt declares `bottom`, it must be a calc() carrying
    // var(--safe-bottom), never a bare vh that a notch could clip under.
    const inScope = [".touch-joystick", ".touch-thrust", ".touch-fly", ".touch-use", ".reveal-prompt"];
    const sources = [
      css,
      mediaBody("max-width: 480px"),
      mediaBody("max-height: 480px"),
    ];
    const offenders: string[] = [];
    for (const src of sources) {
      for (const sel of inScope) {
        for (const block of blocksFor(src, sel)) {
          for (const v of bottomValues(block)) {
            if (/^\d+(\.\d+)?vh$/.test(v)) offenders.push(`${sel} { bottom: ${v} }`);
          }
        }
      }
      // The grouped landscape rule ".touch-fly, .touch-use" too.
      for (const block of blocksFor(src, ".touch-fly, .touch-use")) {
        for (const v of bottomValues(block)) {
          if (/^\d+(\.\d+)?vh$/.test(v)) offenders.push(`.touch-fly, .touch-use { bottom: ${v} }`);
        }
      }
    }
    expect(offenders, `raw bottom vh left on in-scope rules: ${offenders.join(", ")}`).toEqual([]);
  });
});
