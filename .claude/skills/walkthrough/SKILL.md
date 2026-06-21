---
name: walkthrough
description: Generate a guided walkthrough of any PR, merge commit, or branch — change map, reading order, key decisions, risk-ranked hot spots — so understanding a change doesn't require cold-reading the diff. Works on colleagues' PRs and already-merged code.
args:
  target:
    description: GitHub PR URL, bare PR number, merge-commit SHA on main, or branch name
    required: true
user-invocable: true
---

Produce a walkthrough of {{target}} for a reader who wants to *understand* the change, not review it. This skill is read-only — never post to the PR, never edit files.

# 1. Resolve the target to a diff range

Run `git fetch origin` first, then classify {{target}}:

- **GitHub PR URL or bare PR number** — look it up with `gh pr view <number> --json number,title,author,state,baseRefName,headRefName,mergeCommit,body,url`. Branch on `state`:
  - `OPEN`: range is `origin/<baseRefName>...origin/<headRefName>`. (Do NOT use a test-merge commit on an open PR.)
  - `MERGED`: the merge commit is `mergeCommit.oid` — for a squash merge the range is `<mergeCommit>^..<mergeCommit>`; for a merge commit use `<mergeCommit>^1..<mergeCommit>`.
  - `CLOSED` (unmerged): say so and ask whether to proceed against the (possibly deleted) refs.
  Fetch the PR diff directly with `gh pr diff <number>` when the refs aren't local.
- **Commit SHA** — verify with `git cat-file -t <sha>` and that it sits on main (`git merge-base --is-ancestor <sha> origin/main`); range is `<sha>^!`. If it is not on main, warn but continue.
- **Branch name** — range is `origin/main...<branch>`.

For PRs, also capture title, author, linked issues, and description from the `gh pr view` output to explain *why* the change was made.

# 2. Read the change

```bash
git log --oneline <range>
git diff --stat <range>
git diff <range> -- <the files that carry the behavior change>
```

Read the hunks, not just the stat. For very large diffs (>50 files), fan out one `Explore` agent per top-level area in a single message to summarize each, then synthesize.

# 3. Compose the walkthrough

Output in chat:

```
## Walkthrough — <PR number + title, or short SHA + subject>
<author> · <merge/creation date> · <linked issues> · <N> files, +X/−Y

<one paragraph: what this change is and why it exists>

**Change map**
<ASCII diagram in a fenced code block — touched components and the direction of
data/control flow after the change, changed parts marked (new)/(changed)/(removed).
Chat does not render Mermaid; ASCII only here.>

**Reading order**
1. `path` — what to look for          (contracts/schemas first, then implementation, then tests)
...

**Key decisions**
- chose X over Y because Z            (ground each in the diff, commit messages, PR description,
                                       or linked issues; mark unverifiable rationale `inferred`,
                                       and write "unknown — ask the author" rather than inventing)

**⚠️ Hot spots**
- `file:line` — what could go wrong   (wire/storage boundaries, concurrency, behavior changes
                                       hiding in small diffs, migrations — risk-ranked)

**Safe to skim**
- <the mechanical parts: renames, generated code, moved files>
```

Voice: terse but explanatory — this is a tour, not a review. **Bold** the load-bearing facts. If the diff contradicts its own PR description or commit messages, say so explicitly; that mismatch is the single most important thing a reader can learn from a walkthrough.

# 4. Offer the shareable version

End with one line: on request, the walkthrough can be posted to the PR as a single comment (`gh pr comment <number> --body-file <file>`), converting the change map to a ` ```mermaid ` `graph` block (GitHub renders it). Only do this when the user asks.
