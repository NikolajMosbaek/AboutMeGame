# AboutMeGame — Team Charter

> Owned by the Product Owner agent. Empty until the first `/team` run, which
> chooses the stack and scaffolds the project. Every later run reads this file
> to stay grounded.

## Product vision
AboutMeGame is a lightweight, browser-based social party game where a small
group answers prompts about themselves and players score points by guessing
each other's answers — no installs, just a shared link.

## Chosen stack
- **Language:** TypeScript (one language across the whole product; shared
  domain types live in one place as the app grows).
- **UI / build:** React 18 + Vite 5 — the most widely-tooled, well-documented
  zero-install web stack; fast HMR, deploys as static assets, reaches every
  device via a URL.
- **Test:** Vitest + React Testing Library (native to the Vite/TS toolchain,
  one runner, behavioral assertions on what the user sees).
- **Tooling:** Node 20+ (pinned via `engines`), committed `package-lock.json`.

_Rationale:_ a guessing party game is first a UI/state problem, and the
"shared link, no install" vision makes a TS/React/Vite SPA the coherent,
lowest-ceremony foundation. A server/real-time seam (WebSocket) is **not** in
the bootstrap — it is added in the first slice that actually needs networked
multiplayer, so the next run spends its budget on game value, not plumbing.

## Commands
- **Install:** `npm install` (a clean checkout uses `npm ci` to enforce the
  committed `package-lock.json`).
- **Build:** `npm run build` (`tsc --noEmit && vite build`).
- **Test:** `npm test` (`vitest run` — non-watch, exits zero on pass).
- **Run:** `npm run dev` (Vite dev server, title screen at
  http://localhost:5173).

## Conventions
- Commits: Conventional Commits (see `.claude/rules/commit-and-pr-prefixes.md`).
- Branching: one feature branch per `/team` run; PRs to `main`.
