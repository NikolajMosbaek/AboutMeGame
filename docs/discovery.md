# Content & discovery

- **Issues:** #34 (data model), #36 (placement), #37 (reveal triggers), #38 (reveal UI), #39 (state & persistence)
- **Epic:** #4 — Content & Discovery System

The payload of the game. Approach a landmark for a teaser; interact to reveal the
full "how I work with Claude" piece.

## Data model (#34)

`src/content/contentModel.ts` reads and **validates** the seed dataset
`content/working-with-claude.json` (flagged interim in its PROVENANCE) into typed
`PoiContent` (`id, order, title, teaser, body, tags`). It's the only place the
raw JSON is touched; a malformed POI throws (caught by `content.test.ts`).

## Placement / binding (#36)

`discoverablePois.ts` joins each world anchor (`worldConfig.POI_ANCHORS`, which
owns *where*) to its content (which owns *what*) by `poiId`, plus the landmark's
ground position. A missing join throws — a typo can't silently drop a reveal.

## Reveal triggers (#37)

`DiscoverySystem` (engine system) each frame finds the nearest landmark:
- within **teaser radius (32u)** → the store publishes the teaser + title (HUD prompt);
- within **interact radius (16u)** → an interact (E / USE / gamepad A) opens the body.

## Reveal UI (#38)

`ui/RevealPanel.tsx` subscribes to the discovery store via `useSyncExternalStore`
and renders the teaser prompt, the "Discovered N / 13" badge, and the full-body
modal (focus-managed, Escape/click-out/"Drive on" to close).

## State, pause & persistence (#39)

- Discovered ids persist to `localStorage` (`persistence.ts`), restored on load,
  feeding the progress count. Storage failures degrade to in-memory.
- Opening a panel sets the shared `GameSession.paused` flag (derived from
  "is a panel open"), which the vehicle reads to hold still while you read —
  closing from any path (interact, Escape, button, click-out) resumes.

## The seam

Store → React is an injected observable, not a singleton: `buildGame` creates the
store and the system writes it; `GameCanvas` passes it to `RevealPanel`. Tests
construct their own store, fake input, and in-memory persistence.
