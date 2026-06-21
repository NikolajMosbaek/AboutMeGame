---
name: fix-issues
description: Fix a list of issues one at a time with user review between each
args:
  issues:
    description: Comma-separated list of issues or a multi-line description
    required: true
user-invocable: true
---


Fix the following issues one at a time, with user review and commit after each:

{{issues}}

---


## Workflow

For each issue in the list above, follow this cycle:

### Step 1: Announce Current Issue
Clearly state which issue you're working on:
```
## Issue X of Y: <issue description>
```

### Step 2: Analyze & Validate
Before implementing anything, critically evaluate whether this issue should actually be fixed:

- **Is it a real problem?** Does it fix a bug, prevent a crash, or address a genuine maintainability concern?
- **Does it match existing patterns?** Check the codebase — don't invent conventions that aren't already established.
- **Is it in scope?** A fix should address the stated issue, not adjacent code or hypothetical future problems.
- **Is the proposed fix a real fix?** Adding a comment or docstring is not a fix. If the issue calls for a guard, add a guard. If it calls for error handling, add error handling.
- **Is it pedantic?** Removing an unused import that was added alongside related code, or renaming for marginal clarity, may not be worth the churn.

Based on this evaluation, classify the issue:

- **Fix** — Proceed to Step 3
- **Skip** — Explain why this issue should not be fixed and move to the next issue
- **Modify** — The issue is valid but the proposed fix is wrong or insufficient. Describe the better approach, then proceed to Step 3 with the modified fix

If the issue is ambiguous, ask for clarification BEFORE making changes.

### Step 3: Implement the Fix
- Make the necessary code changes
- Keep changes minimal and focused on the specific issue
- Follow existing code patterns and style

### Step 4: Show Changes
After implementing, show a summary:
- List files modified
- Briefly describe what was changed
- Show the diff if helpful:
  ```bash
  git diff
  ```

### Step 5: Request Review
Ask the user to review with clear options:

```
### Ready for Review

**Issue:** <issue description>
**Files changed:** <list>
**Summary:** <what was done>

Please review the changes. Options:
1. **Accept** - Commit and move to next issue
2. **Revise** - Tell me what to change
3. **Skip** - Discard changes and move to next issue
4. **Stop** - Discard changes and end session
```

### Step 6: Handle Response

**If Accepted:**
1. Stage the changed files (specific files, not `git add -A`):
   ```bash
   git add <specific-files>
   ```

2. Create a commit with a descriptive message:
   ```bash
   git commit -m "$(cat <<'EOF'
   <Concise description of the fix>

   - <Detail 1>
   - <Detail 2 if needed>

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

3. Confirm commit was successful
4. Move to the next issue

**If Revise:**
1. Understand the requested changes
2. Make revisions
3. Return to Step 4 (Show Changes)

**If Skip:**
1. Discard changes:
   ```bash
   git checkout -- <changed-files>
   ```
2. Move to the next issue

**If Stop:**
1. Discard changes:
   ```bash
   git checkout -- <changed-files>
   ```
2. End the session with a summary of completed issues

---


## Progress Tracking

Maintain a running status:

```
## Progress: X/Y issues completed

✅ Issue 1: <description> - Committed (abc1234)
✅ Issue 2: <description> - Committed (def5678)
⏭️ Issue 3: <description> - Skipped
🔄 Issue 4: <description> - In progress
⬜ Issue 5: <description> - Pending
```

---


## Completion

When all issues are processed, provide a final summary:

```
## Session Complete

**Completed:** X issues
**Skipped:** Y issues
**Commits created:** Z

Commits:
- abc1234: <message>
- def5678: <message>
```

---


## Guidelines

- Keep each fix atomic and focused
- Don't bundle unrelated changes
- If a fix requires changes that affect other issues, note the dependency
- If an issue is unclear, ask before implementing
- Never push to origin
- If you discover related issues during a fix, note them but don't fix them unless they're in the list
