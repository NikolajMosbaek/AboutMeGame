import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Engine } from "./Engine.ts";
import { createRenderer, applyRendererQuality } from "./createRenderer.ts";
import { createBloomCompositor, type Compositor } from "./createCompositor.ts";
import { buildGame } from "../buildGame.ts";
import { detectDeviceTier } from "../perf/deviceCapability.ts";
import { resolveQuality, type QualityConfig } from "../perf/quality.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";
import { useReducedMotion } from "../settings/reducedMotion.ts";
import { StatsOverlay } from "../perf/StatsOverlay.tsx";
import { RevealPanel } from "../ui/RevealPanel.tsx";
import { Hud } from "../ui/Hud.tsx";
import { NavMarkers } from "../ui/NavMarkers.tsx";
import { Onboarding } from "../ui/Onboarding.tsx";
import { SettingsMenu } from "../ui/SettingsMenu.tsx";
import { JournalPanel } from "../ui/JournalPanel.tsx";
import { DiscoveryAnnouncer } from "../ui/DiscoveryAnnouncer.tsx";
import { CompletionPanel } from "../ui/CompletionPanel.tsx";
import { SurvivalMeters } from "../ui/SurvivalMeters.tsx";
import { DeathOverlay } from "../ui/DeathOverlay.tsx";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { JournalPoi } from "../content/discoverablePois.ts";
import type { HudStore } from "../ui/hudStore.ts";
import type { NavStore } from "../ui/navStore.ts";
import type { SettingsStore } from "../settings/settingsStore.ts";
import type { GameSession } from "../gameSession.ts";

/** The slice of the built game the React shell needs. A subset of `Game`, so the
 *  default `buildGame` satisfies it and a preview/test can return a minimal one. */
export interface GameHandle {
  discovery: {
    store: DiscoveryStore;
    reset(): void;
    pois: { id: string; order: number; title: string }[];
    /** Position-free projection of the landmarks for the journal UI (M3): content
     *  + colour with no THREE leaking into React. Additive to `pois`, which keeps
     *  the THREE `position` NavSystem reads. */
    journalPois: JournalPoi[];
    /** Drain the queued interact edge before opening a reveal from the journal,
     *  so the next `DiscoverySystem.update` can't consume a stale Enter/e press
     *  and close it one tick later. */
    consumeInteract(): boolean;
  };
  hud: HudStore;
  nav: NavStore;
  settings: SettingsStore;
  session: GameSession;
  /** Survival meters + the death→respawn action (pivot slice D). Optional so a
   *  minimal preview/test build without survival still mounts. */
  survival?: { store: SurvivalStore; respawn(): void };
  /** Toggle shadow casting live when graphics quality changes (#47). */
  setShadowsEnabled?: (enabled: boolean) => void;
}

export interface GameCanvasProps {
  /** Populate the engine with the game's systems (world + movement + discovery +
   *  shell). `overlay` is the canvas container touch controls mount into;
   *  `quality` is the resolved render tier (#47), so the world is built at the
   *  right cost. Returns the game handle (its stores drive the overlays).
   *  Defaults to the real game; injected so a preview/test can build a minimal
   *  scene instead. */
  build?: (engine: Engine, overlay: HTMLElement, quality: QualityConfig) => GameHandle | void;
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
  const rendererRef = useRef<ReturnType<typeof createRenderer> | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [game, setGame] = useState<GameHandle | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [webglError, setWebglError] = useState(false);

