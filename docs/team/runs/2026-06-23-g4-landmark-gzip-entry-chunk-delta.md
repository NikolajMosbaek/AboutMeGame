# G4 / T13 — Landmark `BufferGeometryUtils` gzip entry-chunk delta (measured gate)

> **Task T13.** Measure the gzip **entry-chunk** delta from a `vite build` before
> (on `main`) vs after (on the branch) the `BufferGeometryUtils` import, and
> assert it stays **< 2 KB**. Cite the measured byte/gzip delta as a **gate**, not
> as an asserted runtime invariant.

Guarded test-first by `src/world/landmarks.gzip.runlog.test.ts`, which pins these
load-bearing claims so the gate can't regress to a green-but-empty stub.

## Why this is a measured gate, not an asserted invariant

The G4 landmark refactor (`src/world/landmarks.ts`) imports `mergeGeometries`
from `three/examples/jsm/utils/BufferGeometryUtils.js`. The converged design's
claim is that this import adds **tree-shaken CODE bytes** (not asset bytes) that
fold into the **existing `three` vendor chunk** via vite's id-based
`manualChunks` matcher (`vite.config.ts`: `if (/node_modules\/three\//.test(id))
return "three"`). `three/examples/jsm/...` resolves under `node_modules/three/`,
so the matcher pulls `BufferGeometryUtils` into the `three-*.js` vendor chunk
rather than the app entry chunk.

That can only be **established by an actual build** — `main` vs the branch — and
comparing the gzipped entry chunk. There is no runtime expression that yields a
bundle-size delta, so a runtime `expect(delta).toBeLessThan(2048)` would be a
fabrication. This file records the **measurement**; the test asserts the
measurement was performed and the cited numbers clear the gate.

## How it was measured

Two clean detached worktrees off the repo (`main` and the feature branch),
sharing the repo's installed `node_modules` (same `package-lock.json`, no
network), each built with `npx vite build`. The **entry chunk** is the
`assets/index-*.js` referenced by `dist/index.html` (vite's app entry); the
**vendor chunk** is `assets/three-*.js`. Gzipped size measured reproducibly with
`gzip -9 -c <file> | wc -c` (raw bytes via `wc -c`). Script:
`scratchpad/measure-gzip-delta.sh`.

## Measured result — PASS

| chunk | `main` raw | `main` gzip | branch raw | branch gzip | gzip Δ |
|-------|-----------:|------------:|-----------:|------------:|-------:|
| entry `index-*.js` | 227,743 | **75,000** | 228,839 | **75,508** | **+508 bytes** |
| vendor `three-*.js` | 496,494 | 123,711 | 500,276 | 124,649 | +938 bytes |

- **Entry-chunk gzip delta: +508 bytes** — comfortably under the **2 KB
  (2,048-byte)** ceiling. **Gate: PASS** (508 < 2048).
- The `three` **vendor chunk** absorbed +938 gzip bytes: this is exactly the
  `BufferGeometryUtils` code folding into the existing vendor chunk via the
  id-matcher, **confirming the design claim**. The `mergeGeometries`
  implementation did NOT leak into the entry chunk — the +508-byte entry delta is
  the richer per-archetype geometry source plus the merge call-sites in
  `landmarks.ts`, not the imported utility.

### vite's own build report (branch, for cross-reference)

vite uses a lighter gzip level than `gzip -9`, so its reported figures differ
slightly from the reproducible numbers above; both agree the entry chunk barely
moves while the vendor chunk carries the new code:

```
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-Har5XVSC.js   228.74 kB │ gzip:  75.69 kB   <- entry chunk
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB   <- vendor chunk (absorbs BufferGeometryUtils)
✓ built in 640ms
```

## Scope

This deliverable lives only under `docs/team/runs/`; the only product-code
addition for T13 is the test that guards it (`src/world/landmarks.gzip.runlog.test.ts`).
No `.claude/`, harness, or UI change.
