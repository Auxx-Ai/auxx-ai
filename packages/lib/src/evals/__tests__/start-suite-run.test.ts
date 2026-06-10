// packages/lib/src/evals/__tests__/start-suite-run.test.ts
//
// Phase-5A threading through the suite-start recipe: the suite row's
// runMode/draftContentHash derive from what the snapshots ACTUALLY resolved
// (a draft request can still run pinned), denormalized selection keys are
// stamped, and baselineSuiteRunId is validated org-scoped before any work.

import { err, ok } from 'neverthrow'

vi.mock('../queries', () => ({
  listEvalCasesByAgent: vi.fn(),
  createSuiteRunWithChildren: vi.fn(),
  getEvalSuiteRun: vi.fn(),
}))
vi.mock('../prepare-run', () => ({ prepareRunSnapshots: vi.fn() }))
vi.mock('../lifecycle', () => ({ failQueuedEvalRun: vi.fn() }))
vi.mock('../worker/enqueue-eval-run', () => ({ enqueueEvalRun: vi.fn() }))

import { prepareRunSnapshots } from '../prepare-run'
import { createSuiteRunWithChildren, getEvalSuiteRun, listEvalCasesByAgent } from '../queries'
import { startAgentSuiteRun } from '../start-suite-run'

const mockedList = listEvalCasesByAgent as unknown as ReturnType<typeof vi.fn>
const mockedCreate = createSuiteRunWithChildren as unknown as ReturnType<typeof vi.fn>
const mockedGetSuite = getEvalSuiteRun as unknown as ReturnType<typeof vi.fn>
const mockedPrepare = prepareRunSnapshots as unknown as ReturnType<typeof vi.fn>

const TARGET = {
  kind: 'agent_simulation',
  scope: 'procedure',
  agentId: 'agent-1',
  procedureId: 'proc-1',
  procedureVersionId: 'v1',
}
const CONFIG = {
  openingMessage: 'hi',
  customerContext: null,
  channel: 'chat',
  timeFrozenAt: null,
  maxCustomerTurns: 3,
  subject: { recordIds: [], identityVerified: false },
  startingFields: [],
  unmatchedToolPolicy: 'error',
  connectorMocks: [],
}
const ASSERTIONS = [{ id: 'x', type: 'terminal_outcome', data: { outcome: 'finished' } }]

function caseRow(id: string) {
  return {
    id,
    name: `Case ${id}`,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    target: TARGET,
    config: CONFIG,
    assertions: ASSERTIONS,
  }
}

function preparedWith(runMode: 'pinned' | 'draft', draftContentHash?: string) {
  return ok({
    definitionSnapshot: { d: 1 },
    runtimeSnapshot: { runMode, ...(draftContentHash ? { draftContentHash } : {}) },
  })
}

const INPUT = {
  organizationId: 'org',
  userId: 'user',
  agentId: 'agent-1',
  procedureId: 'proc-1',
}

beforeEach(() => {
  for (const m of [mockedList, mockedCreate, mockedGetSuite, mockedPrepare]) m.mockReset()
  mockedList.mockResolvedValue(ok([caseRow('c1'), caseRow('c2')]))
  mockedCreate.mockImplementation(async (input: { children: unknown[] }) =>
    ok({
      suiteRun: { id: 'esr-new' },
      runs: input.children.map((_, i) => ({ id: `run-${i}` })),
    })
  )
})

describe('startAgentSuiteRun — phase-5A threading', () => {
  it('stamps the suite draft + draftContentHash + selection keys from the resolved snapshots', async () => {
    mockedPrepare.mockResolvedValue(preparedWith('draft', 'dhash'))

    const result = await startAgentSuiteRun({ ...INPUT, useDraft: true })
    expect(result.isOk()).toBe(true)

    const createInput = mockedCreate.mock.calls[0]?.[0]
    expect(createInput).toMatchObject({
      runMode: 'draft',
      draftContentHash: 'dhash',
      agentId: 'agent-1',
      procedureId: 'proc-1',
      baselineSuiteRunId: null,
    })
    expect(createInput.children.map((c: { runMode: string }) => c.runMode)).toEqual([
      'draft',
      'draft',
    ])
  })

  it('stamps the suite pinned when a draft request resolved no draft (fallback truth)', async () => {
    mockedPrepare.mockResolvedValue(preparedWith('pinned'))

    const result = await startAgentSuiteRun({ ...INPUT, useDraft: true })
    expect(result.isOk()).toBe(true)

    const createInput = mockedCreate.mock.calls[0]?.[0]
    expect(createInput.runMode).toBe('pinned')
    expect(createInput.draftContentHash).toBeNull()
    expect(createInput.children.map((c: { runMode: string }) => c.runMode)).toEqual([
      'pinned',
      'pinned',
    ])
  })

  it('rejects a baselineSuiteRunId that does not resolve org-scoped, before any snapshot work', async () => {
    mockedGetSuite.mockResolvedValue(ok(null))

    const result = await startAgentSuiteRun({ ...INPUT, baselineSuiteRunId: 'esr-foreign' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('EVAL_VALIDATION')
    expect(mockedPrepare).not.toHaveBeenCalled()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('passes a validated baselineSuiteRunId through to the suite row', async () => {
    mockedGetSuite.mockResolvedValue(ok({ id: 'esr-prev' }))
    mockedPrepare.mockResolvedValue(preparedWith('pinned'))

    const result = await startAgentSuiteRun({ ...INPUT, baselineSuiteRunId: 'esr-prev' })
    expect(result.isOk()).toBe(true)
    expect(mockedGetSuite).toHaveBeenCalledWith({ organizationId: 'org', suiteRunId: 'esr-prev' })
    expect(mockedCreate.mock.calls[0]?.[0].baselineSuiteRunId).toBe('esr-prev')
  })

  it('propagates DRAFT_COMPILE_FAILED from snapshot preparation without creating rows', async () => {
    mockedPrepare.mockResolvedValue(
      err({
        code: 'DRAFT_COMPILE_FAILED',
        message: 'Draft does not compile: cycle detected',
        errors: [{ code: 'CYCLE', message: 'cycle detected' }],
      })
    )

    const result = await startAgentSuiteRun({ ...INPUT, useDraft: true })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('DRAFT_COMPILE_FAILED')
    expect(mockedCreate).not.toHaveBeenCalled()
  })
})
