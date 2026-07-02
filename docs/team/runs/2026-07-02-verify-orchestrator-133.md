# Run log — one-command verify orchestrator (#133)

Date: 2026-07-02
Branch: `feat/133-verify-orchestrator` (tip at injection time: `c496136`)
Issue: #133 — `npm run verify`: build → preview → readiness-gate → Playwright
smoke, with exit-code fidelity and guaranteed teardown.

## V5 — BOOT-FATAL fault-injection proof (AC4)

**Claim under test:** when the app genuinely fails to boot, `npm run verify`
exits non-zero with the verifier alone speaking the failure, and the preview
server is torn down (port 4173 free) on that failure path; after reverting the
fault, the same command exits 0.

**Why boot-fatal:** the smoke's failure predicate is narrow
(`render_game_to_text` null, `fps <= 0`, `/webgl|context|THREE/i` console
errors — `scripts/verify-game.mjs` `smokeShot`/`report`). A survivable
per-frame error would still print `VERIFY OK` and prove nothing. The injection
therefore throws during world construction (`buildGame`, the composition
root), which runs at `GameCanvas.tsx:148` — *before* the automation hooks are
installed at `GameCanvas.tsx:164` — so `window.advanceTime` never appears and
the verifier's `enterWorld` wait must reject.

### Injection (temporary, never committed)

`src/buildGame.ts`, top of the `buildGame` body:

```ts
): Game {
  // TEMPORARY BOOT-FATAL FAULT INJECTION (#133 AC4) — DO NOT MERGE.
  // Thrown before any system is constructed, so window.advanceTime never
  // appears and the verifier's enterWorld wait must reject.
  throw new Error("BOOT-FATAL (V5 fault injection #133): world construction failed");
  const session = createSession();
```

Pre-flight baseline: `git status --short` empty (clean tree at `c496136`);
`lsof -i :4173` exit 1 (nothing listening).

### RED — transcript with the injection in place (verbatim)

`npm run verify` → **exit code 1**

```
> about-me-game@0.1.0 verify
> node scripts/verify.mjs

[verify] building (vite build via the JS API)
vite v5.4.21 building for production...
transforming...
✓ 116 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   2.95 kB │ gzip:   1.16 kB
dist/assets/index-B-ZobgNP.css   18.05 kB │ gzip:   3.84 kB
dist/assets/index-BMwYfbPT.js   193.99 kB │ gzip:  63.12 kB
dist/assets/three-rHP-8Nsw.js   477.58 kB │ gzip: 118.86 kB
✓ built in 608ms
[verify] preview ready at http://localhost:4173/AboutMeGame/
[verify] running scripts/verify-game.mjs against http://localhost:4173/AboutMeGame/
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

page.waitForFunction: Timeout 30000ms exceeded.
    at enterWorld (/Users/nsos/Documents/Workspace/AboutMeGame/scripts/verify-game.mjs:612:14)
    at async file:///Users/nsos/Documents/Workspace/AboutMeGame/scripts/verify-game.mjs:169:3 {
  log: [],
  name: 'TimeoutError'
}

Node.js v22.19.0
```

Teardown proof, immediately afterwards: `lsof -i :4173` → no output, exit 1
(**nothing listening on 4173**).

**Reading the red run:**

- **Exit-code fidelity:** the verifier died on an uncaught `TimeoutError`
  (Node exit 1); the orchestrator's `process.exitCode = code ?? 1` made that
  the command's exit code. Non-zero observed at the `npm run verify` level.
- **The verifier alone spoke.** After the orchestrator's phase line
  (`running scripts/verify-game.mjs against …`) every subsequent line is the
  child's own stdio, streamed verbatim. The orchestrator added no second
  verdict line — failure state (c) of the output contract, exactly as
  designed.
- **The verdict shape is the designed one:** a boot-fatal fault aborts the
  verifier *before* its `report()` runs, so the failure surfaces as the
  rejected `enterWorld` wait (uncaught `TimeoutError` naming
  `verify-game.mjs:612`), not as a literal `VERIFY FAILED` line. That line is
  reserved for survivable check failures; the converged design called this
  path explicitly ("the verifier's enterWorld wait rejects").
- **Teardown ran on the failure path:** the `finally { await closeServer() }`
  freed 4173 — confirmed empty by `lsof` after exit.
- **The fault was genuinely in the served bundle:** the red build's app chunk
  is 193.99 kB vs 233.00 kB green — Rollup tree-shook the world/system
  construction that became unreachable after the injected throw.

### Revert — clean diff against the branch tip

```
git checkout -- src/buildGame.ts
git status --short        → (empty)
git diff HEAD | wc -l     → 0
```

Zero-line diff against `c496136` (the branch tip): the injection left no
trace.

### GREEN — transcript after the revert (verbatim)

`npm run verify` → **exit code 0**

