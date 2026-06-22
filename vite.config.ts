/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    // Keep vitest's defaults (node_modules, dist, …) AND skip any git
    // worktrees checked out under the repo. Stray worktrees carry their own
    // (often broken) node_modules and test files; sweeping them produces
    // spurious failures unrelated to the source tree.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/.worktrees/**"],
  },
});
