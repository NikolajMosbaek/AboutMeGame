# AboutMeGame — Backlog

> Prioritized top-to-bottom. The Product Owner pulls the top unchecked item
> when `/team` is run with no explicit feature. When empty, the PO proposes
> the next most valuable item.

## Items
- [ ] **Make `npm test` green on a clean `main` checkout (top priority — the green-only
      ship gate is currently blocked).** Two defects found on 2026-06-22:
      1. `src/ship.test.ts` ("pre-ship verification gate") is mis-scoped: its
         "only allowed slice files changed vs base" and "latest commit subject is
         Conventional Commits" assertions only make sense on a pre-ship *feature branch*,
         but they run as part of the normal suite and fail on `main` (the merge of #57
         touched many files and used a non-Conventional squash subject). Re-scope these
         checks so they don't fail on `main` — e.g. gate them behind an env/CI flag, move
         them out of the default `vitest run` set, or compare against the right base only
         when on a slice branch.
      2. `vite.config.ts` has no `test.exclude`, so `vitest` sweeps test files inside
         `.claude/worktrees/**` (leftover git worktrees) and runs them against a broken
         `node_modules` → ~28 spurious failures. Add `test.exclude` for `**/.claude/**`
         (and keep the node_modules/dist defaults).
- [x] First vertical game slice (local, single device): show one "about me"
      prompt, let the player type an answer, submit it, and see it echoed back
      on a reveal screen. Proves the prompt → answer → reveal loop (the core
      mechanic) before any lobby, networking, multiplayer, or scoring. The
      SPA shell from the bootstrap hosts it; the Lobby/Prompt/Guess/Scoreboard
      screen states are anticipated next.
- [x] Bootstrap: choose the stack, scaffold the project, write the charter.
