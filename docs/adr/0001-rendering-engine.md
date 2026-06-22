# ADR 0001 — 3D rendering engine

- **Status:** Accepted (2026-06-22)
- **Issue:** #8 — Spike: select 3D rendering engine
- **Epic:** #1 — Tech Foundation & Platform
- **Deciders:** autonomous team (tech-lead synthesis)

## Context

AboutMeGame is a browser-based, zero-install 3D world the player drives and
flies around to discover content. The charter already commits the project to
**TypeScript + Vite**, deploying as **static assets** reachable by a link, and
sets a **mid-range-mobile** performance bar (see `docs/perf-budget.md`). The
engine choice constrains every later epic, so it is decided first.

Requirements the engine must satisfy:

1. Render an open-ish small world (terrain, sky, a handful of landmarks) at the
   perf budget on a mid-range phone over mobile WebGL.
2. Ship as static files from Vite — no proprietary editor or runtime download
   gating the build.
3. First-class TypeScript and a healthy ecosystem (loaders, examples, docs) so
   an AI agent can implement each story from public knowledge.
4. Small enough initial download to hit the time-to-interactive budget.

## Options considered

| Engine | Bundle (min+gz, our use) | Mobile WebGL perf | TS / ecosystem | Learning curve | Static-deploy fit | Score |
|--------|--------------------------|-------------------|----------------|----------------|-------------------|-------|
| **Three.js** | ~155 KB gz core; tree-shakeable | Excellent; full control of draw calls/LOD | TS types ship; vast ecosystem, examples, Q&A | Low–moderate; imperative, well-documented | Perfect — plain ESM via Vite | **★ chosen** |
| Babylon.js | ~700 KB+ gz (heavier core) | Very good; more built-in (physics, PBR) | Excellent TS (written in TS) | Moderate; larger API surface | Good | runner-up |
| PlayCanvas | Engine ~300 KB gz; editor-centric | Very good | Good | Editor workflow fights a code-first, agent-driven repo | Engine-only is fine, but tooling assumes the cloud editor | rejected |
| Unity WebGL | Multi-MB WASM + data | Good once loaded, but huge download | C#, not TS; foreign to the stack | High; whole separate toolchain | Poor — multi-MB payload blows the load budget; not Vite-native | rejected |

## Decision

**Three.js.** It is the only option that hits every requirement at once: the
smallest payload for our needs (tree-shakeable, ~155 KB gz core), the most
direct control over the draw-call/triangle budget that the mid-range-mobile bar
demands, native TypeScript types, and the largest body of public examples and
documentation — which matters when each story is implemented by an agent from
public knowledge. It is plain ESM, so it drops straight into the existing Vite
pipeline with no extra toolchain.

Babylon.js was the credible runner-up but ships a much larger core for features
(built-in physics/GUI) this project implements lightly itself. PlayCanvas and
Unity WebGL both assume tooling (a cloud editor; a C#/WASM pipeline) that fights
a code-first, statically-deployed, TS/Vite repo.

## Consequences

- We own engine concerns Babylon/PlayCanvas bundle for free (a follow camera,
  simple vehicle physics, input). That is acceptable — they are small and let us
  keep the payload and draw calls inside budget. The engine seam
  (`src/engine/Engine.ts`, `System`) is where these live.
- Physics is hand-rolled arcade-style (Epic 3), not a full physics engine, to
  protect the budget.
- `three` is pinned at `^0.169.0`. `three/examples/jsm/*` (e.g. `GLTFLoader`) is
  imported on demand and tree-shaken.

## Spike result — "hello cube"

The throwaway spike is wired as the Epic 1 placeholder world
(`src/world/helloWorld.ts`): a lit, shadow-casting, rotating cube on a ground
plane, driven by the real `Engine` loop. It builds (`npm run build`, 165 KB gz)
and renders in the dev/preview server on desktop and mobile Safari (verified by
the team's Playwright screenshot pass during M1 verification). Epic 2 replaces
`buildHelloWorld` with the real world builder behind the identical seam.
