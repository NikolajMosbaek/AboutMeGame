import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Engine } from "./Engine.ts";
import { createRenderer, applyRendererQuality } from "./createRenderer.ts";
import { installContextLossHandlers } from "./contextLoss.ts";
import type { createBloomCompositor, Compositor } from "./createCompositor.ts";
import { EnvLightSystem } from "../world/envLightSystem.ts";
import type { DayCycleSystem } from "../world/dayCycleSystem.ts";
import { buildGame } from "../buildGame.ts";
import { detectDeviceTier } from "../perf/deviceCapability.ts";
import { resolveQuality, type QualityConfig } from "../perf/quality.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";
import { useReducedMotion } from "../settings/reducedMotion.ts";
import { StatsOverlay } from "../perf/StatsOverlay.tsx";
import { RevealPanel } from "../ui/RevealPanel.tsx";
import { Hud } from "../ui/Hud.tsx";
import { DangerIndicator } from "../ui/DangerIndicator.tsx";
import type { DangerStore } from "../wildlife/dangerWarning.ts";
import { LookPrompt } from "../ui/LookPrompt.tsx";
import { Crosshair } from "../ui/Crosshair.tsx";
import { Onboarding } from "../ui/Onboarding.tsx";
import { SettingsMenu } from "../ui/SettingsMenu.tsx";
import { JournalPanel } from "../ui/JournalPanel.tsx";
import { DiscoveryAnnouncer } from "../ui/DiscoveryAnnouncer.tsx";
import { TreasurePanel } from "../ui/TreasurePanel.tsx";
import { SurvivalMeters } from "../ui/SurvivalMeters.tsx";
import { UnderwaterOverlay } from "../ui/UnderwaterOverlay.tsx";
import { DamageOverlay } from "../ui/DamageOverlay.tsx";
import { DeathOverlay } from "../ui/DeathOverlay.tsx";
import { ActionHint } from "../ui/ActionHint.tsx";
import { TouchActionButton } from "../ui/TouchActionButton.tsx";
import type { SurvivalStore } from "../survival/survivalStore.ts";
import type { ForageStore } from "../forage/forageStore.ts";
import type { QuestStore } from "../quest/questStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { JournalPoi } from "../content/discoverablePois.ts";
import type { HudStore } from "../ui/hudStore.ts";
import type { SettingsStore } from "../settings/settingsStore.ts";
import type { GameSession } from "../gameSession.ts";

/** The slice of the built game the React shell needs. A subset of `Game`, so the
 *  default `buildGame` satisfies it and a preview/test can return a minimal one. */
export interface GameHandle {
  /** The live weather read (W1 #226) — EnvLight's dim hook. Optional so
   *  preview/legacy builders without a weather system stay valid. */
  weather?: { snapshot(): { dim: number; rain01: number } };
  discovery: {
    store: DiscoveryStore;
    reset(): void;
    pois: { id: string; order: number; title: string }[];
    /** Position-free projection of the landmarks for the journal UI (M3): content
     *  + colour with no THREE leaking into React. Additive to `pois`, which keeps
     *  the THREE `position` the engine's systems read. */
    journalPois: JournalPoi[];
    /** Drain the queued interact edge before opening a reveal from the journal,
     *  so the next `DiscoverySystem.update` can't consume a stale Enter/e press
     *  and close it one tick later. */
    consumeInteract(): boolean;
  };
  hud: HudStore;
  /** Wildlife-threat state for the visual danger banner. Optional so a minimal
   *  preview/test build without wildlife still mounts. */
  danger?: DangerStore;
  settings: SettingsStore;
  session: GameSession;
  /** Survival meters + the death→respawn action (pivot slice D). Optional so a
   *  minimal preview/test build without survival still mounts. */
  survival?: { store: SurvivalStore; respawn(): void };
  /** Foraging (pivot slice E) — the pick hint reads it. */
  forage?: { store: ForageStore };
  /** The treasure quest (pivot slice G) — dig prompt + win screen.
   *  `getFinaleGlow` (visual-overhaul slice 7) feeds the compositor's finale
   *  golden sweep — see `createBloomCompositor`'s `finaleSource` param. */
  quest?: { store: QuestStore; getFinaleGlow(): number; clearWin?(): void };
  /** Toggle shadow casting live when graphics quality changes (#47). */
  setShadowsEnabled?: (enabled: boolean) => void;
  /** Touch surface (mobile-controls upgrade): `pressInteract` queues the same
   *  edge the E key does, and `touchActive` gates mounting TouchActionButton.
   *  Optional so a minimal preview/test build without it still mounts. */
  input?: { pressInteract(): void; touchActive: boolean };
  /** The day-cycle palette + sun-direction accessor (visual-overhaul slices 2
   *  and 5) — when present, GameCanvas builds `EnvLightSystem` directly
   *  against it and (high tier) feeds the compositor's god rays the live sun
   *  direction (mirroring how it owns the compositor: `PMREMGenerator`/the
   *  real renderer neither `buildWorld` nor `buildGame` ever touch, keeping
   *  them headless-testable). Optional so a minimal preview/test build
   *  without it still mounts. */
  dayCycle?: Pick<DayCycleSystem, "getPhase" | "getPalette" | "getSunDirection">;
}

