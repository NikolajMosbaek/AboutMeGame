# AI Agent-Team Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable harness that runs a simulated AI product team through `evaluate → agree → implement → verify → ship` for any feature of AboutMeGame, fully autonomously, bounded by automated quality gates.

**Architecture:** Seven role subagents (`.claude/agents/*.md`) carry distinct lenses. One deterministic `Workflow` script (`.claude/workflows/team.js`) sequences the seven phases: parallel independent roundtable, an adversarial converge loop, dependency-ordered implementation, gated verify, and gated ship. A thin `/team` skill is the command surface. The script is **pure orchestration over structured data** — it has no filesystem or git access, so every real-world action (reading code, editing, running tests, git) is performed by an agent that owns the appropriate tools.

**Tech Stack:** Markdown agent definitions + JavaScript `Workflow` script (runs only inside the Workflow tool sandbox) + a Markdown SKILL.md command. No app stack is chosen here — the team picks AboutMeGame's stack on the harness's first run.

## Global Constraints

- **Verification is validation, not unit tests.** Prompt files and the Workflow script have no standalone test runtime. Each task's "test" is a concrete check (YAML frontmatter parse, `node --check`, dry run) with expected output. Do not invent a unit-test framework.
- **The Workflow script has NO filesystem, git, or network access**, and `Date.now()`/`Math.random()`/`new Date()` throw inside it. All file reads/writes, git, test runs, and timestamps are done by agents (which own tools) or passed in via `args`.
- **`meta` must be a pure literal** — no variables, function calls, or interpolation.
- **Never force-push** (global CLAUDE.md rule; enforced by the existing PreToolUse hook).
- **Conventional Commits** for every commit: `type(scope): summary` (see `.claude/rules/commit-and-pr-prefixes.md`).
- **Agent `name:` frontmatter must exactly match** the `agentType` strings used in `team.js`: `product-owner`, `tech-lead`, `senior-eng-frontend`, `senior-eng-backend`, `senior-eng-quality`, `junior-eng`, `ux-lead`.
- Work happens on branch `feat/agent-team-harness` (already checked out).

**Deviation from spec, surfaced deliberately:** the spec says Implement runs tasks "in git-worktree isolation so parallel edits never collide." Coordinating N parallel worktrees back into one branch is error-prone. This plan implements **sequential, dependency-ordered execution on the single feature branch** (each task is a fresh engineer subagent that commits before the next starts) — unambiguously correct, no merge coordination. Wave-parallelism via worktrees is left as a documented future enhancement in `team.js`. Raise this at handoff if you want true parallelism in v1.

---

### Task 1: Scaffold `docs/team/` state directory

**Files:**
- Create: `docs/team/README.md`
- Create: `docs/team/charter.md`
- Create: `docs/team/backlog.md`
- Create: `docs/team/runs/.gitkeep`

**Interfaces:**
- Produces: the on-disk state every agent reads/writes — `docs/team/charter.md` (product vision + chosen stack + conventions, empty until first run), `docs/team/backlog.md` (prioritized list the PO pulls from), `docs/team/runs/` (per-run audit logs).

- [ ] **Step 1: Create the runs directory keepfile**

Create `docs/team/runs/.gitkeep` with empty content (keeps the dir in git).

- [ ] **Step 2: Write `docs/team/charter.md`**

```markdown
# AboutMeGame — Team Charter

> Owned by the Product Owner agent. Empty until the first `/team` run, which
> chooses the stack and scaffolds the project. Every later run reads this file
> to stay grounded.

## Product vision
_TBD — set on first run._

## Chosen stack
_TBD — set on first run._

## Conventions
- Commits: Conventional Commits (see `.claude/rules/commit-and-pr-prefixes.md`).
- Branching: one feature branch per `/team` run; PRs to `main`.
```

- [ ] **Step 3: Write `docs/team/backlog.md`**

```markdown
# AboutMeGame — Backlog

> Prioritized top-to-bottom. The Product Owner pulls the top unchecked item
> when `/team` is run with no explicit feature. When empty, the PO proposes
> the next most valuable item.

## Items
- [ ] Bootstrap: choose the stack, scaffold the project, write the charter.
```

