# AboutMeGame

<!-- One-paragraph description of what this project is and its tech stack. Fill in. -->

## Build & Test

<!-- Replace with the real commands once the stack is chosen. -->

```bash
# Build
# <build command>

# Test
# <test command>
```

## Workflow Principles

- **State the intended end state in one sentence before editing** — forces you to name what the change is for and catches scope drift early
- **Stop and re-plan when stuck** — if an approach goes sideways, stop immediately and re-evaluate instead of pushing through
- **Verify before declaring done** — never claim a task is complete without proving it works (run tests, check logs, diff against main). Ask yourself: "Would a staff engineer approve this?"
- **Autonomous bug fixing** — when given a bug report, investigate and fix it. Point at logs, errors, failing tests — then resolve them. Don't ask for hand-holding
- **Minimal impact** — changes should only touch what's necessary. Find root causes, no temporary fixes. Make every change as simple as possible
- **Inside the files you touch, shape them as if from scratch; outside those files, keep minimal-impact** — within the diff, prefer the code that should exist over the smallest possible change; don't let that license refactors into files the task didn't require
- **Prefer one clear component or flow over a mode flag** — split only on real boundaries (state, layout, controls, or domain commands), not on `isPreview`-style booleans

## Code Review Discipline

- When delivering a code review, only flag issues you can verify against the actual code; if uncertain, mark the finding as 'needs verification' rather than asserting it.
- Calibrate severity to actual impact — avoid disproportionate recommendations for marginal gains.
- Before claiming work is complete (e.g., 'wired up', 'tests pass'), verify with an actual build/test run and cite the command output.

## Don't

- **Don't** force-push to origin — a normal `git push` is fine; never `--force`/`-f` (it rewrites published history). The `.claude/settings.json` PreToolUse hook enforces this
- **Don't** use singletons or global state where a dependency-injection seam would let tests and previews substitute
- **Don't** keep an uncalled mode, prop, route alias, or fallback once `grep` confirms no caller — delete it

See `.claude/rules/commit-and-pr-prefixes.md` for the commit message convention.
