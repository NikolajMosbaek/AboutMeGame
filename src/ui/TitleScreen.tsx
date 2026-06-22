import { useRef, useEffect } from "react";
import { APP_VERSION, VISION } from "../version.ts";
import { createPersistence } from "../discovery/persistence.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";

export interface TitleProgress {
  /** How many landmarks have been revealed in a previous session. */
  discovered: number;
  /** The total number of landmarks. */
  total: number;
}

export interface TitleScreenProps {
  /** Enter the world. Wired by `App` to dispatch `{ type: "start" }`. */
  onStart: () => void;
  /** Saved progress, so the CTA reads "Continue" when some exists. Injected so
   *  tests don't touch real storage; defaults to reading the discovery store. */
  progress?: TitleProgress;
}

/** Read persisted progress without spinning up the engine — the title screen
 *  needs only the count and the landmark total to decide Continue vs Drive in. */
function readProgress(): TitleProgress {
  return { discovered: createPersistence().load().size, total: POI_ANCHORS.length };
}

/**
 * The landing screen (#40): the wordmark, the one-line pitch, a short controls
 * hint, and a single CTA. With saved progress it shows "N / total discovered"
 * and the CTA reads "Continue"; otherwise "Drive in". Kept presentational — it
 * owns no game state, only the focus-on-mount affordance. (The text-only view
 * link is Epic 6.)
 */
export function TitleScreen({ onStart, progress = readProgress() }: TitleScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasProgress = progress.discovered > 0;

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

      {hasProgress && (
        <p className="title-progress" role="status">
          {progress.discovered} / {progress.total} discovered
        </p>
      )}

      <button type="button" className="cta" onClick={onStart}>
        {hasProgress ? "Continue" : "Drive in"}
      </button>

      <p className="title-controls">
        WASD to drive · F to fly · E to reveal a landmark
      </p>

      <p className="version-marker">v{APP_VERSION}</p>
    </main>
  );
}
