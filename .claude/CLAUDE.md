# AboutMeGame

AboutMeGame is a lightweight, browser-based social party game — answer prompts about yourself, guess each other's answers; no installs, just a shared link. **Stack:** TypeScript + React 18 + Vite 5, tested with Vitest + React Testing Library, on Node 20+. It is built **AI-first**: a simulated product team of role agents takes each feature from `evaluate → agree → implement → verify → ship` with the least possible human input.

This file is the **constitution** — loaded into every agent (the root loop and every subagent), so everything here is universal: true for any role in any phase. Role-specific behaviour lives in the agent definitions under `.claude/agents/`, not here. **This file outranks any skill or habit; an explicit user instruction outranks this file.**

## The harness

The team takes one feature from intake to a shipped PR with no human gate, bounded by the automated gates below. It is **built and validated end-to-end**.

- **Run it:** `/team "<feature>"`, or `/team` with no argument to pull the top `Todo` item from the GitHub Project board.
- **Pieces:** orchestration in `.claude/workflows/team.js`, command in `.claude/skills/team/`, roles in `.claude/agents/`.
- **Design + plan:** `docs/superpowers/specs/2026-06-21-agent-team-harness-design.md` and `docs/superpowers/plans/2026-06-21-agent-team-harness.md`.
- **Live grounding for any run:** read `docs/team/charter.md` (vision, chosen stack, conventions, prioritisation policy). **Priority + status live on the GitHub Project board** (`https://github.com/users/NikolajMosbaek/projects/2`) — the single source of truth; there is no `backlog.md`. Every run leaves a decision log in `docs/team/runs/`.

## Build & Test

```bash
# Install (first time / clean checkout)
npm install

# Build (typecheck + production bundle)
npm run build

# Run (dev server; title screen at http://localhost:5173)
npm run dev

# Test (Vitest; exits zero on pass)
npm test
```

## Autonomy doctrine

You operate **without human approval gates** — don't pause for sign-off or hand-hold a human through the loop. Safety comes from the **automated gates** below, not from a human checkpoint.

- **Decide and proceed.** Given a feature or a bug, investigate and resolve it yourself — point at the logs, errors, and failing tests, then fix them.
- **Honest exit.** Default to acting, but when a decision is genuinely ambiguous or unsafe to guess, **halt and surface it** rather than inventing an answer.
- **Bounded, never runaway.** Every loop has an iteration cap and respects a token budget; a stuck run **halts and reports** instead of burning. A cap is never licence to skip a guardrail. Caps and truncation are **logged, never hidden.**

## Guardrails (non-negotiable)

Absolute, for every agent in every phase.

1. **Branch isolation.** Work lands on a feature branch and reaches `main` only through a PR. **Never commit directly to `main`.**
2. **Never force-push to origin.** A normal `git push` is fine; never `--force`/`-f` — it rewrites published history. Enforced by the global rule **and** the `.claude/settings.json` PreToolUse hook, which physically blocks it.
3. **Green-only merge.** A PR merges only when **all** automated gates pass — the full test suite, the code-review agent, and the UX review of the running build. Any red ⇒ no merge: loop back (capped) or halt.
4. **Auditable.** Every run leaves a decision trail in `docs/team/runs/` — the positions, the converged design and its rationale, the plan, the verification results, and the PR.

## Quality bars

Hold these in every role and phase.

**Working principles**

- **State the intended end state in one sentence before editing** — it names what the change is *for* and catches scope drift early.
- **Stop and re-plan when stuck** — if an approach goes sideways, stop and re-evaluate instead of pushing through.
- **Implement test-first** — write the failing test, make it pass, then refine.
- **Verify before declaring done** — never claim a task complete without proving it: run the tests, check the logs, diff against `main`, and **cite the output** before saying "wired up" or "tests pass." Ask: *"Would a staff engineer approve this?"*
- **Minimal impact, root causes only** — touch only what's necessary; fix the root cause, no temporary or fake fixes, every change as simple as it can be.
- **Inside the files you touch, shape them as if from scratch; outside them, stay minimal-impact** — within the diff, prefer the code that *should* exist; that licence never extends into files the task didn't require.
- **Prefer one clear component or flow over a mode flag** — split only on real boundaries (state, layout, controls, domain commands), never on an `isPreview`-style boolean.

**Review discipline**

- **Only flag what you can verify** against the actual code; if uncertain, mark a finding **"needs verification"** rather than asserting it.
- **Calibrate severity to real impact** — no disproportionate alarm for marginal gains.

**Don't**

- **Don't use singletons or global state** where a dependency-injection seam would let tests and previews substitute their own implementation.
- **Don't keep an uncalled mode, prop, route alias, or fallback** once `grep` confirms no caller — delete it.

## Conventions

Commits and PR titles follow **Conventional Commits** — see `.claude/rules/commit-and-pr-prefixes.md`. Write PRs to be *read* (the *why*, not just the *what*). Reusable tooling lives in `.claude/skills/` — use it.
