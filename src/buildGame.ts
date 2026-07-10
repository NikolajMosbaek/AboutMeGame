import type { Engine } from "./engine/Engine.ts";
import type { System } from "./engine/types.ts";
import { buildWorld, type World } from "./world/buildWorld.ts";
import { buildPlayer, type Player } from "./player/buildPlayer.ts";
import { buildDiscovery, type Discovery } from "./discovery/buildDiscovery.ts";
import { createSession, type GameSession } from "./gameSession.ts";
import { createHudStore, type HudStore } from "./ui/hudStore.ts";
import { HudSystem } from "./ui/HudSystem.ts";
import { createNavStore, type NavStore } from "./ui/navStore.ts";
import { NavSystem } from "./ui/NavSystem.ts";
import { createSettingsStore, type SettingsStore } from "./settings/settingsStore.ts";
import { QUALITY_TIERS, type QualityConfig } from "./perf/quality.ts";
import { AudioEngine, type AudioContextFactory } from "./audio/AudioEngine.ts";
import { createSurvivalStore, type SurvivalStore } from "./survival/survivalStore.ts";
import { SurvivalSystem } from "./survival/SurvivalSystem.ts";
import { SPAWN } from "./world/worldConfig.ts";
import { AudioSystem } from "./audio/AudioSystem.ts";
import { DiscoveryBurstSystem } from "./fx/DiscoveryBurstSystem.ts";

export interface Game {
  world: World;
  player: Player;
  discovery: Discovery;
  session: GameSession;
  /** Throttled explorer telemetry for the HUD (#42). */
  hud: HudStore;
  /** Projected nav hints to undiscovered landmarks (#44). */
  nav: NavStore;
  /** Persisted player settings (#41), read/written by the pause menu. */
  settings: SettingsStore;
  /** Survival meters + death/respawn (pivot slice D). */
  survival: {
    store: SurvivalStore;
    respawn(): void;
    eat(amount: number): void;
    hurt(amount: number): void;
  };
  /** Toggle the sun's shadow casting live (#47), so a quality change in the menu
   *  re-applies shadows in BOTH directions — the renderer's shadowMap.enabled
   *  flag alone can't turn shadows back on once the caster was built without it. */
  setShadowsEnabled(enabled: boolean): void;
}

/**
 * Compose the whole playable game into an engine: the world, the first-person
 * explorer (input/controller/camera), discovery and the shell overlays — HUD,
 * nav hints, settings. This is the default `GameCanvas` builder. `overlay` is
 * the canvas container touch controls mount into (and the pointer-lock target).
 *
 * System update order is registration order, so the shell systems go in *after*
 * the systems they read: the HUD feed after the explorer, and the nav projector
 * after the camera (both established by `buildPlayer`). The returned stores are
 * what the React overlays subscribe to; `session` is the shared pause flag (set
 * while a reveal panel or the menu is open).
 *
 * `quality` is the resolved render tier (#47); GameCanvas resolves it from the
 * settings store at mount and threads it here so the world is built at the right
 * cost (prop density, shadow map, fog). Defaults to full quality.
 *
 * `ctxFactory` (#51/#52) builds the Web Audio context the AudioEngine drives.
 * Injected so a test passes a fake; the default constructs a real `AudioContext`
 * when the browser has one, and resolves to `undefined` where it doesn't (jsdom,
 * SSR), in which case audio is simply skipped — the game runs silently rather
 * than throwing.
 */
