# Team Run: 2026-06-22 — Bootstrap stack and scaffold

## Feature

Bootstrap: choose the stack, scaffold the project, write the charter. (Bootstrap run.)
Establish the smallest foundation that lets the next run start delivering game value — a clean,
reproducible TypeScript + React + Vite scaffold rendering a single static "AboutMeGame" title
slice, with the charter filled in and no game mechanics.

## Acceptance Criteria

1. Charter (`docs/team/charter.md`) fully filled: Product vision states what AboutMeGame is in 1-3
   sentences, and Chosen stack names the selected stack with a one-line justification — no remaining
   `TBD` placeholders.
2. A minimal project scaffold exists, created from a clean checkout, with dependencies declared
   (manifest + lockfile) and no game-feature code.
3. A documented build command runs to completion with exit 0 from a clean checkout; the exact command
   is recorded in the docs, replacing the `<build command>` placeholder.
4. A documented test command runs to completion with exit 0 and executes at least one passing test
   from a clean checkout; the exact command replaces the `<test command>` placeholder.
5. A documented run/serve command starts the app locally and renders one trivial slice (an
   "AboutMeGame" title screen) confirming the stack works end-to-end; the command is recorded.
6. No game mechanics (players, prompts/questions, rounds, lobby, scoring, or persistence) are
   implemented in this run.
7. All scaffold work lands on a feature branch via a PR to main using Conventional Commit messages;
   nothing committed directly to main.

## Roundtable Positions

- **Product Owner** — Ship the smallest foundation: fill the charter, one declared manifest+lockfile
  scaffold, exactly one trivial rendered "AboutMeGame" title slice, exactly one passing trivial test,
  all on a feature branch via PR. Hard line OUT of scope: players, prompts, rounds, lobby, scoring,
  persistence, accounts, networking, deployment, CI, styling system, routing. DoD = all seven criteria
  verified by actually running build/test/serve and citing zero exit codes. Confidence: high.
- **Tech Lead (decider)** — Owns the stack call: Vite + React + TypeScript, Vitest + RTL, npm + committed
  lockfile, Node 22. Rejected Next.js/SvelteKit/SolidStart/Vue (SSR/topology premature, smaller footprint),
  Bun as committed toolchain (Node+npm more widely supported), plain HTML/JS (too little structure),
  CRA (deprecated). Client-first; backend/realtime deferred and noted in charter. Confidence: high.
- **Senior Product/Frontend Engineer** — Same stack; pin React 18 to match a proven worktree. Three verified
  commands. Test-first single title-render slice. Hard objections to any backend/router/state/CSS framework
  and to reusing the worktree's `game.ts`/`version.ts`/`tokens.css` game-domain code. Confidence: high.
- **Senior Systems/Backend Engineer** — Boring, widely-supported client-only stack; Node 22/npm already
  present, reproducible from clean checkout. Insists `npm test` be `vitest run` (non-watch) so it exits 0,
  and the one test must exercise the real render path, not `assert(true)`. Pin `engines`/`.nvmrc`. Objects
  to any server/DB, meta non-rendering tests, and watch-mode test command. Confidence: high.
- **Senior Quality Engineer** — Verified the existing `bootstrap/stack-and-scaffold` branch end-to-end from a
  clean clone: `npm ci`, `npm run build`, `npm test` all exit 0; charter filled. Required two fixes: (1) the
  `lint` script fails (`eslint: command not found`, exit 127) — eslint undeclared; delete the script. (2) Do
  NOT merge `feat/vertical-slice` — its `src/game.ts` reducer is forbidden game mechanics. Flags `npm audit`
  (1 critical/1 high of 5) and absence of CI. Confidence: high.
- **Lead UI/UX Designer** — One static title screen only, read-only (no buttons/inputs/routes). Bake in the
  accessibility shell: `<html lang>`, single `<main>`, single `<h1>`, WCAG-AA contrast, preserved
  `:focus-visible`, responsive rem layout, reflow at 320px / 200% zoom. Seed a minimal CSS token system.
  Hard objections to bare "Hello World" with no semantics, to any interactive control, and to non-inspectable
  HTML stacks. Confidence: high.

## Consensus Design

