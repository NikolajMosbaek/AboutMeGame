---
name: squash-commits
description: Squash commits on the current branch into logical groups
args:
  target:
    description: Base branch to compare against
    required: false
user-invocable: true
---


Squash commits on the current branch into logical groups compared to {{target | default: "main"}}.

---


## Workflow

### Step 1: Gather commits

```bash
git log --oneline {{target | default: "main"}}...HEAD
```

### Step 2: Analyze and group

Read each commit's full message and diff to understand what it does:

```bash
git log --format="%H %s" {{target | default: "main"}}...HEAD
```

For each commit, read its diff:

```bash
git diff <commit>^..<commit>
```

Group commits that are logically related:
- A feature implementation and its follow-up fixes belong together
- Test additions for the same feature belong with that feature
- Independent concerns (e.g. a bug fix vs. a new feature vs. a refactor) stay separate
- Review feedback fixes should fold into the commit they fix

### Step 3: Present groups for approval

Present the proposed squash plan clearly:

```
## Proposed squash plan

### Group 1: <descriptive title>
Proposed message: "<commit message>"

Commits:
- abc1234 <original message>
- def5678 <original message>
- ghi9012 <original message>

### Group 2: <descriptive title>
Proposed message: "<commit message>"

Commits:
- jkl3456 <original message>

(kept as-is — single commit, already clean)
```

**Wait for user approval before proceeding.** The user may want to adjust groupings or messages.

### Step 4: Execute the squash

After approval, perform an interactive rebase. Since `-i` is not supported, use this approach:

1. Note the current HEAD: `git rev-parse HEAD`
2. Reset to the base: `git reset --soft {{target | default: "main"}}`
3. For each group (in chronological order):
   a. Identify which files belong to this group from the original commits
   b. Unstage everything: `git reset HEAD .`
   c. Stage only the files for this group: `git add <specific-files>`
   d. Commit with the approved message
   e. Repeat for remaining groups
4. Verify: `git log --oneline {{target | default: "main"}}...HEAD`
5. Verify no changes were lost: `git diff HEAD <original-HEAD>` should be empty

If the approach above is too complex due to overlapping files across groups, use this simpler alternative:

1. Save the final state: `git rev-parse HEAD` as ORIGINAL_HEAD
2. `git reset --soft {{target | default: "main"}}`
3. Create a single commit per group by selectively staging
4. If files overlap between groups, use `git diff <first-commit-of-group>^..<last-commit-of-group> -- <file>` to reconstruct per-group changes, then apply with `git apply`
5. Verify: `git diff HEAD <ORIGINAL_HEAD>` must be empty

### Step 5: Confirm

Show the final commit log and confirm no code was lost:

```bash
git log --oneline {{target | default: "main"}}...HEAD
git diff HEAD <ORIGINAL_HEAD>
```

---


## Guidelines

- Never push to origin
- Never lose code — always verify `git diff` between old and new HEAD is empty
- Preserve Co-Authored-By trailers in squashed messages
- If a group has only one commit and its message is already good, keep it as-is
- Commit messages should focus on the "why", not enumerate every file changed
- If something goes wrong, `git reset --hard <ORIGINAL_HEAD>` to restore
