---
name: create-pr
description: Create a GitHub pull request from the current branch
args:
  target:
    description: Target branch (defaults to main)
    required: false
  title:
    description: PR title (auto-generated if not provided)
    required: false
  draft:
    description: Create as draft PR (true/false, defaults to false)
    required: false
user-invocable: true
---


Create a pull request from the current branch to {{target | default: "main"}} using the `gh` CLI.

Instructions:

1. Get the current branch name:
   ```bash
   git branch --show-current
   ```

2. Check if the branch has been pushed to origin:
   ```bash
   git log @{upstream}..HEAD --oneline
   ```
   This compares against the branch's own tracking remote (not the target branch).
   If the command fails (no upstream set), the branch has not been pushed at all.
   Push it (a normal push only — never `--force`): `git push -u origin <branch>`.
   If there are unpushed commits on an existing upstream, push them with a normal `git push`.

3. Check if a PR already exists for this branch:
   ```bash
   gh pr list --head <branch> --state open --json number,url,title
   ```
   If one exists, show the URL and ask whether to update it instead of creating a new PR.

4. Generate the PR title if not provided:
   - If `{{title}}` is provided, use it.
   - Otherwise derive it from the branch name (replace hyphens with spaces, capitalize) and the commit history.

5. Generate the PR description by analyzing commits:
   ```bash
   git log origin/{{target | default: "main"}}..HEAD --pretty=format:"- %s"
   ```
   Create a Summary section with bullet points of the changes. If the branch name or a
   commit references an issue (e.g. `#123`), add a `Closes #123` line so GitHub auto-links it.

6. Generate the Walkthrough section — explain the change to a reviewer who hasn't seen the branch. Read the actual diff, not just commit subjects:
   ```bash
   git diff origin/{{target | default: "main"}}...HEAD --stat
   git diff origin/{{target | default: "main"}}...HEAD -- <the few files that carry the behavior change>
   ```

   Build these subsections under a `## Walkthrough` heading (omit any that genuinely don't apply — never pad):

   - **Change map** — a Mermaid diagram of the touched components and how data/control flows between them after the change. GitHub renders Mermaid in PR descriptions inside a ` ```mermaid ` fenced block. Use `graph LR` / `graph TD`. Mark what changed: suffix node labels with `(new)` / `(changed)` / `(removed)`. Keep it ≤15 nodes — the diagram shows the shape of the change, not the whole system.
   - **Reading order** — numbered list of files in the order a reviewer should read them for fastest understanding (contracts/schemas first, then implementation, then tests), one line each on what to look for. Not alphabetical, not diff order.
   - **Key decisions** — the 2–4 decisions that shaped the diff, each as "chose X over Y because Z".
   - **⚠️ Hot spots** — what the reviewer must read closely, risk-ranked: anything crossing a wire/storage boundary, concurrency changes, behavior changes hidden in small diffs, migrations. Each entry: `file:line` + one line on what could go wrong. Write "None — mechanical change" only when that is actually true.
   - **Safe to skim** — the mechanical parts (renames, generated code, moved files) so the reviewer doesn't spend attention there.

   Voice: terse, imperative, "X so Y". **Bold** the load-bearing facts; never bury a behavior change in prose.

7. Show the generated title and description, then immediately create the PR (do not wait for confirmation). Write the body to a temp file to preserve newlines, then:
   ```bash
   gh pr create --base {{target | default: "main"}} --head <branch> \
     --title "<title>" --body-file <tmpfile> {{draft | default: "" }}
   ```
   (Pass `--draft` when `{{draft}}` is `true`.)

8. Print the PR URL `gh` returns, and open it:
   ```bash
   gh pr view --web
   ```

Important:
- Never `--force`/`-f` push (it rewrites published history). A normal `git push` is fine.
- Always show the generated title and description.
- Do NOT ask for confirmation — create the PR immediately after showing the summary.
- The Walkthrough explains the diff to a human — it is not a changelog. If you haven't read the diff, you can't write it.
