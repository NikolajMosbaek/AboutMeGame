import { describe, expect, it } from "vitest";
import { applyReducedMotion } from "./reducedMotion.ts";

describe("applyReducedMotion", () => {
  it("sets the data attribute on the root element when on", () => {
    const root = document.createElement("html");
    applyReducedMotion(root, true);
    expect(root.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("removes the attribute when off (so the OS media query still decides)", () => {
    const root = document.createElement("html");
    root.setAttribute("data-reduced-motion", "true");
    applyReducedMotion(root, false);
    expect(root.hasAttribute("data-reduced-motion")).toBe(false);
  });

  it("is a no-op without a root element (SSR/guard)", () => {
    expect(() => applyReducedMotion(null, true)).not.toThrow();
  });
});
