// verify.mjs — one-command render smoke: build, preview, verify, tear down.
//
// Orchestrates `vite build` + `vite preview` IN-PROCESS via Vite's JS API, so
// vite.config.ts stays the single source of base/port truth (base resolves to
// VITE_BASE ?? "/AboutMeGame/" exactly as production) and the preview server's
// lifetime is this process's lifetime — nothing can be orphaned on the port.
// The Playwright verifier (scripts/verify-game.mjs) runs untouched as a child
// against the resolved preview URL; its verdict streams verbatim and its exit
// code becomes ours.
//
// Failure states are phase-attributed and distinguishable:
//   1. build failed          — Vite's own output speaks; we name the phase.
//   2. preview never ready   — message names the URL, the timeout, and the
//                              last observed state (this poll is the 404
//                              guard: a wrong base path is NOT ready).
//   3. verifier failed       — the verifier's report alone speaks; the
//                              orchestrator adds no second verdict line.
//
// Typechecking is deliberately NOT run here — that stays the job of the
// `npm run build` gate; verify is a render smoke, not a second compile gate.

import { spawn } from "node:child_process";
import { build, preview } from "vite";
import { resolveVerifyUrl, waitForReady } from "./verify/lib.mjs";

const PREVIEW_PORT = 4173;
const READY_TIMEOUT_MS = 30_000;
// Generous bound on the whole Playwright run; only a pathological hang trips
// it. Bounded-run doctrine: the cap is logged, never hidden.
const VERIFIER_WATCHDOG_MS = 5 * 60_000;

const log = (msg) => console.log(`[verify] ${msg}`);
const fail = (msg) => console.error(`[verify] ${msg}`);

/** @type {import("vite").PreviewServer | null} */
let server = null;
/** @type {import("node:child_process").ChildProcess | null} */
let child = null;
/** @type {Promise<void> | null} */
let closingServer = null;

/** Idempotent teardown — safe to race between finally and a signal handler. */
function closeServer() {
  if (!server) return Promise.resolve();
  closingServer ??= server
    .close()
    .catch((err) => fail(`preview server close failed: ${err?.message ?? err}`));
  return closingServer;
}

// Ctrl+C / kill must leave no squatter on the port: kill the verifier child,
// close the server, then re-raise so the default disposition sets the exit
// status (`once` removed this handler, so the re-raise terminates us).
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    fail(`received ${signal}; tearing down`);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    void closeServer().finally(() => process.kill(process.pid, signal));
  });
}

async function main() {
  try {
    // Phase 1: production build (loads vite.config.ts like the CLI would).
    log("building (vite build via the JS API)");
    try {
      await build();
    } catch (err) {
      fail(`build failed: ${err?.message ?? err}`);
      process.exitCode = 1;
      return;
    }

    // Phase 2: serve the built bundle. strictPort: if 4173 is held we fail
    // loudly rather than silently bump ports and verify a stale server.
    try {
      server = await preview({
        preview: { port: PREVIEW_PORT, strictPort: true },
      });
    } catch (err) {
      fail(
        `could not start the preview server on port ${PREVIEW_PORT}: ` +
          `${err?.message ?? err}`,
      );
      fail(
        "is another preview already running? (strictPort is on — " +
          "the port is never silently bumped)",
      );
      process.exitCode = 1;
      return;
    }

    // Phase 3: readiness gate at the FULL base URL. Primary URL source is the
    // live server; the pure composer is the unit-tested fallback/drift-pin.
    const url =
      server.resolvedUrls?.local?.[0] ??
      resolveVerifyUrl({ port: PREVIEW_PORT, env: process.env });
    try {
      await waitForReady(url, { timeoutMs: READY_TIMEOUT_MS });
    } catch (err) {
      fail(`${err?.message ?? err}`);
      process.exitCode = 1;
      return;
    }
    log(`preview ready at ${url}`);

    // Phase 4: run the verifier against the resolved URL — printed above and
    // here BEFORE launch, so URL drift can never pass silently. Its stdio
    // streams verbatim; we add nothing to its verdict.
    log(`running scripts/verify-game.mjs against ${url}`);
    child = spawn(process.execPath, ["scripts/verify-game.mjs", url], {
      stdio: "inherit",
    });

    const watchdog = setTimeout(() => {
      fail(
        `watchdog: verifier still running after ${VERIFIER_WATCHDOG_MS} ms; ` +
          "killing it (bounded run — cap logged, never hidden)",
      );
      child?.kill("SIGKILL");
    }, VERIFIER_WATCHDOG_MS);
    watchdog.unref();

    const { code, signal } = await new Promise((resolve, reject) => {
      child?.once("error", reject);
      child?.once("close", (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(watchdog));

    if (signal) fail(`verifier was killed by ${signal}`);
    // Exit-code fidelity: the verifier's verdict is ours; a signal death
    // (code null) maps to non-zero — never a false green.
    process.exitCode = code ?? 1;
  } finally {
    await closeServer();
  }
}

await main();
