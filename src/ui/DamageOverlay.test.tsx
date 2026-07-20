import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DamageOverlay } from "./DamageOverlay.tsx";
import { createSurvivalStore, FULL, type SurvivalSnapshot } from "../survival/survivalStore.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";

function snap(over: Partial<SurvivalSnapshot> = {}): SurvivalSnapshot {
  return {
    health: FULL,
    stamina: FULL,
    hunger: FULL,
    thirst: FULL,
    breath: FULL,
    submerged: false,
    alive: true,
    deaths: 0,
    canDrink: false,
    ...over,
  };
}

const peakOf = () =>
  Number(screen.getByTestId("damage-overlay").style.getPropertyValue("--damage-peak"));

afterEach(cleanup);

describe("DamageOverlay", () => {
  it("renders nothing until health drops", () => {
    render(<DamageOverlay survival={createSurvivalStore()} settings={createSettingsStore()} />);
    expect(screen.queryByTestId("damage-overlay")).toBeNull();
  });

  it("flashes on a health drop with a peak that scales with the hit, then clears on animation end", () => {
    const survival = createSurvivalStore();
    render(<DamageOverlay survival={survival} settings={createSettingsStore()} />);

    act(() => survival.set(snap({ health: 55 }))); // −45, a jaguar pounce
    const peak = peakOf();
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(0.72);

    // The flash clears itself when its CSS animation ends.
    act(() => fireEvent.animationEnd(screen.getByTestId("damage-overlay")));
    expect(screen.queryByTestId("damage-overlay")).toBeNull();
  });

  it("a smaller hit produces a fainter flash", () => {
    const survival = createSurvivalStore();
    render(<DamageOverlay survival={survival} settings={createSettingsStore()} />);
    act(() => survival.set(snap({ health: 75 }))); // −25, a snake strike
    expect(peakOf()).toBeLessThan(0.6); // fainter than the −45 pounce above
  });

  it("does not flash on healing or on the fatal blow (the death overlay owns that)", () => {
    const survival = createSurvivalStore();
    render(<DamageOverlay survival={survival} settings={createSettingsStore()} />);

    act(() => survival.set(snap({ health: 40 }))); // a hit
    act(() => fireEvent.animationEnd(screen.getByTestId("damage-overlay")));

    act(() => survival.set(snap({ health: 70 }))); // healed — no flash
    expect(screen.queryByTestId("damage-overlay")).toBeNull();

    act(() => survival.set(snap({ health: 0, alive: false }))); // fatal — no flash
    expect(screen.queryByTestId("damage-overlay")).toBeNull();
  });

  it("softens the peak under the reduced-motion setting rather than removing the cue", () => {
    const survival = createSurvivalStore();
    const settings = createSettingsStore();
    settings.set({ reducedMotion: true });
    render(<DamageOverlay survival={survival} settings={settings} />);

    act(() => survival.set(snap({ health: 55 }))); // −45
    const peak = peakOf();
    expect(peak).toBeGreaterThan(0); // still shown
    expect(peak).toBeLessThan(0.4); // but halved from ~0.695
  });
});
