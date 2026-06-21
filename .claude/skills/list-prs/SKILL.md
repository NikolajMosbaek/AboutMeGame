---
name: list-prs
description: List pull requests from GitHub
args:
  status:
    description: PR state filter (open, closed, merged, all)
    required: false
user-invocable: true
---


List pull requests for this repository using the `gh` CLI.

State: {{status | default: "open"}}

Instructions:

1. List PRs:
   ```bash
   gh pr list --state {{status | default: "open"}} \
     --json number,title,author,createdAt,state,reviewDecision,url \
     --limit 50
   ```

2. Format the output as a clean, readable table with:
   - PR number
   - Title
   - Author
   - Created date
   - State
   - Review decision (approved / changes requested / review required)
   - URL

3. If `gh` reports it isn't authenticated, tell the user to run `! gh auth login` in the prompt.
