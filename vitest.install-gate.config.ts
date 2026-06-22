/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Config for the clean-checkout install gate (T4). The gate test shells out to
// git and npm and clones the repo, so it needs the node environment, a long
// timeout, and isolation from the fast jsdom unit suite — hence its own config
// and the dedicated `npm run test:install-gate` script rather than `npm test`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.{test,spec}.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
