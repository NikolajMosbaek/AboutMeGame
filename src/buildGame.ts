import type { Engine } from "./engine/Engine.ts";
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
import { buildForage } from "./forage/buildForage.ts";
import { createForageStore, type ForageStore } from "./forage/forageStore.ts";
import { ForageSystem } from "./forage/ForageSystem.ts";
import { buildTreasure } from "./quest/buildTreasure.ts";
import { createQuestStore, type QuestStore } from "./quest/questStore.ts";
import { QuestSystem, TUNE as QUEST_TUNE, type DiscoveredIds } from "./quest/QuestSystem.ts";
import { POI_ANCHORS } from "./world/worldConfig.ts";
import { SPAWN } from "./world/worldConfig.ts";
import { AudioSystem } from "./audio/AudioSystem.ts";
import { installAudioResume } from "./audio/resumeNet.ts";
import { DiscoveryBurstSystem } from "./fx/DiscoveryBurstSystem.ts";
import { TreasureBurstSystem } from "./fx/TreasureBurstSystem.ts";
import { buildWildlife } from "./wildlife/buildWildlife.ts";

export interface Game {
  world: World;
  player: Player;
  discovery: Discovery;
  session: GameSession;
  /** The day-cycle palette accessor (same reference as `world.dayCycle`),
   *  surfaced at the top level so it satisfies `GameHandle.dayCycle` — the
   *  seam `GameCanvas` wires the renderer-owning `EnvLightSystem` (visual-
   *  overhaul slice 2) through, without needing the whole `World`. */
  dayCycle: World["dayCycle"];
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
  /** Foraging (pivot slice E): pick-and-eat plants. */
  forage: { store: ForageStore };
  /** The treasure quest (pivot slice G): the win condition. `getFinaleGlow`
   *  (visual-overhaul slice 7) is `TreasureBurstSystem`'s own 0..1 sweep
   *  signal, surfaced here (not the system itself) so `GameCanvas` can thread
   *  it into the compositor's golden screen-sweep without reaching into fx. */
  quest: { store: QuestStore; getFinaleGlow(): number };
  /** Toggle the sun's shadow casting live (#47), so a quality change in the menu
   *  re-applies shadows in BOTH directions — the renderer's shadowMap.enabled
   *  flag alone can't turn shadows back on once the caster was built without it. */
  setShadowsEnabled(enabled: boolean): void;
  /** Touch surface for the shell: `pressInteract` queues the same edge the E
   *  key does (TouchActionButton calls it on tap), and `touchActive` mirrors
   *  the input layer's live signal so GameCanvas knows when to mount the
   *  button at all (mobile-controls upgrade). */
  input: { pressInteract(): void; touchActive: boolean };
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
  // Stores exist before the systems that write them: the explorer's sprint
  // gate reads stamina, the quest mirrors deaths/eaten — all without circular
  // seams (systems register later, in interact-key priority order).
  const survivalStore = createSurvivalStore();
  const forageStoreEarly = createForageStore();
  const questStore = createQuestStore(POI_ANCHORS.length);
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
  // The treasure quest registers BEFORE discovery: once every page is read,
  // the dig press outranks re-opening the fig's clue text. Its view of the
  // read pages is late-bound to the discovery store built just after.
  const treasure = buildTreasure(world.landmarks);
  let discoveredIds: DiscoveredIds = () => [];
  let sitePanelOpen: () => boolean = () => false;
  // Late-bound (wildlife registers further down): the finale startles every
  // bird flock at once — the whole jungle answers the dig.
  let onFinaleStart: () => void = () => {};
  const questSystem = new QuestSystem(
    POI_ANCHORS.map((a) => a.poiId),
    treasure.digPoint,
    player.explorer,
    player.input,
    () => discoveredIds(),
    () => sitePanelOpen(),
    survivalStore,
    forageStoreEarly,
    questStore,
    session,
    treasure.reveal,
    treasure.dispose,
    () => onFinaleStart(),
  );
  engine.addSystem(questSystem);

  const discovery = buildDiscovery(engine, world, player, session);
  discoveredIds = () => discovery.store.getSnapshot().discoveredIds;
  sitePanelOpen = () => discovery.store.getSnapshot().open !== null;

  // Survival rules — AFTER discovery in the update order, so an interact press
  // near a clue site opens the clue and only a free press reaches food/drink.
  const survivalSystem = new SurvivalSystem(
    player.explorer,
    player.input,
    world.waterDepthAt,
    survivalStore,
    discovery.store,
    session,
    SPAWN,
  );

