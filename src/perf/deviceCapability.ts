// Device-capability detection (#47).
//
// A coarse hardware tier — "low" | "medium" | "high" — derived from the cheap
// signals a browser exposes. It's the input to the quality scaler (quality.ts):
// in "auto" mode the detected tier picks the render budget. Kept a *pure*
// function of an injectable `CapabilityEnv` so it's unit-testable with fakes and
// reads no globals itself; `readEnv()` is the only place real `navigator`/
// `window` are touched, and it degrades safely when a signal is absent.

export type DeviceTier = "low" | "medium" | "high";

/** The hardware signals the tier is derived from. All optional/raw — `readEnv`
 *  fills them from the platform; tests supply their own. */
export interface CapabilityEnv {
  /** Logical CPU cores (`navigator.hardwareConcurrency`), or undefined if absent. */
  hardwareConcurrency: number | undefined;
  /** Approx device RAM in GB (`navigator.deviceMemory`), or undefined if absent.
   *  Only Chromium exposes it, so it's a bonus signal, never required. */
  deviceMemory: number | undefined;
  /** `window.devicePixelRatio` — a high DPR multiplies fill cost. */
  devicePixelRatio: number;
  /** True when the primary pointer is coarse (`pointer: coarse`) — a touch
   *  device, which we never trust to match a desktop GPU. */
  coarsePointer: boolean;
  /** `navigator.maxTouchPoints` — a second, cheaper touch signal. */
  maxTouchPoints: number;
  /** The WebGL renderer string (`WEBGL_debug_renderer_info`'s
   *  `UNMASKED_RENDERER_WEBGL`, falling back to plain `RENDERER`), or undefined
   *  where WebGL/the extension is unavailable (jsdom, SSR, blocked contexts).
   *  The one signal that can DETECT A MISSING GPU: SwiftShader/llvmpipe-style
   *  software rasterizers render each frame on the CPU, where the medium tier's
   *  N8AO passes + periodic PMREM env rebakes take seconds per frame — no
   *  core/RAM count compensates, so it overrides every other heuristic. */
  webglRenderer: string | undefined;
}

/** Software (GPU-less) WebGL implementations — Chromium's SwiftShader, Mesa's
 *  llvmpipe/softpipe, ANGLE's software adapters (WARP), and anything honest
 *  enough to say "software". Case-insensitive; matched against the raw
 *  renderer string. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|angle \(software/i;

/** True when the renderer string names a software (CPU) WebGL implementation.
 *  Undefined (no context / no string) is NOT software: absence of the signal
 *  falls through to the conservative heuristics, it never forces a tier. */
export function isSoftwareRenderer(webglRenderer: string | undefined): boolean {
  return webglRenderer !== undefined && SOFTWARE_RENDERER.test(webglRenderer);
}

/**
 * Map the raw signals to a tier. The bias is conservative: missing signals land
 * on "medium" (never assume a powerhouse), and any touch/coarse-pointer device
 * is capped at "medium" no matter how many cores it reports — a phone SoC with 8
 * cores still can't carry a desktop-high render budget.
 */
/** The one definition of "a touch device" (coarse pointer OR touch points) —
 *  shared by the tier heuristic below and the input layer's eager touch-controls
 *  mount, so the two can never disagree about what class of device this is.
 *  (controlScheme.ts deliberately uses a narrower coarse-only signal for
 *  onboarding copy — see the divergence note there.) */
export function isTouchEnv(env: CapabilityEnv): boolean {
  return env.coarsePointer || env.maxTouchPoints > 0;
}

export function detectTier(env: CapabilityEnv): DeviceTier {
  // Software WebGL (SwiftShader/llvmpipe/…) overrides EVERYTHING: a 16-core VM
  // with no GPU still draws each frame on the CPU, so only the lightest budget
  // (no shadows, no compositor/AO, one static env bake) is playable. Note this
  // only decides the DETECTED tier — an explicit player "low"/"high" setting
  // still wins in `resolveQuality` (only "auto" follows detection).
  if (isSoftwareRenderer(env.webglRenderer)) return "low";

  const cores = env.hardwareConcurrency ?? 4; // unknown ⇒ assume a modest 4
  const mem = env.deviceMemory ?? 4; // unknown ⇒ assume a modest 4 GB
  const isTouch = env.coarsePointer || env.maxTouchPoints > 0;

  // Low: clearly weak — few cores or little memory. A high-DPR touch screen is
  // an extra cost signal that nudges a borderline phone down.
  if (cores <= 2 || mem <= 2) return "low";
  if (isTouch && mem <= 3 && env.devicePixelRatio >= 2) return "low";

  // High: a desktop-class machine only — plenty of cores and memory, and not a
  // touch device. Touch caps out at medium below.
  if (!isTouch && cores >= 8 && mem >= 8) return "high";

  // Everything else — mid laptops, capable phones, unknown hardware.
  return "medium";
}

/** Memoised result of {@link probeWebglRenderer} — the renderer string is a
 *  property of the hardware, immutable for the session, and the probe creates
 *  a real (if throwaway) WebGL context, which is NOT free on the very software
 *  rasterizers this exists to detect. `null` = not probed yet; `undefined` is a
 *  valid probed answer ("no context / no string"). Pure callers are unaffected:
 *  `detectTier` never reads this — tests inject `webglRenderer` via the env. */
let probedWebglRenderer: string | undefined | null = null;

/** Probe the real WebGL renderer string, cheaply and without ever throwing:
 *  a throwaway canvas + context, `WEBGL_debug_renderer_info`'s unmasked
 *  renderer where exposed (Chromium/Firefox), plain `RENDERER` otherwise
 *  (modern Chromium unmasks it there too). Absent DOM/WebGL (jsdom, SSR,
 *  blocked contexts) yields `undefined` — no override, the heuristics decide.
 *  The context is explicitly lost afterwards so the throwaway canvas never
 *  holds a GPU context slot for the page's lifetime. */
function probeWebglRenderer(): string | undefined {
  if (probedWebglRenderer !== null) return probedWebglRenderer;
  let renderer: string | undefined;
  try {
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      const canvas = document.createElement("canvas");
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (gl) {
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        const param = debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const value = gl.getParameter(param);
        if (typeof value === "string" && value.length > 0) renderer = value;
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }
  } catch {
    renderer = undefined; // any probe failure = no signal, never a crash
  }
  probedWebglRenderer = renderer;
  return renderer;
}

/** Read the real platform signals, guarding every one so SSR/jsdom/old browsers
 *  don't throw. The single impure entry point; everything else is pure. */
export function readEnv(): CapabilityEnv {
  const nav: Partial<Navigator & { deviceMemory?: number }> =
    typeof navigator !== "undefined" ? navigator : {};
  const coarsePointer =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  return {
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    devicePixelRatio:
      typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
        ? window.devicePixelRatio
        : 1,
    coarsePointer,
    maxTouchPoints: typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0,
    webglRenderer: probeWebglRenderer(),
  };
}

/** Convenience: detect the tier of the real device. Defers to the pure pair so
 *  callers can still inject a fake env in tests. */
export function detectDeviceTier(env: CapabilityEnv = readEnv()): DeviceTier {
  return detectTier(env);
}
