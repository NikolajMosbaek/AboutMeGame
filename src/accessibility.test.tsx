import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";

// T7 — Accessibility-shell guardrails. The bootstrap promises a single landmark,
// a single page heading, WCAG-AA contrast token pairs, and a focus ring that is
// never stripped. These are cheap to honor now and expensive to retrofit later,
// so they are locked down by test rather than left to a comment. The stylesheet
// is read from disk (vitest runs from the repo root) so the assertions track the
// real shipped tokens — a `?raw` import resolves to empty for `.css` under Vite.
const tokensCss = readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8");

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two hex colors. */
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Reads a `--token: #hex;` value out of the stylesheet. */
function token(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token ${name} not found in tokens.css`);
  return match[1];
}

describe("accessibility shell — DOM landmarks", () => {
  it("renders exactly one main landmark", () => {
    render(<App />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("renders exactly one level-1 heading", () => {
    render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("accessibility shell — token contrast pairs (WCAG AA)", () => {
  it("body foreground on background meets AA for normal text (>= 4.5:1)", () => {
    expect(contrast(token("--color-fg"), token("--color-bg"))).toBeGreaterThanOrEqual(4.5);
  });

  it("accent on background meets AA for normal text (>= 4.5:1)", () => {
    expect(contrast(token("--color-accent"), token("--color-bg"))).toBeGreaterThanOrEqual(4.5);
  });

  it("accent foreground on the accent surface meets AA for normal text (>= 4.5:1)", () => {
    expect(contrast(token("--color-accent-fg"), token("--color-accent"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("accessibility shell — focus ring is not stripped", () => {
  it("defines a visible :focus-visible outline", () => {
    const block = tokensCss.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(block, ":focus-visible rule must exist").not.toBeNull();
    const body = block![1];
    expect(body, "outline must be declared").toMatch(/outline\s*:/);
    expect(body, "outline must not be removed (outline: none/0)").not.toMatch(
      /outline\s*:\s*(none|0)\b/,
    );
  });

  it("never sets outline:none or outline:0 anywhere in the stylesheet", () => {
    expect(tokensCss).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });
});
