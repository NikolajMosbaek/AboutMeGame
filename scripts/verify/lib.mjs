// Pure helpers for the verify orchestrator (scripts/verify.mjs).
//
// This module is side-effect-free: importing it never boots a server, touches
// the network, or reads ambient process state — callers inject `env`.

/**
 * Compose the URL the built preview serves the app at.
 *
 * Fallback / drift-pin for the live `server.resolvedUrls` value: the base
 * default is the IDENTICAL expression to vite.config.ts:12
 * (`process.env.VITE_BASE ?? "/AboutMeGame/"`), so if that knob moves, the
 * pin test here goes red instead of the verifier silently polling a 404.
 *
 * @param {object} opts
 * @param {number} opts.port - preview server port (e.g. 4173)
 * @param {string} [opts.base] - explicit base path; wins over `env.VITE_BASE`
 * @param {Record<string, string | undefined>} [opts.env] - injected env
 *   (pass `process.env` at the call site)
 * @returns {string} fully-qualified URL with a single trailing slash
 */
export function resolveVerifyUrl({ port, base, env = {} }) {
  const rawBase = base ?? env.VITE_BASE ?? "/AboutMeGame/";
  const trimmed = rawBase.replace(/^\/+|\/+$/g, "");
  const path = trimmed === "" ? "/" : `/${trimmed}/`;
  return `http://localhost:${port}${path}`;
}

/**
 * Poll `url` — the FULL base URL, never the root — until it answers HTTP 2xx.
 *
 * Only `res.ok` counts as ready: connection errors (server still booting) and
 * non-2xx statuses (a 404 means the base path is wrong — the exact bug class
 * this poller guards against) both mean keep polling. On timeout, rejects with
 * a message naming the polled URL, the elapsed bound, and the last observed
 * state (e.g. ECONNREFUSED vs HTTP 404).
 *
 * Elapsed time is accounted as accumulated `intervalMs` between attempts, so
 * with an injected `sleep` the timeout path is deterministic and runs in
 * milliseconds.
 *
 * @param {string} url - fully-qualified URL to poll (from resolveVerifyUrl or
 *   the live PreviewServer's resolvedUrls)
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl] - injected fetch (defaults to global)
 * @param {(ms: number) => Promise<void>} [opts.sleep] - injected delay
 * @param {number} [opts.timeoutMs] - total polling budget (default 30s)
 * @param {number} [opts.intervalMs] - delay between attempts (default 250ms)
 * @returns {Promise<void>} resolves once the URL answers 2xx
 */
export async function waitForReady(
  url,
  {
    fetchImpl = (...args) => globalThis.fetch(...args),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 30_000,
    intervalMs = 250,
  } = {},
) {
  let lastState = "no response yet";
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += intervalMs) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) return;
      lastState = `HTTP ${res.status}`;
    } catch (err) {
      // Node's fetch wraps network failures in a TypeError whose `cause`
      // carries the syscall code (e.g. ECONNREFUSED); surface that.
      lastState = err?.cause?.code ?? err?.code ?? err?.message ?? String(err);
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `preview never became ready: ${url} did not answer 2xx within ` +
      `${timeoutMs} ms (last observed state: ${lastState})`,
  );
}
