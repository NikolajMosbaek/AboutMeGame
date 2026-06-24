import { useRef, useEffect } from "react";
import { APP_VERSION, VISION } from "../version.ts";
import { createPersistence } from "../discovery/persistence.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import { readControlChannel, type ControlChannel } from "./controlScheme.ts";

export interface TitleProgress {
  /** How many landmarks have been revealed in a previous session. */
  discovered: number;
  /** The total number of landmarks. */
  total: number;
}

export interface TitleScreenProps {
  /** Enter the world. Wired by `App` to dispatch `{ type: "start" }`. */
  onStart: () => void;
  /** Open the no-WebGL text view (#50). Wired by `App` to dispatch
   *  `{ type: "openTextView" }`. Optional so existing callers/tests need not
   *  pass it; the link is hidden when absent. */
  onReadText?: () => void;
  /** Saved progress, so the CTA reads "Continue" when some exists. Injected so
   *  tests don't touch real storage; defaults to reading the discovery store. */
  progress?: TitleProgress;
  /** Input channel driving the controls hint, so a coarse-pointer visitor sees
   *  touch copy. Injected so tests/previews can force a channel; defaults to the
   *  resolved platform signal (keyboard whenever the pointer is fine or absent). */
  channel?: ControlChannel;
}

// Title-local presentational copy for the one controls hint. Keyboard is the
// existing line verbatim (U+00B7 middot); touch names the on-screen FLY/USE
// buttons built by createTouchControls (src/movement/input.ts). Held here as the
// screen's own prose — not a re-derivation of controlScheme's resolver entries.
const KEYBOARD_HINT = "WASD to drive · F to fly · E to reveal a landmark";
const TOUCH_HINT = "Drag to drive · tap FLY to fly · tap USE to reveal";

/** Read persisted progress without spinning up the engine — the title screen
 *  needs only the count and the landmark total to decide Continue vs Drive in. */
function readProgress(): TitleProgress {
  return { discovered: createPersistence().load().size, total: POI_ANCHORS.length };
}

/**
 * The landing screen (#40): the wordmark, the one-line pitch, a short controls
 * hint, and a single CTA. With saved progress it shows "N / total discovered"
 * and the CTA reads "Continue"; otherwise "Drive in". A secondary link opens the
 * no-WebGL text view (#50) for anyone who can't or won't play. Kept
 * presentational — it owns no game state, only the focus-on-mount affordance.
 */
export function TitleScreen({
  onStart,
  onReadText,
  progress = readProgress(),
  channel = readControlChannel(),
}: TitleScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasProgress = progress.discovered > 0;

  // Move focus to the heading on mount so screen-reader users land at the top
  // of the new screen and keyboard focus has a defined home.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="title-screen">
      {/* Wordmark (#54): a tokenised treatment that reads as intentional — "Me"
          carries the amber accent so the brand's personal note lands, with a
          short accent rule beneath. Split into spans for the visual emphasis;
          aria-label keeps the accessible name a single clean "AboutMeGame". */}
      <h1 ref={headingRef} tabIndex={-1} className="wordmark" aria-label="AboutMeGame">
        <span className="wordmark__about">About</span>
        <span className="wordmark__me">Me</span>
        <span className="wordmark__game">Game</span>
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

      {onReadText && (
        <button type="button" className="title-textlink" onClick={onReadText}>
          Read it without playing
        </button>
      )}

      <p className="title-controls">{channel === "touch" ? TOUCH_HINT : KEYBOARD_HINT}</p>

      <p className="version-marker">v{APP_VERSION}</p>
    </main>
  );
}
