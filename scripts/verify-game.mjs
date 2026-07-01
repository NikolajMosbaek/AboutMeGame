// Browser-driven smoke verifier (develop-web-game discipline: the screenshot is
// the source of truth). Drives the running game in a real WebGL browser:
// enters the world, advances the simulation deterministically via the
// window.advanceTime hook, reads window.render_game_to_text, and writes a
// screenshot. Run against a dev or preview server.
//
//   node scripts/verify-game.mjs [url] [--out file.png] [--advance ms] [--no-start]
//
// G3 living-sky mode — verify the day cycle on the running build:
//
//   node scripts/verify-game.mjs [url] [--day-cycle] [--out-dir dir]
//
// Steps the simulation to the NOON (frac 0.25), GOLDEN (0.5) and dim EVENING
// (0.75) keyframes of the ~180s loop, screenshots each, and checks: the engine
// stays running with positive fps and no WebGL/console errors at every stop; all
// 13 landmarks stay present (beacons.poiCount and discovery.total both 13); the
// SKY visibly changes between the three keyframes (the loop is actually
// animating, not frozen on the construction-time noon); and stepping a FULL
// period back to the start rejoins the dawn look with no seam jump.
//
// G4 landmark-tour mode — verify the upgraded landmark silhouettes on the
// running build:
//
//   node scripts/verify-game.mjs [url] [--landmark-tour] [--out-dir dir]
//
// Frames each of the 8 procedural archetypes (gate, monolith, tower, foundry,
// dam, station, ring, mirror) with the `window.__frameView__` automation hook —
// which aims the camera at the landmark and renders ONE still frame with the
// follow-camera halted, so the framing is deterministic — screenshots each, and
// checks: the engine stays running with positive fps and no WebGL/console errors
// throughout; each frame shows a built STRUCTURE (a body of non-grass, non-sky
// pixels in the centre, not an empty meadow); each shows the landmark's
// signature-hued ACCENT GLOW (bright pixels matching the anchor colour, the
// emissive accent + beacon the G2 bloom catches); and the 8 silhouettes are
// DISTINCT (their structure-coverage / accent-hue signatures are not all alike).
//
// F1 completion-panel mode — verify the completion dialog's dismissal paths on
// the running build:
//
//   node scripts/verify-game.mjs [url] [--completion-panel] [--out-dir dir]
//
// Seeds 12 of the 13 landmarks as already discovered, drives to the Arrivals
// Gate and interacts (the 13th find), closes the reveal so the completion panel
// raises, and checks: the dialog shows all three CTAs in the decided order
// (Replay, Share enabled, Keep exploring) with entry focus on Replay; Escape
// dismisses the dialog and returns focus to the canvas container; and — after a
// reload + re-raise, since the completion edge is single-shot — a backdrop
// click dismisses and returns focus to the canvas container likewise.
//
// Exits non-zero if the page errors, WebGL is unavailable, the engine never
// reports a running state, or any day-cycle / landmark-tour / completion-panel
// check fails — so it works as a verification gate, not just a screenshot tool.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:5173/";
const out = argVal("--out") ?? "scratchpad-shot.png";
const outDir = argVal("--out-dir") ?? ".";
const advanceMs = Number(argVal("--advance") ?? "1500");
const autoStart = !args.includes("--no-start");
const dayCycle = args.includes("--day-cycle");
const landmarkTour = args.includes("--landmark-tour");
const completionPanel = args.includes("--completion-panel");

function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

// --- G3 day-cycle constants (kept in sync with src/world/dayCycleSystem.ts &
//     src/world/dayCycle.ts) ------------------------------------------------
const PERIOD_SECONDS = 180; // one dawn→noon→dusk→evening→dawn loop
const EXPECTED_LANDMARKS = 13; // the island's 13 discoverable landmarks
// Minimum per-channel mean-colour delta (0..255) across the largest quarter step
// for the loop to count as "visibly animating" rather than frozen on one palette.
const MIN_SKY_DELTA = 6;
// Maximum per-channel mean-colour delta between the φ reference and the strip
// after stepping a FULL period — the wrap must rejoin φ closely (no seam jump).
const MAX_SEAM_DELTA = 8;

