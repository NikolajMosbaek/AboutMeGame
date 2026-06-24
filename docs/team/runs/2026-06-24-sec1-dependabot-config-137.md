# Run log — SEC1 slice 3: Dependabot config for npm + github-actions (#137)

Date: 2026-06-24
Branch: `ci/sec1-dependabot-137`
Feature: close the silent supply-chain gap with a checked-in
`.github/dependabot.yml` (Dependabot v2) that opens weekly, *grouped*,
non-major update PRs for the two ecosystems this repo actually depends on —
the npm packages behind the root `package-lock.json` and the GitHub Actions
pinned in `.github/workflows/`. Semver-major bumps are deliberately ignored
(deferred to epic H2). The config is pinned by a headless guard test that
genuinely `yaml.load()`s the file and asserts on the *parsed* structure.

## Files in this slice

- NEW `.github/dependabot.yml` — the Dependabot v2 config (version 2; two
  `updates` entries, npm + github-actions, both `directory: "/"`,
  `schedule.interval: weekly`; each with a named `groups` block batching
  `[minor, patch]` and an `ignore` rule suppressing
  `version-update:semver-major`).
- NEW `src/ops/dependabotConfig.test.ts` — failing-first guard that parses the
  config and asserts the v2 shape, order-insensitively.
- `package.json` / `package-lock.json` — add explicit, typed devDeps
  `js-yaml@^4.1.0` + `@types/js-yaml@^4.0.9`; lockfile regenerated in sync.

## T4 — Final verification (owner: quality)

### Gate 1 — `npm test` (Vitest): GREEN, exit 0

```
Test Files  85 passed (85)
     Tests  781 passed | 1 skipped (782)
  Duration  6.36s
===NPM_TEST_EXIT=0===
```

The new `src/ops/dependabotConfig.test.ts` (8 tests) is in the sweep (vitest
include glob `src/**/*.{test,spec}.{ts,tsx}`) and passes alongside the rest.
The single skip is the pre-existing `src/perf/bundleSize.test.ts` opt-in case,
not introduced here.

### Gate 2 — `npm run build` (`tsc --noEmit && vite build`): GREEN, exit 0

```
> tsc --noEmit && vite build
vite v5.4.21 building for production...
✓ 111 modules transformed.
✓ built in 670ms
===NPM_BUILD_EXIT=0===
```

No split-gate red. The critic's BUILD-GATE-BREAK risk is empirically retired:
`tsc --noEmit` runs **first** and passes — the explicit `@types/js-yaml`
devDep supplies the declarations, so the `import yaml from "js-yaml"` in the
guard test does **not** raise `TS7016` under the repo's strict tsconfig. Test
gate (esbuild) and build gate (tsc) now agree.

### Gate 3 — changed-file scope: clean, exactly the four allowed paths

`git status --porcelain` is empty (working tree clean). Committed diff vs main:

```
$ git diff --name-only main...HEAD
.github/dependabot.yml
package-lock.json
package.json
src/ops/dependabotConfig.test.ts
```

No product code, no `.github/workflows/` (ci.yml / deploy.yml) edits, no
`LICENSE` / `SECURITY.md` (#139), no npm-audit gate (#138). Confirmed by
`git diff --name-only main...HEAD | grep -E 'workflows|LICENSE|SECURITY'` →
NONE, and the only `src/` path is the guard test.

### Gate 4 — lockfile in sync (`npm ci`, used by both ci.yml and deploy.yml)

```
$ npm ci --dry-run
added 46 packages in 269ms
===NPM_CI_DRYRUN_EXIT=0===
```

`npm ci --dry-run` exits 0 with no lock-drift error, so `npm ci` (run by both
CI workflows) succeeds against the regenerated `package-lock.json`. The
`@types/js-yaml@4.0.9` node is present in the lockfile; `js-yaml@^4.1.0`
resolves to the already-present hoisted tree.

## NEEDS VERIFICATION — GitHub-side acceptance is POST-MERGE, not claimed here

The headless suite proves **valid-YAML + Dependabot v2 structural shape only**.
It CANNOT prove GitHub's own behaviour. The following are explicitly **not**
claimed as a headless pass and remain post-merge needs-verification (charter
off-suite-verification policy — never a silent on-device pass):

- The repository **Insights → Dependabot** tab parses `.github/dependabot.yml`
  with **no schema error** (GitHub's own field-name validator, which the
  headless `yaml.load` does not exercise).
- Grouping **actually forms**: minor/patch bumps land as a single grouped PR
  per ecosystem (`npm-minor-patch` / `actions-minor-patch`), not a swarm.
- Semver-major PRs are **suppressed** by the `ignore` rule in live operation.

These can only be confirmed after merge to `main`, against the live GitHub
Dependabot service. Recorded here so the gap is auditable and not mistaken for
a green headless result.

## Verdict

All four headless gates GREEN and cited:
- `npm test` exit 0 — 781 passed / 1 skipped (includes the new 8-test guard).
- `npm run build` exit 0 — `tsc --noEmit` clean (no TS7016) then `vite build`.
- Changed-file set is exactly the four allowed paths; no product / CI /
  LICENSE / SECURITY / #138 / #139 drift.
- `npm ci --dry-run` exit 0 — lockfile in sync for both CI workflows.

GitHub-side Dependabot acceptance flagged above as post-merge needs-verification.
