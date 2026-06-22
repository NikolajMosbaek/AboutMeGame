import { useCallback, useEffect, useRef, useState } from "react";
import { Engine } from "./Engine.ts";
import { createRenderer } from "./createRenderer.ts";
import { buildGame } from "../buildGame.ts";
import { StatsOverlay } from "../perf/StatsOverlay.tsx";
import { RevealPanel } from "../ui/RevealPanel.tsx";
import { Hud } from "../ui/Hud.tsx";
import { NavMarkers } from "../ui/NavMarkers.tsx";
import { Onboarding } from "../ui/Onboarding.tsx";
import { SettingsMenu } from "../ui/SettingsMenu.tsx";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { HudStore } from "../ui/hudStore.ts";
import type { NavStore } from "../ui/navStore.ts";
import type { SettingsStore } from "../settings/settingsStore.ts";
import type { GameSession } from "../gameSession.ts";

/** The slice of the built game the React shell needs. A subset of `Game`, so the
 *  default `buildGame` satisfies it and a preview/test can return a minimal one. */
export interface GameHandle {
  discovery: { store: DiscoveryStore; reset(): void };
  hud: HudStore;
  nav: NavStore;
  settings: SettingsStore;
  session: GameSession;
}

export interface GameCanvasProps {
  /** Populate the engine with the game's systems (world + movement + discovery +
   *  shell). `overlay` is the canvas container touch controls mount into. Returns
   *  the game handle (its stores drive the overlays). Defaults to the real game;
   *  injected so a preview/test can build a minimal scene instead. */
  build?: (engine: Engine, overlay: HTMLElement) => GameHandle | void;
  /** Show the runtime stats overlay (#14). Defaults to dev-only. */
  showStats?: boolean;
  /** Return to the title screen (App dispatches `exitToTitle`). The engine is
   *  disposed on unmount, so leaving tears the world down. */
  onExit?: () => void;
}

/**
 * GameCanvas — the React↔Three.js boundary. It owns exactly one `<canvas>` and
 * one `Engine` instance for its lifetime: build the renderer + engine on mount,
 * size it to its container, run the loop, and dispose everything on unmount.
 * No engine state leaks into module scope, so React StrictMode's double-mount
 * (and any test) gets a clean engine each time.
 *
 * It also hosts the Epic 5 shell overlays (HUD, nav hints, onboarding, pause
 * menu) over the canvas, and owns the menu's open/close state — the one place
 * that toggles `session.setPaused("menu", …)` and applies the Escape-to-open
 * rule (open the menu only when no reveal panel is up, so Escape isn't
 * double-handled with RevealPanel's own close-on-Escape).
 */
export function GameCanvas({
  build = buildGame,
  showStats = import.meta.env.DEV,
  onExit,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [game, setGame] = useState<GameHandle | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = createRenderer({ canvas });
    const eng = new Engine({ renderer });
    const built = build(eng, container);
    if (built) setGame(built);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      eng.resize(clientWidth || window.innerWidth, clientHeight || window.innerHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // Pause the loop while the tab is hidden — no point burning battery/GPU.
    const onVisibility = () => (document.hidden ? eng.stop() : eng.start());
    document.addEventListener("visibilitychange", onVisibility);

    // Automation hooks (develop-web-game convention).
    window.advanceTime = (ms: number) => eng.advanceTime(ms);
    window.render_game_to_text = () => JSON.stringify(eng.getState());
    window.__ENGINE_STATE__ = () => eng.getState();

    eng.start();
    setEngine(eng);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      delete window.advanceTime;
      delete window.render_game_to_text;
      delete window.__ENGINE_STATE__;
      eng.dispose();
      setEngine(null);
      setGame(null);
      setMenuOpen(false);
    };
  }, [build]);

  // Reflect the menu's open state onto the shared pause flag so the sim holds
  // while the menu is up (and resumes when it closes, unless a panel still pauses
  // it). Keyed on `game` so it re-attaches if the engine is rebuilt.
  useEffect(() => {
    game?.session.setPaused("menu", menuOpen);
  }, [game, menuOpen]);

  // Escape opens the menu — but only when no reveal panel is open (RevealPanel
  // owns Escape while open; SettingsMenu owns it while the menu is up). This
  // handler is the single opener.
  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen) return; // SettingsMenu handles closing.
      if (onboardingOpen) return; // don't open a hidden menu behind onboarding.
      if (game.discovery.store.getSnapshot().open) return; // RevealPanel owns it.
      setMenuOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, menuOpen, onboardingOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const resetProgress = useCallback(() => game?.discovery.reset(), [game]);

  return (
    <div ref={containerRef} className="game-canvas-container">
      <canvas ref={canvasRef} className="game-canvas" aria-hidden="true" />
      {showStats && engine && <StatsOverlay engine={engine} />}
      {game && (
        <>
          <Hud hud={game.hud} discovery={game.discovery.store} onOpenMenu={() => setMenuOpen(true)} />
          <NavMarkers nav={game.nav} />
          <RevealPanel store={game.discovery.store} />
          <Onboarding onOpenChange={setOnboardingOpen} />
          {menuOpen && (
            <SettingsMenu
              settings={game.settings}
              onClose={closeMenu}
              onExit={() => onExit?.()}
              onResetProgress={resetProgress}
            />
          )}
        </>
      )}
    </div>
  );
}