// --- G4 landmark-tour constants (kept in sync with src/world/worldConfig.ts:
//     POI_ANCHORS) -----------------------------------------------------------
// The 13 landmark anchors, kept in sync with src/world/worldConfig.ts
// (POI_ANCHORS). One representative anchor per archetype is toured — the
// geometry is identical for repeats of an archetype, so framing one proves the
// silhouette upgrade for that archetype. x/z place the structure; color is the
// signature hue its accent + beacon glow in.
const LANDMARK_ANCHORS = [
  { archetype: "gate", label: "Arrivals Gate", x: 0, z: 64, color: 0xffcb47 },
  { archetype: "monolith", label: "One-Sentence Overlook", x: -62, z: 34, color: 0x7ad1ff },
  { archetype: "foundry", label: "Session Foundry", x: -96, z: -28, color: 0xff8a5c },
  { archetype: "tower", label: "Calibrated Review Tower", x: 118, z: -18, color: 0xffe066 },
  { archetype: "dam", label: "Force-Push Dam", x: 102, z: 52, color: 0x5cc8ff },
  { archetype: "station", label: "Walkthrough Station", x: 56, z: 98, color: 0x8affc1 },
  { archetype: "ring", label: "History Rail Yard", x: -12, z: 112, color: 0xffa3d1 },
  { archetype: "mirror", label: "Hall of Mirrors", x: -120, z: -74, color: 0xd9e3ff },
];
const TOUR_ARCHETYPES = LANDMARK_ANCHORS.length; // 8 distinct silhouettes
// A built structure must cover at least this fraction of the centre band — below
// it, the frame is an empty meadow (the landmark didn't render / wasn't framed).
const MIN_STRUCTURE_COVERAGE = 0.02;
// Each landmark must show at least this fraction of bright pixels whose HUE
// matches the anchor's signature colour — the emissive accent + beacon the G2
// bloom catches. Below it, the signature-hued wayfinding glow is absent. The
// measured floor across the 8 is ~1.3% (ring/tower); 0.5% leaves headroom while
// still catching a genuinely missing glow.
const MIN_ACCENT_HUED_COVERAGE = 0.005;

// --- F1 completion-panel constants (kept in sync with src/discovery/
//     persistence.ts KEY, src/world/worldConfig.ts POI_ANCHORS and the
//     CompletionPanel CTA row) ------------------------------------------------
const DISCOVERY_STORAGE_KEY = "aboutmegame.discovered.v1";
// The one landmark left undiscovered by the seed: the Arrivals Gate sits dead
// ahead of the spawn plaza (the craft spawns at (0,0) facing it), so a straight
// hold-W run reaches its 16-unit interact radius. Landmarks have no collision.
const FINAL_POI = { id: "poi-arrivals-gate", x: 0, z: 64 };
// The other 12 of the 13 poiIds, seeded as already discovered.
const SEEDED_POI_IDS = [
  "poi-end-state-overlook",
  "poi-ai-first-foundry",
  "poi-staff-engineer-gate",
  "poi-root-cause-quarry",
  "poi-autonomous-debug-lab",
  "poi-review-tower",
  "poi-force-push-dam",
  "poi-pr-walkthrough-station",
  "poi-history-rail-yard",
  "poi-architecture-gardens",
  "poi-skill-workshop",
  "poi-meta-mirror",
];
// The decided, documented CTA order (F1 slice 3): DOM = visual = tab order.
const COMPLETION_CTAS = ["Replay", "Share", "Keep exploring"];
// Tap E a little inside DiscoverySystem's INTERACT_RADIUS (16) so the tap still
// lands in range despite the craft's momentum between poll steps.
const INTERACT_TAP_DIST = 14;


