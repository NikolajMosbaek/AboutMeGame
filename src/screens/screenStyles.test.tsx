import { render, screen } from "@testing-library/react";
import { PromptScreen } from "./PromptScreen.tsx";
import { RevealScreen } from "./RevealScreen.tsx";
import { INITIAL_PROMPT } from "../game.ts";

// T7 additive-only style guard (D11). The screen/form styles live in the single
// src/tokens.css alongside the title styles; there is no parallel shell, no
// second token file, no CSS framework. These assertions pin the *seams* the CSS
// hooks into — the class names the components emit — so a future change cannot
// silently fork a parallel button style or drop the pre-wrap echo hook that
// makes the verbatim-fidelity contract (D6) actually render whitespace.
//
// jsdom does not apply the stylesheet (no `getComputedStyle` of cascaded rules),
// so the testable invariant is the className wiring, not the resolved CSS value:
// the answer-echo element carries `.answer-echo` (which maps to
// white-space: pre-wrap in tokens.css) and both screens' primary buttons reuse
// the shared `.cta` class rather than introducing a parallel button style.
describe("screen styles are additive and reuse the shared shell classes", () => {
  it("echoes the answer in an element carrying the pre-wrap .answer-echo class", () => {
    const raw = "  a\nb  ";
    render(
      <RevealScreen prompt={INITIAL_PROMPT} answer={raw} onPlayAgain={() => {}} />,
    );

    // D6: the verbatim answer is rendered inside the .answer-echo element, the
    // single class that maps to `white-space: pre-wrap` in src/tokens.css. If
    // this hook were renamed or dropped, the leading/trailing/internal
    // whitespace would collapse on screen even though the text node is exact.
    const echo = screen.getByText(raw, { normalizer: (s) => s });
    expect(echo.className.split(/\s+/)).toContain("answer-echo");
  });

  it("uses the shared .cta class for RevealScreen's primary button (no parallel style)", () => {
    render(
      <RevealScreen
        prompt={INITIAL_PROMPT}
        answer={"coffee"}
        onPlayAgain={() => {}}
      />,
    );

    const playAgain = screen.getByRole("button", { name: "Play again" });
    expect(playAgain.className.split(/\s+/)).toContain("cta");
  });

  it("uses the shared .cta class for PromptScreen's primary button (no parallel style)", () => {
    render(<PromptScreen onSubmit={() => {}} />);

    const reveal = screen.getByRole("button", { name: "Reveal" });
    expect(reveal.className.split(/\s+/)).toContain("cta");
  });
});