/** Loader for the post-processing module — the code-splitting seam. The default
 *  is a dynamic `import()` of `createCompositor.ts`, which Vite emits as its own
 *  lazy chunk (the `postfx` bucket in `vite.config.ts`), so the LOW tier — which
 *  never calls this — never downloads a byte of `postprocessing`. Injected so
 *  tests can assert the tier gating against a spy instead of a real import. */
export type CompositorLoader = () => Promise<{
  createBloomCompositor: typeof createBloomCompositor;
}>;

const defaultCompositorLoader: CompositorLoader = () => import("./createCompositor.ts");

export interface GameCanvasProps {
  /** Populate the engine with the game's systems (world + movement + discovery +
   *  shell). `overlay` is the canvas container touch controls mount into;
   *  `quality` is the resolved render tier (#47), so the world is built at the
   *  right cost. Returns the game handle (its stores drive the overlays).
   *  Defaults to the real game; injected so a preview/test can build a minimal
   *  scene instead. */
  build?: (engine: Engine, overlay: HTMLElement, quality: QualityConfig) => GameHandle | void;
  /** Load the post-processing module (medium/high only — see the type's doc). */
  loadCompositor?: CompositorLoader;
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
 * It also hosts the Epic 5 shell overlays (HUD, onboarding, pause
 * menu) over the canvas, and owns the menu's open/close state — the one place
 * that toggles `session.setPaused("menu", …)` and applies the Escape-to-open
 * rule (open the menu only when no reveal panel is up, so Escape isn't
 * double-handled with RevealPanel's own close-on-Escape).
 */
export function GameCanvas({
  build = buildGame,
  loadCompositor = defaultCompositorLoader,
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
  const [treasureOpen, setTreasureOpen] = useState(false);
  const [webglError, setWebglError] = useState(false);
  // The GPU context vanished mid-session (mobile memory pressure, driver reset,
  // long backgrounding). We halt the loop and show a reload prompt rather than
  // freezing silently — see the installContextLossHandlers wiring below.
  const [contextLost, setContextLost] = useState(false);

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

    // Bloom is a bake-at-mount knob (like waterDisplacement), gated to the
    // medium/high tiers where `quality.bloom` is true. The post-processing
    // module is a LAZY chunk (the `postfx` bucket in `vite.config.ts`), pulled
    // via `loadCompositor` only when the gate passes — so on low (`bloom:
    // false`) the import is never even requested: zero postprocessing bytes
    // downloaded, zero composer construction, zero post-processing fill cost,
    // and the Engine presents via the bare `renderer.render` forever. On
    // medium/high the Engine starts on the bare path too and renders correctly
    // graded frames (the renderer mounts with AgX + sRGB — see
    // `configureBareRendererColor`) while the chunk is in flight; when it
    // resolves, `createBloomCompositor` atomically re-owns colour
    // (`configureCompositorColor`: renderer → NoToneMapping, the chain's
    // ToneMappingEffect grades with the same AgX) in the same synchronous step
    // that attaches the delegate via `eng.setCompositor` — which also sizes it
    // to the current drawing dimensions — so no frame is ever double- or
    // un-tone-mapped. `cancelled` guards the unmount race: if the component
    // unmounts before the import resolves, nothing is constructed or attached
    // (and there is nothing to dispose — construction and attach are one
    // guarded synchronous block). The scene + camera are created here so the
    // late compositor's RenderPass and the Engine share them.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

    const eng = new Engine({ renderer, scene, camera });
    let cancelled = false;
    const built = build(eng, container, quality);
    if (built) setGame(built);

    if (quality.bloom) {
      // `built?.dayCycle` (its `getSunDirection`) feeds the high-tier god-rays
      // light source, visual-overhaul slice 5 — `built` is already assigned by
      // now (this `.then()` body only ever runs after a real async chunk
      // fetch, so the closure always sees the resolved value, never `undefined`
      // from a stale reference).
      loadCompositor().then(
        ({ createBloomCompositor }) => {
          if (cancelled) return;
          const compositor = createBloomCompositor(
            renderer,
            scene,
            camera,
            quality,
            built?.dayCycle,
            built?.quest,
          );
          compositorRef.current = compositor;
          eng.setCompositor(compositor);
        },
        (err) => {
          // A failed chunk load (offline mid-session, CDN hiccup) is not fatal:
          // the bare path keeps rendering the correctly-graded world, just
          // without the glow/SMAA/vignette garnish.
          console.error("post-processing chunk failed to load — continuing without it:", err);
        },
      );
    }

    // The sky-driven IBL environment light (visual-overhaul slice 2) — built
    // directly here, like the compositor, because `PMREMGenerator` needs the
    // real renderer `buildWorld`/`buildGame` never touch (keeping those
    // headless-testable). Unlike the compositor this needs no lazy chunk
    // (`PMREMGenerator` is core `three`, already eagerly loaded) and runs on
    // EVERY tier (`quality.envDynamic` only gates whether it regenerates), so
    // it is constructed synchronously here rather than behind a dynamic
    // import. `eng.dispose()` on unmount disposes it along with every other
    // registered system — no separate teardown needed.
    if (built?.dayCycle) {
      eng.addSystem(
        new EnvLightSystem(renderer, scene, built.dayCycle, {
          dynamic: quality.envDynamic,
          // This system writes environmentIntensity AFTER WeatherSystem runs,
          // so the shower's ambient darkening applies here, at the write
          // (W1 #226).
          weatherDim: built.weather ? () => built.weather!.snapshot().dim : undefined,
        }),
      );
    }

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

    // WebGL context loss: halt the loop (so it stops spinning on a dead context
    // and the fps read-out can't corrupt) and surface a reload prompt. Every GPU
    // resource is invalidated on loss, so a reload is the clean recovery rather
    // than an in-place re-upload of the whole scene.
    const detachContextLoss = installContextLossHandlers(canvas, {
      onLost: () => {
        eng.stop();
        setContextLost(true);
      },
    });

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
      cancelled = true; // an in-flight compositor load must not attach to a dead engine
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      detachContextLoss();
      delete window.advanceTime;
      delete window.render_game_to_text;
      delete window.__ENGINE_STATE__;
      delete window.__frameView__;
      eng.dispose(); // also disposes the attached compositor (frees its GPU targets)
      rendererRef.current = null;
      compositorRef.current = null;
      setEngine(null);
      setGame(null);
      setMenuOpen(false);
      setJournalOpen(false);
      setTreasureOpen(false);
      setOnboardingOpen(false);
    };
  }, [build, loadCompositor, deviceTier]);

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

