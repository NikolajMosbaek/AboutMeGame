/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Config for the ship gate (T11). Like the install/build/dev gates, this test
// shells out to a CLI (`gh`) and reaches the network, so it needs the node
// environment, a long timeout, and isolation from the fast jsdom unit suite —
// hence its own config and the dedicated `npm run test:ship-gate` script rather
// than `npm test`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/ship-gate.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
});