export function buildGame(
  engine: Engine,
  overlay: HTMLElement,
  quality: QualityConfig = QUALITY_TIERS.high,
  ctxFactory: AudioContextFactory | undefined = defaultAudioContextFactory(),
): Game {
  const session = createSession();
  // Survival store exists before the player so the explorer's sprint gate can
  // read stamina without a circular seam (the system itself registers later,
  // after discovery, because the two share the interact edge — clues first).
  const survivalStore = createSurvivalStore();
  // Settings come first now: the world's beacon pulse reads `reducedMotion` from
  // it live (#49), so non-essential motion is gated by the in-game toggle too.
  const settings = createSettingsStore();
  const world = buildWorld(engine, quality, settings);
  // The sprint gate is SurvivalSystem.canSprint — the one rule, exact-valued
  // (the display store rounds). The system is constructed after the player
  // needs the gate, so the composition root carries this one late-bound ref.
  let sprintGate: () => boolean = () => true;
  const player = buildPlayer(
    engine,
    world,
    overlay,
    session,
    settings,
    () => sprintGate(),
  );
  const discovery = buildDiscovery(engine, world, player, session);

  // Survival rules — AFTER discovery in the update order, so an interact press
  // near a clue site opens the clue and only a free press reaches the drink.
  const survivalSystem = new SurvivalSystem(
    player.explorer,
    player.input,
    world.waterDepthAt,
    survivalStore,
    discovery.store,
    session,
    SPAWN,
  );
  engine.addSystem(survivalSystem);
  sprintGate = survivalSystem.canSprint;

  // HUD telemetry feed — registered after the explorer so it reads fresh state.
  const hud = createHudStore();
  engine.addSystem(new HudSystem(player.explorer, hud));

  // Nav hints — registered after the camera so it reads the updated view matrix.
  const nav = createNavStore();
  engine.addSystem(
    new NavSystem(
      engine,
      player.explorer,
      discovery.pois,
      nav,
      discovery.store,
      () => settings.getSnapshot().showDiscoveredMarkers,
    ),
  );

  // Visual juice (#53): a particle pop at a landmark the instant it's revealed.
  // It listens to the same discovery-store event the chime does, and is gated by
  // reduced motion inside the system. Registered after discovery so the store is
  // populated. (The drive-era speed vignette was retired with the vehicle in the
  // first-person pivot — slice B.)
  engine.addSystem(
    new DiscoveryBurstSystem(engine.scene, discovery.store, world.landmarks.placed, settings),
  );

  // Audio (#51 SFX, #52 ambient bed). Only when a context factory is available
  // (skipped headless). The AudioSystem is a System, so engine.dispose() tears
  // down the AudioEngine (stop oscillators, close the context) on unmount.
  if (ctxFactory) {
    const audio = new AudioEngine(ctxFactory);
    engine.addSystem(
      new AudioSystem(audio, discovery.store, player.input, settings),
    );
    // Autoplay fallback: browsers may keep the context suspended until a real
    // user gesture even though GameCanvas mounts post-click. Resume on the first
    // pointer/key event, then unbind (the listeners live with the audio and are
    // torn down via this disposer system on engine.dispose()).
    engine.addSystem(installAudioResume(audio));
  }

  return {
    world,
    player,
    discovery,
    session,
    hud,
    nav,
    settings,
    survival: {
      store: survivalStore,
      // Death can strike mid-read (a snake while a clue is open): close any
      // stale reveal on wake so its pause reason can't outlive the overlay.
      respawn: () => {
        discovery.store.closePoi();
        survivalSystem.respawn();
      },
      eat: (amount: number) => survivalSystem.eat(amount),
      hurt: (amount: number) => survivalSystem.hurt(amount),
    },
    setShadowsEnabled(enabled) {
      world.sky.sun.castShadow = enabled;
    },
  };
}

/** A no-op `System` whose only job is to own the one-shot "resume audio on first
 *  user gesture" listeners and unbind them on dispose. It self-removes after the
 *  first event so it never adds per-frame cost. Lives here (the composition root,
 *  which already touches the DOM) rather than in the unit-tested AudioSystem. */
function installAudioResume(audio: AudioEngine): System {
  let unbind = () => {};
  if (typeof window !== "undefined") {
    const onGesture = () => {
      audio.resume();
      unbind();
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    unbind = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }
  return {
    id: "audio-resume",
    update() {},
    dispose() {
      unbind();
    },
  };
}

/** Build a real-`AudioContext` factory when the browser has Web Audio, else
 *  `undefined` so audio is skipped (jsdom, SSR). Falls back to the webkit-prefixed
 *  constructor for older Safari. Kept here so `buildGame`'s default stays a pure
 *  capability check with no side effects until the factory is actually called. */
function defaultAudioContextFactory(): AudioContextFactory | undefined {
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  return Ctor ? () => new Ctor() : undefined;
}