```
> about-me-game@0.1.0 verify
> node scripts/verify.mjs

[verify] building (vite build via the JS API)
vite v5.4.21 building for production...
transforming...
✓ 116 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   2.95 kB │ gzip:   1.16 kB
dist/assets/index-B-ZobgNP.css   18.05 kB │ gzip:   3.84 kB
dist/assets/index-OYji8lde.js   233.00 kB │ gzip:  77.04 kB
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 656ms
[verify] preview ready at http://localhost:4173/AboutMeGame/
[verify] running scripts/verify-game.mjs against http://localhost:4173/AboutMeGame/
STATE: {
  "running": true,
  "elapsed": 1.93,
  "fps": 27.05,
  "drawCalls": 1,
  "triangles": 1,
  "systems": {
    "beacons": {
      "poiCount": 13
    },
    "input": {
      "touch": false
    },
    "vehicle": {
      "mode": "drive",
      "speed": 0,
      "altitude": 1,
      "pos": [
        0,
        0
      ]
    },
    "discovery": {
      "discovered": 0,
      "total": 13,
      "nearby": null,
      "open": null
    },
    "nav": {
      "markers": 7,
      "onScreen": 4
    },
    "fx-burst": {
      "active": false
    }
  }
}
SCREENSHOT: scratchpad-shot.png
VERIFY OK
```

After the green run: `lsof -i :4173` → exit 1 (port free — teardown holds on
the success path too), and `git status --short` stayed empty — the 192 kB
`scratchpad-shot.png` written to the repo root is invisible to git, live
proof of the V2 `.gitignore` line.

### AC4 verdict

| Check | Result |
| --- | --- |
| Injected boot fault → `npm run verify` exits non-zero | PASS (exit 1) |
| Verifier alone speaks the failure; no orchestrator second verdict | PASS |
| Port 4173 free after the failed run (teardown on failure path) | PASS |
| Revert leaves a zero-line diff against the branch tip | PASS |
| Rerun after revert exits 0 with `VERIFY OK` | PASS |
| Port 4173 free after the green run | PASS |

### Observation logged for #132 (out of scope here — verifier is diff-frozen)

The red transcript reports `Timeout 30000ms exceeded` although
`verify-game.mjs:612` passes `{ timeout: 15_000 }`. Playwright's signature is
`waitForFunction(pageFunction, arg, options)` — the options object is being
passed in the `arg` slot, so the intended 15 s timeout is silently ignored
and the 30 s default applies. Harmless for this gate (the wait still rejects,
just 15 s later), but it belongs to #132's cleanup of the verifier;
`scripts/verify-game.mjs` keeps its required zero-line diff in this run.

## V6 — Terminal output-contract & failure-legibility review

Date: 2026-07-02, branch tip `b1c6c25`. Reviewer lens: the terminal transcript
IS this feature's UI; every state must be legible by plain text alone.

### Live test — strictPort conflict on 4173

Prescribed probe first: a bare `require('net').createServer().listen(4173)`
(wildcard bind). **Observed: no conflict on macOS** — BSD `SO_REUSEADDR` lets
Vite's more-specific `localhost` bind coexist with a wildcard listener, the
specific bind wins localhost traffic, and the run was a **true green against
the freshly built preview** (exit 0, `VERIFY OK`, 5 277 ms). Same for a
`127.0.0.1`-only squatter while Vite resolved `localhost` to `::1`. Neither is
a false green: in both runs the readiness poll and Playwright reached the
orchestrator's own live server.

