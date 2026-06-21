---
name: fix-issues-auto-accept
description: Fix a list of issues one at a time, automatically committing each without waiting for user review
args:
  issues:
    description: Comma-separated list of issues or a multi-line description
    required: true
user-invocable: true
---


Fix the following issues one at a time, automatically committing each:

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

### Step 3: Implement the Fix
- Make the necessary code changes
- Keep changes minimal and focused on the specific issue
- Follow existing code patterns and style

### Step 4: Commit
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

---


## Progress Tracking

Maintain a running status:

```
## Progress: X/Y issues completed

✅ Issue 1: <description> - Committed (abc1234)
⏭️ Issue 2: <description> - Skipped (reason)
✅ Issue 3: <description> - Committed (def5678), modified approach
🔄 Issue 4: <description> - In progress
⬜ Issue 5: <description> - Pending
```

---


## Completion

When all issues are processed, provide a final summary:

```
## Session Complete

**Fixed:** X issues
**Skipped:** Y issues (with reasons)
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
- If an issue is unclear, make your best judgement and note your assumption in the commit
- Never push to origin
- If you discover related issues during a fix, note them but don't fix them unless they're in the list
