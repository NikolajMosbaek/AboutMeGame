import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * T1 regression lock for the share-card SVG source of truth (#54 follow-up).
 *
 * The editable SVG is committed alongside the rasterized PNG so the social card
 * stays diffable and token-aligned with favicon.svg. This suite guards the
 * authored vector: it must exist and declare the full 1200x630 social-card
 * canvas so the offline rasterization (T2) produces a correctly-sized PNG.
 */
const svgPath = resolve(process.cwd(), "public/share-card.svg");

describe("share-card.svg", () => {
  it("exists as a committed source-of-truth asset", () => {
    expect(existsSync(svgPath)).toBe(true);
  });

  it("declares the 1200x630 social-card canvas via its root viewBox", () => {
    const svg = readFileSync(svgPath, "utf8");
    const match = svg.match(/<svg[^>]*\sviewBox="([^"]*)"/);
    expect(match?.[1]).toBe("0 0 1200 630");
  });
});
