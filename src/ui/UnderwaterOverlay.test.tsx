import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { UnderwaterOverlay } from "./UnderwaterOverlay.tsx";
import { createSurvivalStore, FULL } from "../survival/survivalStore.ts";

function snapshot(submerged: boolean) {
  return {
    health: FULL,
    stamina: FULL,
    hunger: FULL,
    thirst: FULL,
    breath: FULL,
    submerged,
    alive: true,
    deaths: 0,
    canDrink: false,
  };
}

describe("UnderwaterOverlay (#184)", () => {
  it("renders nothing surfaced, the wash submerged, and clears again on surfacing", () => {
    const survival = createSurvivalStore();
    const { container } = render(<UnderwaterOverlay survival={survival} />);
    expect(container.firstChild).toBeNull();

    act(() => survival.set(snapshot(true)));
    const wash = screen.getByTestId("underwater-overlay");
    // Purely visual: never a click target, never announced.
    expect(wash.getAttribute("aria-hidden")).toBe("true");

    act(() => survival.set(snapshot(false)));
    expect(container.firstChild).toBeNull();
  });
});
