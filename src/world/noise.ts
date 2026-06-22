// Tiny deterministic value noise — no dependency, no extra bundle weight.
//
// A seeded integer hash gives a stable pseudo-random value per lattice point;
// bilinear interpolation with a smoothstep fade makes it continuous; fractal
// Brownian motion (fbm) layers octaves for natural-looking terrain. Deterministic
// from `seed`, so the island is byte-identical on every load and in tests.

export interface Noise2D {
  /** Smooth value in [0,1] at any continuous (x,y). */
  value(x: number, y: number): number;
  /** Fractal sum of octaves, in [0,1]. */
  fbm(x: number, y: number, octaves?: number): number;
}

export function makeNoise2D(seed = 1337): Noise2D {
  const hash = (xi: number, yi: number): number => {
    // 32-bit mixes (Math.imul) keep every term integer-exact regardless of seed
    // magnitude, so mixing isn't weakened by exceeding 2^53.
    let h =
      Math.imul(xi | 0, 374761393) +
      Math.imul(yi | 0, 668265263) +
      Math.imul(seed | 0, 975313579);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);

  const value = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const tl = hash(xi, yi);
    const tr = hash(xi + 1, yi);
    const bl = hash(xi, yi + 1);
    const br = hash(xi + 1, yi + 1);
    const u = fade(xf);
    const v = fade(yf);
    const top = tl + (tr - tl) * u;
    const bot = bl + (br - bl) * u;
    return top + (bot - top) * v;
  };

  const fbm = (x: number, y: number, octaves = 4): number => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  return { value, fbm };
}
