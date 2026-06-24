# AboutMeGame

**A browser-based 3D world you drive and fly around to discover how I build software with Claude.** A small, hand-crafted island holds 13 landmarks; approach one for a teaser, interact to reveal a piece of how I actually work — planning, verification, guardrails, git hygiene, reusable tooling. No installs, just a link.

Prefer to read? There's a [text-only view](#text-view) of every landmark — no game required.

> The medium is the message: this game is itself built **AI-first** by a simulated product team of role agents (PO, tech lead, senior engineers, junior, UX lead) that takes each feature from `evaluate → agree → implement → verify → ship`. See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) and the run logs in [`docs/team/runs/`](docs/team/runs/).

## Play

| Action | Keyboard | Touch | Gamepad |
|--------|----------|-------|---------|
| Drive / steer | `W A S D` / arrows | left joystick | left stick |
| Toggle flight | `F` | **FLY** button | Y |
| Boost | `Shift` | — | LT |
| Climb (in flight) | `Space` | **▲** pad | RT |
| Reveal a landmark | `E` / `Enter` | **USE** button | A |
| Menu | `Esc` | ☰ button | — |

Drive or fly to a glowing beacon, get close, and reveal what's there. Find all 13. Progress is saved in your browser.

<a name="text-view"></a>**Text view:** the title screen's "Read it without playing" link opens an accessible, no-WebGL page with all 13 landmarks as text.

## Stack

TypeScript · React 18 (DOM shell) · **Three.js** (the 3D world) · Vite 5 · Vitest + React Testing Library · Node 20+. The 3D world runs on one `<canvas>`; React renders the title, HUD, menus, reveal panel and text view; a clean injected seam (`src/engine/Engine.ts`, `System`) connects them — no singletons, so every system is unit-tested headless (no WebGL needed) and verified in a real browser with Playwright.

See [`docs/adr/0001-rendering-engine.md`](docs/adr/0001-rendering-engine.md) for why Three.js, and [`docs/team/charter.md`](docs/team/charter.md) for the vision and architecture map.

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
  world/      terrain, sky, landmarks, props, boundaries, world config
  movement/   vehicle (drive + fly), follow camera, input (keyboard/touch/gamepad)
  content/    typed content model + POI↔world binding
  discovery/  reveal triggers, discovery store, persistence
  ui/         React shell: title, HUD, nav hints, reveal panel, settings, text view
  audio/      procedural Web Audio (SFX + ambient)
  fx/         discovery burst + speed vignette
  perf/       performance budget, stats overlay, device capability + quality tiers
content/      the "how I work with Claude" payload (+ provenance)
docs/         ADRs, design docs, team charter/backlog/run logs
```

## Performance

Built for a mid-range phone: a typed [performance budget](docs/perf-budget.md) (≥30 fps mobile, ≤150 draw calls, ≤400 KB gz JS — currently ~190 KB gz) is shown live by the in-dev stats overlay, and a device-capability detector scales quality (pixel ratio, shadows, prop density) across low/medium/high tiers.

## Deploy

Static site → **GitHub Pages**. On merge to `main`, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) tests, builds, and publishes; [`ci.yml`](.github/workflows/ci.yml) gates pull requests. The app is served under `/AboutMeGame/` (set via `vite.config.ts`).

> One-time repo setting to go live: **Settings → Pages → Build and deployment → Source = GitHub Actions.**

## License

The code is licensed under the [MIT License](LICENSE). The content under `content/` is a separate carve-out: it is about a real person and is grounded in verifiable evidence (see [`content/PROVENANCE.md`](content/PROVENANCE.md)).
