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

// T8: full-flow behavioral suite (D12). Drives the real App end-to-end through
// the Title -> Prompt -> Reveal loop using only the already-installed
// `fireEvent` — NO new dependency (user-event is deliberately avoided). The
// assertions are on roles, labels, and user-visible text, never on class names
// or DOM nesting, so later UX changes do not break them.
describe("App prompt -> answer -> reveal flow", () => {
  // (a) Happy path with the load-bearing VERBATIM-fidelity assertion (D6).
  //
  // The answer carries leading/trailing whitespace ('  latte  '). RTL's default
  // text matcher trims and collapses whitespace, so a naive
  // `getByText('  latte  ')` would THROW (no normalized node equals the raw
  // string) — or, for a different value, silently pass on a normalized match
  // and be a false witness. The contract is therefore asserted with
  // `{ normalizer: (s) => s }`, which disables normalization so the match is
  // against the EXACT raw string the player typed.
  it("echoes the typed answer verbatim, preserving surrounding whitespace", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // The label is visible and programmatically associated, so the field is
    // resolvable by accessible name — not by placeholder or class.
    const answer = screen.getByRole("textbox", { name: "Your answer" });
    const verbatimAnswer = "  latte  ";
    fireEvent.change(answer, { target: { value: verbatimAnswer } });

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    // Reveal screen is mounted: the prompt is echoed for context (default
    // normalization is fine here — INITIAL_PROMPT has no significant
    // whitespace) and the answer is echoed EXACTLY as typed.
    expect(screen.getByText(INITIAL_PROMPT)).toBeInTheDocument();
    expect(
      screen.getByText(verbatimAnswer, { normalizer: (s) => s }),
    ).toBeInTheDocument();
  });

  // Sibling check: internal newlines survive too (the answer field is a
  // <textarea>, and the echo uses white-space: pre-wrap). Same { normalizer }
  // contract — a default match would collapse the newline to a space.
  it("preserves internal newlines in the echoed answer", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const multiline = "first line\nsecond line";
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: multiline },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    expect(
      screen.getByText(multiline, { normalizer: (s) => s }),
    ).toBeInTheDocument();
  });

  // (b) Empty-answer guard across the three states the user moves through
  // (D5): disabled initially, still disabled on whitespace-only, enabled once
  // the draft has real (non-whitespace) text. The native `disabled` attribute
  // is the user-observable gate; the reducer no-op is its source of truth,
  // covered separately in game.test.ts.
  it("disables Reveal until the answer has non-whitespace text", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    const answer = screen.getByRole("textbox", { name: "Your answer" });
    const reveal = screen.getByRole("button", { name: "Reveal" });

    // Initial: empty draft -> disabled.
    expect(reveal).toBeDisabled();

    // Whitespace-only draft -> still disabled (trimmed check).
    fireEvent.change(answer, { target: { value: "   " } });
    expect(reveal).toBeDisabled();

    // Real text -> enabled.
    fireEvent.change(answer, { target: { value: "tea" } });
    expect(reveal).toBeEnabled();

    // Back to whitespace-only -> disabled again (the gate is live, not one-way).
    fireEvent.change(answer, { target: { value: "  " } });
    expect(reveal).toBeDisabled();
  });

  // (c) Reset / leakage (D7). After Play again, the title screen is back AND no
  // trace of the previous answer remains in the DOM. Re-entering the prompt
  // screen yields a FRESH empty textarea — because the in-progress draft lives
  // in PromptScreen-local state, which is discarded when the component unmounts
  // on return to title.
  it("resets to title on Play again with no answer leakage on re-entry", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    const previousAnswer = "my secret answer";
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: previousAnswer },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    // The answer is on the reveal screen before reset.
    expect(screen.getByText(previousAnswer)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));

    // Title screen is back (fresh state, not the reveal screen).
    expect(
      screen.getByRole("heading", { level: 1, name: "AboutMeGame" }),
    ).toBeInTheDocument();
    // The prior answer is gone from the DOM entirely.
    expect(screen.queryByText(previousAnswer)).toBeNull();

    // Re-enter the prompt screen: the textarea is empty, not pre-filled.
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const freshAnswer = screen.getByRole("textbox", { name: "Your answer" });
    expect(freshAnswer).toHaveValue("");
    // And the prior answer text is still absent.
    expect(screen.queryByText(previousAnswer)).toBeNull();
  });

  // (d) Focus management (D8): on a screen change, focus moves to the new
  // screen's heading (an <h1> with tabIndex={-1}, which a bare <h1> lacks).
  // Asserted via document.activeElement so a stranded keyboard/screen-reader
  // user is a test failure, not a silent regression.
  it("moves focus to the new screen heading after a transition", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    const promptHeading = screen.getByRole("heading", {
      level: 1,
      name: INITIAL_PROMPT,
    });
    expect(document.activeElement).toBe(promptHeading);
  });
});
