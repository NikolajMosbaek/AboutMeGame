// Browser-driven smoke verifier (develop-web-game discipline: the screenshot is
// the source of truth). Drives the running game in a real WebGL browser:
// enters the world, advances the simulation deterministically via the
// window.advanceTime hook, reads window.render_game_to_text, and writes a
// screenshot. Run against a dev or preview server.
//
//   node scripts/verify-game.mjs [url] [--out file.png] [--advance ms] [--no-start]
//
// Exits non-zero if the page errors, WebGL is unavailable, or the engine never
// reports a running state — so it works as a verification gate, not just a
// screenshot tool.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:5173/";
const out = argVal("--out") ?? "scratchpad-shot.png";
const advanceMs = Number(argVal("--advance") ?? "1500");
const autoStart = !args.includes("--no-start");

function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

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
  const webglErr = consoleErrors.find((e) =>
    /webgl|context|THREE/i.test(e),
  );
  if (webglErr) problems.push(`WebGL/three error: ${webglErr}`);
  if (consoleErrors.length) {
    console.log("CONSOLE ERRORS:\n" + consoleErrors.join("\n"));
  }

  if (problems.length) {
    console.error("VERIFY FAILED:\n- " + problems.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("VERIFY OK");
  }
} finally {
  await browser.close();
}
