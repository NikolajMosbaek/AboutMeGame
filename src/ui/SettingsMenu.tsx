import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SettingsStore, Quality } from "../settings/settingsStore.ts";

export interface SettingsMenuProps {
  settings: SettingsStore;
  /** Close the menu and resume the sim. */
  onClose: () => void;
  /** Tear down the world and return to the title screen. */
  onExit: () => void;
  /** Wipe discovery progress (clears persistence + the discovered set). */
  onResetProgress: () => void;
}

const QUALITIES: ReadonlyArray<{ value: Quality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

/**
 * Pause menu / settings (#41). Rendered only while open; the open/close state and
 * the `session.setPaused("menu", …)` toggle live in GameCanvas (the one place
 * that also owns the Escape-to-open rule), so this component is purely the menu
 * surface. Settings are read/written through the injected store (persisted there);
 * audio/quality consumers land in later epics, so for now the toggles just
 * persist. "Reset progress" / "Back to title" are wired up via callbacks.
 * Escape closes the menu (resuming the sim); RevealPanel owns Escape while open,
 * and GameCanvas only opens the menu when no panel is up, so Escape is never
 * double-handled.
 */
export function SettingsMenu({ settings, onClose, onExit, onResetProgress }: SettingsMenuProps) {
  const s = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="menu-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="menu" role="dialog" aria-modal="true" aria-labelledby="menu-title">
        <h2 id="menu-title" className="menu__title">
          Paused
        </h2>

        <label className="menu__row">
          <span>Sound</span>
          <button
            type="button"
            className="menu__toggle"
            role="switch"
            aria-checked={!s.muted}
            onClick={() => settings.set({ muted: !s.muted })}
          >
            {s.muted ? "Muted" : "On"}
          </button>
        </label>

        <div className="menu__row">
          <span>Quality</span>
          <div className="menu__segmented" role="radiogroup" aria-label="Graphics quality">
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                type="button"
                role="radio"
                aria-checked={s.quality === q.value}
                className={`menu__seg${s.quality === q.value ? " menu__seg--on" : ""}`}
                onClick={() => settings.set({ quality: q.value })}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <label className="menu__row">
          <span>Reduced motion</span>
          <button
            type="button"
            className="menu__toggle"
            role="switch"
            aria-checked={s.reducedMotion}
            onClick={() => settings.set({ reducedMotion: !s.reducedMotion })}
          >
            {s.reducedMotion ? "On" : "Off"}
          </button>
        </label>

        <div className="menu__actions">
          <button ref={resumeRef} type="button" className="cta menu__resume" onClick={onClose}>
            Resume
          </button>
          <button type="button" className="menu__btn" onClick={onResetProgress}>
            Reset progress
          </button>
          <button type="button" className="menu__btn" onClick={onExit}>
            Back to title
          </button>
        </div>
      </div>
    </div>
  );
}