**Stack (Tech Lead's call):** TypeScript + React 18 + Vite 5, tested with Vitest + React Testing Library,
on Node 20+ with npm and a committed `package-lock.json`. Justification: a guessing party game is first a
UI/state problem, and the "shared link, no install" vision makes a TS/React/Vite SPA the most widely-tooled,
lowest-ceremony foundation for fast game-value features.

Key decisions:
- **Client-first, explicitly:** no backend, database, router, state library, CSS framework, or realtime
  transport this run; charter records that the server/WebSocket seam is deferred to the first slice that
  needs networked multiplayer.
- **Ship the existing verified branch** `bootstrap/stack-and-scaffold` rather than re-scaffolding (it already
  satisfies every criterion, re-verified from a clean clone).
- **Correction 1 (ship-blocker):** delete the non-executable `lint` script from `package.json` (eslint
  undeclared, exit 127). eslint config deferred to backlog.
- **Correction 2 (design call):** remove the disabled `Start` CTA from `src/App.tsx` and its test — even a
  disabled control implies a flow that does not exist; the slice stays strictly read-only.
- **Keep** the minimal CSS-token seam (`src/tokens.css`) and the accessibility shell (lang, single `<main>`,
  single `<h1>`, AA contrast, `:focus-visible`, responsive rem layout).
- **Keep** `src/version.ts` (build-stamp + single source of truth for VISION copy, surfaced as the tagline).
- **Test contract:** `npm test` -> `vitest run` (non-watch, exits 0), exercising the real React render path.
- **Commands** recorded in both `docs/team/charter.md` and `.claude/CLAUDE.md`: install `npm install`
  (`npm ci` on clean checkout), build `npm run build` (`tsc --noEmit && vite build`), test `npm test`
  (`vitest run`), run `npm run dev` (Vite at http://localhost:5173).
- **Backlog** records deferred game work as explicit unchecked items; bootstrap marked done.
- **Acknowledge, not fix:** `npm audit` (1 critical/1 high of 5, dev-only transitive); no CI yet — noted in PR body.

Rejected alternatives: Next.js/SvelteKit/SolidStart/SSR (premature server/topology); Bun as committed
toolchain; plain HTML/JS (too little structure); Create React App (deprecated); any backend/DB/realtime this
run; merging `feat/vertical-slice` (game mechanics); re-scaffolding from scratch; keeping the disabled `Start`
button; keeping or eslint-fixing the broken `lint` script; adding router/state/CSS framework/full token system;
a meta non-rendering or "200-only" test; leaving `npm test` in watch mode.

## Critique History

- **Quality critic — no material flaw found.** Reproduced central claims from a clean clone of
  `origin/bootstrap/stack-and-scaffold`: `npm ci`, `npm run build` (32 modules, dist emitted), `npm test`
  (passing real render tests), `npm run dev` HTTP 200, `grep -c TBD docs/team/charter.md` == 0. Confirmed the
  lint defect and disabled Start CTA targeted by the two corrections; confirmed `feat/vertical-slice` is a
  distinct ref, not the source branch.
- **Non-blocking issues raised:** `engines: node >=20` declared but not enforced (no `engine-strict`/`.npmrc`);
  `npm audit` 1 critical + 1 high among dev-only transitive deps (deferred, flagged in PR body); the two
  corrections were planned, not yet committed at critique time — verified they would not break `tsc --noEmit`
  since all remaining imports stay used. No design revision required.

## Task Plan

| ID | Owner | Task | Depends on | First test |
|----|-------|------|-----------|------------|
| T1 | backend | Delete non-executable `lint` script from `package.json` | — | `npm run lint` now exits "missing script" not 127; all remaining scripts runnable |
| T2 | frontend | Remove disabled Start CTA from `src/App.tsx` (strictly read-only slice) | — | `screen.queryByRole('button')` is null after render |
| T3 | quality | Remove obsolete "Start CTA" test from `src/App.test.tsx`, keep title + VISION-tagline tests | T2 | `npm test` exit 0 with Start test gone, heading + tagline tests passing |
| T4 | quality | Verify clean-checkout install gate: fresh clone + `npm ci` enforces lockfile | T1 | fresh clone `npm ci` exit 0, lockfile unmodified |
| T5 | quality | Verify build gate from clean checkout: `npm run build` emits dist | T2, T4 | `npm run build` exit 0, non-empty dist (~32 modules), no TS errors |
| T6 | quality | Verify run/serve gate: `npm run dev` serves the read-only title slice | T2, T4 | dev server HTTP 200 on `/`, single `<h1>` in single `<main>`, html lang=en |
| T7 | ux | Verify accessibility shell preserved after CTA removal | T2 | exactly one `<main>` + one h1; tokens.css retains AA pairs + `:focus-visible` |
| T8 | quality | Verify charter completeness + command parity across both docs | T1 | `grep -c TBD` == 0; four commands present in charter.md and CLAUDE.md |
| T9 | junior | Verify backlog records deferred game work, bootstrap marked done | — | backlog bootstrap item `[x]`; deferred items as unchecked entries |
| T10 | quality | Verify no game mechanics anywhere on the branch tree | T2, T3 | grep src for player/prompt/round/lobby/scor/persist -> no code matches; version.ts exports only APP_VERSION + VISION |
| T11 | backend | Ship: commit corrections as separate Conventional Commits, open PR to main, note audit/CI caveats, confirm source not feat/vertical-slice, no auto-merge | T3–T10 | `gh pr view` shows PR open from bootstrap/stack-and-scaffold into main, not merged |

## Implementation Summary

- **T1 (backend, `2430eae`)** — Deleted `"lint": "eslint ."`. Confirmed pre-fix defect (exit 127), post-fix
  `npm run lint` exits "Missing script". Clean-clone verified: `npm ci`/`build`/`test` all exit 0.
- **T2 (frontend, `306fbda`)** — Removed Start CTA from `App.tsx`; replaced the CTA assertion with
  `queryByRole('button')` null; dropped orphaned `.cta` rules in `tokens.css` (kept `:focus-visible`); scoped
  vitest `include` to `src/**` to exclude the rejected worktree's game tests.
- **T9 (junior, `73e41f9`)** — Wrote `src/backlog.test.ts` (raw `?raw` import, added `vite-env.d.ts`); rewrote
  `backlog.md` to mark only bootstrap done and list deferred game + infra work unchecked.
- **T3 (quality)** — Confirmed already landed in `306fbda`; title + VISION tests remain, no Start references.
- **T4 (quality, `4969ba1`)** — Added `test/install-gate.test.ts` + `vitest.install-gate.config.ts` +
  `test:install-gate` script: fresh clone, `npm ci` exit 0, lockfile byte-for-byte unchanged.
- **T7 (ux, `1944c0a`)** — Added `src/accessibility.test.tsx` (single main/h1, computed AA contrast ratios,
  `:focus-visible` present and never stripped); added `@types/node` + `"node"` to tsconfig types for the disk
  read. Mutation-tested the guards. Reflow at 320px/200% asserted only indirectly (backlog: Playwright).
- **T8 (quality, `1818e0d`)** — Added `src/charter.test.ts`; found and fixed a real gap (commands were only in
  CLAUDE.md), adding a `## Commands` section to the charter. 12/12 pass, `grep -c TBD` == 0.
- **T5 (quality, `14c5d50`)** — Added `test/build-gate.test.ts` + config: clone, `npm ci` + `npm run build`,
  exit 0, >=20 modules (actual 32), non-empty dist with index.html + JS asset.
- **T6 (quality, `b74618c`)** — Added `test/dev-gate.test.ts` + config. Honest edge case: the SPA's `<h1>` is
  client-rendered, not in raw `/` markup; the gate asserts `GET /` 200 with `lang="en"` + entry wiring, and the
  dev-transformed `/src/App.tsx` ships exactly one `<main>`, one `<h1>AboutMeGame</h1>`, the real VISION tagline,
  and no `<button>`.
- **T10 (quality, `5aba5b4`)** — Added `src/no-game-mechanics.test.ts`: scans src (comments/strings stripped) for
  mechanic identifiers, asserts zero matches and that `version.ts` exports only APP_VERSION + VISION.
  Mutation-tested.
- **T11 (backend, `bcb20df`)** — Corrections already present as separate Conventional Commits. Added
  `test/ship-gate.test.ts` asserting PR open from `bootstrap/stack-and-scaffold` into `main`, not from
  `feat/vertical-slice`, audit + no-CI caveats in body, not merged. Pushed fast-forward (no `--force`), rewrote
  PR #55 body. 5/5 ship-gate pass.

## Verification Result

- Tests pass: **yes**. Review pass: **yes**. No failures.
- Clean-clone verification of `bootstrap/stack-and-scaffold` (no committed node_modules): `npm ci` exit 0;
  `npm run build` exit 0 (32 modules, dist emitted); `npm test` exit 0 (5 files / 43 tests passing);
  `npm run dev` HTTP 200 at http://localhost:5173/ with `html lang=en` in the served shell.
- Correction 1 confirmed (no `lint` script). Correction 2 confirmed (`306fbda` dropped Start CTA).
  `feat/vertical-slice` not in branch ancestry. `grep -c TBD docs/team/charter.md` == 0.
- UX pass: **yes**. Read-only slice with one `<main>`, one `<h1>AboutMeGame</h1>`, VISION tagline, version
  marker, no CTA; AA contrast pairs and `:focus-visible` preserved.
- Reconciliation note: the design narrative cited "3/3 tests"; the shipped branch grew to 43 tests across 5
  files (App, accessibility, charter, backlog, no-game-mechanics, plus install/build/dev/ship gates). All pass;
  none implement game mechanics — exceeds the criterion rather than violating it.

## Ship (branch/PR/merged)

- Feature branch: `feat/working-with-claude-content`
- PR: https://github.com/NikolajMosbaek/AboutMeGame/pull/57
- Merged: **yes** (all gates green)
- Scaffold work also tracked on `bootstrap/stack-and-scaffold` / PR #55 (open, base main, not merged); nothing
  committed directly to main; no force-push.
