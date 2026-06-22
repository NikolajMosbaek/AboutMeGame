import { useEffect, useRef, useState } from "react";
import {
  createOnboardingPersistence,
  type OnboardingPersistence,
} from "./onboardingPersistence.ts";

export interface OnboardingProps {
  /** Persistence seam — injected so tests/previews substitute their own. */
  persistence?: OnboardingPersistence;
}

/** The controls taught on first run, mirrored by the HUD reminder line. */
const CONTROLS: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: "W A S D", action: "Drive / steer" },
  { keys: "F", action: "Toggle flight" },
  { keys: "Shift", action: "Boost" },
  { keys: "Space", action: "Climb (in flight)" },
  { keys: "E", action: "Reveal a landmark" },
  { keys: "Esc", action: "Menu" },
];

/**
 * First-run onboarding (#43): a one-time overlay listing the controls, dismissed
 * with "Got it, drive in". It does NOT pause the sim — the world keeps running
 * behind it, and dismiss simply removes the overlay (and persists a seen flag so
 * it never returns). Degrades gracefully if storage is blocked (it may re-show,
 * which is harmless). Respects reduced motion via the tokens.css animation rule.
 */
export function Onboarding({ persistence }: OnboardingProps) {
  // Resolve persistence once (default reads real localStorage). Memoised in a
  // ref so a re-render never rebuilds it or re-reads the flag.
  const persistRef = useRef<OnboardingPersistence>(persistence ?? createOnboardingPersistence());
  const [open, setOpen] = useState(() => !persistRef.current.seen());
  const dismissRef = useRef<HTMLButtonElement>(null);

  // Move focus onto the dismiss button so keyboard/AT users land in the dialog.
  useEffect(() => {
    if (open) dismissRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    persistRef.current.markSeen();
    setOpen(false);
  };

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <h2 id="onboarding-title" className="onboarding__title">
          Drive, fly, discover
        </h2>
        <p className="onboarding__lede">
          Roam the island and approach a landmark to reveal a piece of how I build software
          with Claude. Here are the controls:
        </p>
        <dl className="onboarding__controls">
          {CONTROLS.map((c) => (
            <div key={c.keys} className="onboarding__row">
              <dt>
                <kbd>{c.keys}</kbd>
              </dt>
              <dd>{c.action}</dd>
            </div>
          ))}
        </dl>
        <button ref={dismissRef} type="button" className="cta" onClick={dismiss}>
          Got it, drive in
        </button>
      </div>
    </div>
  );
}