  // First-run onboarding pauses the sim under its own reason, like the menu and
  // journal. Without this the world ran behind the tutorial overlay: hunger and
  // thirst drained, wildlife stayed live, and the expedition clock inflated
  // while a new player read the controls. Cleared the instant it is dismissed.
  useEffect(() => {
    game?.session.setPaused("onboarding", onboardingOpen);
  }, [game, onboardingOpen]);

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

  // Rain on the lens (E1 #234): a pure-CSS droplet overlay whose opacity rides
  // the live weather envelope — zero draw calls, decorative only.
  const lensRainRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!game?.weather) return;
    let raf = 0;
    const tick = () => {
      const el = lensRainRef.current;
      if (el) el.style.opacity = String(game.weather!.snapshot().rain01 * 0.35);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [game]);

  // The single keyboard opener. Escape opens the menu and J opens the journal,
  // each only when no other modal owns the foreground — so two modals never
  // stack (RevealPanel/SettingsMenu/TreasurePanel/Onboarding/journal each own
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
        if (treasureOpen) return; // TreasurePanel owns Escape while it's up.
        if (game.discovery.store.getSnapshot().open) return; // RevealPanel owns it.
        setMenuOpen(true);
        return;
      }
      if (e.key === "j" || e.key === "J") {
        if (journalOpen) return; // already open.
        if (menuOpen) return; // a modal is up.
        if (onboardingOpen) return;
        if (treasureOpen) return;
        if (game.discovery.store.getSnapshot().open) return; // reveal is up.
        setJournalOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, menuOpen, journalOpen, onboardingOpen, treasureOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeJournal = useCallback(() => setJournalOpen(false), []);
  // Reset clears BOTH the read pages and the persisted win — otherwise a reset
  // run would relaunch straight back into a solved (already-won) world.
  const resetProgress = useCallback(() => {
    game?.discovery.reset();
    game?.quest?.clearWin?.();
  }, [game]);

  // Replay = a fresh expedition: wipe the saved pages AND the win, then reload —
  // the world, survival meters, plants, wildlife and quest all rebuild from
  // zero. A reload is the one honest full reset now that five systems carry
  // session state.
  const replayExpedition = useCallback(() => {
    game?.discovery.reset();
    game?.quest?.clearWin?.();
    window.location.reload();
  }, [game]);

  // Track the treasure panel's visibility for the Escape/J precedence guards
  // (its rising edge comes from the quest store; "keep exploring" clears it).
  useEffect(() => {
    const store = game?.quest?.store;
    if (!store) return;
    const baseline = store.getSnapshot().treasureFound;
    const onChange = () => {
      if (!baseline && store.getSnapshot().treasureFound) setTreasureOpen(true);
    };
    return store.subscribe(onChange);
  }, [game]);

  if (webglError) {
    return (
      <main className="webgl-fallback">
        <h2>3D couldn’t start here</h2>
        <p>
          Your browser or device couldn’t start the 3D view. Head back and choose{" "}
          <strong>“Can’t play? About this game”</strong> to read what The Lost Idol is.
        </p>
        <button type="button" className="cta" onClick={() => onExit?.()}>
          Back to start
        </button>
      </main>
    );
  }

  if (contextLost) {
    return (
      <main className="webgl-fallback">
        <h2>The 3D view was interrupted</h2>
        <p>
          Your device paused the game’s graphics — this can happen after a long
          time in the background or under memory pressure. Reload to pick the
          expedition back up; your found pages are saved.
        </p>
        <button type="button" className="cta" onClick={() => window.location.reload()}>
          Reload
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
      <div ref={lensRainRef} className="lens-rain" aria-hidden="true" />
      {showStats && engine && <StatsOverlay engine={engine} />}
      {game && (
        <>
          {game.danger && <DangerIndicator danger={game.danger} />}
          {game.input && <LookPrompt session={game.session} touchActive={game.input.touchActive} />}
          {game.input && <Crosshair session={game.session} touchActive={game.input.touchActive} />}
          <Hud
            hud={game.hud}
            discovery={game.discovery.store}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenJournal={() => setJournalOpen(true)}
          />
          {game.survival && (
            <>
              <UnderwaterOverlay survival={game.survival.store} />
              <DamageOverlay survival={game.survival.store} settings={game.settings} />
              <SurvivalMeters survival={game.survival.store} />
              <DeathOverlay survival={game.survival.store} onRespawn={game.survival.respawn} />
              <ActionHint
                survival={game.survival.store}
                forage={game.forage?.store}
                discovery={game.discovery.store}
                quest={game.quest?.store}
                touchActive={game.input?.touchActive}
              />
              {game.input?.touchActive && (
                <TouchActionButton
                  survival={game.survival.store}
                  forage={game.forage?.store}
                  discovery={game.discovery.store}
                  quest={game.quest?.store}
                  onPress={() => game.input?.pressInteract()}
                />
              )}
            </>
          )}
          <DiscoveryAnnouncer store={game.discovery.store} />
          <RevealPanel store={game.discovery.store} pois={game.discovery.pois} quest={game.quest?.store} />
          {game.quest && (
            <TreasurePanel
              quest={game.quest.store}
              onKeepExploring={() => {
                game.session.setPaused("treasure", false);
                setTreasureOpen(false);
                containerRef.current?.focus();
              }}
              onReplay={replayExpedition}
            />
          )}
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