The genuine conflict class — **another preview bound the way Vite binds**
(`listen(4173, "localhost")`, resolved `::1` here) — trips strictPort exactly
as designed. Verbatim tail (after Vite's normal build output):

```
✓ built in 638ms
[verify] could not start the preview server on port 4173: Port 4173 is already in use
[verify] is another preview already running? (strictPort is on — the port is never silently bumped)
```

Exit **1**, total elapsed **834 ms** — fail-fast proven: no 30 s readiness
poll, no `preview ready` line, no verifier launch. The message names port
4173 (twice), states the likely cause, and is plain text.

Port 4173 free (`lsof` exit 1) before and after every probe; squatters were
scoped to the test harness process and closed with it.

*Platform nuance (needs verification, low severity):* the wildcard-squat
pass-through is macOS `SO_REUSEADDR` behaviour; on Linux the wildcard bind
would collide and trip the same strictPort message. No path observed on any
variant verifies a stale server.

### Live test — build-failed state (a), previously untranscripted

Temporary parse-error injection (`echo 'this is not typescript (' >>
src/buildGame.ts`), never committed. Verbatim tail:

```
✓ 27 modules transformed.
x Build failed in 83ms
[verify] build failed: [vite:esbuild] Transform failed with 1 error:
/Users/nsos/Documents/Workspace/AboutMeGame/src/buildGame.ts:164:5: ERROR: Expected ";" but found "is"
```

Exit **1**, elapsed **428 ms**; no preview, no verifier, esbuild's own
diagnostic speaks under the phase-naming `[verify] build failed:` line.
Reverted: `git status --short` empty, `git diff HEAD | wc -l` → 0.

### Contract review — V4 happy path, V5 failure, V6 probes

| Contract clause | Evidence | Verdict |
| --- | --- | --- |
| `[verify]` phase prefixes on every orchestrator line | `building…`, `preview ready at…`, `running…against…` in GREEN/RED; `build failed:` / `could not start…` on failure paths (`scripts/verify.mjs:32-33` — one prefix template) | PASS |
| Resolved URL printed before any verifier output | GREEN & RED: `preview ready at http://localhost:4173/AboutMeGame/` then `running scripts/verify-game.mjs against <same URL>` precede the first child byte (`STATE:`/TimeoutError) | PASS |
| Verifier stdio verbatim, no orchestrator rephrasing | RED: after the `running…` line every byte is the child's; orchestrator adds no line on non-zero child exit (`verify.mjs:131` fires only on signal death) | PASS |
| Exactly one verdict line | GREEN: one `VERIFY OK`, nothing after; RED: zero `VERIFY` lines (boot-fatal aborts before `report()`) and no orchestrator substitute — state (c) reads as "last `[verify]` line is `running…`, then the verifier's own failure" | PASS |
| Three failure states distinguishable by text alone | (a) `[verify] build failed:` + tool diagnostic (V6 transcript); (b) `preview never became ready: <url> … within <ms> (last observed state: …)` pinned by `scripts/verify/lib.test.mjs:68-100`, plus the strictPort variant naming port 4173 (V6 transcript); (c) verifier-speaks-alone (V5 RED) | PASS |
| No colour-only or emoji signaling | Orchestrator lines are plain template strings via `console.log/error`; meaning carried by words. Vite's `✓`/colours are the tool's own streamed output ("tool output speaks for itself" — design) | PASS |
| strictPort conflict fails fast naming the port | 834 ms total, message names 4173 + likely cause (V6 transcript) | PASS |

### Gate state after review

`npm test`: 102 files, 980 passed / 1 skipped. Working tree clean at
`b1c6c25`; no product or script files changed by this review.

## V7 — Scope-freeze and gates audit

Date: 2026-07-02, branch tip `715ff32`, clean working tree. Auditor lens: the
diff against `main` must contain exactly the converged design's files and
nothing from the frozen surfaces.

### Frozen surfaces — zero-line diffs

```
git diff main -- scripts/verify-game.mjs .github/workflows .claude
```

→ **empty output, exit 0.** The verifier's pass/fail semantics, defaults and
CLI are untouched (#132's territory), no CI workflow changed (#134's
territory), and no `.claude/` harness file was touched.

### Full diff surface vs `main` (`git diff main --stat`)

| File | Change | In design? |
| --- | --- | --- |
| `scripts/verify.mjs` | +140 (new orchestrator) | yes (NEW) |
| `scripts/verify/lib.mjs` | +76 (pure helpers) | yes (NEW) |
| `scripts/verify/lib.test.mjs` | +101 (headless tests) | yes (NEW) |
| `package.json` | +1: `"verify": "node scripts/verify.mjs"` | yes (one script) |
| `.gitignore` | +1: `scratchpad-shot.png` | yes (one line) |
| `vite.config.ts` | +1 include glob, ±3 comment lines (below) | yes (one glob) |
| `docs/team/runs/2026-07-02-verify-orchestrator-133.md` | +273 (this log) | yes (audit trail) |

Nothing else — no `src/` change survives (V5/V6 fault injections reverted to
zero-line diffs, transcripts above).

### vite.config.ts — the one-glob check, verbatim

The only functional change is the single include entry:

```diff
-    include: ["src/**/*.{test,spec}.{ts,tsx}"],
+    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/verify/*.test.mjs"],
```

plus the amendment of the adjacent comment so it stays truthful — it still
states that `scripts/verify-game.mjs` "must not be swept here" and now
documents why the new glob cannot sweep it. Recorded honestly: the diff is
one include line **and** its documenting comment; no other key of the config
changed.

**The glob cannot sweep the verifier** — structurally
(`scripts/verify/*.test.mjs` requires the `scripts/verify/` directory and a
`.test.mjs` suffix; `scripts/verify-game.mjs` has neither) and empirically:
`npx vitest list` shows all 10 `scripts/verify/lib.test.mjs` tests
(5 × `resolveVerifyUrl`, 4 × `waitForReady`) and **zero** entries matching
`verify-game`.

### Gates

| Gate | Result |
| --- | --- |
| `npm test` | **exit 0** — 102 files passed, 980 passed / 1 skipped |
| `npm run build` (`tsc --noEmit && vite build`) | **exit 0** — `✓ built in 653ms` |

### V7 verdict

| Check | Result |
| --- | --- |
| `scripts/verify-game.mjs` zero-line diff vs `main` | PASS |
| No `.github/workflows` changes | PASS |
| No `.claude/` or harness files touched | PASS |
| `vite.config.ts` = one include glob (+ truthful comment), nothing else | PASS |
| Glob cannot sweep `verify-game.mjs` (structural + `vitest list`) | PASS |
| `npm test` exit 0 | PASS |
| `npm run build` exit 0 | PASS |
