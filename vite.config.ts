/// <reference types="vitest/config" />
/// <reference types="node" />
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site under `/<repo>/`, so production assets must
// be referenced from that sub-path. Dev/preview stay at root. `VITE_BASE` lets
// CI override it (e.g. a custom domain serves from "/"). Every runtime asset URL
// is built from `import.meta.env.BASE_URL` (see src/engine/assets.ts), so this
// is the single knob that makes a sub-path deploy work.
const BASE = process.env.VITE_BASE ?? "/AboutMeGame/";

export default defineConfig(({ command, isPreview }) => ({
  // Production build + `vite preview` serve under the GitHub Pages sub-path so
  // the local preview matches the deployed site; the dev server stays at root.
  base: command === "build" || isPreview ? BASE : "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the rarely-changing engine vendor (three) into its own chunk so
        // a game-code change doesn't bust its cache, and the main chunk stays
        // small. An id-based matcher (not the bare `{ three: ["three"] }`
        // specifier) is required so three's add-on modules — notably
        // `three/examples/jsm/postprocessing/*`, which resolve to distinct ids —
        // fold into the same vendor chunk instead of leaking into the entry
        // chunk. See docs/perf-budget.md.
        manualChunks(id) {
          if (/node_modules\/three\//.test(id)) return "three";
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    // Unit tests live beside the source. Browser-driven verification
    // (scripts/verify-game.mjs) is run separately and must not be swept here —
    // the scripts/verify/ glob only matches the verify orchestrator's pure,
    // headless helper tests, never verify-game.mjs itself.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/verify/*.test.mjs"],
    // Keep vitest's defaults (node_modules, dist, …) AND skip any git
    // worktrees checked out under the repo. Stray worktrees carry their own
    // (often broken) node_modules and test files; sweeping them produces
    // spurious failures unrelated to the source tree.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/.worktrees/**"],
  },
}));
