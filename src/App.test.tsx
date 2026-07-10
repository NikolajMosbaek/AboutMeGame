import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// GameCanvas owns a real WebGLRenderer + ResizeObserver, neither of which jsdom
// provides. Stub it so this test can prove App's switchboard (title → playing)
// without WebGL; the Engine↔canvas integration is covered in Engine.test.ts.
vi.mock("./engine/GameCanvas.tsx", () => ({
  GameCanvas: () => <div data-testid="game-canvas">world</div>,
}));

import { App } from "./App.tsx";

describe("App", () => {
  it("opens on the title screen", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "THE LOST IDOL" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("game-canvas")).not.toBeInTheDocument();
  });

  it("mounts the world and leaves the title when Begin the expedition is clicked", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Begin the expedition" }));
    expect(screen.getByTestId("game-canvas")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "THE LOST IDOL" }),
    ).not.toBeInTheDocument();
  });
});
