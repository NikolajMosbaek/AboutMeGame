# Commit Messages — Conventional Commits

Commit subjects use [Conventional Commits](https://www.conventionalcommits.org/).

Format: `type(scope): summary (#issue)`

- **`type`** — lowercase, from the set below.
- **`scope`** — optional, lowercase kebab-case; the package or feature touched
  (`auth`, `ui`, `api`, `build`, `skills`, …).
- **`summary`** — imperative, lowercase, no trailing period.
- **`(#issue)`** — optional trailing reference to the GitHub issue: `(#123)`.

Types in use:

| Type | Use for |
|------|---------|
| `feat` | New behaviour or capability |
| `fix` | Bug fix |
| `refactor` | Restructuring without behaviour change |
| `docs` | Documentation, comments, design specs |
| `test` | Adding or changing tests only |
| `chore` | Build glue, deps, housekeeping |
| `style` | Formatting / lint-only changes (no logic) |
| `ci` | Pipeline / CI configuration |
| `build` | Build-system or packaging changes |
| `perf` | Performance improvement |

Examples:

```
feat(ui): add player avatar picker (#42)
fix: guard against empty question set on round start (#58)
refactor: extract scoring into its own module
test(api): cover the lobby-join endpoint
chore: bump dependencies
```

## PR titles

Keep PR titles human-readable and imperative — they become the squash-merge commit subject.
No special product prefix is required. If the PR closes an issue, put `Closes #<n>` in the
body (not the title) so GitHub auto-links it.

If a branch has accumulated messy commits, tidy them with `/squash-commits` before opening the PR.
