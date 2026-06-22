/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Config for the clean-checkout run/serve gate (T6). Like the install and
// build gates, this test shells out to git and npm, clones the repo, and binds
// a port, so it needs the node environment, a long timeout, and isolation from
// the fast jsdom unit suite — hence its own config and the dedicated
// `npm run test:dev-gate` script rather than `npm test`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/dev-gate.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
});
