# AboutMeGame — Team Charter

> Owned by the Product Owner agent. Every `/team` run reads this file to stay
> grounded. **Updated 2026-07-08** to reflect the project's second pivot (below).

## Product vision

The product is **The Lost Idol** — a browser-based, first-person **jungle
survival treasure hunt**. You are an explorer on an uncharted island: five
readable clues lead from your riverside camp to a buried idol, while you manage
hunger, thirst, stamina and health — drinking from the river, foraging fruit,
and keeping your distance from the wildlife. As realistic as a procedural,
no-external-assets budget allows: first-person immersion, dense lit vegetation,
living water, day cycle, reactive animals, a full soundscape. No installs, just
a shared link.

The binding spec is `docs/design/2026-07-08-the-lost-idol-design.md`.

### Pivot note (2026-07-08)

The user rejected the "3D about-me world" outright and ordered a from-scratch
replacement (see `docs/team/runs/2026-07-08-jungle-pivot.md`). "From scratch"
applies to the game, not the chassis: the engine seam, terrain/water/day-cycle
pipeline, discovery-store idiom, procedural audio, perf budgets and CI gates
carry over; every player-facing system is replaced. Work lands as slice PRs into
the long-lived **`jungle`** integration branch, which merges to `main` (and so
to the live site) only when the complete game passes all gates and a full-game
review — mid-pivot hybrids never deploy. Pre-pivot board items are obsolete
unless they are chassis/quality work.

### Pivot note (2026-06-22)

The project began as a "social party guessing game", was redirected to a **3D
explorable "about me" world** (Epics #1–#7), and the party-game slice was
replaced by the 3D engine. That product has now itself been replaced (above);
it survives in git history, run logs, and the pre-pivot issues.

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
- `src/world/` — terrain, sky, river/lagoon water, vegetation, sites, day cycle,
  boundaries, world config.
- `src/perf/` — performance budget + runtime stats overlay.
- `src/player/` — first-person controller: walk/sprint, look, touch input,
  terrain clamp (replaces the old `src/movement/` vehicle+flight).
- `src/survival/` — hunger/thirst/stamina/health store + system, drink/eat/forage.
- `src/wildlife/` — birds, butterflies/fireflies, fish, snakes.
- `src/quest/`, `src/content/` — clue-chain content model, clue triggers,
  journal, dig site, completion (reworks the old `src/discovery/`).
- `src/ui/` — React shell: title, survival HUD, compass, clue/journal panels,
  pause menu, onboarding, completion.
- `src/audio/` — procedural Web Audio engine + the audio `System` (jungle bed,
  survival/quest SFX).

## Conventions

- Commits: Conventional Commits (`.claude/rules/commit-and-pr-prefixes.md`).
- Branching: one feature branch per slice; PRs to `main`; never commit to `main`.
- Performance budget: `docs/perf-budget.md` (enforced in `src/perf/perfBudget.ts`).
- Supply-chain & payload policy: see `docs/perf-budget.md` (`PERF_BUDGET` is the
  single source) plus root `LICENSE` and `SECURITY.md`.
- Asset conventions: `docs/asset-pipeline.md`.

## Prioritisation & backlog

The **GitHub Project board is the single source of truth** for priority and
status — *not* a file in this repo. Board:
`https://github.com/users/NikolajMosbaek/projects/2` (owner `NikolajMosbaek`,
project number `2`).

- **Issues** hold the spec (goal, scope, acceptance criteria, slices,
  dependencies). Don't restate a spec elsewhere — link the issue.
- **Board** holds **Status** (`Todo` / `In Progress` / `Done`) and **order**
  (top = highest priority), arranged epic-then-its-slices.
- **Pulling work:** with no explicit feature, the PO pulls the **top `Todo` item
  in board order**:
  ```bash
  gh project item-list 2 --owner NikolajMosbaek --format json
  ```
  If the top item is an epic (too big for one run), take that epic's first
  not-`Done` slice (sub-issue) as the run's feature.
- There is **no `backlog.md`** — it was retired (2026-06-24) because a
  hand-maintained list drifted from the board. Re-prioritising = reordering the
  board; record the rationale in `docs/team/runs/`.

### Standing ordering policy

- **Sound ranks strictly below all other tracks.** A Sound epic (S2/S4) never
  auto-pulls ahead of feature / quality / graphics work — promote it only if the
  user reports audio breakage on a real device.
- **On-device verification gap (never a silent pass).** Mobile safe-area / `dvh`
  and iOS-audio fixes are flagged "needs verification": the headless Vitest suite
  and the desktop-Chromium Playwright smoke cannot prove them on a real phone. A
  run touching them must say so in its run log and must not claim on-device
  success it can't prove.
