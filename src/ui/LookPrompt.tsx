import { useEffect, useState } from "react";
import type { GameSession } from "../gameSession.ts";

export interface LookPromptProps {
  session: GameSession;
  /** Touch has no pointer lock, so the prompt never shows there. */
  touchActive: boolean;
}

/**
 * "Click to look" affordance (desktop). Mouse-look runs on pointer lock, which
 * the browser silently drops on Esc, on tab-out, and before the very first
 * click — with no cue that the mouse no longer turns the view. This shows a
 * prompt whenever the game is actively playing (not paused behind a modal) but
 * the pointer is not locked, so a player who lost look knows to click to get it
 * back. The game only ever locks its own canvas, so a non-null
 * `document.pointerLockElement` means look is live. Purely a mouse hint, hidden
 * from assistive tech.
 */
export function LookPrompt({ session, touchActive }: LookPromptProps) {
  const [locked, setLocked] = useState(
    () => typeof document !== "undefined" && document.pointerLockElement != null,
  );
  useEffect(() => {
    const update = () => setLocked(document.pointerLockElement != null);
    update();
    document.addEventListener("pointerlockchange", update);
    document.addEventListener("pointerlockerror", update);
    return () => {
      document.removeEventListener("pointerlockchange", update);
      document.removeEventListener("pointerlockerror", update);
    };
  }, []);

  if (touchActive || locked || session.paused) return null;
  return (
    <div className="look-prompt" aria-hidden="true">
      Click to look around
    </div>
  );
}