const consoleErrors = [];
const browser = await chromium.launch({
  args: [
    // Software WebGL so it renders in headless CI/sandboxes without a GPU.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // Completion-panel mode: seed 12 of the 13 landmarks as already discovered
  // BEFORE the app boots (the discovery system loads persistence when the world
  // builds), so one drive-and-interact at the Arrivals Gate is the 13th find.
  // An init script re-applies on every navigation, so the reload between the
  // two dismissal passes re-seeds the same 12/13 state.
  if (completionPanel) {
    await page.addInitScript(
      ([key, ids]) => localStorage.setItem(key, JSON.stringify(ids)),
      [DISCOVERY_STORAGE_KEY, SEEDED_POI_IDS],
    );
  }

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await enterWorld(page, autoStart);

  if (dayCycle) {
    await verifyDayCycle(page);
  } else if (landmarkTour) {
    await verifyLandmarkTour(page);
  } else if (completionPanel) {
    await verifyCompletionPanel(page);
  } else {
    await smokeShot(page);
  }
} finally {
  await browser.close();
}

// --- Default single-frame smoke shot -----------------------------------------
async function smokeShot(page) {
  // Optionally hold keys (e.g. --keys w,d or --keys Space) while stepping, so a
  // screenshot can capture the craft actually driving/flying.
  const keysArg = argVal("--keys");
  const heldKeys = keysArg ? keysArg.split(",").map((k) => k.trim()) : [];
  for (const k of heldKeys) await page.keyboard.down(k);

  // Step the simulation deterministically, then read state.
  await page.evaluate((ms) => window.advanceTime(ms), advanceMs);
  for (const k of heldKeys) await page.keyboard.up(k);

  // Optional coast (let momentum settle) then a single key tap (e.g. interact).
  const coastMs = Number(argVal("--coast") ?? "0");
  if (coastMs > 0) await page.evaluate((ms) => window.advanceTime(ms), coastMs);
  const tapKey = argVal("--tap");
  if (tapKey) {
    await page.keyboard.down(tapKey);
    await page.evaluate(() => window.advanceTime(50));
    await page.keyboard.up(tapKey);
    await page.evaluate(() => window.advanceTime(400));
  }
  const stateJson = await page.evaluate(() =>
    window.render_game_to_text ? window.render_game_to_text() : "null",
  );

  await page.waitForTimeout(200);
  await page.screenshot({ path: out });

  const state = JSON.parse(stateJson);
  console.log("STATE:", JSON.stringify(state, null, 2));
  console.log("SCREENSHOT:", out);

  const problems = [];
  if (!state) problems.push("render_game_to_text returned null");
  if (state && state.fps <= 0) problems.push(`fps not positive: ${state?.fps}`);
  const webglErr = consoleErrors.find((e) => /webgl|context|THREE/i.test(e));
  if (webglErr) problems.push(`WebGL/three error: ${webglErr}`);
  if (consoleErrors.length) {
    console.log("CONSOLE ERRORS:\n" + consoleErrors.join("\n"));
  }

  report(problems);
}

// --- G3 living-sky verification ----------------------------------------------
async function verifyDayCycle(page) {
  const problems = [];

  // Climb to an aerial vantage so the SKY DOME, the fog horizon and the sun's
  // long shadows fill the frame — at ground level the sky is a thin sliver and
  // the day-cycle change is hard to read (for the human eyeball check too). F
  // toggles flight; Space climbs. We then nose down slightly so the island stays
  // in shot under the sky.
  await page.keyboard.press("f");
  await page.keyboard.down(" ");
  await page.evaluate(() => window.advanceTime(6000));
  await page.keyboard.up(" ");

  // Sample the mean RGB of a horizontal sky strip (the top ~14% of the frame),
  // decoded from the Playwright PNG (a plain image decode — robust, unlike a
  // WebGL readback on a non-preserved drawing buffer). The strip excludes the
  // ground, so it tracks the dome-top / fog the day cycle drives.
  const skyStripMean = async (pngBuffer) => {
    const dataUrl = "data:image/png;base64," + pngBuffer.toString("base64");
    return await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const cx = cv.getContext("2d");
      cx.drawImage(img, 0, 0);
      const h = Math.max(1, Math.floor(img.height * 0.14));
      const { data } = cx.getImageData(0, 0, img.width, h);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      return [r / n, g / n, b / n];
    }, dataUrl);
  };

  const chanDelta = (a, b) =>
    Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  // Capture the current frame: screenshot to `file`, read the engine snapshot,
  // and sample the sky strip. Also runs the per-frame health + 13-landmark check.
  const capture = async (name) => {
    await page.waitForTimeout(120);
    const file = `${outDir}/daycycle-${name}.png`;
    const shot = await page.screenshot({ path: file });
    const stateJson = await page.evaluate(() =>
      window.render_game_to_text ? window.render_game_to_text() : "null",
    );
    const state = JSON.parse(stateJson);
    const sky = await skyStripMean(shot);

    if (!state) {
      problems.push(`${name}: render_game_to_text returned null`);
    } else {
      if (!state.running) problems.push(`${name}: engine not running`);
      if (state.fps <= 0) problems.push(`${name}: fps not positive (${state.fps})`);
      if (state.drawCalls > 150)
        problems.push(`${name}: drawCalls ${state.drawCalls} over budget (150)`);
      if (state.triangles > 500_000)
        problems.push(`${name}: triangles ${state.triangles} over budget (500000)`);
      // All 13 landmarks must stay present/legible at every loop point. The
      // beacon-pulse system reports the placed landmark count; discovery reports
      // the total. Both must read 13 — a dropped landmark would show as a lower
      // count, and "present" is the legibility floor a text snapshot can assert.
      const beaconCount = state.systems?.beacons?.poiCount;
      const discoveryTotal = state.systems?.discovery?.total;
      if (beaconCount !== EXPECTED_LANDMARKS)
        problems.push(`${name}: beacons.poiCount ${beaconCount} != ${EXPECTED_LANDMARKS}`);
      if (discoveryTotal !== EXPECTED_LANDMARKS)
        problems.push(`${name}: discovery.total ${discoveryTotal} != ${EXPECTED_LANDMARKS}`);
    }
    return { name, file, state, sky };
  };

  const stepQuarter = async () => {
    await page.evaluate((ms) => window.advanceTime(ms), (PERIOD_SECONDS / 4) * 1000);
  };

  // The system owns its scalar clock and exposes no reset hook (by design — it
  // takes only the three sky handles + the gate, never the World). So we verify
  // PHASE-RELATIVE: pick a reference phase φ here and walk the loop in quarter-
  // period steps from it. φ's absolute value is irrelevant — the running-build
  // job is to prove the look CHANGES smoothly across a loop and REJOINS φ exactly
  // after a full period (the seam). Absolute-frac bit-exactness (the noon palette
  // == sky.ts) is owned by the headless unit test, which reads the palette math
  // directly; pixels through tone-mapping + fog can't prove a hex value anyway.
  const stops = [];
  stops.push(await capture("ref")); // φ
  for (const name of ["q1", "q2", "q3"]) {
    await stepQuarter();
    stops.push(await capture(name)); // φ+0.25, φ+0.5, φ+0.75
  }

  // The cycle is ANIMATING, not frozen: each successive quarter's sky differs
  // from the previous by more than the noise floor. A frozen sky (e.g. the system
  // not advancing, or stuck on the construction-time noon) would show ~0 delta
  // across every step. We also require the loop to actually travel — the spread
  // between the brightest and dimmest sky across the four stops must clear the
  // floor, so a tiny per-step wobble can't masquerade as a living cycle.
  let maxSpread = 0;
  for (let i = 1; i < stops.length; i++) {
    const d = chanDelta(stops[i].sky, stops[i - 1].sky);
    if (d > maxSpread) maxSpread = d;
  }
  if (maxSpread < MIN_SKY_DELTA)
    problems.push(
      `sky did not change across the loop: max step delta ${maxSpread.toFixed(1)} < ${MIN_SKY_DELTA} (loop frozen?)`,
    );

  // Seam check: step the final quarter to complete one full period from φ. The
  // sky must rejoin the φ reference closely — proof the wrap is jump-free (the
  // closing keyframe rejoins dawn and the accumulator euclidean-wraps).
  await stepQuarter();
  const wrap = await capture("wrap"); // φ+1.0 ≡ φ
  const seamDelta = chanDelta(stops[0].sky, wrap.sky);
  if (seamDelta > MAX_SEAM_DELTA)
    problems.push(
      `seam jump at wrap: φ→φ+period max channel delta ${seamDelta.toFixed(1)} > ${MAX_SEAM_DELTA}`,
    );

  const webglErr = consoleErrors.find((e) => /webgl|context|THREE/i.test(e));
  if (webglErr) problems.push(`WebGL/three error: ${webglErr}`);

  // Report the measured signal so a human reviewer can eyeball the screenshots
  // and the numbers together.
  console.log("DAY-CYCLE STOPS (phase-relative quarters of the ~180s loop):");
  for (const s of [...stops, wrap]) {
    console.log(
      `  ${s.name}: sky≈[${s.sky.map((v) => v.toFixed(0)).join(",")}] ` +
        `fps=${s.state?.fps} draws=${s.state?.drawCalls} tris=${s.state?.triangles} ` +
        `landmarks(beacons=${s.state?.systems?.beacons?.poiCount}, discovery=${s.state?.systems?.discovery?.total}) ` +
        `-> ${s.file}`,
    );
  }
  console.log(
    `  max per-quarter sky delta=${maxSpread.toFixed(1)} (>=${MIN_SKY_DELTA} ⇒ animating); ` +
      `seam φ→φ+period delta=${seamDelta.toFixed(1)} (<=${MAX_SEAM_DELTA} ⇒ no jump)`,
  );
  if (consoleErrors.length) {
    console.log("CONSOLE ERRORS:\n" + consoleErrors.join("\n"));
  }

  report(problems);
}