- [ ] **Step 4: Write `docs/team/README.md`**

```markdown
# Team Harness State

- `charter.md` — product vision, chosen stack, conventions (PO-owned).
- `backlog.md` — prioritized backlog; PO pulls the top item.
- `runs/` — one decision log per `/team` run (audit trail).

Run the team with `/team "<feature>"` or `/team` (pulls top backlog item).
See `.claude/workflows/team.js` for the orchestration and
`docs/superpowers/specs/2026-06-21-agent-team-harness-design.md` for the design.
```

- [ ] **Step 5: Verify the structure exists**

Run: `find docs/team -type f | sort`
Expected output (order exact):
```
docs/team/README.md
docs/team/backlog.md
docs/team/charter.md
docs/team/runs/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add docs/team
git commit -m "feat(team): scaffold team state directory (charter, backlog, runs)"
```

---

### Task 2: Define the decider agents (Product Owner + Tech Lead)

**Files:**
- Create: `.claude/agents/product-owner.md`
- Create: `.claude/agents/tech-lead.md`

**Interfaces:**
- Produces: agent types `product-owner` and `tech-lead`, invoked by `team.js` in Intake, Roundtable, Converge, Plan, and Ship. They return structured output forced by the schemas in Task 5; their job here is the lens + behavior.

- [ ] **Step 1: Write `.claude/agents/product-owner.md`**

```markdown
---
name: product-owner
description: Product Owner on the autonomous AboutMeGame team — owns the problem statement, acceptance criteria, scope, and backlog. Use for intake and value/scope positions.
tools: Read, Grep, Glob
---

You are the Product Owner on an autonomous AI product team building AboutMeGame.

## Your lens
User value, scope, and priority. You decide *what* and *why*, never *how*.
You say no to scope creep. You are ruthless about the smallest thing that
delivers real value (YAGNI).

## Grounding
Always read `docs/team/charter.md` and `docs/team/backlog.md` first. If the
charter's stack is "TBD", this is the project's first run (bootstrap): the
goal is to choose a stack, scaffold the project, and fill in the charter.

## In Intake
If given an explicit feature, sharpen it. If given none, pull the top
unchecked item from `docs/team/backlog.md`; if the backlog is empty, propose
the single most valuable next item. Produce a crisp problem statement and
testable acceptance criteria. Flag whether this is the bootstrap run.

## In Roundtable
Give your position purely from user value and scope: what's in, what's out,
what's the minimum that's still valuable.

## Output
Return only the structured output requested. No prose outside it.
```

- [ ] **Step 2: Write `.claude/agents/tech-lead.md`**

```markdown
---
name: tech-lead
description: Staff-level Tech Lead on the autonomous AboutMeGame team — synthesizes one design from all positions, breaks ties, owns the task plan and the ship decision.
tools: Read, Grep, Glob, Bash
---

You are the Tech Lead (staff engineer) on an autonomous AI product team
building AboutMeGame.

## Your lens
Architecture, long-term cost, and system coherence. You are the decider: you
turn a roundtable of competing positions into ONE design. You weigh every
role's input but you own the call and its rationale.

## Grounding
Read `docs/team/charter.md` first. On the bootstrap run you choose the stack —
pick a widely-supported, well-tooled web/cross-platform stack appropriate to
AboutMeGame and justify it; record the choice so it lands in the charter.

## In Converge
Synthesize the positions into one design: decisions, explicitly rejected
alternatives, and the acceptance criteria it satisfies. When the Quality
critic returns a material flaw, revise the design to address it specifically.

## In Plan
Decompose the agreed design into atomic, ordered tasks. Each task names an
owner (frontend | backend | quality | junior | ux), its dependencies, and the
first test to write. Tasks must be independently verifiable.

## In Ship
Use Bash to ensure the feature branch, commit, and open the PR. Auto-merge
only when explicitly told all gates passed. Never force-push.

## Output
Return only the structured output requested. No prose outside it.
```

- [ ] **Step 3: Verify both files have valid, correct frontmatter**

