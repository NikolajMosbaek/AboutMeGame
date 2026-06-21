---
name: team
description: Run the autonomous AI product team (PO, tech lead, senior engineers, junior, UX lead) through evaluate→agree→implement→verify→ship for one AboutMeGame feature. Use when the user types /team, asks the "team" to build/design a feature, or wants an autonomous feature run. Pass the feature as args; with no args the team pulls the top backlog item.
---

# /team — run the autonomous product team

Invoke the deterministic `team` workflow to take one feature from intake to a
shipped PR with no human gate, bounded by automated quality gates.

## How to run

Call the `Workflow` tool with:
- `name`: `"team"`
- `args`: `{ "feature": "<the user's feature text, or omit to pull the top backlog item>", "autoMerge": <true|false> }`

`autoMerge` defaults to `true` (the team merges its own PR when all gates pass).
Pass `false` when the user wants PRs left open for review.

## Behavior

The workflow runs: Intake → Roundtable (parallel) → Converge (adversarial loop)
→ Plan → Implement (sequential, dependency order) → Verify (tests + review + UX)
→ Ship (branch + PR, gated auto-merge). It writes a decision log to
`docs/team/runs/` and returns `{ prUrl, merged, branch, runLogPath, gatesGreen }`.

Relay the returned PR url, merge status, and run-log path to the user.

## Notes

- The first run is the bootstrap: the team chooses the stack, scaffolds the
  project, and fills in `docs/team/charter.md`.
- For continuous autonomous operation, drive this with `/loop /team`.
