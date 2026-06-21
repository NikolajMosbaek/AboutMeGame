import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";
import { VISION } from "./version.ts";

// Behavioral smoke test: renders the real App and asserts the user-visible
// title, the actual vision tagline, and the CTA exist. This exercises the
// full React render path (the medium the product lives in), not a hardcoded
// snapshot — proving the stack is wired end-to-end.
describe("App title screen", () => {
  it("renders the game title as the page heading", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "AboutMeGame" }),
    ).toBeInTheDocument();
  });

  it("shows the real product vision as the tagline", () => {
    render(<App />);
    expect(screen.getByText(VISION)).toBeInTheDocument();
  });

  it("presents a Start call-to-action", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