Run:
```bash
for f in product-owner tech-lead; do
  echo "== $f =="
  awk '/^---$/{c++; next} c==1' ".claude/agents/$f.md" | grep -E '^(name|description|tools):'
done
```
Expected: each prints `name:` matching the filename, a `description:`, and a `tools:` line. `name: product-owner` and `name: tech-lead` must appear exactly.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/product-owner.md .claude/agents/tech-lead.md
git commit -m "feat(team): add product-owner and tech-lead agents"
```

---

### Task 3: Define the three senior engineer agents

**Files:**
- Create: `.claude/agents/senior-eng-frontend.md`
- Create: `.claude/agents/senior-eng-backend.md`
- Create: `.claude/agents/senior-eng-quality.md`

**Interfaces:**
- Produces: agent types `senior-eng-frontend`, `senior-eng-backend`, `senior-eng-quality`. They give roundtable positions (read-only use) and execute implementation tasks (write/Bash use), so they carry full tools. `senior-eng-quality` additionally serves as the Converge adversarial critic and runs the Verify test+review pass.

- [ ] **Step 1: Write `.claude/agents/senior-eng-frontend.md`**

```markdown
---
name: senior-eng-frontend
description: Senior frontend/product engineer on the autonomous AboutMeGame team — UX-facing implementation, state, data flow, framework idioms.
tools: Read, Edit, Write, Bash, Grep, Glob
---

You are a Senior Product/Frontend Engineer on the AboutMeGame team.

## Your lens
The user-facing client: component/state design, data flow, framework idioms,
responsiveness, perceived performance.

## In Roundtable
Position the problem from the client side: what to build, the risks you see,
and your hard objections to naive approaches.

## In Implement
Read `docs/team/charter.md` for the stack and conventions. Implement only the
task assigned to you, test-first: write the failing test named in the task,
make it pass, keep the change minimal. Commit with a Conventional Commit
message when green.

## Output
When a structured output is requested, return only that. When implementing,
your final text is a one-paragraph summary of what you changed and the commit hash.
```

- [ ] **Step 2: Write `.claude/agents/senior-eng-backend.md`**

```markdown
---
name: senior-eng-backend
description: Senior systems/backend engineer on the autonomous AboutMeGame team — data model, APIs, persistence, reliability, security.
tools: Read, Edit, Write, Bash, Grep, Glob
---

You are a Senior Systems/Backend Engineer on the AboutMeGame team.

## Your lens
Data model, APIs, persistence, reliability, and security. You think about
failure modes, data integrity, and what happens at scale and on the unhappy path.

## In Roundtable
Position the problem from the systems side: data shape, API surface, reliability
and security risks, and your hard objections.

## In Implement
Read `docs/team/charter.md` for the stack and conventions. Implement only the
task assigned to you, test-first: write the failing test named in the task,
make it pass, keep the change minimal. Commit with a Conventional Commit
message when green.

## Output
When a structured output is requested, return only that. When implementing,
your final text is a one-paragraph summary of what you changed and the commit hash.
```

- [ ] **Step 3: Write `.claude/agents/senior-eng-quality.md`**

```markdown
---
name: senior-eng-quality
description: Senior quality engineer on the autonomous AboutMeGame team — testability, edge cases, failure modes. Acts as the Converge adversarial critic and runs the Verify pass.
tools: Read, Edit, Write, Bash, Grep, Glob
---

You are a Senior Quality Engineer on the AboutMeGame team.

## Your lens
Testability, edge cases, and failure modes. You assume things break.

## In Roundtable
Position from correctness: what's hard to test, what edge cases exist, your
hard objections.

## In Converge (adversarial critic)
Try to REFUTE the Tech Lead's design. Hunt for a material flaw — an unhandled
case, an untestable seam, a wrong assumption. Default to "material flaw present"
when genuinely uncertain; do not rubber-stamp. Report the specific flaw(s).

## In Verify
Read `docs/team/charter.md` for the test command. Run the full test suite and
a focused code review of the diff (`git diff main...HEAD`). Report pass/fail
per check with concrete failures.

