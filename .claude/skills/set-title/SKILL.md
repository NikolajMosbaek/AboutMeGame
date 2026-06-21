---
name: set-title
description: Set the Terminal window title based on the current branch
user-invocable: true
---


Extract a short title from the current git branch name and set the Terminal window title.

1. Run `git branch --show-current` to get the branch name
2. Extract a short identifier:
   - If the branch contains a ticket number (e.g., `feature/541883-...`), use the number plus a 2-3 word summary from the branch name (e.g., `541883 awaiting-reference`)
   - If no ticket number, use the last path segment shortened to ~30 chars
3. Set the Terminal title by running:
   ```bash
   echo -ne "\033]0;<title>\007"
   ```
4. Confirm what the title was set to
