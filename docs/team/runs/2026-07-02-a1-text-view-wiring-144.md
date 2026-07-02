# Run log — TextView wiring: lede, mark & takeaway callout (epic #128, #144)

Date: 2026-07-02
Branch: `feat/144-text-view-model-wiring`
Epic: #128 (text view as a first-class readable surface), final planned slice.
UX-gate evidence: `docs/team/runs/assets/2026-07-02-text-view-144-ux-review/`.

## Board reconciliation (t9) — HONEST FAILURE REPORT: epic NOT moved to Done

The t9 mandate was gated: *verify on the board itself* that #144 is Done via
the merged PR and that #145/#146 are closed NOT_PLANNED — **only then** move
epic #128 to Done. The pre-mutation check was run first and it **failed**, so
no board mutation was performed. Epic #128 remains **In Progress** on project
2, and this log reports that honestly rather than claiming Done.

### Pre-mutation verification (cited, board-sourced — not ticket text)

`gh project item-list 2 --owner NikolajMosbaek --format json` (filtered to the
four items):

```
128 | In Progress | A1 — TextView first-class fallback: surface authored teaser, highlight | PVTI_lAHOAcutM84BbSknzgwoGOo
144 | In Progress | [A1] Render lede, marked takeaway & answerReveal callout in TextView (  | PVTI_lAHOAcutM84BbSknzgwoGPs
145 | Done        | [A1] In-page table of contents linking each landmark by its tv-${id} a | PVTI_lAHOAcutM84BbSknzgwoGP0
146 | Done        | [A1] Deep-link-on-load: focus the hashed article, preserve focus-on-he | PVTI_lAHOAcutM84BbSknzgwoGP8
```

Issue states (`gh issue view <n> --json state,stateReason`):

```
145: CLOSED, NOT_PLANNED   ✓ verified on board (Done) and issue (closed as not planned)
146: CLOSED, NOT_PLANNED   ✓ verified on board (Done) and issue (closed as not planned)
144: OPEN                  ✗ precondition FAILED
128: OPEN                  (epic — untouched, see below)
```

PR check for the slice branch:

```
gh pr list --head feat/144-text-view-model-wiring --state all  →  []
git ls-remote --heads origin 'feat/144*'                       →  (empty)
```

### Why the mutation was withheld

- **#144 is not Done via a merged PR.** No PR exists for
  `feat/144-text-view-model-wiring` (open, closed, or merged), and the branch
  has not been pushed to origin; the issue is OPEN and its board card is
  In Progress. The only merged PR on this epic is #179 (slice 1, the
  `buildTextViewModel` selector).
- The t9 gate is explicit: closing #144 is the trigger for moving the epic
  card, and that trigger has not fired. Moving #128 to Done now would assert a
  shipped state the board cannot back — exactly the dishonest claim this step
  exists to prevent.

This is a **sequencing failure, not an auth or field-ID failure**: the ship
step (push branch → open PR with `Closes #144` → green-only merge) had not
completed when t9 ran. All board reads and ID resolutions above succeeded, so
credentials and field IDs are known-good.

### Epic-closure rationale (recorded now for the post-merge step)

Epic #128's remaining slices were descoped: #145 (in-page ToC) and #146
(deep-link-on-load) are closed **NOT_PLANNED** — verified above on the board
itself, per the design's instruction not to infer this from ticket text. #144
is therefore the **last planned slice** of the epic: the selector seam (#179)
plus the #144 rendering (teaser lede, `<mark>` emphasis, "The takeaway"
callout) deliver the epic's full first-class-fallback scope. Once #144's PR
merges green and auto-closes the issue, epic #128 is complete and its card
moves to Done as a separate explicit step — closing #144 does not move the
epic card.

### Deferred mutation — run after #144's PR merges green

All IDs pre-resolved and verified read-only this run:

```bash
gh project item-edit \
  --project-id PVT_kwHOAcutM84BbSkn \
  --id PVTI_lAHOAcutM84BbSknzgwoGOo \
  --field-id PVTSSF_lAHOAcutM84BbSknzhWEFD4 \
  --single-select-option-id 98236657   # Status → Done
```

(#144's own card — `PVTI_lAHOAcutM84BbSknzgwoGPs`, same field/option IDs —
should also be Done after merge; GitHub's issue-close automation normally
handles it, so check before editing.)
