---
name: worktree
description: Create a git worktree in .worktrees/ for a branch, ensuring the directory exists and .gitignore covers it
user-invocable: true
arguments:
  - name: branch_name
    description: "Branch name to create the worktree for (e.g., bugfix/543346-progress-bar-ui-issue)"
---

# Create Worktree

Create a git worktree under `.worktrees/` with the same name as the branch.

## Steps

1. **Create `.worktrees/` if it doesn't exist:**
   ```bash
   mkdir -p .worktrees
   ```

2. **Create the worktree with a new branch:**
   ```bash
   git worktree add .worktrees/<branch_name> -b <branch_name>
   ```

   If the branch already exists (e.g., from a remote):
   ```bash
   git worktree add .worktrees/<branch_name> <branch_name>
   ```

3. **Confirm creation** by printing the worktree path and current branch.

4. **`cd` into the worktree** and use it as the working directory for ALL subsequent commands. Never read, edit, or write files in the main worktree — every file path must go through the new worktree.
