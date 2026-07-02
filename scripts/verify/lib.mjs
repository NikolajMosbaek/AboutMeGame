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
