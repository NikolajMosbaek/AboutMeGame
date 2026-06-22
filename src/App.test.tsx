import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";
import { VISION } from "./version.ts";

// Behavioral smoke test: renders the real App and asserts the user-visible
// title and the actual vision tagline exist. This exercises the full React
// render path (the medium the product lives in), not a hardcoded snapshot —
// proving the stack is wired end-to-end. The slice is strictly read-only, so
// it also asserts no interactive control is present.
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

  it("renders no interactive control (read-only slice)", () => {
    render(<App />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
