# Run: G1 slice 1 — headless water-surface math module

## Feature

G1 (water) slice 1: add one pure, headless module `src/world/waterSurface.ts`
plus its test, containing the wave-height function, the fresnel/depth colour
ramp, the shoreline foam term, and the shared `clamp01`/`smoothstep` helpers —
modelled on the existing `noise.ts` / `terrain.ts` precedent (named exports,
fixed constants up top, jsdoc per export, zero non-`src/world` imports). **No
Three.js / DOM / WebGL, no rendering, no `onBeforeCompile`, no `ShaderMaterial`,
no `WaterSystem`, no `uTime` wiring, no new runtime dependency, and no touch to
`boundaries.ts` / `worldConfig.ts` / world wiring.** The module stays unimported
so tree-shaking keeps it out of the shipped bundle. The math is authored so the
later G1 visual slice can transliterate it line-for-line into a GLSL patch.

## T6 — Verify gates (this run)

### Test gate — `npm test`

Full Vitest suite, headless (no WebGL):

```
Test Files  51 passed (51)
     Tests  391 passed (391)
  Duration  2.84s
```

Focused on the new module — `npm test -- --run src/world/waterSurface.test.ts`:

```
✓ src/world/waterSurface.test.ts (37 tests) 15ms
Test Files  1 passed (1)
     Tests  37 passed (37)
```

The 37 cases cover every acceptance criterion: `waveHeight` two-sine bound
`|h| <= A1 + A2` over a sampled (x,z,t) grid plus variation across distinct t
and distinct positions; `waterColor` endpoint channel-equality
(`fresnel=0 → WATER_SHALLOW`, `fresnel=1 → WATER_DEEP`) using the module's
exported palette constants, midpoint blend, out-param identity (`ret === out`);
`shorelineFoam` as `1 - smoothstep(START, END, depth)` with `START < END`, ~0
offshore, ramp to 1 at shore, monotonic non-decreasing toward shore, clamped
tails; the co-located `smoothstep` clamping its interpolant to [0,1]; whole-suite
determinism (`toBe` on a second identical call, incl. fractional/negative coords)
and degenerate-input guards (NaN/±Infinity/out-of-range stay finite, in-gamut);
and static guards proving the module imports nothing outside `src/world` and no
other `src` file imports it.

### Build gate — `npm run build`

`tsc --noEmit && vite build` — typecheck clean, production bundle built:

```
✓ 89 modules transformed.
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-Ce_vD_Dg.js   219.59 kB │ gzip:  72.07 kB
dist/assets/three-Xz6F1pq0.js   477.63 kB │ gzip: 120.69 kB
✓ built in 615ms
```

### Tree-shaking / no-bundle-change proof

Built `main` in an isolated worktree (sharing this checkout's `node_modules`).
The chunks are **byte-for-byte identical** to the branch build — same content
hashes and sizes:

| Chunk | `main` | branch (HEAD) |
|-------|--------|---------------|
| `index-Ce_vD_Dg.js`  | 219.59 kB / gzip 72.07 kB  | 219.59 kB / gzip 72.07 kB  |
| `three-Xz6F1pq0.js`  | 477.63 kB / gzip 120.69 kB | 477.63 kB / gzip 120.69 kB |
| `index-D4SG0bZ9.css` | 16.30 kB / gzip 3.54 kB    | 16.30 kB / gzip 3.54 kB    |

Identical Vite content-hash filenames are the strongest possible proof: the
module is fully tree-shaken out, the shipped bundle is unchanged, no draw call /
triangle / material was added, and **flat water stays flat this slice**. The
static guard confirms no other `src` file imports `./waterSurface`.

### Scope-fence audit

`git diff --name-only main...HEAD` — only the two new files, nothing else:

```
src/world/waterSurface.test.ts
src/world/waterSurface.ts
```

(plus this run log under `docs/team/runs/`).

- `boundaries.ts`, `worldConfig.ts`, `buildWorld.ts`, `sky.ts`, `Engine.ts`,
  `package.json`, `package-lock.json` — **untouched** (not in the diff).
- Nothing under `.claude/` touched — `git diff --name-only main...HEAD` matches
  zero `.claude/` paths.
- No `onBeforeCompile` / `ShaderMaterial` / `WaterSystem` / `uTime` /
  `from "three"` in `waterSurface.ts` runtime code (the only `onBeforeCompile`
  hits are jsdoc/comments documenting the *later* slice, not code).
- All changes confined to `src/` and `docs/`.

## Result

**All gates green.** Test suite (391/391, incl. 37 water cases) and build both
pass; the bundle is byte-identical to `main`; the scope fence holds. Ready to
ship.
