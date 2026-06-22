import { afterEach, describe, expect, it, vi } from "vitest";
import { assetUrl, clearAssetCache } from "./assets.ts";

afterEach(() => clearAssetCache());

describe("assetUrl (GitHub Pages sub-path safety)", () => {
  it("prepends the Vite BASE_URL so paths survive a sub-path deploy", () => {
    // Vitest default BASE_URL is "/", matching dev.
    expect(assetUrl("assets/textures/grass.png")).toBe(
      "/assets/textures/grass.png",
    );
  });

  it("never produces a double slash from a leading-slash input", () => {
    expect(assetUrl("/assets/x.png")).toBe("/assets/x.png");
  });

  it("respects a configured sub-path base", () => {
    const original = import.meta.env.BASE_URL;
    vi.stubEnv("BASE_URL", "/AboutMeGame/");
    try {
      expect(assetUrl("assets/models/car.glb")).toBe(
        "/AboutMeGame/assets/models/car.glb",
      );
    } finally {
      vi.stubEnv("BASE_URL", original);
      vi.unstubAllEnvs();
    }
  });
});
