import { useEffect, useState } from "react";
import type { GameSession } from "../gameSession.ts";

export interface CrosshairProps {
  session: GameSession;
  /** Touch aims by dragging the view, not by a locked centre — no reticle there. */
  touchActive: boolean;
}

/**
 * A subtle centre reticle for the first-person view. Mouse-look aims wherever
 * the view centre points — lining up the dig, facing water to drink, reading a
 * page — but there was no mark for that centre. Shows the reticle only while
 * look is actually live: pointer locked, not paused behind a modal, not touch —
 * the exact complement of {@link LookPrompt} (locked ⇒ reticle, unlocked ⇒
 * "click to look"). Purely decorative: hidden from assistive tech, never eats
 * input, and static so it needs no reduced-motion gate.
 */
export function Crosshair({ session, touchActive }: CrosshairProps) {
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

  if (touchActive || !locked || session.paused) return null;
  return <div className="crosshair" aria-hidden="true" />;
}
