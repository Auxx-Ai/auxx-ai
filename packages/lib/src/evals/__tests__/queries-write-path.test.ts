// packages/lib/src/evals/__tests__/queries-write-path.test.ts
//
// Write-path persistence of the phase-5A denormalized mode columns. No DB
// harness exists, so `@auxx/database` is mocked wholesale and the tests assert
// the `.values(...)` shapes handed to the insert chains (also sidesteps the
// known Drizzle-columns-undefined-under-vitest gotcha).

vi.mock('@auxx/database', () => {
  const insertedValues: { table: unknown; values: Record<string, unknown> }[] = []

  function makeInsert() {
    return (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push({ table, values })
        return {
          returning: async () => [{ id: `row-${insertedValues.length}`, ...values }],
        }
      },
    })
  }

  const database = {
    insert: makeInsert(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ insert: makeInsert() }),
  }
  const schema = { EvalRun: { __table: 'EvalRun' }, EvalSuiteRun: { __table: 'EvalSuiteRun' } }
  return { database, schema, __insertedValues: insertedValues }
})

vi.mock('@auxx/services/shared/utils', async () => {
  const { ok } = await import('neverthrow')
  return { fromDatabase: async (promise: Promise<unknown>) => ok(await promise) }
})

import * as mockedDatabaseModule from '@auxx/database'
import { schema } from '@auxx/database'
import { createQueuedEvalRun, createSuiteRunWithChildren, mergeLatestWithPinned } from '../queries'

const insertedValues = (
  mockedDatabaseModule as unknown as {
    __insertedValues: { table: unknown; values: Record<string, unknown> }[]
  }
).__insertedValues

beforeEach(() => {
  insertedValues.length = 0
})

describe('createQueuedEvalRun — runMode persistence', () => {
  const base = {
    organizationId: 'org',
    caseId: 'c1',
    kind: 'agent_simulation' as const,
    definitionSnapshot: { d: 1 },
    runtimeSnapshot: { r: 1 },
  }

  it('persists an explicit draft runMode', async () => {
    const result = await createQueuedEvalRun({ ...base, runMode: 'draft' })
    expect(result.isOk()).toBe(true)
    expect(insertedValues[0]?.values.runMode).toBe('draft')
  })

  it('defaults to pinned for headless callers that omit runMode', async () => {
    await createQueuedEvalRun(base)
    expect(insertedValues[0]?.values.runMode).toBe('pinned')
  })
})

describe('createSuiteRunWithChildren — suite + per-child mode persistence', () => {
  const children = [
    { caseId: 'c1', definitionSnapshot: {}, runtimeSnapshot: {}, runMode: 'draft' as const },
    { caseId: 'c2', definitionSnapshot: {}, runtimeSnapshot: {} },
  ]

  it('persists suite runMode/draftContentHash/agentId/procedureId/baselineSuiteRunId and per-child runMode', async () => {
    const result = await createSuiteRunWithChildren({
      organizationId: 'org',
      kind: 'agent_simulation',
      selectionSnapshot: { caseIds: ['c1', 'c2'] },
      runMode: 'draft',
      draftContentHash: 'dhash',
      agentId: 'agent-1',
      procedureId: 'proc-1',
      baselineSuiteRunId: 'esr-prev',
      children,
    })
    expect(result.isOk()).toBe(true)

    const suiteInsert = insertedValues.find((i) => i.table === schema.EvalSuiteRun)
    expect(suiteInsert?.values).toMatchObject({
      runMode: 'draft',
      draftContentHash: 'dhash',
      agentId: 'agent-1',
      procedureId: 'proc-1',
      baselineSuiteRunId: 'esr-prev',
    })

    const childInserts = insertedValues.filter((i) => i.table === schema.EvalRun)
    expect(childInserts.map((i) => i.values.runMode)).toEqual(['draft', 'pinned'])
  })

  it('defaults the new suite columns for pinned-mode callers (existing behavior unaffected)', async () => {
    await createSuiteRunWithChildren({
      organizationId: 'org',
      kind: 'agent_simulation',
      selectionSnapshot: { caseIds: ['c1'] },
      children: [{ caseId: 'c1', definitionSnapshot: {}, runtimeSnapshot: {} }],
    })

    const suiteInsert = insertedValues.find((i) => i.table === schema.EvalSuiteRun)
    expect(suiteInsert?.values).toMatchObject({
      runMode: 'pinned',
      draftContentHash: null,
      agentId: null,
      procedureId: null,
      baselineSuiteRunId: null,
    })
  })
})

describe('mergeLatestWithPinned — last-verified semantics', () => {
  const run = (
    caseId: string,
    runMode: 'pinned' | 'draft',
    runId: string
  ): Parameters<typeof mergeLatestWithPinned>[0][number] => ({
    caseId,
    runId,
    status: 'passed',
    runMode,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    completedAt: null,
  })

  it('attaches the latest pinned run when the latest overall is a draft run', () => {
    const merged = mergeLatestWithPinned(
      [run('c1', 'draft', 'r-draft')],
      [run('c1', 'pinned', 'r-pinned')]
    )
    expect(merged[0]?.runId).toBe('r-draft')
    expect(merged[0]?.latestPinned?.runId).toBe('r-pinned')
  })

  it('leaves pinned-latest cases untouched (no secondary)', () => {
    const merged = mergeLatestWithPinned(
      [run('c1', 'pinned', 'r-pinned')],
      [run('c1', 'pinned', 'r-older')]
    )
    expect(merged[0]?.runId).toBe('r-pinned')
    expect(merged[0]?.latestPinned).toBeUndefined()
  })

  it('returns the draft run bare when the case has no pinned history', () => {
    const merged = mergeLatestWithPinned([run('c1', 'draft', 'r-draft')], [])
    expect(merged[0]?.runId).toBe('r-draft')
    expect(merged[0]?.latestPinned).toBeUndefined()
  })
})
