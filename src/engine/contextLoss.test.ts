import { describe, expect, it, vi } from "vitest";
import { installContextLossHandlers } from "./contextLoss.ts";

describe("installContextLossHandlers", () => {
  it("preventDefaults the loss event and fires onLost", () => {
    const canvas = document.createElement("canvas");
    const onLost = vi.fn();
    installContextLossHandlers(canvas, { onLost });

    const e = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(e);

    // preventDefault is the required "the app will handle restoration" signal.
    expect(e.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledOnce();
  });

  it("fires onRestored on the restore event (when provided)", () => {
    const canvas = document.createElement("canvas");
    const onRestored = vi.fn();
    installContextLossHandlers(canvas, { onLost: () => {}, onRestored });

    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it("does not throw on restore when onRestored is omitted", () => {
    const canvas = document.createElement("canvas");
    installContextLossHandlers(canvas, { onLost: () => {} });
    expect(() => canvas.dispatchEvent(new Event("webglcontextrestored"))).not.toThrow();
  });

  it("cleanup detaches both listeners", () => {
    const canvas = document.createElement("canvas");
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const detach = installContextLossHandlers(canvas, { onLost, onRestored });
    detach();

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onLost).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });
});
