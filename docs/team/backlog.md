# AboutMeGame — Backlog

> Prioritized top-to-bottom. The Product Owner pulls the top unchecked item
> when `/team` is run with no explicit feature. When empty, the PO proposes
> the next most valuable item.

## Items
- [x] **Make `npm test` green on a clean `main` checkout (top priority — the green-only
      ship gate was blocked).** Fixed 2026-06-22:
      1. `src/ship.test.ts` + `src/ship.d.ts` removed. They were a one-shot pre-ship gate
         hardcoded to base branch `feat/agent-team-harness` (long since merged and deleted)
         and the already-shipped slice #56 — dead code that could never pass on `main` and
         couldn't serve future ships. The team harness now enforces branch isolation and
         Conventional Commits via the ship phase + the force-push PreToolUse hook.
      2. `vite.config.ts` now sets `test.exclude` = vitest defaults + `**/.claude/**` +
         `**/.worktrees/**`, and the stale `.claude/worktrees/vertical-slice` worktree
         (which carried a broken `node_modules`) was removed. Worktrees no longer pollute
         the suite.
- [x] First vertical game slice (local, single device): show one "about me"
      prompt, let the player type an answer, submit it, and see it echoed back
      on a reveal screen. Proves the prompt → answer → reveal loop (the core
      mechanic) before any lobby, networking, multiplayer, or scoring. The
      SPA shell from the bootstrap hosts it; the Lobby/Prompt/Guess/Scoreboard
      screen states are anticipated next.
- [x] Bootstrap: choose the stack, scaffold the project, write the charter.
