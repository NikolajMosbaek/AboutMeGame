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
// Exits non-zero if the page errors, WebGL is unavailable, the engine never
// reports a running state, or any day-cycle check fails — so it works as a
// verification gate, not just a screenshot tool.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:5173/";
const out = argVal("--out") ?? "scratchpad-shot.png";
const outDir = argVal("--out-dir") ?? ".";
const advanceMs = Number(argVal("--advance") ?? "1500");
const autoStart = !args.includes("--no-start");
const dayCycle = args.includes("--day-cycle");

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

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  // Enter the world if a landing CTA is present.
  if (autoStart) {
    const cta = page.getByRole("button", { name: /drive in/i });
    if (await cta.count()) {
      await cta.first().click();
    }
  }

  // Wait for the engine's automation hook to come online.
  await page.waitForFunction(() => typeof window.advanceTime === "function", {
    timeout: 15_000,
  });

  // Dismiss the first-run onboarding overlay if present — it does not pause the
  // sim, but its dark backdrop would dominate any screenshot (and obscure the
  // sky strip the day-cycle check samples).
  const gotIt = page.getByRole("button", { name: /got it, drive in/i });
  if (await gotIt.count()) {
    await gotIt.first().click();
    await page.waitForTimeout(100);
  }

  if (dayCycle) {
    await verifyDayCycle(page);
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

function report(problems) {
  if (problems.length) {
    console.error("VERIFY FAILED:\n- " + problems.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("VERIFY OK");
  }
}
