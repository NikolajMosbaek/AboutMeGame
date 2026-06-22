// Minimal ambient typing for the single node API the pre-ship verification
// gate (src/ship.test.ts) needs. Declaring it here — in a global declaration
// file with no imports/exports — lets tsc resolve `node:child_process` without
// pulling in @types/node, keeping the slice free of extra dependencies under
// the project's restricted tsconfig `types` list.
declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: { encoding: "utf8" },
  ): string;
}