  // Resolve the device tier once for this mount — `detectDeviceTier` reads real
  // hardware signals, so it's stable for the session and cheap to memoise.
  const deviceTier = useMemo(() => detectDeviceTier(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Resolve quality from the persisted setting + detected tier, *before* the
    // renderer and world are built, so the expensive build-time knobs (prop
    // count, shadow-map size, fog) bake in at the right cost. This reads the
    // same persisted store the menu writes, so the two agree at mount.
    const quality = resolveQuality(createSettingsStore().getSnapshot().quality, deviceTier);

    // A device without a usable WebGL context throws here. Don't crash — fall
    // back to a message pointing at the no-WebGL text view (#50 "can't play").
    let renderer: ReturnType<typeof createRenderer>;
    try {
      renderer = createRenderer({
        canvas,
        maxPixelRatio: quality.maxPixelRatio,
        shadows: quality.shadows,
      });
    } catch (err) {
      console.error("WebGL unavailable — falling back to the text view:", err);
      setWebglError(true);
      return;
    }
    rendererRef.current = renderer;

    // Bloom is a bake-at-mount knob (like waterDisplacement): build the
    // post-processing compositor ONCE here, only on the medium/high tiers where
    // `quality.bloom` is true, so the emissive site accents (and, later, fireflies)
    // glow. On low (`bloom: false`) we construct nothing and inject no delegate,
    // so the Engine presents via the bare `renderer.render` — zero composer bytes,
    // zero post-processing fill cost. The scene + camera are created here so they
    // can be shared by the compositor's RenderPass and the Engine that renders
    // through it; the Engine's own defaults match these exactly when bloom is off.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    if (quality.bloom) {
      compositorRef.current = createBloomCompositor(renderer, scene, camera, quality);
    }

    const eng = new Engine({
      renderer,
      scene,
      camera,
      compositor: compositorRef.current ?? undefined,
    });
    const built = build(eng, container, quality);
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
    // Deterministic camera framing for the Playwright smoke verifier — aim at a
    // landmark and render one still frame, with the follow camera halted so the
    // framed view holds for the screenshot. No-op on simulation state.
    window.__frameView__ = (eye, target) => eng.renderFromView(eye, target);

    eng.start();
    setEngine(eng);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      delete window.advanceTime;
      delete window.render_game_to_text;
      delete window.__ENGINE_STATE__;
      delete window.__frameView__;
      eng.dispose(); // also disposes the injected compositor (frees its GPU targets)
      rendererRef.current = null;
      compositorRef.current = null;
      setEngine(null);
      setGame(null);
      setMenuOpen(false);
      setJournalOpen(false);
    };
  }, [build, deviceTier]);

  // Apply the *cheap* quality knobs live when the player changes the graphics
  // setting in the menu (#47): the pixel-ratio cap and the shadow-map enable
  // take effect on the next frame via the live renderer. The expensive parts
  // (prop count, shadow-map size, fog) are baked at build time, so the menu
  // surfaces an "applies on reload" note for those. Subscribed to the same store
  // the menu writes; the unsubscribe runs on teardown so no listener leaks.
  useEffect(() => {
    const settings = game?.settings;
    const renderer = rendererRef.current;
    if (!settings || !renderer) return;
    const apply = () => {
      const quality = resolveQuality(settings.getSnapshot().quality, deviceTier);
      applyRendererQuality(renderer, {
        maxPixelRatio: quality.maxPixelRatio,
        shadows: quality.shadows,
      });
      // Re-apply the shadow caster too, so toggling quality up re-enables shadows
      // (the renderer's shadowMap.enabled flag alone can't, since the caster was
      // built without castShadow).
      game?.setShadowsEnabled?.(quality.shadows);
    };
    apply(); // sync once in case the store changed between build and subscribe
    return settings.subscribe(apply);
  }, [game, deviceTier]);

  // Reflect the reduced-motion setting onto <html> so tokens.css can suppress UI
  // motion (the OS media query is the other gate). No-op until the game exists.
  useReducedMotion(game?.settings);

  // Reflect the menu's open state onto the shared pause flag so the sim holds
  // while the menu is up (and resumes when it closes, unless a panel still pauses
  // it). Keyed on `game` so it re-attaches if the engine is rebuilt.
  useEffect(() => {
    game?.session.setPaused("menu", menuOpen);
  }, [game, menuOpen]);

  // The journal pauses the sim under its own reason — distinct from the menu and
  // the reveal, so the three coexist in the session's reason Set. Mirrors the
  // menu effect above; the reveal reason is owned by DiscoverySystem (derived
  // each frame from store.open), so the journal never writes it.
  useEffect(() => {
    game?.session.setPaused("journal", journalOpen);
  }, [game, journalOpen]);

  // The reveal handoff (flaw three): when a journal entry opens a reveal,
  // DiscoverySystem only establishes the "reveal" pause reason on its NEXT tick,
  // one frame after the React `openPoi` commit. If we cleared `journalOpen` at
  // that commit, the journal reason would drop before the reveal reason was
  // added — `paused` would read false for one frame and the vehicle would
  // integrate motion. So we keep `journalOpen` set and clear it only once BOTH
  // the store reports `open != null` AND the session's "reveal" reason is live,
  // i.e. once DiscoverySystem has taken over the pause. We poll per frame from
  // the open commit because that reason flip happens inside the engine loop and
  // emits no store event; the rAF stops the instant the reveal reason lands.
  useEffect(() => {
    if (!game || !journalOpen) return;
    const { store } = game.discovery;
    const { session } = game;
    let raf = 0;
    const tryHandoff = () => {
      if (store.getSnapshot().open && session.isPaused("reveal")) {
        setJournalOpen(false); // reveal reason now overlaps — safe to drop journal
        return;
      }
      raf = requestAnimationFrame(tryHandoff);
    };
    tryHandoff();
    return () => cancelAnimationFrame(raf);
  }, [game, journalOpen]);

  // The single keyboard opener. Escape opens the menu and J opens the journal,
  // each only when no other modal owns the foreground — so two modals never
  // stack (RevealPanel/SettingsMenu/CompletionPanel/Onboarding/journal each own
  // their own keys while up). The journal owns Escape while topmost.
  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      // The death overlay owns the whole keyboard: no menu/journal opens over
      // it (its single button is focused; Enter/Space activate it natively).
      if (game.survival && !game.survival.store.getSnapshot().alive) return;
      // Escape opens the menu — but only when no other modal owns Escape, and
      // the journal owns it while topmost (it closes itself, below). J opens the
      // journal under the same precedence chain, so two modals never stack.
      if (e.key === "Escape") {
        if (journalOpen) return; // JournalPanel handles closing while topmost.
        if (menuOpen) return; // SettingsMenu handles closing.
        if (onboardingOpen) return; // don't open a hidden menu behind onboarding.
        if (completionOpen) return; // CompletionPanel owns Escape while it's up.
        if (game.discovery.store.getSnapshot().open) return; // RevealPanel owns it.
        setMenuOpen(true);
        return;
      }
      if (e.key === "j" || e.key === "J") {
        if (journalOpen) return; // already open.
        if (menuOpen) return; // a modal is up.
        if (onboardingOpen) return;
        if (completionOpen) return;
        if (game.discovery.store.getSnapshot().open) return; // reveal is up.
        setJournalOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, menuOpen, journalOpen, onboardingOpen, completionOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeJournal = useCallback(() => setJournalOpen(false), []);
  const resetProgress = useCallback(() => game?.discovery.reset(), [game]);

  if (webglError) {
    return (
      <main className="webgl-fallback">
        <h2>3D couldn’t start here</h2>
        <p>
          Your browser or device couldn’t start the 3D view. Nothing’s lost — head
          back and choose <strong>“Read it without playing”</strong> to read every
          landmark as text.
        </p>
        <button type="button" className="cta" onClick={() => onExit?.()}>
          Back to start
        </button>
      </main>
    );
  }

  return (
    // tabIndex={-1}: the modal overlays (reveal/completion) return focus here on
    // dismiss via containerRef.focus() — a plain div is unfocusable, so without
    // it that call is a silent no-op and focus drops to <body> (caught by the
    // completion-panel Playwright smoke; the jsdom a11y tests use a focusable
    // stand-in). -1 keeps the container out of the Tab order.
    <div ref={containerRef} className="game-canvas-container" tabIndex={-1}>
      <canvas ref={canvasRef} className="game-canvas" aria-hidden="true" />
      {showStats && engine && <StatsOverlay engine={engine} />}
      {game && (
        <>
          <Hud
            hud={game.hud}
            discovery={game.discovery.store}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenJournal={() => setJournalOpen(true)}
          />
          {game.survival && (
            <>
              <SurvivalMeters survival={game.survival.store} discovery={game.discovery.store} />
              <DeathOverlay survival={game.survival.store} onRespawn={game.survival.respawn} />
            </>
          )}
          <DiscoveryAnnouncer store={game.discovery.store} />
          <NavMarkers nav={game.nav} />
          <RevealPanel store={game.discovery.store} pois={game.discovery.pois} />
          <CompletionPanel
            store={game.discovery.store}
            pois={game.discovery.pois}
            onReplay={resetProgress}
            containerRef={containerRef}
            onOpenChange={setCompletionOpen}
          />
          <Onboarding onOpenChange={setOnboardingOpen} />
          {journalOpen && (
            <JournalPanel
              store={game.discovery.store}
              journalPois={game.discovery.journalPois}
              onClose={closeJournal}
              consumeInteract={game.discovery.consumeInteract}
            />
          )}
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
