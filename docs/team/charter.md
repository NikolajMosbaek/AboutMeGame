# AboutMeGame — Team Charter

> Owned by the Product Owner agent. Every `/team` run reads this file to stay
> grounded. **Updated 2026-06-22** to reflect the project's pivot (below).

## Product vision

AboutMeGame is a browser-based **3D world you drive and fly around to discover
how I build software with Claude.** A small, hand-crafted island holds 13
landmarks; approach one for a teaser, interact to reveal a piece of how I
actually work (planning, verification, guardrails, git hygiene, reusable
tooling). No installs, just a shared link. There is a non-game **text view** for
anyone who can't or won't play.

The discoverable content is real and already written (`content/working-with-
claude.json`, evidence in `content/PROVENANCE.md`).

### Pivot note (2026-06-22)

The project began as a "social party guessing game" and an initial React
Title→Prompt→Reveal slice was built under that framing. It was then redirected:
the GitHub issues (Epics #1–#7) define the current product — a **3D explorable
"about me" world** — and the content payload + game-dev toolkits were added to
support it. The party-game slice has been replaced by the 3D engine. This
charter and `package.json` now describe the real product; the old framing
survives only in early git history and run logs.

## Chosen stack

- **Language:** TypeScript across the whole product; shared domain types in one
  place.
- **3D engine:** **Three.js** (`^0.169`) — smallest payload for our needs,
  best mobile-WebGL control, native TS, largest ecosystem. See
  `docs/adr/0001-rendering-engine.md`.
- **UI / build:** React 18 + Vite 5. React renders the DOM shell (title, HUD,
  menus, reveal panel, text view); Three.js owns the WebGL world on one canvas;
  a clean injected seam (`src/engine/Engine.ts`, `System`) connects them.
- **Test:** Vitest + React Testing Library for unit/logic (headless, no WebGL),
  plus a Playwright smoke verifier (`scripts/verify-game.mjs`) that drives the
  running build and screenshots it.
- **Tooling:** Node 20+, committed `package-lock.json`.
- **Hosting:** static deploy to GitHub Pages under `/AboutMeGame/`; CI builds +
  tests on PRs, deploys on merge to `main`.

_Rationale:_ a "shared link, no install" 3D experience is a static-SPA problem;
TS + Three.js + Vite is the lowest-ceremony foundation that reaches every device
via a URL.

## Architecture map

- `src/engine/` — engine seam, renderer, canvas, asset pipeline.
- `src/world/` — terrain, sky, landmarks, props, boundaries, world config.
- `src/perf/` — performance budget + runtime stats overlay.
- `src/movement/` — vehicle, flight, camera, input (Epic 3).
- `src/content/`, `src/discovery/` — content model, POI binding, reveal (Epic 4).
- `src/ui/` — React shell: title, HUD, menus, reveal panel, text view (Epic 5/6).

## Conventions

- Commits: Conventional Commits (`.claude/rules/commit-and-pr-prefixes.md`).
- Branching: one feature branch per slice; PRs to `main`; never commit to `main`.
- Performance budget: `docs/perf-budget.md` (enforced in `src/perf/perfBudget.ts`).
- Asset conventions: `docs/asset-pipeline.md`.
