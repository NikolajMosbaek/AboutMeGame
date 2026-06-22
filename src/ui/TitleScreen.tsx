import { useRef, useEffect } from "react";
import { APP_VERSION, VISION } from "../version.ts";

export interface TitleScreenProps {
  /** Enter the world. Wired by `App` to dispatch `{ type: "start" }`. */
  onStart: () => void;
}

/**
 * The landing screen: the wordmark, the one-line pitch, and a single Drive in
 * CTA that drops the player into the world. Kept presentational — it owns no
 * game state, only the focus-on-mount affordance for keyboard/AT users. Epic 5
 * grows this into the full start screen (settings, continue, text-only view).
 */
export function TitleScreen({ onStart }: TitleScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the heading on mount so screen-reader users land at the top
  // of the new screen and keyboard focus has a defined home.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="title-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        AboutMeGame
      </h1>
      <p className="tagline">{VISION}</p>
      <button type="button" className="cta" onClick={onStart}>
        Drive in
      </button>
      <p className="version-marker">v{APP_VERSION}</p>
    </main>
  );
}
