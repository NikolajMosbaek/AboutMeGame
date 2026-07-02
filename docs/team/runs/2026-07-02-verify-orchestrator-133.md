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
