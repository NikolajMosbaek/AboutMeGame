import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.tsx";
import { INITIAL_PROMPT } from "./game.ts";
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

// T6: App owns the screen state via useReducer(gameReducer) and switches on
// screen.kind to render exactly one screen. Clicking Start dispatches `start`,
// which advances the reducer to the prompt screen. Because App renders screens
// conditionally (not CSS-hidden), the title heading is REMOVED from the DOM —
// proving the single reducer-to-render seam, not a toggled visibility flag.
describe("App screen routing", () => {
  it("advances from title to prompt on Start, removing the title from the DOM", () => {
    render(<App />);

    // Initial state is the title screen.
    expect(
      screen.getByRole("heading", { level: 1, name: "AboutMeGame" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // Conditional render: the title heading and tagline are gone from the DOM,
    // not merely hidden — queryByRole returns null.
    expect(
      screen.queryByRole("heading", { level: 1, name: "AboutMeGame" }),
    ).toBeNull();
    expect(screen.queryByText(VISION)).toBeNull();

    // The prompt screen is now mounted: its heading is the real prompt copy and
    // a free-text answer field is present.
    expect(
      screen.getByRole("heading", { level: 1, name: INITIAL_PROMPT }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
