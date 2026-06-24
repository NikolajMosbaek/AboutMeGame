# Security Policy

## Scope

AboutMeGame is a static, client-only React + Three.js single-page app served from
GitHub Pages under `/AboutMeGame/`. Everything runs in the visitor's browser:

- There is no backend and no server — nothing executes on our side at request time.
- There is no authentication and no accounts.
- No personal data (no PII) is collected, stored, or transmitted; there is no
  microphone or audio input captured. All audio is generated procedurally in the
  browser.

Because the app has no server-side surface, the realistic security concerns are
the shipped JavaScript bundle and the dependency supply chain, not data handling.

## Reporting a vulnerability

Please report security issues privately through GitHub's
private vulnerability reporting (Security Advisories) on this repository,
under the **Security** tab.

This is the only intended disclosure path. It needs no email inbox and gives you
a tracked, acknowledged report.

Do not open a public issue or pull request for a security problem, and do not
disclose it elsewhere until a fix has shipped.

## Supply-chain posture

Dependencies are kept current by Dependabot (`.github/dependabot.yml`), and an
npm-audit gate in CI blocks pull requests on advisories in the shipped
dependencies.

The exact threshold, what blocks, and what is knowingly out of scope are
single-sourced in `docs/perf-budget.md` — see that document rather than relying
on any value restated here.
