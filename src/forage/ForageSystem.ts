import type { System, FrameContext } from "../engine/types.ts";
import type { GameSession } from "../gameSession.ts";
import type { ForageStore, FruitKind } from "./forageStore.ts";

/** One food plant in the world. `ripe` flips false on pick and back true when
 *  the regrow clock passes; the renderable fruit follows via onRipenessChange. */
export interface FruitPlant {
  kind: FruitKind;
  x: number;
  z: number;
  ripe: boolean;
  /** Seconds of play until this plant fruits again (counts only unpaused). */
  regrowIn: number;
}

/** What one bite is worth, by fruit. */
export const NOURISH: Record<FruitKind, number> = {
  berries: 20,
  banana: 30,
  mango: 40,
};

export const TUNE = {
  /** Reach to pick, metres (a step closer than the clue trigger radius). */
  pickReach: 2.4,
  /** Seconds until a picked plant fruits again. */
  regrowSeconds: 90,
} as const;

/** Where the player is — the explorer satisfies it. */
export interface PositionSource {
  readonly state: { position: { x: number; z: number } };
}

/** The interact edge (shared key): sites outrank foraging (DiscoverySystem runs
 *  first and eats in-range presses); foraging outranks drinking (this system
 *  runs before SurvivalSystem and consumes only presses it uses; survival's
 *  unconditional drain stays the terminal sink). */
export interface InteractSource {
  consumeInteract(): boolean;
}

/** Whether a clue prompt currently owns the key. */
export interface SitePromptSource {
  getSnapshot(): { nearby: { inRange: boolean } | null };
}

/** Restores hunger — buildGame passes SurvivalSystem.eat. */
export type EatSink = (amount: number) => void;

/**
 * Foraging (pivot slice E): walk up to a ripe plant, one press picks and eats
 * — hunger back by the fruit's worth, the plant bare for regrowSeconds of
 * play. Pick-and-eat is ONE action (the design doc's 1-slot inventory was
 * dropped for a tighter loop — recorded in the run log): the jungle is the
 * larder, planning is choosing your route past food, not menu management.
 * Plants and their ripeness are owned here; the renderable fruit meshes
 * subscribe via `onRipenessChange` so this system stays headless-testable.
 */
export class ForageSystem implements System {
  readonly id = "forage";

  constructor(
    private readonly plants: FruitPlant[],
    private readonly player: PositionSource,
    private readonly input: InteractSource,
    private readonly sitePrompt: SitePromptSource,
    private readonly eat: EatSink,
    private readonly store: ForageStore,
    private readonly session: GameSession,
    /** The world hook: flip the plant's fruit visuals on pick/regrow. */
    private readonly onRipenessChange?: (index: number, ripe: boolean) => void,
    /** Owns the renderable plants' teardown (geometries/materials). */
    private readonly disposeWorld?: () => void,
  ) {}

  dispose(): void {
    this.disposeWorld?.();
  }

  private eaten = 0;

  update(ctx: FrameContext): void {
    if (this.session.paused) return; // survival (after us) drains the edge

    // Regrow clocks tick on play time only.
    for (let i = 0; i < this.plants.length; i++) {
      const p = this.plants[i];
      if (!p.ripe) {
        p.regrowIn -= ctx.dt;
        if (p.regrowIn <= 0) {
          p.ripe = true;
          this.onRipenessChange?.(i, true);
        }
      }
    }

    // Nearest ripe plant in reach.
    const pos = this.player.state.position;
    let nearest = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < this.plants.length; i++) {
      const p = this.plants[i];
      if (!p.ripe) continue;
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d <= TUNE.pickReach && d < nearestDist) {
        nearest = i;
        nearestDist = d;
      }
    }

    const siteOwnsKey = this.sitePrompt.getSnapshot().nearby?.inRange ?? false;
    const canPick = nearest >= 0 && !siteOwnsKey;

    if (canPick && this.input.consumeInteract()) {
      const p = this.plants[nearest];
      p.ripe = false;
      p.regrowIn = TUNE.regrowSeconds;
      this.eat(NOURISH[p.kind]);
      this.eaten += 1;
      this.onRipenessChange?.(nearest, false);
      this.store.set({ nearby: null, eaten: this.eaten });
      return;
    }

    this.store.set({
      nearby: canPick ? { kind: this.plants[nearest].kind } : null,
      eaten: this.eaten,
    });
  }

  describe(): Record<string, unknown> {
    return {
      plants: this.plants.length,
      ripe: this.plants.filter((p) => p.ripe).length,
      eaten: this.eaten,
      nearby: this.store.getSnapshot().nearby?.kind ?? null,
    };
  }
}