// --- G4 landmark-tour verification -------------------------------------------
// The per-pixel hue maths runs in-page (inside `page.evaluate`, the browser
// context — it can't reach node-scope helpers), so the hue/delta functions are
// defined inline where the PNG is decoded rather than up here.
async function verifyLandmarkTour(page) {
  const problems = [];

  // Wait for the framing hook specifically (the smoke hook may be up first).
  await page.waitForFunction(() => typeof window.__frameView__ === "function", {
    timeout: 15_000,
  });

  // Step to a bright daytime keyframe so the flat-shaded facets and the accent
  // glow read clearly (at the dim dawn spawn the silhouettes are muddy).
  await page.evaluate(() => window.advanceTime(45_000));

  // Hide the React HUD/overlay chrome so the screenshot is just the world —
  // nav markers, the speed pill and onboarding would otherwise sit over the
  // structure and pollute the pixel sample. This touches only the verifier's
  // page, never product code.
  await page.addStyleTag({
    content:
      ".hud,[class*='hud'],[class*='nav'],[class*='Nav'],[class*='onboard']," +
      "[class*='vignette'],[class*='announc']{display:none!important;}",
  });

  // Sample a screenshot for: total bright signature-hued accent coverage, and
  // central-band built-structure coverage (stone-grey or accent-bright pixels
  // that are neither the green ground nor the pale sky). Decoded from the PNG in
  // the page (a plain image decode, robust on a non-preserved drawing buffer).
  const sampleFrame = async (pngBuffer, colorHex) => {
    const dataUrl = "data:image/png;base64," + pngBuffer.toString("base64");
    return await page.evaluate(
      async ([src, hex]) => {
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = src;
        });
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const cx = cv.getContext("2d");
        cx.drawImage(img, 0, 0);
        const { data, width, height } = cx.getImageData(0, 0, img.width, img.height);

        const tr = (hex >> 16) & 255;
        const tg = (hex >> 8) & 255;
        const tb = hex & 255;
        // Target hue (inline, matching the node-side rgbHue).
        const hueOf = (r, g, b) => {
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
          if (c < 12) return -1;
          let h;
          if (mx === r) h = ((g - b) / c) % 6;
          else if (mx === g) h = (b - r) / c + 2;
          else h = (r - g) / c + 4;
          return ((h * 60) + 360) % 360;
        };
        const dh = (a, b) => {
          const d = Math.abs(a - b) % 360;
          return d > 180 ? 360 - d : d;
        };
        const targetHue = hueOf(tr, tg, tb);

        // Centre band where the framed structure sits (avoids the ground apron
        // and the very top sky). 18%..82% vertically, 25%..75% horizontally.
        const x0 = Math.floor(width * 0.25), x1 = Math.floor(width * 0.75);
        const y0 = Math.floor(height * 0.18), y1 = Math.floor(height * 0.82);

        let total = 0, accent = 0, accentHued = 0; // whole-frame accent-glow coverage
        let bandTotal = 0, structure = 0; // centre-band built-structure coverage
        for (let y = 0; y < height; y++) {
          const inBandY = y >= y0 && y < y1;
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            total++;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const h = hueOf(r, g, b);

            // Accent glow, two reads over the whole frame (the beacon plume rises
            // out of the centre band): `hued` = a bright pixel whose hue matches
            // the anchor's signature colour (the assertable signature glow);
            // `brightCore` = a bloom-blown near-white halo (reported, not gated,
            // since the sky is also bright-white).
            const brightCore = lum > 210 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
            const hued = lum > 150 && h >= 0 && targetHue >= 0 && dh(h, targetHue) < 32;
            if (hued) accentHued++;
            if (brightCore || hued) accent++;

            if (inBandY && x >= x0 && x < x1) {
              bandTotal++;
              // Ground is green-dominant mid-tone; sky is pale and blue/white at
              // high luminance with low green-dominance. A built structure is
              // either desaturated stone-grey OR a bright signature-hued accent.
              const greenGround = g > r + 14 && g > b + 14 && lum < 170;
              const paleSky = lum > 190 && b >= g - 10;
              const isStone = !greenGround && !paleSky;
              if (isStone) structure++;
            }
          }
        }
        return {
          accentCoverage: accent / total,
          accentHuedCoverage: accentHued / total,
          structureCoverage: structure / Math.max(bandTotal, 1),
        };
      },
      [dataUrl, colorHex],
    );
  };

  const results = [];
  for (const a of LANDMARK_ANCHORS) {
    // Stand outward of the landmark (away from the island origin) and look back
    // in and slightly down — an elevated 3/4 view that clears the foreground
    // trees and frames the full silhouette top-to-base against the sky.
    const len = Math.hypot(a.x, a.z) || 1;
    const ux = a.x / len, uz = a.z / len;
    const dist = 34;
    const eye = [a.x + ux * dist, 28, a.z + uz * dist];
    // Look at the structure's upper-middle so the camera tilts up enough to keep
    // the tallest tops (the tower's lamp crown, the monolith cap) in frame while
    // the elevated eye still clears the foreground trees.
    const target = [a.x, 11, a.z];

    await page.evaluate(
      ([e, t]) => window.__frameView__(e, t),
      [eye, target],
    );
    await page.waitForTimeout(80);

    const file = `${outDir}/landmark-${a.archetype}.png`;
    const shot = await page.screenshot({ path: file });

    // The engine must stay healthy at every framing (no crash mid-tour).
    const stateJson = await page.evaluate(() =>
      window.render_game_to_text ? window.render_game_to_text() : "null",
    );
    const state = JSON.parse(stateJson);
    if (!state) problems.push(`${a.archetype}: render_game_to_text returned null`);
    else {
      // `__frameView__` deliberately HALTS the live loop to hold the still, so
      // `state.running` is false here — that is the framed-shot contract, not a
      // fault. The health signals that still hold are a positive fps read-out
      // (an EMA, untouched by the halt) and the full 13-landmark count.
      if (state.fps <= 0) problems.push(`${a.archetype}: fps not positive (${state.fps})`);
      const beaconCount = state.systems?.beacons?.poiCount;
      const discoveryTotal = state.systems?.discovery?.total;
      if (beaconCount !== EXPECTED_LANDMARKS)
        problems.push(`${a.archetype}: beacons.poiCount ${beaconCount} != ${EXPECTED_LANDMARKS}`);
      if (discoveryTotal !== EXPECTED_LANDMARKS)
        problems.push(`${a.archetype}: discovery.total ${discoveryTotal} != ${EXPECTED_LANDMARKS}`);
    }

    const s = await sampleFrame(shot, a.color);
    if (s.structureCoverage < MIN_STRUCTURE_COVERAGE)
      problems.push(
        `${a.archetype}: no structure framed — centre coverage ` +
          `${(s.structureCoverage * 100).toFixed(2)}% < ${(MIN_STRUCTURE_COVERAGE * 100).toFixed(2)}% (empty meadow?)`,
      );
    if (s.accentHuedCoverage < MIN_ACCENT_HUED_COVERAGE)
      problems.push(
        `${a.archetype}: no signature-hued accent glow — ` +
          `${(s.accentHuedCoverage * 100).toFixed(3)}% match #${a.color.toString(16)} ` +
          `< ${(MIN_ACCENT_HUED_COVERAGE * 100).toFixed(3)}%`,
      );

    results.push({ ...a, file, state, ...s });
  }

  // All 8 archetypes were toured (a missing anchor would shorten this).
  if (results.length !== TOUR_ARCHETYPES)
    problems.push(`toured ${results.length} archetypes, expected ${TOUR_ARCHETYPES}`);

  // Distinctness: the 8 silhouettes must not all read alike. Structure coverage
  // alone is weak (a tall obelisk and a thin gate can match), so distinctness is
  // judged on the (structure-coverage, accent-coverage) signature pair — if every
  // archetype collapsed to the same blob, these would barely spread. Require the
  // structure-coverage spread across the 8 to clear a floor.
  const covs = results.map((r) => r.structureCoverage);
  const spread = Math.max(...covs) - Math.min(...covs);
  if (results.length === TOUR_ARCHETYPES && spread < 0.02)
    problems.push(
      `silhouettes not distinct: structure-coverage spread ${(spread * 100).toFixed(2)}% < 2% ` +
        `(all archetypes render the same blob?)`,
    );

  const webglErr = consoleErrors.find((e) => /webgl|context|THREE/i.test(e));
  if (webglErr) problems.push(`WebGL/three error: ${webglErr}`);

  console.log("LANDMARK TOUR (8 procedural archetypes, framed one still each):");
  for (const r of results) {
    console.log(
      `  ${r.archetype.padEnd(9)} #${r.color.toString(16).padStart(6, "0")} ` +
        `structure=${(r.structureCoverage * 100).toFixed(2)}% ` +
        `accent(hued)=${(r.accentHuedCoverage * 100).toFixed(3)}% ` +
        `accent(any)=${(r.accentCoverage * 100).toFixed(3)}% ` +
        `fps=${r.state?.fps} landmarks=${r.state?.systems?.beacons?.poiCount} -> ${r.file}`,
    );
  }
  console.log(
    `  structure-coverage spread across the 8 = ${(spread * 100).toFixed(2)}% (>=2% ⇒ distinct silhouettes)`,
  );
  if (consoleErrors.length) {
    console.log("CONSOLE ERRORS:\n" + consoleErrors.join("\n"));
  }

  report(problems);
}

