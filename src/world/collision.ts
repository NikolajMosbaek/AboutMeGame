// Player-vs-solid collision (the "walk through trunks" fix). A CPU-only seam,
// injected into the explorer exactly like `waterDepthAt`/`SwimZones`: the world
// owns WHAT is solid (tree trunks, boulders, later ruin walls), the explorer
// only asks "push me out of anything I'd step into." No geometry, no draw calls,
// no per-frame allocation beyond the returned point — nothing against the render
// budget. The field is built once at world-build time.

/** A solid, walk-blocking circle on the ground plane (a trunk, a boulder). XZ
 *  world metres. Crowns/leaves are deliberately NOT colliders — you brush
 *  through foliage; only the solid core stops you. */
export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** The query the explorer runs on its committed step: push a point out of any
 *  collider it penetrates, sliding along the rim so movement grazes a trunk
 *  rather than passing through it. */
export interface CollisionField {
  resolve(x: number, z: number, playerRadius: number): { x: number; z: number };
}

/** The empty default: nothing collides. The right default for previews and
 *  zone-less unit tests, mirroring the explorer's no-op SwimZones. */
export const NO_COLLISION: CollisionField = {
  resolve: (x, z) => ({ x, z }),
};

/**
 * Build a collision field from a fixed set of ground colliders, bucketed into a
 * uniform XZ spatial hash (default cell 8u ≫ any collider radius) so a per-frame
 * query touches only the ~handful of colliders in the 3×3 cells around the
 * player, never the whole set.
 *
 * `resolve` ejects the point to the rim of every overlapping collider
 * (`r + playerRadius`), iterating twice so a point wedged between two trunks
 * settles instead of overshooting on a single pass; the small iteration cap also
 * stops a dense cluster from trapping the player in a resolve feedback loop.
 * A perfectly-centred overlap (no push direction) is nudged out along +x rather
 * than dividing by zero.
 */
export function buildCollisionField(colliders: readonly Collider[], cellSize = 8): CollisionField {
  if (colliders.length === 0) return NO_COLLISION;
  const grid = new Map<string, Collider[]>();
  const key = (cx: number, cz: number) => `${cx}:${cz}`;
  for (const c of colliders) {
    const k = key(Math.floor(c.x / cellSize), Math.floor(c.z / cellSize));
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(c);
  }
  return {
    resolve(x, z, playerRadius) {
      let px = x;
      let pz = z;
      for (let iter = 0; iter < 2; iter++) {
        const cx = Math.floor(px / cellSize);
        const cz = Math.floor(pz / cellSize);
        let moved = false;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gz = cz - 1; gz <= cz + 1; gz++) {
            const bucket = grid.get(key(gx, gz));
            if (!bucket) continue;
            for (const c of bucket) {
              const min = c.r + playerRadius;
              const dx = px - c.x;
              const dz = pz - c.z;
              const d2 = dx * dx + dz * dz;
              if (d2 >= min * min) continue;
              if (d2 < 1e-9) {
                px = c.x + min; // dead centre — nudge out along +x
                moved = true;
                continue;
              }
              const d = Math.sqrt(d2);
              const push = (min - d) / d;
              px += dx * push;
              pz += dz * push;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      return { x: px, z: pz };
    },
  };
}
