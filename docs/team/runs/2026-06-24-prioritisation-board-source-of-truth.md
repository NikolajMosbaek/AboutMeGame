# Run log — Backlog prioritisation + board as single source of truth

**Date:** 2026-06-24 (prioritisation done 2026-06-23) · **Driver:** Product Owner
(human-directed) · **Type:** prioritisation + process/harness change.

## What happened

1. Re-prioritised every **Todo** item on the GitHub Project board
   (`https://github.com/users/NikolajMosbaek/projects/2`) — 9 epics / 38 items.
2. Made the **GitHub Project board the single source of truth** for priority +
   status and **retired `docs/team/backlog.md`** (it had drifted badly — G1–G4
   were shipped and 7 epics were missing from it).

## Final priority order (board order, epic → slices)

| # | Epic | Track | One-line why |
|---|------|-------|--------------|
| 1 | MOB1 #148 | bug/ux | User-reported P0 — core verb (press USE → reveal) unusable on phones (no safe-area, static `vh`, dead first tap). |
| 2 | MOB2 #149 | bug/ux | Same root cause strands top HUD + the Settings/a11y button. Depends on MOB1's inset/`dvh` tokens. |
| 3 | A2 #127 | ux | Stop onboarding phone users into a keyboard wall; reuses MOB1's coarse-pointer seam. |
| 4 | SEC1 #126 | tech-lead | Bundle/payload gate that guards F1's new asset + repo health (Dependabot, audit, LICENSE/SECURITY). |
| 5 | F1 #124 | frontend | The "shared link" promise — no share affordance + image-less unfurl today. |
| 6 | A1 #128 | ux | TextView fallback silently drops authored teaser/highlight/answerReveal; deep-link tail gated on F1. |
| 7 | Q1 #125 | quality | Render gate — guards *future* canvas work; nothing in this backlog touches the WebGL seam. |
| 8 | S4 #89 | sound | Real iOS audio bug, but Sound is held below all tracks (opt-in, not sole channel). |
| 9 | S2 #87 | sound | Pure polish (completion sting). Bottom of the lowest track. |

## How it was decided

A 3-lens judge-panel (PO value · tech-lead dependency/risk · quality/correctness)
ranked the 9 epics independently, then a synthesis reconciled them. All three
lenses + the proposed order agreed on the top two (MOB1, MOB2), the A2/coarse-
pointer reuse, the Sound tail, and Q1's low rank. Every embedded dependency was
verified against code (no `og:image`, `twitter:card=summary` in `index.html`;
`TextView.tsx` renders only `poi.body`; SEC1 caps single-source from
`perfBudget.ts`).

### The one live disagreement — F1 vs SEC1

Two of three lenses ranked **F1 above SEC1** (the OG PNG is tens of KB against
~213 KB of gz headroom, so gating the biggest user-value gap behind a CI chore is
a thin trade). Resolved in favour of **SEC1-first**, honouring the F1 issue's
explicit "sequence F1 after SEC1's payload gate" note — the deferral cost is one
epic, the gate's value is permanent. **F1 may be pulled ahead of SEC1** if we
accept the marginal byte risk; SEC1's bundle-gate slice still lands next and
catches any oversized asset retroactively.

## Cross-cutting risks (carried forward)

- **On-device verification gap.** MOB1/MOB2/S4 are "needs verification" on real
  iOS; the headless suite + desktop-Chromium smoke can't prove safe-area/`dvh`/
  silent-switch behaviour. Green-only-merge can pass a fix still broken on a
  phone — flag it in the run log, never silent-pass. Now also a standing policy in
  the charter.
- **MOB token coupling.** MOB1 must own the new `env(safe-area-inset)` + `dvh`
  token layer and expose the coarse-pointer/eager-mount resolver as an injectable
  seam; MOB2 + A2 reuse it. Land MOB1→MOB2 in order or together.
- **A1 deep-link tail (#145/#146)** is gated on F1's landmark targeting — drop it
  if F1 ships page-level only.
- **SEC1 LICENSE** needs an OWNER decision — ship the bundle-gate/Dependabot
  slices first so the licence pick never stalls the mechanical guardrail.

## Board hygiene

Two items showed status **In Progress** but were **closed** issues (#34, #45) —
stale state, no real WIP (no open PRs). Moved both to **Done**.

## Process change (the durable part)

- **Issues** = spec. **Board** = status + priority order. **Charter** = the
  standing ordering policy + this kind of rationale lives in `docs/team/runs/`.
- The PO now pulls the top `Todo` item from the board
  (`gh project item-list 2 --owner NikolajMosbaek --format json`) instead of
  reading a file. Harness prose updated in `product-owner.md`, `team.js`,
  `.claude/CLAUDE.md`, and the team skill; `docs/team/backlog.md` deleted.
