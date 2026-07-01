# Run log — F1 slice 3: Share CTA on the CompletionPanel (#131)

Date: 2026-07-02
Branch: `feat/share-announcement-131`
Feature: wire the shipped `useShare` hook + `socialUrlHref` into a Share CTA on
the CompletionPanel (order Replay → Share → Keep exploring), generalise the
panel's focus trap to an index-managed N-button cycle, and announce share
outcomes via the house polite live-region pattern plus a visible mirror line.

## T9 — Playwright smoke: completion-panel dismissal paths on the production build

`scripts/verify-game.mjs` gained a `--completion-panel` mode so the agreed
running-build check is a repeatable gate, not a one-off: it seeds 12 of the 13
landmarks as discovered (`aboutmegame.discovered.v1`), drives from spawn to the
Arrivals Gate, interacts (the 13th find), closes the reveal so the panel
raises, and asserts the CTA row (all three CTAs in the decided order, Share
enabled at rest, entry focus on Replay) and both dismissal paths — Escape, and
(after a reload + re-raise, since the completion edge is single-shot) a
backdrop click — each detaching the dialog and landing focus on the canvas
container.

### First run — red, and a real gap (test-first)

Command (production build via `npm run build` + `vite preview --port 4173`):

```
node scripts/verify-game.mjs http://localhost:4173/AboutMeGame/ --completion-panel --out-dir <scratch>
```

Output (first run, before any product change):

```
COMPLETION PANEL raised (escape pass)
  CTA row: [Replay, Share, Keep exploring]; Share disabled=false; entry focus="Replay"
  Escape: dialog detached; focus -> <body class="">
COMPLETION PANEL raised (backdrop pass)
  backdrop click: dialog detached; focus -> <body class="">
VERIFY FAILED:
- Escape: focus did not return to the canvas container — active element is <body class="">
- backdrop click: focus did not return to the canvas container — active element is <body class="">
```

Root cause: GameCanvas's real `.game-canvas-container` is a plain `<div>` with
no `tabIndex`, so the panel's `containerRef.current.focus()` is a silent no-op
in a real browser and focus drops to `<body>`. The jsdom a11y suite never
caught this because its stand-in container carries `tabIndex={-1}`
(`CompletionPanel.a11y.test.tsx`). Fix: `tabIndex={-1}` on the container div in
`src/engine/GameCanvas.tsx` (programmatic focus target, kept out of the Tab
order; no `:focus-visible` rule matches it, so no viewport outline appears).

### Second run — green (pass output cited)

```
COMPLETION PANEL raised (escape pass)
SCREENSHOT: <scratch>/completion-panel.png
  CTA row: [Replay, Share, Keep exploring]; Share disabled=false; entry focus="Replay"
  Escape: dialog detached; focus -> <div class="game-canvas-container">
COMPLETION PANEL raised (backdrop pass)
  backdrop click: dialog detached; focus -> <div class="game-canvas-container">
VERIFY OK
```

Exit code 0. The screenshot shows the raised dialog with all 13 rows marked
Discovered, the HUD reading "Discovered 13 / 13", and the CTA row
Replay / Share / Keep exploring with the entry-focus ring on Replay.

Also green after the change: `npm test` (99 files, 921 passed, 1 skipped),
`npm run build`, `npm run lint`.

### Honest limits of this smoke

