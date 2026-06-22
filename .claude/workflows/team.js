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

return { prUrl: ship.prUrl, merged: ship.merged, branch: ship.branch, runLogPath: (runLog || '').trim(), gatesGreen }
