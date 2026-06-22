import backlog from "../docs/team/backlog.md?raw";

// Doc-as-contract test: the backlog is the record of deferred game work for
// the next /team run. The bootstrap must be marked done, and the deferred
// items must appear as explicit *unchecked* entries so a later run has a
// prioritized target and does not assume the work already exists.
// The backlog is imported as a raw string (Vite ?raw) so the test reads the
// real committed file without a Node-fs dependency.

/** True if the backlog contains a checked item ("- [x]") matching the pattern. */
const checkedItem = (pattern: RegExp): boolean =>
  backlog
    .split("\n")
    .some((line: string) => /^\s*-\s*\[x\]/i.test(line) && pattern.test(line));

/** True if the backlog contains an unchecked item ("- [ ]") matching the pattern. */
const uncheckedItem = (pattern: RegExp): boolean =>
  backlog
    .split("\n")
    .some((line: string) => /^\s*-\s*\[ \]/.test(line) && pattern.test(line));

describe("docs/team/backlog.md", () => {
  it("marks the bootstrap item as done", () => {
    expect(checkedItem(/bootstrap/i)).toBe(true);
  });

  it.each([
    ["first local vertical slice (prompt -> answer -> reveal)", /vertical slice|prompt|reveal/i],
    ["lobby / join", /lobby|join/i],
    ["guessing", /guess/i],
    ["scoring", /scor/i],
    ["persistence", /persist/i],
    ["networking / server / websocket", /network|websocket|server/i],
    ["eslint config", /eslint|lint/i],
    ["CI", /\bCI\b|pipeline|continuous integration/i],
    ["npm audit fixes", /audit|vulnerab/i],
  ])("lists %s as an explicit unchecked item", (_label, pattern) => {
    expect(uncheckedItem(pattern)).toBe(true);
  });
});
