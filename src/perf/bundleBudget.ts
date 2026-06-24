// Bundle-budget decision module (SEC1 slice 1, #126).
//
// A *pure*, headless function that turns a list of already-measured build
// artifacts plus a `PerfBudget` into a budget verdict carrying human-readable
// measured-vs-cap deltas. It mirrors `deviceCapability.ts`' discipline: a pure
// function over an injected data shape, with NO I/O — no `node:fs`/`node:zlib`/
// glob, no `import.meta`/`process` reads. The impure dist-measuring/gzip/glob
// shell and the CI wiring are deferred to slice #136; this module only decides.
//
// Caps are single-sourced from `perfBudget.ts` via the defaulted `budget` arg —
// the same seam `checkFrame`/`detectDeviceTier` use — so no literal `400`/`6000`
// lives here.

import { PERF_BUDGET, type PerfBudget } from "./perfBudget.ts";

/**
 * One measured build artifact, as #136's shell will hand it to us. A
 * discriminated `kind` union (not a boolean flag) is the real domain boundary:
 * the JS-only sum reads `kind === 'js'`, and the initial-download walk reads
 * `kind` to decide whether the on-wire size is the gzip or the raw byte count.
 *
 * #136's measurer (the impure shell) is responsible for classification and must:
 *   - map `.html` / `.svg` / `.json` / `.txt` → `'text'` (gzip-friendly entry docs),
 *     `.js` → `'js'`, `.css` → `'css'`, and genuinely-binary models / textures /
 *     audio / fonts → `'other'`;
 *   - filter out non-shipped artifacts (source maps, `.map`) before passing them in.
 */
export interface MeasuredArtifact {
  /** Artifact path/name, for the breach message and human scanning. */
  name: string;
  /** What kind of payload this is — decides how it is counted on the wire. */
  kind: "js" | "css" | "text" | "other";
  /** Size after gzip (bytes). Text/code ships gzipped, so this is its wire size. */
  gzipBytes: number;
  /** Size before gzip (bytes). Already-compressed binaries ship at this size. */
  rawBytes: number;
}

/** A single cap that was exceeded, with the numbers behind the breach exposed so
 *  #136's CI annotation / any live overlay can format or route it WITHOUT
 *  re-parsing the prose `message`. */
export interface BundleBreach {
  /** Which cap was breached. */
  metric: "jsGzip" | "initialDownload";
  /** Measured value in decimal KB (unrounded; rendered to 1 dp in `message`). */
  measuredKb: number;
  /** The cap from the budget, in KB (an integer budget value, shown as-is). */
  capKb: number;
  /** How far over the cap, in KB (`measuredKb - capKb`). */
  overByKb: number;
  /** Self-describing breach line — dimension + measured value with unit +
   *  comparator + cap with unit + signed delta — legible in a bare CI log or to
   *  a screen reader with no colour or layout. */
  message: string;
}

/** The budget verdict for a set of artifacts. `overBudget` is the AC-named
 *  contract; headroom is fully derivable as `cap - measuredKb` from the exposed
 *  numeric fields, so no convenience field is added. */
export interface BundleVerdict {
  /** Summed gzip of `kind === 'js'` artifacts, decimal KB (unrounded). */
  jsGzipKb: number;
  /** Total bytes downloaded before interactive, decimal KB (unrounded). */
  initialDownloadKb: number;
  /** True iff any cap was breached (`breaches.length > 0`). */
  overBudget: boolean;
  /** Only the caps that actually breached, ordered jsGzip then initialDownload. */
  breaches: BundleBreach[];
}

/** Bytes → decimal KB (`/1000`, NOT `/1024` KiB). Decimal is what the caps in
 *  `docs/perf-budget.md` are stated in, what `vite build`'s gzip column reports,
 *  and what `StatsOverlay` already uses — a KiB base would make this gate
 *  disagree with the very build output it exists to track. ONE shared helper
 *  feeds BOTH checks so they cannot diverge; #136's measurer inherits this
 *  divisor rather than re-deciding it. */
function bytesToKb(bytes: number): number {
  return bytes / 1000;
}

/** The on-wire byte count for one artifact in the initial-download walk:
 *  js/css/text ship gzipped (use `gzipBytes`); `'other'` is already-compressed
 *  binary that gzips to ~nil and ships at raw size (use `rawBytes`).
 *
 *  Using `rawBytes` for `'other'` is conservative-by-design: it over-counts a
 *  hypothetical *compressible* binary, so the gate fails sooner — fail-safe.
 *  A future asset-heavy slice should know this is intentional, not a bug. */
function wireBytes(artifact: MeasuredArtifact): number {
  return artifact.kind === "other" ? artifact.rawBytes : artifact.gzipBytes;
}

/**
 * Decide whether a set of measured artifacts fits the performance budget.
 *
 * Two checks, both compared on UNROUNDED KB with a strict greater-than boundary
 * (`measured > cap` ⇒ breach; `measured == cap` ⇒ within, matching `checkFrame`):
 *   - JS cap: sum `gzipBytes` of `kind === 'js'` artifacts only, vs `maxJsGzipKb`.
 *   - Initial-download cap: walk EVERY artifact (js/css/text by gzip, 'other' by
 *     raw) vs `maxInitialDownloadKb`, so the two text entry docs that ship today
 *     (index.html, favicon.svg) and any future binary payload are all counted.
 *
 * Caps come solely from `budget` (defaulting to `PERF_BUDGET`); the empty list
 * returns 0/0 with no breach via a 0-seeded reduce (no NaN, no false breach).
 */
export function checkBundleBudget(
  artifacts: MeasuredArtifact[],
  budget: PerfBudget = PERF_BUDGET,
): BundleVerdict {
  const jsGzipBytes = artifacts.reduce(
    (sum, a) => (a.kind === "js" ? sum + a.gzipBytes : sum),
    0,
  );
  const initialDownloadBytes = artifacts.reduce(
    (sum, a) => sum + wireBytes(a),
    0,
  );

  const jsGzipKb = bytesToKb(jsGzipBytes);
  const initialDownloadKb = bytesToKb(initialDownloadBytes);

  const breaches: BundleBreach[] = [];

  // jsGzip first, then initialDownload — deterministic order for stable
  // scanning/snapshotting.
  if (jsGzipKb > budget.maxJsGzipKb) {
    breaches.push(
      breach("jsGzip", "JS gzip", jsGzipKb, budget.maxJsGzipKb),
    );
  }
  if (initialDownloadKb > budget.maxInitialDownloadKb) {
    breaches.push(
      breach(
        "initialDownload",
        "initial download",
        initialDownloadKb,
        budget.maxInitialDownloadKb,
      ),
    );
  }

  return {
    jsGzipKb,
    initialDownloadKb,
    overBudget: breaches.length > 0,
    breaches,
  };
}

/** Build a typed breach with a self-consistent 1-dp message. `measuredKb` and
 *  `overByKb` render to 1 decimal place (so a 400.4 KB chunk never prints the
 *  contradictory "400 KB > cap 400 KB (over by 0 KB)"); `capKb` is an integer
 *  budget value shown as-is. */
function breach(
  metric: BundleBreach["metric"],
  label: string,
  measuredKb: number,
  capKb: number,
): BundleBreach {
  const overByKb = measuredKb - capKb;
  const message =
    `${label} ${measuredKb.toFixed(1)} KB > cap ${capKb} KB ` +
    `(over by ${overByKb.toFixed(1)} KB)`;
  return { metric, measuredKb, capKb, overByKb, message };
}
