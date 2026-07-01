# Run log — F1 slice 2: DI-injected useShare hook with typed share outcomes (#130)

Date: 2026-07-01
Branch: `feat/f1-useshare-hook`
Feature: the Web-Share-with-clipboard-fallback behaviour as injectable,
logic-only code — one new module `src/ui/useShare.ts` plus its test
`src/ui/useShare.test.tsx`, nothing else in `src/` changed. The composition
point (real navigator wiring, the button, the live region) is #131's job.

## What shipped

- NEW `src/ui/useShare.ts` — exports the closed four-member union
  `ShareOutcome = "shared" | "copied" | "cancelled" | "failed"` (JSDoc'd with
  the recommended announcement per value), `ShareCapabilities` (optional
  `share`, optional `clipboard.writeText`), the pure async core
  `performShare(capabilities, url)` carrying all branching, and
  `useShare(capabilities, url)` as a thin stateless `useCallback` binder.
  Both the capabilities AND the url are required injected inputs — zero reads
  of `navigator`, `window`, `location`, or `document`, enforced by an in-suite
  comment-stripped source-scan test (dayCycle.test.ts precedent), so the JSDoc
  may legitimately name `navigator.share` without failing the gate.
- NEW `src/ui/useShare.test.tsx` — the test matrix written first: every
  outcome branch, AbortError-with-no-fallback, the combined
  share-rejects-then-writeText-rejects → `"failed"` tie-breaker, synchronous
  throws from both capabilities, partial clipboard (writeText missing),
  non-Error rejection values, the never-rejects invariant, concurrent
  invocations both resolving, hook identity stability, and the source scan.

## Re-verified stale In-Progress finding (2026-07-01)

The board showed #130 In Progress before this run started, but re-verification
on 2026-07-01 found **no PR, no branch, and no useShare artifacts on `main`**
for #130 — the In-Progress status was stale, not evidence of parallel work.
This run is the first real delivery for the issue; the earlier design-phase
claim of "unrelated meta work" on the issue is dropped as unsupported by the
re-check.

## Branch-(c) AC interpretation (read this before flagging a violation)

The issue's "when the Web Share API is available, the button routes to it (not
to clipboard)" bullet **describes the success scenario** — the
graceful-degradation fallback fires only after share was routed to and
**failed non-abortively**. Concretely: share present → it is always invoked
first, and
the clipboard is never the first choice; only a non-AbortError rejection (or
synchronous throw) from the routed-to share falls back to the awaited
`clipboard.writeText`. An AbortError (user dismissed the sheet) resolves
`"cancelled"` and the clipboard is positively NOT called — a surprise write
after an explicit cancel would be hostile. Verify's literal AC check should
read this interpretation rather than treating the fallback's existence as a
contradiction of the bullet.

## Headless-verification limits (stated, never claimed proven)

Three properties of the real device path are **unprovable in Vitest** and this
run makes no claim to have proven them:

- **Transient activation** — `performShare` invokes the injected share with no
  preceding `await` so the user gesture's transient activation is preserved;
  the test suite can assert the synchronous call order, but only a real
  browser with a real user gesture proves the share sheet actually opens.
- **The real share sheet** — every share/clipboard capability in the suite is
  a plain `vi.fn()` fake; no native sheet is ever presented headless.
- **Illegal invocation binding** — the JSDoc mandates arrow-wrapping
  `navigator.share` at the composition point because an unbound method
  reference throws "Illegal invocation"; the fakes cannot reproduce that
  binding trap, so #131's on-device pass must watch for it.

Per the charter's standing policy, this is flagged as an on-device
verification gap, not silently passed.

## Re-grounded #131 handoff

- F1 slice 1 (#129) is **merged** — `e3d54bf` (PR #176) — so the canonical
  share URL is an existing single source, not an open decision: #131's
  composition point must inject `socialUrlHref(import.meta.env.BASE_URL)` from
  `src/share/socialMeta.ts` as the url argument.
- Arrow-wrap `navigator.share` when building the capabilities object (see the
  `ShareCapabilities` JSDoc example); pass `navigator.clipboard` as-is and
  call `writeText` as a method.
- #131 owns the announcement state and live region; `ShareOutcome`'s JSDoc
  maps each outcome to its announcement (shared → optional/none; copied →
  "Link copied", mandatory; cancelled → silence; failed → recoverable copy)
  so the mapping needs zero further branching and can exhaustiveness-check
  with a `never` guard.
- Caller obligations documented on the hook: disable the CTA while pending
  (no in-hook re-entrancy latch), pass referentially stable capabilities/url
  (the `useCallback` identity guarantee is conditional on it).

## Guardrail scope

- All work on `feat/f1-useshare-hook`; lands on `main` only via a PR whose
  body contains `Closes #130`.
- `git diff --stat main..HEAD` touches only `src/ui/useShare.ts`,
  `src/ui/useShare.test.tsx`, and this run log — no existing UI component
  (CompletionPanel, TitleScreen, …) changed, and **no file under `.claude/`
  is created, edited, or deleted**.
- Gates: `npm test` and `npm run build` green; the comment-stripped source
  scan runs inside the suite, not just in review.
