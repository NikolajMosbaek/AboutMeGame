import { useEffect, useId, useRef, useState } from "react";
import { INITIAL_PROMPT } from "../game.ts";

interface PromptScreenProps {
  /**
   * Submit the player's answer. App dispatches the `submitAnswer` command with
   * the RAW string this passes up — the reveal screen echoes it verbatim (D6).
   */
  onSubmit: (answer: string) => void;
}

/**
 * Prompt screen — the middle of the Title -> Prompt -> Reveal flow. It shows the
 * one real "about me" prompt (D4) and collects a free-text answer. Pure
 * presentational apart from two pieces of *local* state: the in-progress draft
 * (transient text is screen-local, never app/reducer state, so returning to the
 * title and back yields a fresh empty field — D5/D7) and the mount-time focus
 * effect that lands keyboard/screen-reader users on the heading (D8).
 *
 * Integrity rule (empty/whitespace answers are rejected) lives in the reducer;
 * the disabled Reveal button here is a derived reflection of the same trimmed
 * check. The value carried up on submit is the RAW draft, not the trimmed one,
 * so leading/trailing/internal whitespace survives to the reveal (D6).
 */
export function PromptScreen({ onSubmit }: PromptScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState("");
  // Stable id so the visible <label> is programmatically associated with the
  // <textarea> (htmlFor/id), making it resolvable by accessible name (D5/D9).
  const answerId = useId();

  // D8: move focus to this screen's heading on mount. The heading carries
  // tabIndex={-1} because a bare <h1> is not programmatically focusable.
  // Focusing is idempotent, so StrictMode's double-invoke is harmless.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // D5: gate on the TRIMMED draft so a whitespace-only answer cannot continue.
  const canReveal = draft.trim().length > 0;

  return (
    <main className="prompt-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        {INITIAL_PROMPT}
      </h1>
      <label className="answer-label" htmlFor={answerId}>
        Your answer
      </label>
      <textarea
        id={answerId}
        className="answer-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={4}
      />
      <p className="answer-hint">Type your answer to continue</p>
      <button
        className="cta"
        type="button"
        disabled={!canReveal}
        // D6: pass the RAW draft, not the trimmed value, so the reveal echoes
        // exactly what was typed.
        onClick={() => onSubmit(draft)}
      >
        Reveal
      </button>
    </main>
  );
}