// --- Shared world entry --------------------------------------------------------
// Enter the world: click the landing CTA when present (skipped by --no-start),
// wait for the engine's automation hook to come online, and dismiss the
// first-run onboarding overlay if it shows — it does not pause the sim, but its
// dark backdrop would dominate any screenshot (and obscure the sky strip the
// day-cycle check samples). Shared by the initial load and the completion-panel
// mode's mid-run reload.
async function enterWorld(page, start = true) {
  if (start) {
    // The landing CTA reads "Drive in" on a fresh state and "Continue" when
    // saved progress exists (the completion-panel mode seeds 12/13).
    const cta = page.getByRole("button", { name: /^(drive in|continue)$/i });
    if (await cta.count()) {
      await cta.first().click();
    }
  }
  await page.waitForFunction(() => typeof window.advanceTime === "function", {
    timeout: 15_000,
  });
  const gotIt = page.getByRole("button", { name: /got it, drive in/i });
  if (await gotIt.count()) {
    await gotIt.first().click();
    await page.waitForTimeout(100);
  }
}

// --- F1 completion-panel verification ------------------------------------------
async function verifyCompletionPanel(page) {
  const problems = [];

  // PASS 1 — raise the panel, check the CTA row, dismiss with Escape.
  if (await raiseCompletionPanel(page, problems, "escape pass")) {
    await page.screenshot({ path: `${outDir}/completion-panel.png` });
    console.log(`SCREENSHOT: ${outDir}/completion-panel.png`);
    await checkCtaRow(page, problems);
    await page.keyboard.press("Escape");
    await checkDismissed(page, problems, "Escape");
  }

  // PASS 2 — the raise is single-shot (the completion edge is consumed), so
  // reload (the init script re-seeds 12/13), raise again, and dismiss with a
  // click on the backdrop outside the panel.
  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  await enterWorld(page);
  if (await raiseCompletionPanel(page, problems, "backdrop pass")) {
    await page
      .locator(".completion-panel-backdrop")
      .click({ position: { x: 12, y: 12 } });
    await checkDismissed(page, problems, "backdrop click");
  }

  // Engine health after both passes: positive fps, the full 13 discovered, no
  // WebGL/console errors.
  const state = JSON.parse(
    await page.evaluate(() =>
      window.render_game_to_text ? window.render_game_to_text() : "null",
    ),
  );
  if (!state) problems.push("render_game_to_text returned null");
  else {
    if (state.fps <= 0) problems.push(`fps not positive (${state.fps})`);
    const discovered = state.systems?.discovery?.discovered;
    if (discovered !== EXPECTED_LANDMARKS)
      problems.push(
        `discovered ${discovered} != ${EXPECTED_LANDMARKS} after the final find`,
      );
  }
  const webglErr = consoleErrors.find((e) => /webgl|context|THREE/i.test(e));
  if (webglErr) problems.push(`WebGL/three error: ${webglErr}`);
  if (consoleErrors.length) {
    console.log("CONSOLE ERRORS:\n" + consoleErrors.join("\n"));
  }

  report(problems);
}

