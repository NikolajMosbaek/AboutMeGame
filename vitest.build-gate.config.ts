/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Config for the clean-checkout build gate (T5). Like the install gate, this
// test shells out to git and npm and clones the repo, so it needs the node
// environment, a long timeout, and isolation from the fast jsdom unit suite —
// hence its own config and the dedicated `npm run test:build-gate` script
// rather than `npm test`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/build-gate.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
});
