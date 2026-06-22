// Flat ESLint config — a lenient but real lint for the TS/React source. Catches
// genuine mistakes (unused vars, bad hooks deps, fallthroughs) without fighting
// the codebase's deliberate choices. Run as a PR gate in CI (ci.yml) alongside
// build + test, and locally via `npm run lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    // Build/lint config files use idiomatic patterns (triple-slash refs) that
    // aren't app source; scripts are Node tooling. Lint the app under src/.
    ignores: [
      "dist/**",
      "node_modules/**",
      ".claude/**",
      "scripts/**",
      "coverage/**",
      "*.config.{js,ts}",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The codebase uses a handful of deliberate, localised `any` casts at
      // boundaries (stub renderers in tests, THREE interop) — keep them as a
      // warning, not an error.
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused args prefixed with _ (e.g. `_ctx` in System.update).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Tests use globals (describe/it/expect via vitest) and looser typing.
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
