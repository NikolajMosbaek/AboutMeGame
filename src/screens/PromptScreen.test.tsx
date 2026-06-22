import { render, screen, fireEvent } from "@testing-library/react";
import { PromptScreen } from "./PromptScreen.tsx";
import { INITIAL_PROMPT } from "../game.ts";

// PromptScreen is a pure presentational component: it shows the one real "about
// me" prompt as the focused heading (D4, D8), a labeled free-text <textarea>
// whose draft is screen-local (D5), an always-present helper hint (D9), and a
// 'Reveal' CTA (D10) whose NATIVE disabled is derived from the TRIMMED draft.
// Submitting carries the RAW, untrimmed text up to the parent (D6) so the
// reveal screen can echo it verbatim.
describe("PromptScreen", () => {
  it("shows the real prompt as the heading and focuses it on mount", () => {
    render(<PromptScreen onSubmit={() => {}} />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: INITIAL_PROMPT,
    });
    expect(heading).toBeInTheDocument();
    // D8: focus moves to the new screen's heading so no keyboard user is
    // stranded. A bare <h1> is not focusable, so this also proves tabIndex.
    expect(document.activeElement).toBe(heading);
  });

  it("renders a free-text answer field reachable by its visible label", () => {
    render(<PromptScreen onSubmit={() => {}} />);

    // D5/D9: the textarea has a visible, programmatically-associated label, so
    // it is resolvable by accessible name (not by placeholder, not by class).
    const textarea = screen.getByRole("textbox", { name: "Your answer" });
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("shows an always-present helper hint", () => {
    render(<PromptScreen onSubmit={() => {}} />);
    expect(
      screen.getByText("Type your answer to continue"),
    ).toBeInTheDocument();
  });

  it("disables Reveal until the draft has non-whitespace text", () => {
    render(<PromptScreen onSubmit={() => {}} />);

    const reveal = screen.getByRole("button", { name: "Reveal" });
    const textarea = screen.getByRole("textbox", { name: "Your answer" });

    // D5: native disabled, derived from draft.trim() === "".
    expect(reveal).toBeDisabled();

    // Whitespace-only is still empty for the gate.
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(reveal).toBeDisabled();

    // Real text enables it.
    fireEvent.change(textarea, { target: { value: "coffee" } });
    expect(reveal).toBeEnabled();
  });

  it("calls onSubmit with the EXACT raw typed string when Reveal is clicked", () => {
    const submissions: string[] = [];
    render(<PromptScreen onSubmit={(answer) => submissions.push(answer)} />);

    const reveal = screen.getByRole("button", { name: "Reveal" });
    const textarea = screen.getByRole("textbox", { name: "Your answer" });

    // D6: the gate trims, but the value carried up is the RAW, untrimmed text,
    // including surrounding whitespace, so the reveal can echo it verbatim.
    const raw = "  coffee  ";
    fireEvent.change(textarea, { target: { value: raw } });
    fireEvent.click(reveal);

    expect(submissions).toEqual([raw]);
  });
});