// Raise the completion panel: drive from spawn to the Arrivals Gate (the one
// unseeded landmark, dead ahead), tap E inside interact range to open its
// reveal — the 13th find, which arms the completion latch — then tap E again to
// close the reveal, which is what raises the panel. `label` names the pass in
// problem reports. Returns false (with a problem pushed) if the panel never
// raised, so the caller skips that pass's dismissal checks.
async function raiseCompletionPanel(page, problems, label) {
  const readState = async () =>
    JSON.parse(
      await page.evaluate(() =>
        window.render_game_to_text ? window.render_game_to_text() : "null",
      ),
    );
  const tapInteract = async () => {
    await page.keyboard.down("e");
    await page.evaluate(() => window.advanceTime(60));
    await page.keyboard.up("e");
    await page.evaluate(() => window.advanceTime(250));
  };

  // Approach with W held, stepping the sim in small slices and polling the
  // vehicle position, so the E tap lands inside the 16-unit interact radius
  // despite the craft's speed (driveMax 54 u/s). Once the reveal opens the sim
  // pauses, so the still-held W stops mattering.
  await page.keyboard.down("w");
  let opened = false;
  for (let i = 0; i < 80 && !opened; i++) {
    await page.evaluate(() => window.advanceTime(150));
    const state = await readState();
    if (state?.systems?.discovery?.open === FINAL_POI.id) {
      opened = true;
      break;
    }
    const pos = state?.systems?.vehicle?.pos;
    const dist = Array.isArray(pos)
      ? Math.hypot(pos[0] - FINAL_POI.x, pos[1] - FINAL_POI.z)
      : Infinity;
    if (dist <= INTERACT_TAP_DIST) {
      await tapInteract();
      const after = await readState();
      opened = after?.systems?.discovery?.open === FINAL_POI.id;
    }
  }
  await page.keyboard.up("w");

  if (!opened) {
    problems.push(`${label}: could not open the final reveal at ${FINAL_POI.id}`);
    return false;
  }
  const discovered = (await readState())?.systems?.discovery?.discovered;
  if (discovered !== EXPECTED_LANDMARKS)
    problems.push(
      `${label}: final reveal open but discovered ${discovered} != ${EXPECTED_LANDMARKS} (seed failed?)`,
    );

  // Close the reveal with a second interact — the panel raises only once the
  // final reveal has closed (the armed completion latch).
  await tapInteract();
  try {
    await page.waitForSelector(".completion-panel", { timeout: 5_000 });
  } catch {
    problems.push(
      `${label}: completion panel did not raise after the final reveal closed`,
    );
    return false;
  }
  console.log(`COMPLETION PANEL raised (${label})`);
  return true;
}

