// `n8ao` (^1.10.3, ISC) ships no TypeScript types — checked: its package.json
// has no "types"/"typings" field and `dist/` has no `.d.ts` alongside the
// published `N8AO.js`. This is the minimal ambient surface `createCompositor.ts`
// actually uses (just enough for `tsc --noEmit` to type-check the postfx-chunk
// wiring), not a full re-statement of the library's API. Kept in the engine
// seam — the only place a `postprocessing`/`n8ao` object is constructed.
declare module "n8ao" {
  import type { Camera, Color, Scene } from "three";
  import { Pass } from "postprocessing";

  /** The tunable knobs `createCompositor.ts` actually sets — a subset of
   *  `N8AOPostPass`'s full `configuration` Proxy (see the n8ao README's
   *  "Usage (Detailed)" and "Performance" sections for the rest). */
  interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    halfRes: boolean;
    screenSpaceRadius: boolean;
    gammaCorrection: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** Swap the AO sample/denoise counts to one of the library's presets — see
     *  the n8ao README's quality-mode table. Recompiles shaders; call once at
     *  setup, not per frame. */
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
  }
}
