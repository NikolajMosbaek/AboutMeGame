// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveVerifyUrl } from "./lib.mjs";

describe("resolveVerifyUrl", () => {
  it("pins the default preview URL: port 4173 under /AboutMeGame/", () => {
    // Drift pin: must match `VITE_BASE ?? "/AboutMeGame/"` in vite.config.ts.
    expect(resolveVerifyUrl({ port: 4173, env: {} })).toBe(
      "http://localhost:4173/AboutMeGame/",
    );
  });

  it("honours the VITE_BASE env override", () => {
    expect(resolveVerifyUrl({ port: 4173, env: { VITE_BASE: "/other/" } })).toBe(
      "http://localhost:4173/other/",
    );
  });

  it('normalizes VITE_BASE="/" without a double slash', () => {
    expect(resolveVerifyUrl({ port: 4173, env: { VITE_BASE: "/" } })).toBe(
      "http://localhost:4173/",
    );
  });

  it("normalizes a base missing its leading/trailing slashes", () => {
    expect(resolveVerifyUrl({ port: 4173, env: { VITE_BASE: "other" } })).toBe(
      "http://localhost:4173/other/",
    );
  });

  it("prefers an explicit base over the env", () => {
    expect(
      resolveVerifyUrl({
        port: 5000,
        base: "/explicit/",
        env: { VITE_BASE: "/ignored/" },
      }),
    ).toBe("http://localhost:5000/explicit/");
  });
});
