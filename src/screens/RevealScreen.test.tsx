import { render, screen, fireEvent } from "@testing-library/react";
import { RevealScreen } from "./RevealScreen.tsx";
import { INITIAL_PROMPT } from "../game.ts";

// RevealScreen is a pure presentational component: it shows the screen heading
// as the focused element on mount (D8), the original prompt text, and the
// player's answer echoed VERBATIM as escaped React text children inside an
// element with white-space: pre-wrap (D6) so leading/trailing/internal
// whitespace and newlines display exactly as typed. Its 'Play again' CTA (D10)
// calls back to the parent, which dispatches the `playAgain` command.
describe("RevealScreen", () => {
  it("focuses the heading on mount and renders the prompt text", () => {
    render(
      <RevealScreen
        prompt={INITIAL_PROMPT}
        answer={"  a\nb  "}
        onPlayAgain={() => {}}
      />,
    );

    // D8: focus moves to the new screen's heading so no keyboard user is
    // stranded. A bare <h1> is not focusable, so this also proves tabIndex.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(document.activeElement).toBe(heading);

    // The reveal screen shows the same prompt the player answered (D4 single
    // source of truth — read from the INITIAL_PROMPT constant, not a literal).
    expect(screen.getByText(INITIAL_PROMPT)).toBeInTheDocument();
  });

  it("echoes the answer VERBATIM, preserving leading/trailing/internal whitespace and newlines", () => {
    const raw = "  a\nb  ";
    render(
      <RevealScreen prompt={INITIAL_PROMPT} answer={raw} onPlayAgain={() => {}} />,
    );

    // D6: RTL's default matcher trims and collapses whitespace, so a naive
    // getByText(raw) would throw (or silently pass on a normalized match —
    // a false witness). Disabling the normalizer asserts the EXACT bytes, and
    // scoping to the element lets us also check textContent precisely.
    const echo = screen.getByText(raw, { normalizer: (s) => s });
    expect(echo).toBeInTheDocument();
    expect(echo.textContent).toBe(raw);
  });

  it("renders the answer as escaped text, never as HTML (no dangerouslySetInnerHTML)", () => {
    const htmlish = "<b>x</b>";
    render(
      <RevealScreen
        prompt={INITIAL_PROMPT}
        answer={htmlish}
        onPlayAgain={() => {}}
      />,
    );

    // The literal angle-bracket string must appear as text (default React
    // escaping), not be parsed into a real <b> element.
    const echo = screen.getByText(htmlish, { normalizer: (s) => s });
    expect(echo.textContent).toBe(htmlish);
    expect(echo.querySelector("b")).toBeNull();
  });

  it("calls onPlayAgain exactly once when 'Play again' is clicked", () => {
    let calls = 0;
    render(
      <RevealScreen
        prompt={INITIAL_PROMPT}
        answer={"coffee"}
        onPlayAgain={() => (calls += 1)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(calls).toBe(1);
  });
});