- Desktop Chromium (SwiftShader) only — it proves the DOM/focus contract on the
  production bundle, not native share-sheet behaviour, real screen-reader
  utterance, or the disabled-focus-drop restore branch (those remain on the
  run's needs-verification list).
- The seeded-progress path makes the landing CTA read "Continue" rather than
  "Drive in"; `enterWorld` in the verifier matches both.

## T10 — Honesty commitments

Guarded by `src/ui/shareCta.runlog.test.ts` (the house runlog-lint pattern:
`socialMetaRunlog.test.ts`, `titleControlsChannel.runlog.test.ts`) so none of
the claims below can silently regress to a green-but-empty stub.

### Corrected dev-URL statement (prior claim retracted)

The Share CTA copies `realShareUrl = socialUrlHref(import.meta.env.BASE_URL)`
(`src/ui/shareCapabilities.ts`). On the dev server, Vite's `BASE_URL` is `/`
(`vite.config.ts` line 17 — dev stays at root), so a dev-mode share copies
`https://nikolajmosbaek.github.io/` — origin + `/`, a **wrong** link missing
the `/AboutMeGame/` base path. The defect is dev-only: production builds (and
`vite preview`) run with `BASE_URL` `/AboutMeGame/`, where the copied link is
the correct `https://nikolajmosbaek.github.io/AboutMeGame/`. The design-phase
claim that dev mode shares "the canonical prod URL by design" is **retracted**
— the dev-mode link is simply wrong, and this log says so instead of dressing
it up as intent.

### TitleScreen Share CTA — omitted (zero-added-scope rationale)

The TitleScreen Share CTA is **omitted**. It fails the AC's own
zero-added-scope bar: TitleScreen has no dialog/CTA-row structure, no
live-region host, and no focus trap, so a drop-in would mean extracting a
shared ShareButton + announcer pattern — real added scope, and premature with
only one call site (extract on the second concrete call site, per the house
rule). A follow-up issue is filed only if product wants it.

### Test-file count: three, not four

The pre-existing CompletionPanel test files are **three, not four** (this log
counts what exists): `CompletionPanel.test.tsx`, `CompletionPanel.replay.test.tsx`,
and `CompletionPanel.a11y.test.tsx`. Verified against the diff:
`git diff main...HEAD` shows zero changes to the first two, and the a11y file
is append-only (0 deleted lines — new full-cycle cases appended). All
pre-existing cases, including the two protected focus-trap cases, pass
byte-identical; `CompletionPanel.share.test.tsx` is the one new panel suite.

### The shipped URL string cannot be pinned headlessly

Under Vitest, `import.meta.env.BASE_URL` is `/`, so the exact shipped URL
string (`https://nikolajmosbaek.github.io/AboutMeGame/`) **cannot be pinned**
by any headless test — an assertion on it would re-derive the dev value, not
the production one. The honest unit seam is `socialUrlHref`, already covered
in `socialMeta.test.ts` (which pins the production string for the base
`/AboutMeGame/` as an explicit input); the composition const `realShareUrl` is
verified by diff review, not by a fabricated runtime assertion.

### PR wiring

The PR references #131 (F1 slice 3). Merging **closes epic #124** (F1 — Share
& social presence; this is its final slice) and **unblocks A1 (#146)**, which
was waiting on the completion-panel CTA row stabilising.

## NEEDS VERIFICATION

Per the charter's never-a-silent-pass policy, three properties of this slice
are beyond what headless Vitest + desktop-Chromium Playwright can prove. No
automated gate covers them; all three remain open:

- **Native share sheet on a real device.** jsdom has no `navigator.share` and
  the desktop smoke asserts only that the Share CTA is present and enabled at
  rest — it never clicks it and cannot summon an OS sheet. Whether the sheet
  opens from the button's transient activation (the iOS gesture-expiry
  concern) cannot be proven here; it needs a real phone.
- **Real screen-reader utterance.** RTL proves DOM shape/text only: the
  `role=status` `aria-live=polite` `aria-atomic` region exists, starts empty,
  and receives "Link copied". Whether VoiceOver/NVDA actually speaks it (and
  how AT coalesces repeated identical strings — accepted parity with
  DiscoveryAnnouncer) cannot be proven headlessly.
- **Disabled-focus-drop restore branch.** In Chromium a natively `disabled`
  button relinquishes focus; on resolve, if `document.activeElement` fell
  outside the dialog, focus is restored to the Share button. jsdom never blurs
  on disable, so this branch is **dead code under Vitest**, and the smoke does
  not click Share either — the branch is not exercised by any automated gate
  and is flagged here rather than claimed.

## Final green baseline (T10)

After adding the runlog lint (measured, not projected): `npm test` — 100 test
files, 944 passed, 1 skipped; `npm run build` green.
