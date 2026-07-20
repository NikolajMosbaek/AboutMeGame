# The Lost Idol

**A browser-based first-person jungle survival treasure hunt.** You wake at a riverside camp on an uncharted island, the last of a vanished expedition. Drink and forage to stay alive, read the torn page at your camp and follow five more that lead deeper into the jungle, mind the wildlife, and dig up the Emerald Idol. No installs, just a link.

**[Play it here](https://nikolajmosbaek.github.io/AboutMeGame/)**

> The medium is the message: this game is itself built **AI-first** by a simulated product team of role agents (PO, tech lead, senior engineers, junior, UX lead) that takes each feature from `evaluate → agree → implement → verify → ship`. See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) and the run logs in [`docs/team/runs/`](docs/team/runs/).

## Play

| Action | Keyboard | Touch | Gamepad |
|--------|----------|-------|---------|
| Walk | `W A S D` / arrows | left joystick | left stick |
| Look | mouse (click to grab) | drag right side | right stick |
| Sprint | `Shift` | **SPRINT** button | LT |
| Use / examine (drink, eat, dig, read a page) | `E` / `Enter` | **USE** button | A |
| Menu | `Esc` | ☰ button | — |

Read the pages, drink from the river, forage fruit, and keep clear of snakes on your way to the ancient fig tree. Progress (pages found) is saved in your browser.

**Can't run WebGL?** The title screen's "Can't play? About this game" link opens a short static notice explaining what the game is.

## Stack

TypeScript · React 18 (DOM shell) · **Three.js** (the 3D world) · Vite 5 · Vitest + React Testing Library · Node 20+. The 3D world runs on one `<canvas>`; React renders the title, HUD, menus, journal and panels; a clean injected seam (`src/engine/Engine.ts`, `System`) connects them — no singletons, so every system is unit-tested headless (no WebGL needed) and verified in a real browser with Playwright.

See [`docs/adr/0001-rendering-engine.md`](docs/adr/0001-rendering-engine.md) for why Three.js, and [`docs/design/2026-07-08-the-lost-idol-design.md`](docs/design/2026-07-08-the-lost-idol-design.md) for the game design, and [`docs/team/charter.md`](docs/team/charter.md) for the team's conventions.

## Develop

```bash
npm install      # first time / clean checkout
npm run dev      # dev server → http://localhost:5173
npm test         # unit tests (Vitest, headless)
npm run lint     # ESLint
npm run build    # typecheck (tsc --noEmit) + production bundle
npm run preview  # serve the production build locally
```

A browser-driven smoke check (drives the running game in real WebGL and screenshots it):

```bash
npm run dev &
node scripts/verify-game.mjs http://localhost:5173/ --out shot.png --keys w --advance 1500
```

## Architecture

```
src/
  engine/     Engine (scene/camera/renderer + loop), GameCanvas, asset pipeline
  world/      terrain, river/lagoon, sky, sites, props, boundaries, world config
  player/     first-person controller, look, input (keyboard/touch/gamepad)
  survival/   hunger/thirst/stamina/health, drink, death/respawn
  forage/     fruit plants, pick/eat, regrowth
  wildlife/   birds, butterflies/fireflies, fish, snakes
  quest/      the clue chain, journal, dig site, completion
  content/    typed content model + POI↔world binding
  discovery/  reveal triggers, discovery store, persistence
  ui/         React shell: title, HUD, journal, panels, settings
  audio/      procedural Web Audio (SFX + ambient)
  fx/         discovery burst FX
  perf/       performance budget, stats overlay, device capability + quality tiers
content/      the clue-chain payload (+ provenance)
docs/         ADRs, design docs, team charter/run logs
```

## Performance

Built for a mid-range phone: a typed [performance budget](docs/perf-budget.md) (≥30 fps mobile, ≤150 draw calls, ≤400 KB gz JS) is shown live by the in-dev stats overlay, and a device-capability detector scales quality (pixel ratio, shadows, prop density) across low/medium/high tiers.

## Deploy

Static site → **GitHub Pages**. On merge to `main`, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) tests, builds, and publishes; [`ci.yml`](.github/workflows/ci.yml) gates pull requests. The app is served under `/AboutMeGame/` (set via `vite.config.ts`).

> One-time repo setting to go live: **Settings → Pages → Build and deployment → Source = GitHub Actions.**

## License

The code is licensed under the [MIT License](LICENSE). The content under `content/` is a separate carve-out (see [`content/PROVENANCE.md`](content/PROVENANCE.md)).
