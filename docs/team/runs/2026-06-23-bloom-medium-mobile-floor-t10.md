# Run: G2 bloom compositor — T10 medium mobile-floor under full audio load

> Measurement record for the G2 bloom slice (#116). This is **T10** — measure the
> **medium** tier (true half-res bloom) against the **≥30 fps mobile floor** via
> `StatsOverlay`/`checkFrame`'s fps read-out, with the **ambient audio bed AND a
> live SFX voice running** (NOT a silent scene), and decide whether bloom must
> drop to high-only. It changes **no product code** — it builds the game, drives
> the running build in a real WebGL browser (Playwright + swiftshader), reads
> `render_game_to_text` / `__ENGINE_STATE__`, and records the numbers, the
> decision, and the swiftshader caveat here. (No new unit test: this is a
> running-build measurement, per the task.)

## Why T10 exists separately from T9's mobile-floor line

The T9 mobile-floor probe ran with the settings store **unmuted** (so the
ambient bed played), but its driver only drove `W` forward — it never toggled
drive↔fly and never held boost, so **no SFX voice was actually synthesised**
during its fps window. It measured the ambient *pad alone*. T10 closes that gap:
it measures the medium tier while a **live SFX voice** (whoosh + boost) is
continuously re-triggered on the real audio thread, layered over the bed — a
genuinely not-silent scene, as the AC requires.

## Method

- **Build:** `npm run build` (tsc --noEmit + vite build) — green (cited below).
- **Tests:** `npm test` (Vitest) — full suite green, WebGL-free: **62 files /
  510 tests passed**.
- **Running build:** Playwright, headless Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`
  (plus `--autoplay-policy=no-user-gesture-required` so the headless
  `AudioContext` runs), against `vite preview` at
  `http://localhost:4317/AboutMeGame/`.
- **Medium tier forced:** `quality:"auto"` + spoofed `navigator.hardwareConcurrency=6`,
  `deviceMemory=6`, `maxTouchPoints=0` → `detectTier()` resolves **medium**
  (half-res bloom). The resolved signals are read back from the page (`6c / 6GB /
  touch 0`) and recorded.
- **Live SFX voice (the whole point):** settings **unmuted**; the **live rAF
  render loop** runs in wall-clock time while the driver **holds `Shift`** (boost
  → a cue on the rising edge + sustained boost state) and **taps `f`** every
  ~500 ms (drive↔fly toggle → a ~0.4 s `whoosh` voice). The whoosh re-fires
  before the prior one decays, so a synthesised SFX voice is essentially always
  live over the sustained ambient pad. fps is sampled from `__ENGINE_STATE__`
  (the same EMA `StatsOverlay`/`checkFrame` read) over a ~5 s window; the
  back half is taken as steady state.

### Two independent proofs the scene was genuinely not silent

1. **Vehicle mode flipped** drive↔fly across the window (`modesSeen:
   ["fly","drive"]`) — each flip is exactly the event `AudioSystem` turns into a
   `whoosh`.
2. **Live Web Audio synthesis confirmed:** an `AudioContext.prototype.createOscillator`
   counter (patched in an init script) rose **3 → 14 (Δ11)** during the window —
   each chime/whoosh/boost creates oscillator nodes, so a count that keeps rising
   after the bed's fixed startup voices proves live SFX synthesis. The live
   `AudioContext.state` was observed **`running`** and the persisted setting
   `muted:false`.

## Result

Two back-to-back runs at the beacon vantage (bloom in frame — the worst case for
a fill-rate pass), each ~5 s loaded window, ten 500 ms fps samples:

| run | fps samples | steady-state (back half) |
|---|---|---|
| #1 (bed + live SFX, unmuted) | 23.5, 21.5, 20.7, 20.6, 20.5, 20.3, 20.4, 20.2, 20.6, 20.4 | **~20.4 fps** |
| #2 (bed + live SFX, unmuted) | (same shape) | **~20.4 fps** |
| control (same `f`/Shift sequence, **muted**) | 25.6, 21.7, 20.6, 20.5, 20.1, 20.4, 20.2, 20.5, 20.4, 20.2 | **~20.3 fps** |

- **Steady-state ~20.4 fps on medium**, swiftshader software-WebGL — **a
  worst-case lower bound, NOT a target-device measurement.**
- **The audio load is NOT the constraint.** Unmuted (bed + live SFX) ~20.4 fps vs
  the muted control (identical input sequence, audio gated) ~20.3 fps — **within
  sampling noise.** The audio thread (procedural oscillators) runs in parallel and
  does not move the frame rate; the constraint is the **bloom fill-rate pass under
  CPU rasterization.** That is the diagnostic T10 was asked to produce: the scene
  fps is dominated by the full-screen blur, not by the soundscape.

> **Caveat (failure-mode honesty), governing the call below:** swiftshader is a
> **CPU software rasterizer, NOT the target mobile GPU.** Its absolute fps is the
> wrong instrument for an absolute "≥30 fps on the target device" claim —
> *especially* for a **fill-rate** effect like bloom: a full-screen mip-blur is
> CPU-expensive under swiftshader and cheap on a GPU, which is the entire reason
> the design runs bloom **half-res on medium**. swiftshader IS sound for
> rendering correctness, the glow-vs-flat step, cross-tier white-point
> consistency, teardown cleanliness, and the **relative** cost of the pass. The
> absolute mobile floor is argued from the budget + relative cost, below — not
> from this number.

## Floor argued from the triangle/draw budget + isolated bloom cost

Bloom is a **fill-rate** pass, not a geometry pass — `RenderPass` renders the
unchanged scene, then `UnrealBloomPass` + `OutputPass` are full-screen quads. So
the geometry budget is untouched (re-measured at the gate vantage this run):

| tier | path | draw calls | triangles | budget (`PERF_BUDGET`) |
|---|---|---|---|---|
| low | no compositor (true scene info) | **29** | **90,406** | 150 draws / 500,000 tris |
| medium | compositor presenting | **1** | **1** | — (terminal `OutputPass` quad) |
| high | compositor presenting | **1** | **1** | — (terminal `OutputPass` quad) |

- The **true scene geometry** (low, no compositor presenting) is **29 draws /
  90.4k triangles** — roughly **19 %** of the draw-call cap and **18 %** of the
  triangle cap. Bloom adds **zero** scene draws/triangles; the medium/high `1
  draw / 1 tri` is `renderer.info` resetting per `renderer.render` and reporting
  the terminal `OutputPass` quad — itself confirmation the compositor is
  presenting, **not** a geometry change.
- **Isolated bloom cost (relative, swiftshader):** medium *with* bloom held
  ~20.4 fps loaded; the prior G1 measurement put medium *without* bloom at
  ~28–31 fps swiftshader — a ~7–10 fps drop attributable to the full-screen
  blur. Under CPU rasterization the half-screen blur is a **fixed per-frame
  fill-rate cost** that software punishes hardest; on a real mobile GPU the same
  half-res mip pyramid is a few cheap texture passes. The geometry headroom
  (≈5× under both caps) plus the standard cheapness of a half-res bloom on a GPU
  is the basis for expecting the **≥30 fps mobile floor to hold on a real
  mid-range device**, despite the ~20 fps software number.

## Decision (honest exit)

**Bloom is NOT dropped to high-only.** The ~20.4 fps figure is **explicitly not**
the target-device gate (it is a CPU-software lower bound for a fill-rate effect,
per the caveat and the established G1 convention), the audio load was shown not
to be the constraint, the geometry budget sits at ~5× headroom under both caps,
and half-res bloom is a standard cheap mobile-GPU effect. Dropping bloom to
high-only on the strength of a swiftshader number would be guessing against the
budget argument. `QUALITY_TIERS` is left unchanged (the slice keeps the tier
table fixed; flipping `medium.bloom` is a one-line table change + its
`quality.test.ts` row, held in reserve for a real-device result, not made here).

**This remains the top residual risk and the reserved remedy is recorded** (see
below): a real mid-range-phone capture is owed before fully trusting medium bloom
on mobile. If a real device shows medium under ≥30 fps, flip `medium.bloom` to
false (high-only) — a one-line change.

## Cited command output

`npm run build`:

```
✓ 106 modules transformed.
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-DAf4iFBw.js   224.93 kB │ gzip:  74.22 kB
dist/assets/three-XzBdJiDY.js   496.52 kB │ gzip: 124.87 kB
✓ built in 639ms
```

`npm test`:

```
 Test Files  62 passed (62)
      Tests  510 passed (510)
```

T10 driver (medium, unmuted, bed + live SFX voice):

```
tier            : medium  (resolved 6c / 6GB / touch 0)
audio           : unmuted=true  AudioContext=running  oscillators 3→14 (Δ11)
                  modesSeen=[fly,drive]  sfxVoiceConfirmed=true
fps samples     : 23.5,21.5,20.7,20.6,20.5,20.3,20.4,20.2,20.6,20.4
steady-state    : ~20.4 fps  (swiftshader — worst-case lower bound, NOT target-device)
muted control   : ~20.3 fps  (same input sequence) → audio is not the constraint
scene geometry  : low 29 draws / 90,406 tris (true scene); medium/high 1/1 (OutputPass quad)
console         : 0 real errors, 0 real warnings (4 benign swiftshader notices)
T10 MEASUREMENT OK — medium measured with ambient bed + live SFX voice running.
```

Screenshot evidence:
`docs/team/runs/assets/2026-06-23-bloom-compositor-verify/t10-medium-audio-sfx-floor.png`
(medium tier, mid-drive at the beacon vantage, HUD live — a valid not-silent
render during the loaded window).

## Residual risk / follow-up

- **TOP RISK — medium mobile fps is unmeasured on a real GPU.** Software
  swiftshader puts medium (half-res bloom, bed + live SFX) at ~20.4 fps, but the
  control proves the audio is not the constraint and bloom is a fill-rate pass
  that CPU rasterization punishes and a GPU handles cheaply. **A real
  mid-range-phone capture is owed** before trusting medium bloom on mobile.
  Reserved remedy: flip `medium.bloom` to `false` in `QUALITY_TIERS` (one-line
  table change + its `quality.test.ts` row) — deferred to that measurement, not
  guessed here.
