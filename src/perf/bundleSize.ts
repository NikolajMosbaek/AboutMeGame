// Bundle-size measurement core (SEC1 slice 2, #136).
//
// The *pure* I/O layer that turns a real `dist/` tree on disk into the
// `MeasuredArtifact[]` shape that the already-shipped pure `checkBundleBudget`
// (bundleBudget.ts) decides on. This module owns measurement and classification
// ONLY — it never decides pass/fail, never converts bytes to KB (the `/1000`
// divisor lives solely in bundleBudget.ts), and holds no `400`/`6000` literal.
//
// It is deliberately split from the impure CLI (`scripts/check-bundle-size.mjs`):
// this file has NO top-level side effect — no `process`/`argv`/`exit`, no
// `console`, no `main()` — so the committed Vitest test can import it and
// exercise the real fs/gzip path without ever firing a process exit that would
// kill the test runner. The CLI is the only edge that reads argv and exits.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { gzipSync } from "node:zlib";
import type { MeasuredArtifact } from "./bundleBudget.ts";

/** Lowercased extensions that ship as gzip-friendly text (counted by wire size,
 *  i.e. their gzip byte length). Everything that is neither `.js`/`.css` nor in
 *  this set is treated as already-compressed binary (`'other'`, counted raw). */
const TEXT_EXTENSIONS = new Set([".html", ".svg", ".json", ".txt", ".md"]);

/** gzip compression level used for the wire-size estimate. Pinned so the
 *  measured gzip bytes are deterministic across machines and Node versions —
 *  a drifting default would make the gate's headroom wobble run-over-run. */
const GZIP_LEVEL = 9;

/**
 * Measure every shipped artifact under `distRoot`, recursively.
 *
 * Walks the tree from the root (not just `dist/assets/`) because `index.html`
 * and `favicon.svg` sit at the root while hashed chunks live under `assets/`.
 * Each regular file is classified by its lowercased extension into the
 * `MeasuredArtifact.kind` union and measured in RAW bytes; js/css/text also get
 * a gzip wire-size, while `'other'` binaries report their raw size as the wire
 * size (already-compressed payloads gzip to ~nil). Source maps (`.map`) are
 * excluded BEFORE classification — they are never shipped and must not inflate
 * the JS sum or the total download.
 *
 * Fails loud rather than returning an empty/false-green list:
 *   - throws if `distRoot` is absent (no silent 0/0 "within budget"),
 *   - throws if the walk finds zero JS chunks (a stale or unbuilt `dist`).
 *
 * @param distRoot path to the built `dist/` directory.
 * @returns one `MeasuredArtifact` per shipped file, names relative to `distRoot`
 *   with forward slashes for stable cross-platform reporting.
 */
export function measureDist(distRoot: string): MeasuredArtifact[] {
  if (!existsAsDir(distRoot)) {
    throw new Error(
      `dist root not found at '${distRoot}' — run npm run build first`,
    );
  }

  const artifacts: MeasuredArtifact[] = [];
  for (const filePath of walkFiles(distRoot)) {
    const lowerName = filePath.toLowerCase();
    // Exclude source maps BEFORE classifying — they are never shipped.
    if (lowerName.endsWith(".map")) continue;

    const ext = extname(lowerName);
    const kind = classify(ext);
    const rawBytes = statSync(filePath).size;
    // js/css/text ship gzipped (wire size = gzip length); 'other' is
    // already-compressed binary and ships at raw size. The pure budget module
    // re-derives the wire size from `kind`, so we hand both numbers honestly.
    const gzipBytes =
      kind === "other" ? rawBytes : gzipSync(readFileSync(filePath), { level: GZIP_LEVEL }).length;

    artifacts.push({
      name: toPosix(relative(distRoot, filePath)),
      kind,
      gzipBytes,
      rawBytes,
    });
  }

  if (!artifacts.some((a) => a.kind === "js")) {
    throw new Error(
      `no JS chunks found under '${distRoot}' — dist looks stale or unbuilt; run npm run build first`,
    );
  }

  return artifacts;
}

/** True iff `path` exists and is a directory. Avoids surfacing a raw ENOENT
 *  stack to the CLI; the caller turns a `false` into an actionable message. */
function existsAsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively yield every regular-file path under `dir` (absolute paths).
 *  Uses `readdirSync(..., { withFileTypes: true })` rather than the experimental
 *  `fs.glob`, which is unstable on the CI-pinned Node 20. */
function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/** Map a lowercased extension to the `MeasuredArtifact.kind` union. */
function classify(ext: string): MeasuredArtifact["kind"] {
  if (ext === ".js") return "js";
  if (ext === ".css") return "css";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "other";
}

/** Normalise a path to forward slashes so artifact names read the same on
 *  Windows and POSIX (and so the CLI report is stable across machines). */
function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
