// Bundle-size gate CLI (SEC1 slice 2, #136).
//
// The ONLY impure edge in the bundle-budget gate: this is the single file that
// touches the filesystem, `process`/`argv`, `console`, and `process.exit`. It is
// run by `npm run check:bundle` (= `vite-node scripts/check-bundle-size.mjs`)
// after the production build, so the JS-gzip / initial-download caps cannot
// regress unnoticed.
//
// Everything that *decides* lives elsewhere and is single-sourced:
//   - `measureDist` walks the real `dist/` and classifies artifacts (bundleSize.ts),
//   - `checkBundleBudget` turns that measurement into the pass/fail verdict using
//     the caps from `PERF_BUDGET` (bundleBudget.ts),
//   - `formatReport` renders the measured-vs-cap table (bundleSize.ts).
// This file re-implements none of that — no `400`/`6000` literal, no
// `measured > cap` comparison. It only reads input, prints output, and exits.
//
// `main()` is UNGUARDED — no `import.meta`-vs-`argv` guard. Under `vite-node`
// that guard evaluates false, which would make the whole gate a permanent silent
// no-op. The two-file split (pure core in `src/perf/bundleSize.ts`, impure edge
// here) is what makes an unguarded `main()` safe: the committed Vitest test
// imports the core ONLY and never this file, so it can never fire this exit.
//
// Loaded via `vite-node` (not plain `node`) because `bundleBudget.ts` imports
// `./perfBudget.ts` with an explicit `.ts` extension; plain `node` on the
// CI-pinned Node 20 throws `ERR_UNKNOWN_FILE_EXTENSION` (no type-stripping),
// the classic green-local / red-CI trap. `vite-node` is already on disk (a
// transitive dependency of vite/vitest), so this adds no new dependency.

import { measureDist, formatReport } from "../src/perf/bundleSize.ts";
import { checkBundleBudget } from "../src/perf/bundleBudget.ts";

function main() {
  // Default to 'dist' (the build output). argv[2] is the test/CI seam for
  // pointing the same flow at a fixture tree — no `--fixture` switch.
  const distRoot = process.argv[2] ?? "dist";

  let artifacts;
  try {
    artifacts = measureDist(distRoot);
  } catch (error) {
    // measureDist throws an actionable Error for a missing/empty dist (e.g.
    // "run npm run build first"). Surface that clean message and a non-zero
    // exit — never a raw ENOENT stack.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Bundle budget check failed: ${message}`);
    process.exit(1);
  }

  const verdict = checkBundleBudget(artifacts);
  console.log(formatReport(verdict));

  // Over budget => non-zero exit so an over-budget bundle fails the PR.
  process.exit(verdict.overBudget ? 1 : 0);
}

main();
