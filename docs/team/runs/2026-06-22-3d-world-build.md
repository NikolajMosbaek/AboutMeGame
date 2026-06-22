# Team run — Build the 3D "About Me" world (Epics 1–7)

**Date:** 2026-06-22
**Trigger:** `/team` (via `/loop`) — "go through each of the issues and implement
them … the outcome should be a finished, deployable product."
**Driver:** root orchestrator acting as tech-lead, with role subagents for review.

## Orchestration decision (why not 47 separate `/team` runs)

`team.js` ships **one backlog feature with auto-merge**. The 47 open issues
(Epics #1–#7 + stories) form **one coherent program** — a from-scratch 3D game
on a shared, evolving codebase. Running 47 independent ceremonies would auto-merge
47 PRs that collide on the same files and produce incoherent architecture.

Staff-engineer call: build in **coherent milestones** (one feature branch → one
PR → merge per epic), the orchestrator owning cross-cutting design, role
subagents (`senior-eng-quality`) doing adversarial review, and the running build
verified with a Playwright screenshot pass each milestone. Every guardrail holds:
branch isolation, never-commit-to-main, green-only merge (tests + code-review +
UX/visual), no force-push, and this audit trail. Issues close as their acceptance
criteria are met.

## Milestones

### M0 — Green main (top backlog) — PR #60 ✅ merged
The `vitest` run was red on `main`, blocking the green-only gate. Removed the
obsolete one-shot `ship.test.ts` gate (hardcoded to a merged base branch) and
added `test.exclude` for worktrees; removed a stale worktree. 30/30 green.

### M1 — Epic 1: Tech Foundation — PR #61 ✅ merged (closes #8–#14, #1)
Pivoted from the React party-game slice to a Three.js foundation: injected
`Engine`/`System` seam (unit-tested headless), asset pipeline (`assetUrl`
BASE_URL-safe for the Pages sub-path), typed perf budget + live stats overlay,
GitHub Pages base + CI/deploy workflows, Playwright smoke verifier.
**Review:** `senior-eng-quality` → SHIP; applied its should-fix items
(advanceTime/live-loop decoupling, fps-EMA, dropped uncalled `exitToTitle`,
fixed stale package description). **Verify:** 23 tests, 165 KB gz, cube renders.

### M2 — Epic 2: World & Environment — PR #_ (closes #15–#22, #2)
One small island (520u tile, plateau-to-shore terrain that keeps all 13 POIs on
land), flat-shaded vertex-coloured terrain (`heightAt` is the contract Epic 3
follows), gradient sky + warm sun + fog, 13 distinct procedural landmarks each
with a colour-coded sky-beacon (guides exploration), water + boundary maths,
instanced trees/rocks (3 draw calls). Docs: world-design, art-direction; charter
pivoted. **Verify:** 39 tests, 80 draw calls / ~105k tris / 60 fps, screenshot
shows the lush island with beacons.

### M3–M7 — pending
Movement & controls → content & discovery → shell & UX → reach → polish.

## Notes / for the user
- One-time repo setting needed for live deploy: **Settings → Pages → Source =
  GitHub Actions** (documented in `deploy.yml`). The build is otherwise fully
  green and deployable.
