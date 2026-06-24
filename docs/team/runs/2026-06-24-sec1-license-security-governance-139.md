# Run log — SEC1 closing slice: LICENSE + SECURITY governance docs (#139)

**Date:** 2026-06-24 · **Driver:** Decider (decision-of-record) · **Type:**
docs-and-governance-only slice (zero product code, zero gate/script/CI change,
zero `.claude/` change).

## What this slice ships

The closing slice of epic SEC1 (#139, top of board Todo). It adds two root
governance files (`LICENSE`, `SECURITY.md`), corrects one stale line in
`docs/perf-budget.md` to describe the already-shipped automated bundle gate,
adds a by-reference policy pointer to `docs/team/charter.md`, and reconciles the
README License section — guarded by a new failing-first string test under
`src/`. The unifying invariant is **single-sourcing**: every threshold/flag lives
in exactly one place (`PERF_BUDGET` in `src/perf/perfBudget.ts`, surfaced via
`src/perf/bundleBudget.ts`; the audit carve-out prose in `docs/perf-budget.md`)
and every other document points at it rather than restating it.

## Owner-gated decisions — surfaced, reversible (T7)

Two inputs in this slice are genuinely owner-gated (a license choice and a
security disclosure channel). The 2026-06-24 prioritisation run log
(`2026-06-24-prioritisation-board-source-of-truth.md`) explicitly defers the
LICENSE pick to an owner decision and orders the mechanical SEC1 guardrails
ahead of it so the pick never stalls the gate. No stated owner preference exists
for either input. Rather than silently inventing an answer or stalling the slice,
the Decider records both as **owner-of-record calls with documented, one-line-
reversible defaults**:

### Decision 1 — LICENSE (root) = MIT

**absent a stated preference, LICENSE = MIT, holder Nikolaj Simonsen, year 2026; reversible with a one-line edit if the owner objects.**

- **Why MIT:** the documented permissive default for a public portfolio SPA. No
  owner preference is on record (the prioritisation run log defers LICENSE to an
  owner decision), so the permissive default applies.
- **Holder:** `Nikolaj Simonsen` — the human git author identity (author email
  `nikolajmos@me.com`), **not** the GitHub org slug `NikolajMosbaek`.
- **Year:** `2026` — both the first commit (2026-06-21) and HEAD (2026-06-24)
  fall in 2026.
- **Copyright line in the file:** `Copyright (c) 2026 Nikolaj Simonsen`.
- **Reversibility:** a one-line edit to the copyright line (or swapping the SPDX
  body) is all that is needed if the owner states a different preference.
- **Scope guard:** `package.json` is left untouched — no `private: true` flip,
  no `license` field added (that would change publish posture; out of scope).

### Decision 2 — SECURITY disclosure channel = GitHub private vulnerability reporting

**disclosure channel = GitHub private vulnerability reporting by default; reversible.**

- **Why this channel:** it needs no email inbox to stand up and gives the
  reporter tracked, acknowledged state via GitHub Security Advisories. No
  personal or `security@` email is invented.
- **Reversibility:** if the owner later prefers an email or other intake, the
  single "Reporting a vulnerability" section in `SECURITY.md` is swapped in one
  edit. `SECURITY.md` neither depends on nor mentions the license decision and
  ships independently of it.

Both defaults are the only owner-contingent inputs in the slice; nothing else
blocks on them.

## Files in this slice (planned)

- NEW `LICENSE` (root) — MIT, `Copyright (c) 2026 Nikolaj Simonsen`.
- NEW `SECURITY.md` (root) — static client-only SPA scope (no backend, no auth,
  no PII), supply-chain posture by reference (Dependabot + npm-audit CI gate),
  single disclosure path (GitHub private vulnerability reporting).
- `docs/perf-budget.md` — replace the stale "review gate" Bundle line with the
  automated `npm run check:bundle` reality; audit carve-out (#138) preserved.
- `docs/team/charter.md` — one by-reference policy pointer under Conventions
  (no forbidden tokens, no restated numbers).
- `README.md` — License section reconciled to point code at root `LICENSE` while
  preserving the `content/PROVENANCE.md` carve-out.
- NEW `src/perf/governanceDocs.test.ts` — failing-first string guard for the
  prose deliverables.

## Note on verification scope

This T7 entry is the owner-decision record only. The run-log prose lives outside
the Vitest `src/**` include, so it is guarded by a manual/CI grep rather than a
new vitest case (see the grep hit cited in the task summary). The remaining
deliverables are guarded by `src/perf/governanceDocs.test.ts` and the existing
`supplyChainAuditCi.test.ts` (its T5 guards the audit carve-out; lines 149-154
guard that the canonical policy is not duplicated in the charter).
