import charter from "../docs/team/charter.md?raw";
import claudeMd from "../.claude/CLAUDE.md?raw";

// Doc-as-contract test (T8): the charter is the grounding document every later
// /team run reads. It must be fully filled — no TBD placeholders — and must
// state the product vision and the chosen stack with a justification. The four
// documented commands (install, build, test, run) must appear in BOTH the
// charter and .claude/CLAUDE.md so the two records cannot drift. Both files are
// imported as raw strings (Vite ?raw) so the test reads the real committed
// files without a Node-fs dependency.

// The four documented commands. Install accepts `npm install` or the
// clean-checkout `npm ci`; the rest are exact.
const COMMAND_CONTRACTS: ReadonlyArray<readonly [string, RegExp]> = [
  ["install (npm install / npm ci)", /npm (install|ci)\b/],
  ["build (npm run build)", /npm run build\b/],
  ["test (npm test)", /npm test\b/],
  ["run (npm run dev)", /npm run dev\b/],
];

describe("docs/team/charter.md", () => {
  it("contains no TBD placeholders (grep -c TBD returns 0)", () => {
    const tbdCount = (charter.match(/TBD/g) ?? []).length;
    expect(tbdCount).toBe(0);
  });

  it("states the product vision under a Product vision heading", () => {
    expect(charter).toMatch(/##\s*Product vision/i);
  });

  it("names the chosen stack: TypeScript, React 18, Vite 5, Vitest, Node 20+", () => {
    expect(charter).toMatch(/##\s*Chosen stack/i);
    expect(charter).toMatch(/TypeScript/i);
    expect(charter).toMatch(/React 18/);
    expect(charter).toMatch(/Vite 5/);
    expect(charter).toMatch(/Vitest/i);
    expect(charter).toMatch(/React Testing Library/i);
    expect(charter).toMatch(/Node 20\+/);
  });

  it("gives a one-line justification for the stack", () => {
    expect(charter).toMatch(/rationale|justification|because|so the/i);
  });

  it.each(COMMAND_CONTRACTS)(
    "records the %s command",
    (_label, pattern) => {
      expect(charter).toMatch(pattern);
    },
  );
});

describe(".claude/CLAUDE.md", () => {
  it.each(COMMAND_CONTRACTS)(
    "records the %s command",
    (_label, pattern) => {
      expect(claudeMd).toMatch(pattern);
    },
  );
});
