import { useEffect, useRef } from "react";

export interface TextViewProps {
  /** Return to the title screen (App dispatches `exitToTitle`). */
  onBack: () => void;
}

/**
 * The no-WebGL fallback (#50): a static notice, not a readable document. The
 * old about-me game offered a full text-only replay of its content here; The
 * Lost Idol is a first-person 3D game with nothing equivalent to read, so this
 * screen just explains what the game is and sends the visitor back. Reuses the
 * design tokens; no canvas, no engine, no content payload. Linked from the
 * title screen, with a clear "Back".
 */
export function TextView({ onBack }: TextViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the page heading on mount so AT users land at the top.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="text-view">
      <h1 ref={headingRef} tabIndex={-1} className="text-view__title">
        THE LOST IDOL
      </h1>
      <p className="text-view__lede">
        This expedition needs WebGL/3D, which your browser or device can't run right now.
        The Lost Idol is a first-person jungle survival game: explore an uncharted island,
        drink and forage to stay alive, follow the six torn pages to the ancient fig tree,
        and dig up the Emerald Idol.
      </p>
      <button type="button" className="cta text-view__back" onClick={onBack}>
        ← Back to start
      </button>
    </main>
  );
}
