import { render, screen, fireEvent } from "@testing-library/react";
import { TitleScreen } from "./TitleScreen.tsx";
import { VISION } from "../version.ts";

// TitleScreen is a pure presentational component: it shows the game title,
// the real product vision, the version marker, and an ENABLED Start CTA that
// calls back to its parent. App owns the screen state; this component owns no
// state, only a mount-time focus effect (D8) so keyboard/screen-reader users
// land on the new screen's heading after every transition.
describe("TitleScreen", () => {
  it("renders the game title as the page heading and focuses it on mount", () => {
    render(<TitleScreen onStart={() => {}} />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "AboutMeGame",
    });
    expect(heading).toBeInTheDocument();
    // D8: focus moves to the new screen's heading so no keyboard user is
    // stranded. A bare <h1> is not focusable, so this also proves tabIndex.
    expect(document.activeElement).toBe(heading);
  });

  it("shows the real product vision as the tagline", () => {
    render(<TitleScreen onStart={() => {}} />);
    expect(screen.getByText(VISION)).toBeInTheDocument();
  });

  it("presents an ENABLED Start CTA that calls onStart once when clicked", () => {
    let calls = 0;
    render(<TitleScreen onStart={() => (calls += 1)} />);

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeEnabled();

    fireEvent.click(start);
    expect(calls).toBe(1);
  });
});
