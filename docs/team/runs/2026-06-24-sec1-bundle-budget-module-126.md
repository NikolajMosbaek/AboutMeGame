# Run log — SEC1 slice 1: pure bundle-budget decision module (#126)

Date: 2026-06-24
Branch: `feat/bundle-budget-module-sec1-126`
Feature: a pure, headless `checkBundleBudget` that turns measured artifacts +
a `PerfBudget` into a budget verdict with human-readable measured-vs-cap deltas.
The impure dist-measuring/gzip/glob shell and CI wiring stay deferred to #136.

## Files in this slice

- NEW `src/perf/bundleBudget.ts` — the pure decision module.
- NEW `src/perf/bundleBudget.test.ts` — failing-first unit coverage.
- Reads (no edits) `src/perf/perfBudget.ts` for `PerfBudget` / `PERF_BUDGET`.

`git diff --name-only main...HEAD` confirms the branch touches ONLY those two
new files — nothing else.

## T3 — Verification (owner: quality)

### Full test suite — GREEN, re-counted

`npm test` (Vitest):

```
Test Files  82 passed (82)
     Tests  756 passed (756)
  Duration  6.15s
```

Actual passing total is **756** (re-counted from the Vitest summary, not the
asserted 745 — the suite has grown since that number was written). The new
`src/perf/bundleBudget.test.ts` is included in the sweep (vitest include glob
`src/**/*.{test,spec}.{ts,tsx}`) and passes alongside the rest. Zero failures,
zero skips reported in the summary.

### Runtime / bundle neutrality — no importer

`grep -rn "bundleBudget" src/` returns exactly ONE reference: the test importing
the module under test (`src/perf/bundleBudget.test.ts`). No production module
imports `checkBundleBudget` / `MeasuredArtifact` / `BundleVerdict` /
`BundleBreach`. The new module is therefore dead-on-the-wire: it changes no
runtime behaviour and adds nothing to the shipped bundle this slice. (Wiring it
into a CI gate / measurer is slice #136.)

### Purity — confirmed against code, not comments

- Imports in `bundleBudget.ts`: only `import { PERF_BUDGET, type PerfBudget }
  from "./perfBudget.ts"`. No `node:fs` / `node:zlib` / `node:*` / `glob`
  import, no `import.meta` / `process` read in code. (The grep hits for those
  tokens are all in the doc comments that document their *absence*.)
- No hardcoded cap literal: stripping comment lines, there is no `400` /
  `6000` / `6_000` in code — caps flow solely through the defaulted `budget`
  arg. (The `400.4` in a comment is the message-format example, not a cap.)

### Guardrail scope — clean

`git diff --name-only main...HEAD` against the forbidden-path set is empty:
no files under `.claude/`, no `.github/` / CI, no dependabot, no LICENSE, no
SECURITY.md changes landed in this run. Product code + this run log only.

## Known debt — verdict polarity divergence in `src/perf/`

`BundleVerdict` (new, `bundleBudget.ts`) and the frame-shaped `BudgetVerdict`
(existing, `perfBudget.ts`) carry **opposite boolean polarity** and a different
`breaches` element type:

| | `BundleVerdict` (bundle) | `BudgetVerdict` (frame) |
|---|---|---|
| over/under flag | `overBudget: boolean` | `withinBudget: boolean` |
| breaches | `BundleBreach[]` (typed) | `string[]` |

This is **intentional for this slice, logged as debt rather than papered over**:

- `overBudget` is the AC-named contract for the bundle verdict; renaming it
  would diverge from the acceptance criteria this slice was built to.
- Adding a derived `withinBudget` convenience field to `BundleVerdict` was
  explicitly REJECTED in the converged design — it would re-introduce the exact
  opposite-polarity wart and give two fields that must be kept in sync.
  Headroom is fully derivable as `capKb - measuredKb` from the exposed numeric
  fields, so no convenience field is needed.
- The distinct type names (`BundleVerdict` vs `BudgetVerdict`) are deliberate so
  a future stats-overlay consumer cannot conflate the runtime frame check with
  bundle accounting.

Reconciling polarity / breach-shape across `src/perf/` (e.g. a shared verdict
convention) is **out of scope for this pure slice** and should be picked up if
and when a single consumer needs both verdicts in one place. Recorded here so it
is not lost.

## Verdict

Slice green and runtime-neutral. All T3 checks pass:
- 756 tests green (re-counted).
- No production importer of the new module.
- Module is pure (no I/O / glob / import.meta / process; no hardcoded caps).
- No `.claude/` / CI / dependabot / LICENSE / SECURITY changes.
- Polarity divergence recorded as known debt (above).
