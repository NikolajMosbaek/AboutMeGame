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

// ---- guardrails ----
// The team builds the AboutMeGame PRODUCT, never itself. Reused across phases.
const NO_HARNESS_EDITS = `HARD GUARDRAIL — you build the AboutMeGame product, never the team itself. Do NOT create, edit, or delete any file under \`.claude/\` (agents, workflows, skills, settings, hooks) and do NOT otherwise change the team's own process, roles, or harness. Your changes stay within product code and docs only: \`src/\`, \`content/\`, \`public/\`, \`index.html\`, test/config files, and \`docs/\` (run logs). If the agreed design seems to need a harness/process/role change, do NOT make it — stop and surface it.`
// When an explicit feature is requested, it is the exact, non-negotiable scope.
const scopeDirective = feature
  ? `The requested feature is the EXACT, NON-NEGOTIABLE scope of this run: "${feature}". You MUST scope the problem statement to precisely this feature. Do NOT substitute a different feature, do NOT pull a different or "more valuable" backlog item, do NOT re-prioritize, and do NOT expand scope into process/harness/role changes. If the feature names a GitHub issue, that issue defines the work. Read docs/team/charter.md and docs/team/backlog.md only for grounding (stack, conventions, what already shipped).`
  : `No explicit feature was given — pull the top unchecked backlog item, or propose the most valuable next item if the backlog is empty.`

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
          owner: { type: 'string', enum: ['frontend', 'backend', 'graphics', 'sound', 'quality', 'junior', 'ux'] },
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
  graphics: 'graphics-3d',
  sound: 'sound-engineer',
  quality: 'senior-eng-quality',
  junior: 'junior-eng',
  ux: 'ux-lead',
}

const ROUNDTABLE = [
  'product-owner',
  'tech-lead',
  'senior-eng-frontend',
  'senior-eng-backend',
  'graphics-3d',
  'sound-engineer',
  'senior-eng-quality',
  'ux-lead',
]

// ---- Intake ----
phase('Intake')
const intake = await agent(
  `Intake for the AboutMeGame team. ${scopeDirective}\n\n${NO_HARNESS_EDITS}\n\nProduce the problem statement (scoped exactly to the requested feature when one was given), testable acceptance criteria, and whether this is the bootstrap run.`,
  { agentType: 'product-owner', phase: 'Intake', schema: INTAKE_SCHEMA }
)
if (!intake) { log('HALT in Intake: the product-owner agent returned no result (likely an API/session limit). Stopping the run.'); return { halted: true, phase: 'Intake', reason: 'intake agent returned null' } }

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
  if (!consensus) { log(`HALT in Converge: the tech-lead synthesize agent returned no result on round ${round} (likely an API/session limit). Stopping the run.`); return { halted: true, phase: 'Converge', reason: 'synthesize agent returned null' } }
  critique = await agent(
    `Adversarially critique this design. Try to refute it; default to materialFlaw=true if genuinely uncertain.\n\n${problemBlock}\n\nDESIGN:\n${consensus.summary}\nDECISIONS:\n${(consensus.decisions || []).map(d => `- ${d}`).join('\n')}`,
    { agentType: 'senior-eng-quality', label: `critique:r${round}`, phase: 'Converge', schema: CRITIQUE_SCHEMA }
  )
  if (!critique) { log(`Converge round ${round}: the critique agent returned no result — accepting the current design without further critique.`); break }
  log(`Converge round ${round}: materialFlaw=${critique.materialFlaw}`)
  if (!critique.materialFlaw) break
}

const designBlock = `DESIGN:\n${consensus.summary}\nDECISIONS:\n${(consensus.decisions || []).map(d => `- ${d}`).join('\n')}\nACCEPTANCE CRITERIA:\n${(consensus.acceptanceCriteria || []).map(c => `- ${c}`).join('\n')}`

// ---- Plan ----
phase('Plan')
const plan = await agent(
  `Decompose the agreed design into atomic, ordered, independently verifiable tasks. Each task needs id, title, owner (frontend|backend|graphics|sound|quality|junior|ux), dependsOn (task ids), and the first test to write. Use the graphics owner for Three.js/WebGL/GLSL/rendering work and the sound owner for Web Audio / SFX / music / audio work.\n\n${NO_HARNESS_EDITS}\nEvery task must touch only product code/docs — never plan a task that modifies the harness, agents, or process.\n\n${designBlock}`,
  { agentType: 'tech-lead', phase: 'Plan', schema: PLAN_SCHEMA }
)
if (!plan) { log('HALT in Plan: the tech-lead planning agent returned no result (likely an API/session limit). Stopping the run.'); return { halted: true, phase: 'Plan', reason: 'plan agent returned null' } }

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
      `Implement this task test-first, then commit.\n\n${designBlock}\n\nTASK ${t.id}: ${t.title}\nFirst test to write: ${t.testFirst}\nImplement ONLY this task. Read docs/team/charter.md for the stack, test command, and conventions.\n\n${NO_HARNESS_EDITS}`,
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
      `Verify the implementation. Read docs/team/charter.md for the test command. Run the full test suite and review the diff (git diff main...HEAD). HARD GUARDRAIL: run \`git diff --name-only main...HEAD\` — if ANY changed path is under \`.claude/\` (harness, agents, workflows, skills, settings, hooks), set reviewPass=false and add a failure like "harness self-modification: <path> — feature runs must not change the team's own files"; this is an automatic fail regardless of test results.\n\n${designBlock}`,
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
  const testFailures = (verify && verify.failures) || []
  const uxGaps = (ux && ux.gaps) || []
  const fixes = []
  if (testFailures.length) {
    fixes.push(() => agent(
      `Tests/review failed. Fix these specific issues, test-first, and commit:\n${testFailures.map(f => `- ${f}`).join('\n')}\n\n${designBlock}\nRead docs/team/charter.md for the stack and test command.`,
      { agentType: 'senior-eng-quality', label: `fix:tests:r${round}`, phase: 'Implement' }
    ))
  }
  if (uxGaps.length) {
    fixes.push(() => agent(
      `The UX review found gaps against the agreed design. Fix these specific issues, test-first, and commit:\n${uxGaps.map(f => `- ${f}`).join('\n')}\n\n${designBlock}\nRead docs/team/charter.md for the stack and test command.`,
      { agentType: 'senior-eng-frontend', label: `fix:ux:r${round}`, phase: 'Implement' }
    ))
  }
  for (const f of fixes) { await f() }
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

if (!ship) log('Ship: the ship agent returned no result (likely an API/session limit) — the run log was still written; no PR was opened.')
return { prUrl: ship && ship.prUrl, merged: ship ? ship.merged : false, branch: ship && ship.branch, runLogPath: (runLog || '').trim(), gatesGreen, halted: !ship }
