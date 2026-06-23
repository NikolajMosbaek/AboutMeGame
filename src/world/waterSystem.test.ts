import { describe, expect, it, vi } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import type { WaterUniforms } from "./boundaries.ts";
import { WRAP_PERIOD } from "./waterSurface.ts";
import { WaterSystem } from "./waterSystem.ts";

// A live `{value}` uniform handle, identity-stable like the one boundaries
// exposes — the System advances it BY REFERENCE, never by replacing the object.
function fakeUniforms(): WaterUniforms {
  return { uTime: { value: 0 } };
}

// A reduced-motion source whose answer we can flip between frames, so the test
// can prove the gate is read LIVE (mirrors BeaconPulseSystem's seam).
function reducedMotion(still: boolean): ReducedMotionSource {
  return { getSnapshot: () => ({ reducedMotion: still }) };
}

// A frame context with a tracked scene whose `traverse` we can assert is never
// called — the System owns the uniform by reference, it does NOT hunt the graph.
function ctxWith(dt: number): { ctx: FrameContext; traverse: ReturnType<typeof vi.fn> } {
  const traverse = vi.fn();
  const scene = { traverse } as unknown as FrameContext["scene"];
  return { ctx: { scene, camera: {} as never, dt, elapsed: 0 }, traverse };
}

describe("WaterSystem (G1 slice 3, T6)", () => {
  it("advances uTime.value by dt when motion is allowed", () => {
    const uniforms = fakeUniforms();
    const sys = new WaterSystem(uniforms, reducedMotion(false));

    const { ctx } = ctxWith(0.5);
    sys.update(ctx);
    expect(uniforms.uTime.value).toBeCloseTo(0.5, 6);

    sys.update(ctx);
    expect(uniforms.uTime.value).toBeCloseTo(1.0, 6);
  });

  it("HOLDS uTime.value unchanged when reducedMotion is true (no reset to 0)", () => {
    const uniforms = fakeUniforms();
    const still = { reducedMotion: false };
    const source: ReducedMotionSource = { getSnapshot: () => still };
    const sys = new WaterSystem(uniforms, source);

    // Build up a non-zero phase while motion is allowed.
    const { ctx } = ctxWith(0.5);
    sys.update(ctx);
    sys.update(ctx);
    const held = uniforms.uTime.value;
    expect(held).toBeGreaterThan(0);

    // Now ask for reduced motion, read LIVE each frame: the phase must HOLD at
    // its current value, never advance and never snap back to 0.
    still.reducedMotion = true;
    sys.update(ctx);
    expect(uniforms.uTime.value).toBe(held);
    sys.update(ctx);
    expect(uniforms.uTime.value).toBe(held);

    // Releasing the gate resumes from the held phase — no time-jump.
    still.reducedMotion = false;
    sys.update(ctx);
    expect(uniforms.uTime.value).toBeCloseTo(held + 0.5, 6);
  });

  it("never traverses the scene (owns the uniform by reference)", () => {
    const uniforms = fakeUniforms();
    const sys = new WaterSystem(uniforms, reducedMotion(false));
    const { ctx, traverse } = ctxWith(0.016);
    sys.update(ctx);
    sys.update(ctx);
    expect(traverse).not.toHaveBeenCalled();
  });

  it("keeps the same uniform object across updates (structural zero-alloc proof)", () => {
    const uniforms = fakeUniforms();
    const before = uniforms.uTime;
    const sys = new WaterSystem(uniforms, reducedMotion(false));
    const { ctx } = ctxWith(0.1);
    sys.update(ctx);
    sys.update(ctx);
    // The System mutates `.value` in place; it never swaps the `{value}` object,
    // so the live shader keeps reading the same identity-stable reference.
    expect(uniforms.uTime).toBe(before);
  });

  it("wraps the accumulator modulo the shared continuous period", () => {
    const uniforms = fakeUniforms();
    const sys = new WaterSystem(uniforms, reducedMotion(false));
    // One step just past a whole period must wrap back into [0, WRAP_PERIOD),
    // keeping the sin() argument float32-safe on a long-lived tab.
    const { ctx } = ctxWith(WRAP_PERIOD + 0.25);
    sys.update(ctx);
    expect(uniforms.uTime.value).toBeGreaterThanOrEqual(0);
    expect(uniforms.uTime.value).toBeLessThan(WRAP_PERIOD);
    expect(uniforms.uTime.value).toBeCloseTo(0.25, 6);
  });

  it("treats an absent reduced-motion source as motion-on", () => {
    const uniforms = fakeUniforms();
    const sys = new WaterSystem(uniforms);
    const { ctx } = ctxWith(0.2);
    sys.update(ctx);
    expect(uniforms.uTime.value).toBeCloseTo(0.2, 6);
  });
});
