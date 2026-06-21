# AI Agent-Team Harness — Design Spec

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Project:** AboutMeGame

## Goal

A **reusable harness** that runs a simulated product team of AI agents through
`evaluate → agree → implement → verify → ship` for any feature, with the
**least possible human input** (fully autonomous, bounded by automated quality
gates). The harness is the deliverable; AboutMeGame is the codebase it operates on.

## Non-goals

- Not building AboutMeGame's features in this work (the harness builds those later).
- Not choosing AboutMeGame's tech stack here — the PO + Tech Lead agents choose it
  on the harness's first run.
- No human approval gates in the loop (explicit user choice). Safety comes from
  automated gates, not human checkpoints.

## Architecture

Built on the deterministic `Workflow` orchestration engine (Approach A, chosen over
GSD and a model-driven orchestrator). Three pieces:

1. **Role subagents** — one markdown agent definition per team role in `.claude/agents/`.
2. **Orchestration script** — one `Workflow` script (`.claude/workflows/team.js`) that
   drives the phases deterministically (parallel roundtable, adversarial converge loop,
   pipelined implementation, gated ship).
3. **Command surface** — a thin `/team` skill (`.claude/skills/team/SKILL.md`) that invokes
   the workflow with a feature argument or pulls the top backlog item.

### Why this engine

The `Workflow` tool is purpose-built for parallel evaluation, judge/critic panels,
adversarial verification, and deterministic control flow — the properties that make a
fully autonomous, code-merging loop *reliable and reproducible* rather than drifty.

## The team (agents)

Each role is a subagent in `.claude/agents/` with its own system prompt and an explicit
lens it argues from.

| Role | File | Lens | Specialty |
|------|------|------|-----------|
| Product Owner | `product-owner.md` | User value, scope, priority | Owns problem statement + acceptance criteria; guards scope |
| Tech Lead (staff) | `tech-lead.md` | Architecture, long-term cost, coherence | Synthesizes the final design; the decider |
| Senior — Product/Frontend | `senior-eng-frontend.md` | UX-facing implementation, state, data flow | Client/UI engineering |
| Senior — Systems/Backend | `senior-eng-backend.md` | Data model, APIs, persistence, reliability, security | Server/data engineering |
| Senior — Quality | `senior-eng-quality.md` | Testability, edge cases, failure modes | Testing & correctness; the adversarial critic in Converge |
| Junior | `junior-eng.md` | Executes narrow, well-specified tasks exactly | Mechanical implementation |
| UX/UI Lead | `ux-lead.md` | Interaction & visual design, accessibility, design-system coherence | Design; reviews build against design |

Senior specialties stay framework-agnostic because the stack is chosen on the first run.
The charter (below) records the real stack once chosen, and agent prompts read it to
stay grounded.

## The flow (one `/team` run)

```
Intake → Roundtable → Converge → Plan → Implement → Verify → Ship
```

1. **Intake** (PO) — turn a backlog line into a crisp problem statement + acceptance
   criteria. Reads `docs/team/charter.md` for grounding.
2. **Roundtable** (parallel barrier) — PO, Tech Lead, 3 seniors, UX lead each return a
   **structured position**: `{ proposal, risks[], objections[] }`. Independent — they do
   not see each other's positions (preserves perspective diversity).
3. **Converge** (loop, capped at 3 rounds) — Tech Lead synthesizes ONE design from all
   positions. The Quality senior runs an **adversarial critic pass** that tries to refute
   it (default to "has a material flaw" when uncertain). If a material flaw is found, the
   Tech Lead revises and the critic re-runs. Loop ends when the critic finds nothing
   material or the round cap is hit. Output: the consensus design + full rationale.
4. **Plan** — decompose the consensus design into atomic, ordered, independently
   verifiable tasks.
5. **Implement** — seniors + junior execute tasks via **TDD**, in **git-worktree
   isolation** so parallel edits never collide. Each task: write failing test → implement →
   green.
6. **Verify** — run the full test suite + a **code-review agent** + the **UX lead checks
   the running build against the agreed design**. Any failure loops back to Implement
   (capped). 
7. **Ship** — create a feature branch, commit, open a PR. Merge behavior per §Autonomy.

## Autonomy & safety

Fully autonomous (no human gate), bounded by automated gates:

- **Branch isolation** — all work on a feature branch; never commit directly to `main`.
- **Never force-push** — enforced (global CLAUDE.md rule + existing PreToolUse hook).
- **Green-only merge** — a PR auto-merges only if the test suite passes AND the
  code-review agent AND UX review pass. Any red = no merge (loop or halt).
- **Caps** — every loop (converge, implement-fix) has an iteration cap and the run
  respects the token budget, so a stuck run halts instead of burning indefinitely.
  Silent truncation/caps are logged, never hidden.
- **Auto-merge: ON** — true to "fully autonomous," justified by the green-tests + review
  gate. Implemented as a single config toggle; flipping it OFF leaves PRs stacked for a
  human to merge.
- **Continuous mode** — the `/loop` skill drives `/team` to keep pulling the top backlog
  item until the backlog is empty or a cap is hit (the "team picks features, zero human
  touch" mode). A single `/team <feature>` run is the atomic unit.
- **Audit trail** — every run writes a decision log to `docs/team/runs/<ts>-<slug>.md`:
  all roundtable positions, the converged design + rationale, the task plan, verification
  results, and the PR link. This is how a human audits autonomous behavior after the fact.

## File layout

```
.claude/agents/*.md            # the 7 role subagents
.claude/workflows/team.js       # the deterministic orchestration script
.claude/skills/team/SKILL.md    # the /team <feature> command (thin wrapper)
docs/team/charter.md            # product vision + chosen stack + conventions (PO-owned)
docs/team/backlog.md            # prioritized backlog (PO picks top; proposes new when empty)
docs/team/runs/<ts>-<slug>.md   # per-run decision log / audit trail
```

## First-run bootstrap

The first `/team` run is special: with no charter and no application code, the PO + Tech
Lead's converged output *is* the bootstrap decision — choose the stack, scaffold the
project, and write `docs/team/charter.md`. Every later run reads the charter to stay
grounded in the established stack, conventions, and product vision.

## Data contracts (structured outputs)

- **Position** (each roundtable agent): `{ role, proposal, risks: string[], objections: string[], confidence }`
- **ConsensusDesign** (Tech Lead): `{ summary, decisions: string[], rejectedAlternatives: string[], acceptanceCriteria: string[] }`
- **Critique** (Quality senior): `{ materialFlaw: boolean, issues: string[], rationale }`
- **TaskPlan**: `{ tasks: [{ id, title, owner, dependsOn: string[], testFirst: string }] }`
- **VerifyResult**: `{ testsPass: boolean, reviewPass: boolean, uxPass: boolean, failures: string[] }`

## Risks & open considerations

- **Cost** — a full roundtable + converge + implement + verify run spawns many agents.
  Mitigated by caps and the token budget; continuous mode should be run with an explicit
  budget.
- **First-run quality** — stack choice is high-leverage and hard to reverse. The converge
  adversarial pass is the safeguard; the human can still review the bootstrap PR before
  the team continues if they choose.
- **Worktree overhead** — only used during Implement where parallel file edits actually
  collide; cheap single-task runs can skip it.

## Success criteria

- Running `/team "<feature>"` on AboutMeGame produces, with no human input, a feature
  branch + PR whose tests pass and whose decision log records the team's reasoning.
- The first run produces a scaffolded project + committed charter.
- Continuous mode drains a seeded backlog into a series of green PRs.