  // Foraging sits BETWEEN discovery and survival on the shared interact key:
  // sites first, then a pick, and survival's unconditional drain stays the
  // terminal sink (so no press ever banks). Registration order = priority.
  const forage = buildForage(world.terrain, quality.propDensity);
  engine.scene.add(forage.group);
  const forageStore = forageStoreEarly;
  const forageSystem = new ForageSystem(
    forage.plants,
    player.explorer,
    player.input,
    discovery.store,
    (amount) => survivalSystem.eat(amount),
    forageStore,
    session,
    forage.setRipe,
    () => forage.dispose(),
  );
  engine.addSystem(forageSystem);
  engine.addSystem(survivalSystem);
  sprintGate = survivalSystem.canSprint;

  // Wildlife (pivot slice F, #184): birds, butterflies/fireflies, fish, snakes
  // and the jaguar — ambient life that reacts to (and hunts) the player.
  // Registered AFTER survival so a snake strike or jaguar pounce can call the
  // exact same hurt() seam starvation death uses, via a plain callback
  // (buildWildlife never sees the SurvivalSystem itself). Captured (not
  // discarded) so the audio slice can poll snakes/jaguar for their warning
  // edges, and the finale can startle the birds.
  const wildlife = buildWildlife(
    engine,
    world,
    player.explorer,
    session,
    (amount) => survivalSystem.hurt(amount),
    settings,
    // The monkey heist steals through the SAME plants/ripeness seam the
    // forage system owns; a scooped drop nourishes like a real pick (J1 #220).
    {
      plants: forage.plants,
      setRipe: forage.setRipe,
      creditEat: (kind) => forageSystem.creditExternalEat(kind),
    },
  );
  onFinaleStart = () => wildlife.birds.startle();

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

  // The completion spectacle (owner note 2026-07-10): golden motes spiral up
  // from the dig point and the idol's emissive pulses through the bloom for
  // the finale window the quest store publishes. Reduced motion inside the
  // system swaps the spiral for a static glow. Captured (not discarded) so
  // its `getFinaleGlow()` (visual-overhaul slice 7) can ride along on `Game.quest`
  // for the compositor's golden screen-sweep.
  const treasureBurst = new TreasureBurstSystem(
    engine.scene,
    questStore,
    {
      x: treasure.digPoint.x,
      y: world.terrain.heightAt(treasure.digPoint.x, treasure.digPoint.z),
      z: treasure.digPoint.z,
    },
    settings,
    treasure.setIdolEmissive,
    QUEST_TUNE.finaleSeconds,
  );
  engine.addSystem(treasureBurst);

  // Audio (#51 SFX, #52 ambient bed). Only when a context factory is available
  // (skipped headless). The AudioSystem is a System, so engine.dispose() tears
  // down the AudioEngine (stop oscillators, close the context) on unmount.
  if (ctxFactory) {
    const audio = new AudioEngine(ctxFactory);
    engine.addSystem(
      new AudioSystem(
        audio,
        discovery.store,
        player.explorer,
        settings,
        world.dayCycle,
        world.waterDepthAt,
        survivalStore,
        forageStore,
        questStore,
        wildlife.snakes,
        wildlife.jaguar,
      ),
    );
    // Mobile-Safari survival net (S4): a PERSISTENT resume on every gesture and
    // on returning to the foreground (a one-shot unbind died the moment iOS
    // interrupted the context a second time), plus the silent-element unlock
    // that moves Web Audio onto the media channel so the hardware silent
    // switch doesn't mute an opted-in mix. Torn down on engine.dispose().
    engine.addSystem(installAudioResume(audio, overlay));
  }

  return {
    world,
    player,
    discovery,
    session,
    dayCycle: world.dayCycle,
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
        // The troop goes back to its own life — no thief mid-gag over a body.
        wildlife.monkeys.reset();
      },
      eat: (amount: number) => survivalSystem.eat(amount),
      hurt: (amount: number) => survivalSystem.hurt(amount),
    },
    forage: { store: forageStore },
    quest: { store: questStore, getFinaleGlow: () => treasureBurst.getFinaleGlow() },
    setShadowsEnabled(enabled) {
      world.sky.sun.castShadow = enabled;
    },
    input: {
      pressInteract: () => player.input.pressInteract(),
      get touchActive() {
        return player.input.touchActive;
      },
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
