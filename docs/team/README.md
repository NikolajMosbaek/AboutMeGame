# Team Harness State

- `charter.md` — product vision, chosen stack, conventions (PO-owned).
- `backlog.md` — prioritized backlog; PO pulls the top item.
- `runs/` — one decision log per `/team` run (audit trail).

Run the team with `/team "<feature>"` or `/team` (pulls top backlog item).
See `.claude/workflows/team.js` for the orchestration and
`docs/superpowers/specs/2026-06-21-agent-team-harness-design.md` for the design.

> **Operational note.** The role agents in `.claude/agents/` are registered at
> Claude Code **session startup**. After adding or renaming an agent, **restart
> the session** before running `/team` — a mid-session-created agent is not yet
> in the dispatch registry and the run will fail with `agent type '…' not found`.