// The completion dialog's CTA row: the decided, documented order (DOM = visual
// = tab order), the Share CTA present and enabled at rest, entry focus on the
// Replay CTA.
async function checkCtaRow(page, problems) {
  const ctas = await page.$$eval(".completion-panel button", (btns) =>
    btns.map((b) => ({ label: b.textContent?.trim(), disabled: b.disabled })),
  );
  const labels = ctas.map((c) => c.label);
  if (JSON.stringify(labels) !== JSON.stringify(COMPLETION_CTAS))
    problems.push(
      `CTA row [${labels.join(", ")}] != [${COMPLETION_CTAS.join(", ")}]`,
    );
  const share = ctas.find((c) => c.label === "Share");
  if (!share) problems.push("Share CTA missing from the completion panel");
  else if (share.disabled)
    problems.push("Share CTA disabled at rest (pending latch stuck?)");
  const focused = await page.evaluate(
    () => document.activeElement?.textContent?.trim() ?? null,
  );
  if (focused !== "Replay")
    problems.push(`entry focus on ${JSON.stringify(focused)} — expected the Replay CTA`);
  console.log(
    `  CTA row: [${labels.join(", ")}]; Share disabled=${share?.disabled}; ` +
      `entry focus=${JSON.stringify(focused)}`,
  );
}

// A dismissal path must detach the dialog and land focus on the canvas
// container (the panel has no opener element to restore focus to).
async function checkDismissed(page, problems, label) {
  try {
    await page.waitForSelector(".completion-panel", {
      state: "detached",
      timeout: 5_000,
    });
  } catch {
    problems.push(`${label}: completion panel still up after dismissal`);
    return;
  }
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    return el
      ? { tag: el.tagName.toLowerCase(), className: String(el.className) }
      : null;
  });
  const onContainer =
    !!focus && focus.className.split(" ").includes("game-canvas-container");
  if (!onContainer)
    problems.push(
      `${label}: focus did not return to the canvas container — active element ` +
        `is <${focus?.tag ?? "none"} class="${focus?.className ?? ""}">`,
    );
  console.log(
    `  ${label}: dialog detached; focus -> ` +
      `<${focus?.tag ?? "none"} class="${focus?.className ?? ""}">`,
  );
}

function report(problems) {
  if (problems.length) {
    console.error("VERIFY FAILED:\n- " + problems.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("VERIFY OK");
  }
}
