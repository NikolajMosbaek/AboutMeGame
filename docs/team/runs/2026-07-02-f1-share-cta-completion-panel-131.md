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
