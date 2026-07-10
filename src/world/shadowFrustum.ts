// Pure math for the player-following, texel-snapped shadow frustum
// (visual-overhaul slice 2). No three/DOM/WebGL — plain `[x, y, z]` tuples
// throughout, mirroring `noise.ts`/`waterSurface.ts`'s dependency-free
// convention, so it's headless-testable and the GPU-touching
// `shadowFrustumSystem.ts` stays a thin "read the camera, call this, write
// the result back" wrapper.

/** A 3D vector as a plain tuple. */
export type Vec3 = readonly [number, number, number];

/** An orthonormal right/up basis spanning a light's view plane — the ortho
 *  shadow camera's own local X/Y axes in world space. */
export interface LightBasis {
  right: Vec3;
  up: Vec3;
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

const WORLD_UP: Vec3 = [0, 1, 0];
/** Fallback up axis used only when the light points (numerically) straight
 *  along world-up, where `cross(worldUp, forward)` degenerates to zero — an
 *  edge case this world's sun elevation never reaches (it never points
 *  straight up/down), kept only so the function stays total. */
const FALLBACK_UP: Vec3 = [0, 0, 1];

/**
 * Derive the orthonormal right/up basis for a light pointing along
 * `direction` (need not be unit — only its direction is used). This
 * reproduces exactly what `THREE.Matrix4.lookAt` computes for a camera with
 * the default world-up `(0,1,0)` (`right = normalize(worldUp × forward)`,
 * `up = forward × right`) — i.e. the SAME local axes the sun's
 * `OrthographicCamera` shadow camera actually renders with (three positions
 * that camera via `lookAt`, using its default `up`) — without needing a live
 * `THREE.Camera` to ask. That equivalence is what makes snapping along this
 * basis actually align with the rendered shadow map's texel grid.
 */
export function lightBasis(direction: Vec3): LightBasis {
  const forward = normalize(direction); // target -> light, i.e. eye - target normalized (three's "z" axis)
  let right = normalize(cross(WORLD_UP, forward));
  if (length(cross(WORLD_UP, forward)) === 0) {
    right = normalize(cross(FALLBACK_UP, forward));
  }
  const up = normalize(cross(forward, right));
  return { right, up };
}

/**
 * Snap a world position to the light's texel grid, so the point the shadow
 * frustum centers on moves in whole-texel steps instead of continuously —
 * eliminating the sub-texel shimmer/crawl a shadow camera that re-centers on
 * a continuously-moving player would otherwise produce every frame.
 *
 * `texelSize` is world units per shadow-map texel (frustum full width /
 * `mapSize`). Only the components ALONG the light's `right`/`up` axes are
 * snapped (those are what determine which texel a shadow sample falls into);
 * the along-light-direction component is left exactly as given — it only
 * affects near/far depth, never texel alignment.
 */
export function snapToTexelGrid(position: Vec3, basis: LightBasis, texelSize: number): Vec3 {
  if (texelSize <= 0) return position;

  const alongRight = dot(position, basis.right);
  const alongUp = dot(position, basis.up);
  const snappedRight = Math.round(alongRight / texelSize) * texelSize;
  const snappedUp = Math.round(alongUp / texelSize) * texelSize;
  const dRight = snappedRight - alongRight;
  const dUp = snappedUp - alongUp;

  return [
    position[0] + dRight * basis.right[0] + dUp * basis.up[0],
    position[1] + dRight * basis.right[1] + dUp * basis.up[1],
    position[2] + dRight * basis.right[2] + dUp * basis.up[2],
  ];
}
