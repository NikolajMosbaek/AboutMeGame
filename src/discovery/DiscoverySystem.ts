import type { System, FrameContext } from "../engine/types.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { DiscoveryStore } from "./discoveryStore.ts";
import type { DiscoveryPersistence } from "./persistence.ts";
import type { InputSnapshot } from "../movement/input.ts";
import type { VehicleSystem } from "../movement/vehicle.ts";
import type { GameSession } from "../gameSession.ts";

/** Show the teaser + nav prompt within this horizontal distance of a landmark. */
const TEASER_RADIUS = 32;
/** Close enough to trigger the reveal on interact. */
const INTERACT_RADIUS = 16;

/**
 * Discovery: reveal triggers (#37) + state tracking & persistence (#39).
 *
 * Each frame it finds the nearest landmark and tells the store whether the
 * player is in teaser range (show the line + a nav prompt) or interact range
 * (an interact reveals the full body). Revealing marks the POI discovered,
 * persists it, and pauses the sim (`session.paused`) so the craft holds while
 * reading; a second interact closes the panel and resumes. Reads the vehicle's
 * position and the shared input — both injected, so it's unit-tested with fakes.
 */
export class DiscoverySystem implements System {
  readonly id = "discovery";
  private readonly discovered: Set<string>;

  constructor(
    private readonly input: InputSnapshot,
    private readonly vehicle: VehicleSystem,
    private readonly pois: DiscoverablePoi[],
    private readonly store: DiscoveryStore,
    private readonly persist: DiscoveryPersistence,
    private readonly session: GameSession,
  ) {
    this.discovered = persist.load();
    this.store.setDiscovered([...this.discovered]);
  }

  update(_ctx: FrameContext): void {
    const interact = this.input.consumeInteract();

    // The sim is paused while a reveal panel is open — derived here, so closing
    // the panel from any path (button, Escape, click-out, interact) resumes.
    this.session.setPaused("reveal", this.store.getSnapshot().open !== null);

    // Panel open: an interact closes it; otherwise stay paused.
    if (this.store.getSnapshot().open) {
      if (interact) this.store.closePoi();
      return;
    }

    // Paused by something else (e.g. the menu): the interact edge is already
    // drained above, so we just bail — no reveal opens behind the menu.
    if (this.session.paused) return;

    const p = this.vehicle.state.position;
    let nearest: DiscoverablePoi | null = null;
    let nearestDist = Infinity;
    for (const poi of this.pois) {
      const d = Math.hypot(p.x - poi.position.x, p.z - poi.position.z);
      if (d < TEASER_RADIUS && d < nearestDist) {
        nearestDist = d;
        nearest = poi;
      }
    }

    const inRange = nearest !== null && nearestDist <= INTERACT_RADIUS;
    this.store.setNearby(
      nearest
        ? { id: nearest.id, order: nearest.order, title: nearest.title, teaser: nearest.teaser, inRange }
        : null,
    );

    if (nearest && inRange && interact) {
      this.store.openPoi({ id: nearest.id, order: nearest.order, title: nearest.title, body: nearest.body });
      if (!this.discovered.has(nearest.id)) {
        this.discovered.add(nearest.id);
        this.persist.save(this.discovered);
        this.store.setDiscovered([...this.discovered]);
      }
    }
  }

  /**
   * Wipe progress (#41 "Reset progress"): clear the persisted set and the
   * in-memory Set, and close any open panel, so the world reads as fresh. The
   * settings menu wires its button through here.
   */
  reset(): void {
    this.discovered.clear();
    this.persist.clear();
    this.store.closePoi();
    this.store.setNearby(null);
    this.store.setDiscovered([]);
  }

  /** Test/debug view (also feeds render_game_to_text). */
  describe(): Record<string, unknown> {
    return {
      discovered: this.discovered.size,
      total: this.pois.length,
      nearby: this.store.getSnapshot().nearby?.id ?? null,
      open: this.store.getSnapshot().open?.id ?? null,
    };
  }
}
