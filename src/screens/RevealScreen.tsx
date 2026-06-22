import { useEffect, useRef } from "react";

interface RevealScreenProps {
  /** The prompt that was answered. Echoed alongside the answer for context. */
  prompt: string;
  /**
   * The player's answer, echoed VERBATIM. App carries the RAW, untrimmed string
   * the player typed (D6), so leading/trailing/internal whitespace and newlines
   * survive to here unchanged.
   */
  answer: string;
  /** Return to the title screen. App dispatches the `playAgain` command. */
  onPlayAgain: () => void;
}

/**
 * Reveal screen — the end of the Title -> Prompt -> Reveal flow. It shows the
 * prompt that was answered and echoes the player's answer back. Pure
 * presentational apart from the mount-time focus effect that lands
 * keyboard/screen-reader users on the heading after the transition (D8).
 *
 * The answer is rendered as plain React text children (default-escaped; never
 * dangerouslySetInnerHTML) inside an element with `white-space: pre-wrap`
 * (.answer-echo), so what the player typed displays exactly — including
 * surrounding/internal whitespace and newlines — and any HTML-looking text
 * shows literally rather than being interpreted as markup (D6).
 */
export function RevealScreen({ prompt, answer, onPlayAgain }: RevealScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // D8: move focus to this screen's heading on mount. The heading carries
  // tabIndex={-1} because a bare <h1> is not programmatically focusable.
  // This is the only effect in the screen; focusing is idempotent, so
  // StrictMode's double-invoke is harmless.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="reveal-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        Here&rsquo;s your answer
      </h1>
      <p className="reveal-prompt">{prompt}</p>
      {/* D6: escaped React text children + white-space: pre-wrap, so the raw
          answer is echoed exactly as typed and never parsed as HTML. */}
      <p className="answer-echo">{answer}</p>
      <button className="cta" type="button" onClick={onPlayAgain}>
        Play again
      </button>
    </main>
  );
}
