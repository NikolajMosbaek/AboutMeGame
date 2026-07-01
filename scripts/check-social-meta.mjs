// Social-metadata gate CLI (F1 slice 1, #129 — Seam B).
//
// The ONLY impure edge in the social-metadata gate: the single file that touches
// the filesystem, `process`/`argv`, `console`, and `process.exit`. It runs via
// `npm run check:social` (= `vite-node scripts/check-social-meta.mjs`) AFTER the
// production build (ci.yml, post-Build), so the absolute-href / emitted-asset
// contract cannot regress unnoticed.
//
// It is DELIBERATELY not in the `npm test` lane. deploy.yml runs `npm test`
// BEFORE `npm run build` on a gitignored dist; a Vitest read of real dist/ would
// throw there and break the deploy-to-Pages gate on every merge. So the verdict
// lives in a pure core (`src/share/socialMetaCheck.ts`, imported by the
// committed Vitest test with a fixture string — never real dist) and this CLI is
// the sole thing that reads dist/ and exits. That two-file split mirrors
// bundleSize.ts ↔ check-bundle-size.mjs.
//
// `main()` is UNGUARDED (no `import.meta`-vs-`argv` guard) — under `vite-node`
// that guard evaluates false, which would make the whole gate a silent no-op.
// The split makes an unguarded `main()` safe: the committed test imports the
// pure core ONLY and never this file, so it can never fire this exit.
//
// Loaded via `vite-node` (not plain `node`) so the TS pure core with its `.ts`
// imports type-strips cleanly on the CI-pinned Node 20 — the same reason
// check-bundle-size.mjs uses vite-node. `vite-node` is already on disk (a
// transitive dep of vite/vitest), so this adds no new dependency.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { checkSocialMeta } from "../src/share/socialMetaCheck.ts";

/** True iff `path` exists and is a directory. */
function existsAsDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively yield every regular-file path under `dir`, relative to `root`,
 *  with forward slashes so the emitted-asset check is stable cross-platform. */
function* walkPosix(dir, root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkPosix(full, root);
    } else if (entry.isFile()) {
      const rel = relative(root, full);
      yield sep === "/" ? rel : rel.split(sep).join("/");
    }
  }
}

function main() {
  // Default to 'dist' (the build output). argv[2] is the test/CI seam for
  // pointing the same flow at a fixture tree — no `--fixture` switch.
  const distRoot = process.argv[2] ?? "dist";

  // Fail loud on an absent/stale dist rather than a false green (measureDist
  // precedent). This is safe ONLY because this runs post-Build in a CLI step,
  // never inside `npm test`.
  if (!existsAsDir(distRoot)) {
    console.error(
      `Social-metadata check failed: dist root not found at '${distRoot}' — run npm run build first.`,
    );
    process.exit(1);
  }

  const indexPath = join(distRoot, "index.html");
  if (!statSync(indexPath, { throwIfNoEntry: false })) {
    console.error(
      `Social-metadata check failed: ${indexPath} not found — dist looks stale or unbuilt; run npm run build first.`,
    );
    process.exit(1);
  }

  const html = readFileSync(indexPath, "utf8");
  const distFiles = [...walkPosix(distRoot, distRoot)];

  // The deploy base path — Vite substitutes %BASE_URL% to this at build time.
  // Single knob: it defaults to the production Pages sub-path and can be
  // overridden (argv[3]) to check a differently-based build.
  const base = process.argv[3] ?? "/AboutMeGame/";

  const verdict = checkSocialMeta({ html, distFiles, base });

  if (!verdict.ok) {
    console.error("Social-metadata check failed:");
    for (const message of verdict.failures) {
      console.error(`  ${message}`);
    }
    process.exit(1);
  }

  console.log(
    "Social-metadata check passed: og:image / twitter:image are absolute, " +
      "og:url is canonical, twitter:card is summary_large_image, and " +
      "social-preview.png is emitted into dist/.",
  );
  process.exit(0);
}

main();