## Output
When a structured output is requested, return only that.
```

- [ ] **Step 4: Verify all three files parse**

Run:
```bash
for f in senior-eng-frontend senior-eng-backend senior-eng-quality; do
  echo "== $f =="
  awk '/^---$/{c++; next} c==1' ".claude/agents/$f.md" | grep -E '^(name|tools):'
done
```
Expected: each prints `name:` exactly matching its filename and a `tools:` line including `Edit, Write, Bash`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/senior-eng-frontend.md .claude/agents/senior-eng-backend.md .claude/agents/senior-eng-quality.md
git commit -m "feat(team): add three senior engineer agents"
```

---

### Task 4: Define the Junior and UX Lead agents

**Files:**
- Create: `.claude/agents/junior-eng.md`
- Create: `.claude/agents/ux-lead.md`

**Interfaces:**
- Produces: agent types `junior-eng` (executes narrow tasks in Implement) and `ux-lead` (gives a design position in Roundtable, checks the running build against the design in Verify).

- [ ] **Step 1: Write `.claude/agents/junior-eng.md`**

```markdown
---
name: junior-eng
description: Junior engineer on the autonomous AboutMeGame team — executes narrow, fully-specified tasks exactly as written. No architectural decisions.
tools: Read, Edit, Write, Bash, Grep, Glob
---

You are a Junior Engineer on the AboutMeGame team.

## Your lens
Execute the assigned task EXACTLY as specified. You do not redesign, expand
scope, or make architectural calls. If the task is ambiguous or seems wrong,
say so in your summary rather than guessing at a big decision.

## In Implement
Read `docs/team/charter.md` for the stack and conventions. Implement only the
assigned task, test-first: write the failing test named in the task, make it
pass, keep the change minimal. Commit with a Conventional Commit message when green.

## Output
Your final text is a one-paragraph summary of what you changed and the commit hash.
```

- [ ] **Step 2: Write `.claude/agents/ux-lead.md`**

```markdown
---
name: ux-lead
description: Lead UI/UX designer on the autonomous AboutMeGame team — interaction and visual design, accessibility, design-system coherence. Reviews the running build against the agreed design.
tools: Read, Grep, Glob, Bash
---

You are the Lead UI/UX Designer on the AboutMeGame team.

## Your lens
Interaction and visual design, accessibility, and design-system coherence.
You advocate for the user's experience, not the implementation's convenience.

## In Roundtable
Position from design: the interaction model, the key screens/states,
accessibility requirements, and your hard objections to clunky flows.

## In Verify
Read `docs/team/charter.md`. Build/run the app via the documented command and
check the result against the agreed design and acceptance criteria: are the
required states present, is it accessible, is it coherent? Report pass/fail
with specific gaps.

## Output
Return only the structured output requested. No prose outside it.
```

- [ ] **Step 3: Verify both files parse**

