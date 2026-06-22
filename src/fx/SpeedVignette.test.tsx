import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SpeedVignette } from "./SpeedVignette.tsx";
import { vignetteOpacity } from "./speedVignette.ts";
import { createHudStore } from "../ui/hudStore.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";

// An in-memory settings store (no real localStorage) for deterministic tests.
function memSettings() {
  const map = new Map<string, string>();
  const storage: Storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
  return createSettingsStore(storage);
}

describe("vignetteOpacity", () => {
  it("is zero at rest and below the floor", () => {
    expect(vignetteOpacity(0)).toBe(0);
    expect(vignetteOpacity(20)).toBe(0);
  });

  it("ramps with speed and clamps at the top", () => {
    const mid = vignetteOpacity(59);
    expect(mid).toBeGreaterThan(0);
    const full = vignetteOpacity(90);
    expect(full).toBeGreaterThan(mid);
    expect(vignetteOpacity(500)).toBe(full); // clamped, doesn't keep growing
  });
});

describe("SpeedVignette", () => {
  it("darkens as the hud speed rises", () => {
    const hud = createHudStore();
    const settings = memSettings();
    render(<SpeedVignette hud={hud} settings={settings} />);
    const el = screen.getByTestId("speed-vignette");
    expect(el.style.opacity).toBe("0");

    act(() => hud.set({ mode: "drive", speed: 90, altitude: 0 }));
    expect(Number(el.style.opacity)).toBeGreaterThan(0);
  });

  it("stays clear under reduced motion regardless of speed", () => {
    const hud = createHudStore();
    const settings = memSettings();
    settings.set({ reducedMotion: true });
    render(<SpeedVignette hud={hud} settings={settings} />);
    const el = screen.getByTestId("speed-vignette");

    act(() => hud.set({ mode: "drive", speed: 90, altitude: 0 }));
    expect(el.style.opacity).toBe("0");
  });
});
