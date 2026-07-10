import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SurvivalMeters, LOW_METER } from "./SurvivalMeters.tsx";
import { DeathOverlay } from "./DeathOverlay.tsx";
import { createSurvivalStore } from "../survival/survivalStore.ts";

function fullSnapshot() {
  return {
    health: 100,
    stamina: 100,
    hunger: 100,
    thirst: 100,
    alive: true,
    deaths: 0,
    canDrink: false,
  };
}

describe("SurvivalMeters (pivot slice D)", () => {
  it("renders all four meters with value-bearing labels", () => {
    const survival = createSurvivalStore();
    survival.set({ ...fullSnapshot(), health: 80, stamina: 55, hunger: 40, thirst: 12 });
    render(<SurvivalMeters survival={survival} />);
    expect(screen.getByRole("img", { name: "Health 80 of 100" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Stamina 55 of 100" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Hunger 40 of 100" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Thirst 12 of 100" })).toBeInTheDocument();
  });

  it(`flags a meter as low at or below ${LOW_METER}`, () => {
    const survival = createSurvivalStore();
    survival.set({ ...fullSnapshot(), thirst: LOW_METER });
    const { container } = render(
      <SurvivalMeters survival={survival} />,
    );
    expect(container.querySelector(".meter--thirst")!.className).toContain("meter--low");
    expect(container.querySelector(".meter--health")!.className).not.toContain("meter--low");
  });

});

describe("DeathOverlay (pivot slice D)", () => {
  it("renders nothing while alive, the dialog when dead, and respawns on click", () => {
    const survival = createSurvivalStore();
    const onRespawn = vi.fn();
    const { container } = render(<DeathOverlay survival={survival} onRespawn={onRespawn} />);
    expect(container.firstChild).toBeNull();

    act(() => survival.set({ ...fullSnapshot(), health: 0, alive: false, deaths: 1 }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/jungle keeps its secrets/i)).toBeInTheDocument();
    // Progress-keeping is stated to the player.
    expect(screen.getByText(/journal survive/i)).toBeInTheDocument();

    const btn = screen.getByRole("button", { name: /wake at camp/i });
    expect(btn).toHaveFocus(); // the only control takes focus on open
    fireEvent.click(btn);
    expect(onRespawn).toHaveBeenCalledOnce();
  });
});