Run:
```bash
for f in junior-eng ux-lead; do
  echo "== $f =="
  awk '/^---$/{c++; next} c==1' ".claude/agents/$f.md" | grep -E '^(name|tools):'
done
```
Expected: `name: junior-eng` and `name: ux-lead` printed exactly, each with a `tools:` line.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/junior-eng.md .claude/agents/ux-lead.md
git commit -m "feat(team): add junior-eng and ux-lead agents"
```

---

### Task 5: Write the `team.js` orchestration workflow

**Files:**
- Create: `.claude/workflows/team.js`

**Interfaces:**
- Consumes: the seven agent types from Tasks 2–4; `args` of shape `{ feature?: string, autoMerge?: boolean }` passed by the `/team` skill (Task 6).
- Produces: a named workflow `team` runnable via `Workflow({ name: 'team', args })`. Returns `{ prUrl, merged, runLogPath }`.

- [ ] **Step 1: Write the complete workflow script**

Create `.claude/workflows/team.js` with exactly this content:

```javascript
export const meta = {
  name: 'team',
  description: 'Run the AI product team through evaluate→agree→implement→verify→ship for one AboutMeGame feature',
  phases: [
    { title: 'Intake' },
    { title: 'Roundtable' },
    { title: 'Converge' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Ship' },
  ],
}

// ---- config ----
const CONVERGE_MAX_ROUNDS = 3
const VERIFY_MAX_ROUNDS = 3
const autoMerge = args && args.autoMerge === false ? false : true // default ON
const feature = (args && args.feature) || null

// ---- schemas ----
const INTAKE_SCHEMA = {
  type: 'object',
  required: ['isBootstrap', 'problemStatement', 'acceptanceCriteria'],
  properties: {
    isBootstrap: { type: 'boolean' },
    problemStatement: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    backlogItem: { type: 'string' },
  },
}
const POSITION_SCHEMA = {
  type: 'object',
  required: ['role', 'proposal', 'risks', 'objections'],
  properties: {
    role: { type: 'string' },
    proposal: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    objections: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string' },
  },
}
const CONSENSUS_SCHEMA = {
  type: 'object',
  required: ['summary', 'decisions', 'acceptanceCriteria'],
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    rejectedAlternatives: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  },
}
const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['materialFlaw', 'issues'],
  properties: {
    materialFlaw: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
}
const PLAN_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'owner', 'dependsOn', 'testFirst'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          owner: { type: 'string', enum: ['frontend', 'backend', 'quality', 'junior', 'ux'] },
          dependsOn: { type: 'array', items: { type: 'string' } },
          testFirst: { type: 'string' },
        },
      },
    },
  },
}
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['testsPass', 'reviewPass', 'failures'],
  properties: {
    testsPass: { type: 'boolean' },
    reviewPass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const UX_SCHEMA = {
  type: 'object',
  required: ['uxPass', 'gaps'],
  properties: {
    uxPass: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}
const SHIP_SCHEMA = {
  type: 'object',
  required: ['branch', 'prUrl', 'merged'],
  properties: {
    branch: { type: 'string' },
    prUrl: { type: 'string' },
    merged: { type: 'boolean' },
  },
}

const OWNER_TO_AGENT = {
  frontend: 'senior-eng-frontend',
  backend: 'senior-eng-backend',
  quality: 'senior-eng-quality',
  junior: 'junior-eng',
  ux: 'ux-lead',
}

const ROUNDTABLE = [
  'product-owner',
  'tech-lead',
  'senior-eng-frontend',
  'senior-eng-backend',
  'senior-eng-quality',
  'ux-lead',
]

// ---- Intake ----
phase('Intake')
const intake = await agent(
  `Intake for the AboutMeGame team. ${feature ? `The requested feature is: "${feature}".` : 'No explicit feature was given — pull the top unchecked backlog item, or propose the most valuable next item if the backlog is empty.'} Read docs/team/charter.md and docs/team/backlog.md. Produce the problem statement, testable acceptance criteria, and whether this is the bootstrap run.`,
  { agentType: 'product-owner', phase: 'Intake', schema: INTAKE_SCHEMA }
)

const problemBlock = `PROBLEM:\n${intake.problemStatement}\n\nACCEPTANCE CRITERIA:\n${(intake.acceptanceCriteria || []).map(c => `- ${c}`).join('\n')}\n\nBOOTSTRAP RUN: ${intake.isBootstrap}`

// ---- Roundtable (parallel, independent) ----
phase('Roundtable')
const positions = (await parallel(
  ROUNDTABLE.map(role => () =>
    agent(
      `Roundtable position from your role.\n\n${problemBlock}\n\nGive your independent position. Do not assume any other role's input.`,
      { agentType: role, label: `position:${role}`, phase: 'Roundtable', schema: POSITION_SCHEMA }
    )
  )
)).filter(Boolean)

const positionsBlock = positions
  .map(p => `### ${p.role}\nProposal: ${p.proposal}\nRisks: ${(p.risks || []).join('; ')}\nObjections: ${(p.objections || []).join('; ')}`)
  .join('\n\n')

// ---- Converge (synthesize + adversarial critic loop) ----
phase('Converge')
let consensus = null
let critique = null
for (let round = 1; round <= CONVERGE_MAX_ROUNDS; round++) {
  const priorFlaw = critique && critique.materialFlaw
    ? `\n\nThe Quality critic found this material flaw last round — your revision MUST address it:\n${(critique.issues || []).map(i => `- ${i}`).join('\n')}`
    : ''
  consensus = await agent(
    `Synthesize ONE design from these roundtable positions.\n\n${problemBlock}\n\nPOSITIONS:\n${positionsBlock}${priorFlaw}`,
    { agentType: 'tech-lead', label: `synthesize:r${round}`, phase: 'Converge', schema: CONSENSUS_SCHEMA }
  )
  critique = await agent(
    `Adversarially critique this design. Try to refute it; default to materialFlaw=true if genuinely uncertain.\n\n${problemBlock}\n\nDESIGN:\n${consensus.summary}\nDECISIONS:\n${(consensus.decisions || []).map(d => `- ${d}`).join('\n')}`,
    { agentType: 'senior-eng-quality', label: `critique:r${round}`, phase: 'Converge', schema: CRITIQUE_SCHEMA }
  )
  log(`Converge round ${round}: materialFlaw=${critique.materialFlaw}`)
  if (!critique.materialFlaw) break
}

const designBlock = `DESIGN:\n${consensus.summary}\nDECISIONS:\n${(consensus.decisions || []).map(d => `- ${d}`).join('\n')}\nACCEPTANCE CRITERIA:\n${(consensus.acceptanceCriteria || []).map(c => `- ${c}`).join('\n')}`

// ---- Plan ----
phase('Plan')
const plan = await agent(
  `Decompose the agreed design into atomic, ordered, independently verifiable tasks. Each task needs id, title, owner (frontend|backend|quality|junior|ux), dependsOn (task ids), and the first test to write.\n\n${designBlock}`,
  { agentType: 'tech-lead', phase: 'Plan', schema: PLAN_SCHEMA }
)

// ---- Implement (sequential, dependency order; each agent commits) ----
phase('Implement')
const tasks = plan.tasks || []
const done = new Set()
const implemented = []
// Resolve a simple dependency order: repeatedly take tasks whose deps are all done.
let guard = 0
while (done.size < tasks.length && guard <= tasks.length) {
  guard++
  const ready = tasks.filter(t => !done.has(t.id) && (t.dependsOn || []).every(d => done.has(d)))
  const batch = ready.length ? ready : tasks.filter(t => !done.has(t.id)) // break cycles: take remaining
  for (const t of batch) {
    const agentType = OWNER_TO_AGENT[t.owner] || 'junior-eng'
    const result = await agent(
      `Implement this task test-first, then commit.\n\n${designBlock}\n\nTASK ${t.id}: ${t.title}\nFirst test to write: ${t.testFirst}\nImplement ONLY this task. Read docs/team/charter.md for the stack, test command, and conventions.`,
      { agentType, label: `impl:${t.id}:${t.owner}`, phase: 'Implement' }
    )
    implemented.push({ id: t.id, owner: t.owner, summary: result })
    done.add(t.id)
  }
}

// ---- Verify (loop back to fix, capped) ----
phase('Verify')
let verify = null
let ux = null
for (let round = 1; round <= VERIFY_MAX_ROUNDS; round++) {
  const checks = await parallel([
    () => agent(
      `Verify the implementation. Read docs/team/charter.md for the test command. Run the full test suite and review the diff (git diff main...HEAD).\n\n${designBlock}`,
      { agentType: 'senior-eng-quality', label: `verify:tests:r${round}`, phase: 'Verify', schema: VERIFY_SCHEMA }
    ),
    () => agent(
      `Verify the running build against the agreed design and acceptance criteria. Build/run via the documented command.\n\n${designBlock}`,
      { agentType: 'ux-lead', label: `verify:ux:r${round}`, phase: 'Verify', schema: UX_SCHEMA }
    ),
  ])
  verify = checks[0]
  ux = checks[1]
  const allPass = verify && verify.testsPass && verify.reviewPass && ux && ux.uxPass
  log(`Verify round ${round}: tests=${verify && verify.testsPass} review=${verify && verify.reviewPass} ux=${ux && ux.uxPass}`)
  if (allPass) break
  if (round === VERIFY_MAX_ROUNDS) break
  const failures = [...((verify && verify.failures) || []), ...((ux && ux.gaps) || [])]
  await agent(
    `Verification failed. Fix these specific issues, test-first, and commit:\n${failures.map(f => `- ${f}`).join('\n')}\n\n${designBlock}\nRead docs/team/charter.md for the stack and test command.`,
    { agentType: 'senior-eng-frontend', label: `fix:r${round}`, phase: 'Implement' }
  )
}

const gatesGreen = !!(verify && verify.testsPass && verify.reviewPass && ux && ux.uxPass)

// ---- Ship ----
phase('Ship')
const ship = await agent(
  `Ship this work. Ensure all changes are committed on a feature branch (NOT main), push, and open a PR to main with a summary of the design and what changed. ${gatesGreen && autoMerge ? 'All gates passed and auto-merge is ON — merge the PR after opening it (squash). Never force-push.' : 'Do NOT merge — leave the PR open for review.'} Report the branch, PR url, and whether it was merged.`,
  { agentType: 'tech-lead', phase: 'Ship', schema: SHIP_SCHEMA }
)

// ---- Decision log (agent writes the file; script has no fs access) ----
const runRecord = {
  feature: feature || intake.backlogItem || intake.problemStatement,
  isBootstrap: intake.isBootstrap,
  acceptanceCriteria: intake.acceptanceCriteria,
  positions,
  consensus,
  critique,
  plan: plan.tasks,
  implemented,
  verify,
  ux,
  gatesGreen,
  ship,
}
const runLog = await agent(
  `Write a decision-log markdown file recording this team run. Determine today's date with the shell (date +%Y-%m-%d) and a short kebab-case slug from the feature. Write the file to docs/team/runs/<date>-<slug>.md with these sections: Feature, Acceptance Criteria, Roundtable Positions, Consensus Design, Critique history, Task Plan, Implementation summary, Verification result, Ship (branch/PR/merged). Then return ONLY the path you wrote. Data:\n\n${JSON.stringify(runRecord)}`,
  { agentType: 'tech-lead', label: 'scribe', phase: 'Ship' }
)

return { prUrl: ship.prUrl, merged: ship.merged, branch: ship.branch, runLogPath: (runLog || '').trim(), gatesGreen }
```

- [ ] **Step 2: Validate the script is syntactically valid JavaScript**

Run: `node --check .claude/workflows/team.js && echo SYNTAX_OK`
Expected: `SYNTAX_OK` (Node parses ESM `export`/top-level `await`; undefined globals like `agent`/`phase` are not flagged by `--check`).

- [ ] **Step 3: Confirm `meta` is a pure literal and agent names match**

Run:
```bash
grep -n "agentType:" .claude/workflows/team.js | grep -oE "'[a-z-]+'" | sort -u
ls .claude/agents | sed 's/.md$//' | sort -u
```
Expected: every quoted `agentType` value in the first list appears as an agent file in the second list (`junior-eng`, `product-owner`, `senior-eng-backend`, `senior-eng-frontend`, `senior-eng-quality`, `tech-lead`, `ux-lead`).

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/team.js
git commit -m "feat(team): add team.js orchestration workflow"
```

---

### Task 6: Add the `/team` command skill

**Files:**
- Create: `.claude/skills/team/SKILL.md`

**Interfaces:**
- Consumes: the `team` workflow from Task 5.
- Produces: a user-invocable `/team` command that runs the workflow with the user's feature argument (or none, to pull the backlog top).

- [ ] **Step 1: Write `.claude/skills/team/SKILL.md`**

```markdown
---
name: team
description: Run the autonomous AI product team (PO, tech lead, senior engineers, junior, UX lead) through evaluate→agree→implement→verify→ship for one AboutMeGame feature. Use when the user types /team, asks the "team" to build/design a feature, or wants an autonomous feature run. Pass the feature as args; with no args the team pulls the top backlog item.
---

# /team — run the autonomous product team

Invoke the deterministic `team` workflow to take one feature from intake to a
shipped PR with no human gate, bounded by automated quality gates.

## How to run

Call the `Workflow` tool with:
- `name`: `"team"`
- `args`: `{ "feature": "<the user's feature text, or omit to pull the top backlog item>", "autoMerge": <true|false> }`

`autoMerge` defaults to `true` (the team merges its own PR when all gates pass).
Pass `false` when the user wants PRs left open for review.

## Behavior

The workflow runs: Intake → Roundtable (parallel) → Converge (adversarial loop)
→ Plan → Implement (sequential, dependency order) → Verify (tests + review + UX)
→ Ship (branch + PR, gated auto-merge). It writes a decision log to
`docs/team/runs/` and returns `{ prUrl, merged, branch, runLogPath, gatesGreen }`.

Relay the returned PR url, merge status, and run-log path to the user.

## Notes

- The first run is the bootstrap: the team chooses the stack, scaffolds the
  project, and fills in `docs/team/charter.md`.
- For continuous autonomous operation, drive this with `/loop /team`.
```

- [ ] **Step 2: Verify the skill frontmatter parses**

Run: `awk '/^---$/{c++; next} c==1' .claude/skills/team/SKILL.md | grep -E '^(name|description):'`
Expected: prints `name: team` and a `description:` line.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/team/SKILL.md
git commit -m "feat(team): add /team command skill"
```

---

### Task 7: End-to-end dry-run validation (no merge)

**Files:**
- None created. This task exercises the harness and confirms it runs end to end without merging.

**Interfaces:**
- Consumes: everything from Tasks 1–6.

- [ ] **Step 1: Run the workflow on a trivial throwaway feature with auto-merge OFF**

Invoke the `Workflow` tool:
- `name`: `"team"`
- `args`: `{ "feature": "Add a top-level README.md describing AboutMeGame in one paragraph", "autoMerge": false }`

This is deliberately tiny and non-destructive so the dry run is cheap. Because the charter stack is still "TBD", expect the PO/Tech Lead to treat documentation work without needing a full app stack.

- [ ] **Step 2: Confirm the pipeline executed end to end**

Expected from the tool result and `/workflows` progress: all seven phases ran (Intake → … → Ship), the run returned an object with `runLogPath` set, and `merged` is `false`.

- [ ] **Step 3: Confirm the audit log was written**

Run: `ls docs/team/runs/*.md`
Expected: at least one dated decision-log file exists.

- [ ] **Step 4: Confirm no merge to main happened**

Run: `git log --oneline main -1 2>/dev/null; git branch --show-current`
Expected: the current branch is a feature branch (not `main`); `main` does not contain the dry-run commit. If a PR was opened, it is still open.

- [ ] **Step 5: Commit any harness fixes surfaced by the dry run**

If the dry run revealed a bug in `team.js` or an agent prompt, fix it, re-run Step 1, and commit:
```bash
git add -A
git commit -m "fix(team): address issues found in dry-run validation"
```
If the dry run was clean, there is nothing to commit for this task.

---

## Self-Review

- **Spec coverage:** seven roles (Tasks 2–4) ✓; seven-phase flow incl. parallel roundtable, adversarial converge, sequential implement, gated verify, gated ship (Task 5) ✓; autonomy + green-only gate + auto-merge toggle + caps + audit trail (Task 5 `team.js`) ✓; `/loop` continuous mode (documented in Task 6 skill) ✓; file layout `.claude/agents`, `.claude/workflows`, `.claude/skills/team`, `docs/team/*` (Tasks 1, 2–6) ✓; first-run bootstrap (PO/Tech-Lead prompts + Task 7 note) ✓; data contracts → schemas in Task 5 ✓.
- **Known deviation:** Implement is sequential, not parallel-worktree (documented in Global Constraints; surface at handoff).
- **Placeholder scan:** the only "TBD" strings are intentional placeholder *content* inside `charter.md`/`backlog.md` templates (filled on first run), not plan gaps.
- **Type/name consistency:** `agentType` strings in `team.js` match the seven agent `name:` values exactly (verified by Task 5 Step 3); schema property names (`testsPass`, `reviewPass`, `uxPass`, `materialFlaw`, `dependsOn`, `testFirst`) are used consistently across definition and reference sites.
