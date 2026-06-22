import { useEffect, useRef } from "react";
import { APP_VERSION, VISION } from "../version.ts";

interface TitleScreenProps {
  /** Advance to the prompt screen. App dispatches the `start` command. */
  onStart: () => void;
}

/**
 * Title screen — the entry point of the Title -> Prompt -> Reveal flow. Pure
 * presentational: it owns no game state, only the mount-time focus effect that
 * lands keyboard/screen-reader users on the heading after every screen change
 * (D8). App switches on screen.kind and renders exactly one screen component.
 */
export function TitleScreen({ onStart }: TitleScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // D8: move focus to this screen's heading on mount. The heading carries
  // tabIndex={-1} because a bare <h1> is not programmatically focusable.
  // This is the only effect in the slice; focusing is idempotent, so
  // StrictMode's double-invoke is harmless.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="title-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        AboutMeGame
      </h1>
      <p className="tagline">{VISION}</p>
      <button className="cta" type="button" onClick={onStart}>
        Start
      </button>
      <p className="version-marker">v{APP_VERSION}</p>
    </main>
  );
}
