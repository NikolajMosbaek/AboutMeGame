import { describe, expect, it } from "vitest";
import { detectTier, readEnv, type CapabilityEnv } from "./deviceCapability.ts";
import { resolveQuality } from "./quality.ts";

/** A baseline desktop-ish env; tests override one field at a time. */
function env(overrides: Partial<CapabilityEnv> = {}): CapabilityEnv {
  return {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    devicePixelRatio: 1,
    coarsePointer: false,
    maxTouchPoints: 0,
    webglRenderer: undefined,
    ...overrides,
  };
}

describe("detectTier", () => {
  it("rates a strong desktop high", () => {
    expect(detectTier(env({ hardwareConcurrency: 12, deviceMemory: 16 }))).toBe("high");
  });

  it("rates a mid laptop medium", () => {
    expect(detectTier(env({ hardwareConcurrency: 4, deviceMemory: 4 }))).toBe("medium");
  });

  it("rates a low-core / low-memory device low", () => {
    expect(detectTier(env({ hardwareConcurrency: 2, deviceMemory: 2 }))).toBe("low");
  });

  it("treats a touch device with many cores as no better than medium", () => {
    // A phone may report 8 cores but cannot match a desktop GPU; the coarse
    // pointer caps it so we never push a high-tier load onto mobile.
    expect(detectTier(env({ hardwareConcurrency: 8, deviceMemory: 8, coarsePointer: true, maxTouchPoints: 5 }))).toBe(
      "medium",
    );
  });

  it("rates a weak phone low", () => {
    expect(
      detectTier(env({ hardwareConcurrency: 4, deviceMemory: 2, coarsePointer: true, maxTouchPoints: 5, devicePixelRatio: 3 })),
    ).toBe("low");
  });

  it("falls back gracefully when signals are missing", () => {
    // Older browsers omit deviceMemory; an unknown env should not crash and
    // should land on a safe middle tier rather than assuming a powerful device.
    expect(detectTier(env({ hardwareConcurrency: undefined, deviceMemory: undefined }))).toBe("medium");
  });

  it("is a pure function of its env argument (no globals read)", () => {
    const e = env({ hardwareConcurrency: 1, deviceMemory: 1 });
    expect(detectTier(e)).toBe(detectTier(e));
  });
});

// Software-WebGL override (render-gate fix): a GPU-less renderer (SwiftShader,
// llvmpipe, …) draws each frame in software — N8AO passes and periodic PMREM
// env rebakes turn the medium tier into a seconds-per-frame slideshow (the CI
// screenshot timeout that caught this). No amount of cores/RAM compensates for
// a missing GPU, so the renderer string overrides EVERY other signal.
describe("detectTier — software-WebGL override", () => {
  const SWIFTSHADER =
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

  it("forces low for a SwiftShader renderer even with 16 cores / 16 GB", () => {
    expect(
      detectTier(env({ hardwareConcurrency: 16, deviceMemory: 16, webglRenderer: SWIFTSHADER })),
    ).toBe("low");
  });

  it("forces low for Mesa's llvmpipe / softpipe software rasterizers", () => {
    expect(detectTier(env({ webglRenderer: "llvmpipe (LLVM 15.0.7, 256 bits)" }))).toBe("low");
    expect(detectTier(env({ webglRenderer: "softpipe" }))).toBe("low");
  });

  it("forces low for an ANGLE (software ...) adapter string", () => {
    expect(
      detectTier(env({ webglRenderer: "ANGLE (Software Adapter, D3D11 WARP)" })),
    ).toBe("low");
  });

  it("does NOT override for a real GPU renderer string", () => {
    expect(
      detectTier(
        env({
          hardwareConcurrency: 12,
          deviceMemory: 16,
          webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
        }),
      ),
    ).toBe("high");
  });

  it("falls through to the existing heuristics when no renderer string is available", () => {
    // Absent context (jsdom/SSR/blocked WebGL probe) must not be treated as
    // software rendering — the conservative heuristics still decide.
    expect(
      detectTier(env({ hardwareConcurrency: 12, deviceMemory: 16, webglRenderer: undefined })),
    ).toBe("high");
  });

  it("an EXPLICIT player quality setting still wins over the software-GL detection", () => {
    // resolveQuality's contract: only "auto" follows the detected tier.
    const detected = detectTier(env({ webglRenderer: SWIFTSHADER }));
    expect(detected).toBe("low");
    expect(resolveQuality("high", detected).tier).toBe("high");
    expect(resolveQuality("auto", detected).tier).toBe("low");
  });
});

describe("readEnv — WebGL renderer probe", () => {
  it("does not throw where WebGL is unavailable (jsdom) and reports no renderer string", () => {
    // jsdom has no WebGL: `canvas.getContext("webgl")` is not implemented. The
    // probe must swallow that (no crash) and report `undefined` — no override.
    const e = readEnv();
    expect(e.webglRenderer).toBeUndefined();
  });
});
