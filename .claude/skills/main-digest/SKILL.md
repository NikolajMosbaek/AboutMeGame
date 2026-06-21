---
name: main-digest
description: Roll up what changed on main over a period — merged PRs, dependency changes, doc drift — the forest-level second pass for staying current with the codebase
args:
  since:
    description: Start of the window — a date, "N days ago", or a SHA (defaults to the last digest's recorded HEAD, else 7 days ago)
    required: false
user-invocable: true
---

Summarize what landed on main since {{since | default: "the last digest"}}. Read-only except for the digest file in step 6.

# 1. Anchor the window

```bash
git fetch origin main
ls .claude/review-log/main-digest-*.md 2>/dev/null | sort | tail -1
```

If `{{since}}` was given, use it (`--since="<date>"` or `<sha>..origin/main`). Otherwise read the `HEAD:` line from the newest digest file and use `<that-sha>..origin/main`. If neither exists, default to `--since="7 days ago"`.

# 2. List the merges

```bash
git log origin/main --first-parent --pretty='%h|%ad|%s' --date=short <window>
```

GitHub squash merges appear as `<title> (#<number>)`; merge-commit merges as `Merge pull request #<number> …`. If the list is empty, report `main unchanged since <anchor>.` and stop.

# 3. Summarize each PR

For each merge commit: `git show --stat <sha>` → classify the touched areas and flag high-risk paths (anything crossing a wire/storage boundary, build manifests, CI config, generated code).

If more than 3 PRs merged, fan out one `Explore` agent per merge commit **in a single message**, each returning: what changed (2 lines), why (from the merge-commit body / linked PR), and which risk flags apply. Otherwise read the diffs inline. Use `gh pr view <number>` to pull a PR's description when the commit body is thin.

# 4. Cross-cutting checks

Deterministic, cheap — run all of them:

- **Docs**: `git diff --stat <window> -- docs/ README.md`. Any PR that changed behavior in a documented area with **no** corresponding docs change in the window goes on the drift-watch list.
- **Dependencies**: diff the project's dependency manifests/lockfiles over the window — added/removed/bumped packages.
- **Test balance**: count test files vs production files touched in the window; call out PRs that shipped production behavior with no test delta.

# 5. Output the digest

```
## Main digest — <anchor> → <today>
<N> PRs merged · areas touched: <list>

### Merged
- #<number> — <title> — <what/why, one line> [risk flags, or —]

### Invariants & boundaries
<schema, storage, API-contract changes — or "none">

### Dependencies
<manifest changes — or "none">

### Drift watch
<documented areas changed without doc updates; anything quietly diverging>

### Suggested deep-dives
<the 1–3 PRs worth a /walkthrough, with one line on why each>
```

Terse, imperative, "X so Y". The digest is for re-orienting, not auditing — severity language stays out; pointers go in.

# 6. Persist the anchor

Write the digest verbatim to `.claude/review-log/main-digest-<YYYY-MM-DD>.md` (`mkdir -p .claude/review-log`; the directory is gitignored), ending with:

```
HEAD: <full sha of origin/main at digest time>
```

That line is the next run's anchor, so consecutive digests tile the history with no gaps and no overlaps.
