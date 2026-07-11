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
        // specifier) is required so three's own add-on modules
        // (`three/examples/jsm/...`, used by `assets.ts`'s GLTFLoader and the
        // `mergeGeometries` prop-batching callers) resolve to distinct ids but
        // still fold into the same vendor chunk instead of leaking into the
        // entry chunk.
        //
        // `postprocessing` (and `n8ao`, visual-overhaul slice 2's ambient
        // occlusion) get their own SEPARATE bucket, never `three`'s: both are
        // only reached through `GameCanvas`'s dynamic `import()` of
        // `createCompositor.ts` (the bloom-tier gate), and folding either into
        // the eagerly-loaded `three` chunk would silently re-eager-load them
        // for the LOW tier — which must not pay their bytes for an effect
        // chain it never builds (docs/perf-budget.md). The bucket also keeps
        // the lazy boundary safe against future accidental static imports: a
        // stray eager import would drag `postfx` into the initial preload
        // graph, but never invisibly merge the bytes into `three`.
        manualChunks(id) {
          // `GLTFLoader` (visual-overhaul slice 6, flora & fauna) is reached
          // ONLY through the lazy `floraUpgrade.ts` chunk (`src/engine/assets.ts`
          // itself now imports it dynamically too, for exactly this reason —
          // see that file's own doc). Forcing it into the blanket `three/`
          // match below would pin its ~24 KB gz into the ALWAYS-eager `three`
          // bucket regardless of that laziness, since `manualChunks` assigns by
          // module id, not by static/dynamic reachability — measured directly
          // (`npm run build`: the `three` chunk jumped 134.04 → 157.9 KB gz
          // before this exclusion). Falling through to `undefined` here lets
          // Rollup's default splitting chunk it with its real (today, lazy-
          // only) importer instead.
          if (/node_modules\/three\/examples\/jsm\/loaders\/GLTFLoader\.js/.test(id)) return undefined;
          if (/node_modules\/three\//.test(id)) return "three";
          if (/node_modules\/(postprocessing|n8ao)\//.test(id)) return "postfx";
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
