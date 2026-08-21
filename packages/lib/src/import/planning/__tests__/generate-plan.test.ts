// packages/lib/src/import/planning/__tests__/generate-plan.test.ts
//
// The planner's two invariants:
//   1. the strategy table can never disagree with what `analyzeRow` produces,
//      strategies are built from the RESOLVED identifier, after auto-select;
//   2. `sum(strategyCounts) === rawData.size`. No row may leave the plan
//      silently. The old `if (!strategy) continue` violated both.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists, see the lookup test suite).
// `getCachedFieldMap` is what `batch-identifier-lookup`'s pre-pass resolves its
// `CustomField` through. An empty map means "not batchable", so this suite keeps
// exercising the per-row resolver it drives from `setMatches`. The batched SQL
// itself cannot be unit-tested at all: this config mocks `@auxx/database`, so
// every Drizzle column is `undefined`. It is pinned in
// `batch-identifier-lookup.int.test.ts` against a real database instead.
vi.mock('../../../cache', () => ({
  findCachedResource: vi.fn(),
  getCachedFieldMap: vi.fn(async () => new Map()),
}))

// `find-existing-record` needs a real DB; the planner only cares that it gets a
// resolver back, so stub the factory and drive matches from the test.
//
// `hasSystemTable` and `stripRecordIdPrefix` are real: `batch-identifier-lookup`
// imports them, and a module mock that omits an export hands the importer
// `undefined` rather than failing at collection. That is exactly how a stub can
// make the subject take a path production never takes.
vi.mock('../find-existing-record', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../find-existing-record')>()
  return { ...actual, createFindExistingRecord: vi.fn() }
})

// Partial mock: the real `createDefaultStrategies` is the subject of the
// ordering test, but one test deliberately breaks it to prove the fallthrough
// raises. NEVER fully replace this module, collection dies at the import.
vi.mock('../create-strategy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../create-strategy')>()
  return { ...actual, createDefaultStrategies: vi.fn(actual.createDefaultStrategies) }
})

const { findCachedResource } = await import('../../../cache')
const { createFindExistingRecord } = await import('../find-existing-record')
const { createDefaultStrategies } = await import('../create-strategy')
const { generatePlan } = await import('../generate-plan')

import type { ImportMappingProperty } from '../../types/mapping'
import type { StrategyType } from '../../types/plan'
import type { FindExistingRecordResult } from '../find-existing-record'

const findCachedResourceMock = vi.mocked(findCachedResource)
const createFindExistingRecordMock = vi.mocked(createFindExistingRecord)
const createDefaultStrategiesMock = vi.mocked(createDefaultStrategies)

const ORG = 'org-1'
const DEF = 'def-part'

/** Resource whose `part_sku` field is a registry-declared identifier. */
const RESOURCE = {
  id: 'part',
  type: 'custom',
  entityDefinitionId: DEF,
  fields: [
    {
      id: 'f-sku',
      key: 'part_sku',
      label: 'SKU',
      type: 'string',
      isIdentifier: true,
      capabilities: { filterable: true },
    },
    { id: 'f-name', key: 'name', label: 'Name', type: 'string', capabilities: {} },
    { id: 'f-supplier', key: 'supplier', label: 'Supplier', type: 'string', capabilities: {} },
  ],
} as never

/**
 * Fake db. `insert().values()` is both awaitable (batchAssignRows) and carries
 * `.returning()` (createPlan / createStrategy); `update().set().where()` resolves.
 */
function fakeDb() {
  let seq = 0
  const planRows: Array<{ importPlanStrategyId: string; rowIndex: number }> = []
  const db = {
    insert: () => ({
      values: (vals: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = (Array.isArray(vals) ? vals : [vals]).map((v) => ({
          id: `row-${seq++}`,
          createdAt: new Date(),
          ...v,
        }))
        for (const row of rows) {
          if ('importPlanStrategyId' in row) {
            planRows.push(row as never)
          }
        }
        const promise = Promise.resolve(rows) as Promise<typeof rows> & {
          returning: () => Promise<typeof rows>
        }
        promise.returning = async () => rows
        return promise
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return { db: db as never, planRows }
}

function mapping(overrides: Partial<ImportMappingProperty>): ImportMappingProperty {
  return {
    id: 'prop-sku',
    importMappingId: 'mapping-1',
    sourceColumnIndex: 0,
    sourceColumnName: 'SKU',
    targetType: 'particle',
    targetFieldKey: 'part_sku',
    customFieldId: null,
    resolutionType: 'text:value',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const MAPPINGS = [mapping({})]

function rows(...values: string[]): Map<number, Record<number, string>> {
  return new Map(values.map((v, i) => [i, { 0: v }]))
}

function setMatches(matches: Record<string, string>) {
  createFindExistingRecordMock.mockReturnValue(
    async (values: Record<string, string>): Promise<FindExistingRecordResult> => {
      const hit = matches[values.part_sku ?? '']
      return hit ? { kind: 'one', recordId: hit } : { kind: 'none' }
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  findCachedResourceMock.mockResolvedValue(RESOURCE)
  setMatches({})
})

describe('generatePlan, the strategy table matches what analyzeRow produces', () => {
  // The ordering fix. Strategies used to be created from the RAW option while
  // the analyzer got an auto-selected fallback, so `update` could be missing
  // from the plan while the analyzer happily returned it.
  it('creates an `update` strategy when the identifier came from AUTO-SELECT', async () => {
    const { db } = fakeDb()
    setMatches({ M400L: 'rec-1' })

    const result = await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: rows('M400L'),
      mappings: MAPPINGS,
      resolutions: new Map(),
      // deliberately NO identifierFieldKeys, the auto-pick must reach both
      // the strategy table and the analyzer.
    })

    expect(createDefaultStrategiesMock).toHaveBeenCalledWith(
      db,
      expect.any(String),
      ['part_sku'],
      'create-or-update'
    )
    expect(result.strategies.map((s) => s.strategy)).toContain('update')
    expect(result.estimates.toUpdate).toBe(1)
  })

  it('creates NO `update` strategy in create mode, and ignores the identifier', async () => {
    const { db } = fakeDb()
    setMatches({ M400L: 'rec-1' })

    const result = await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: rows('M400L'),
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
      mode: 'create',
    })

    expect(result.strategies.map((s) => s.strategy)).toEqual(['create', 'skip'])
    expect(createFindExistingRecordMock).not.toHaveBeenCalled()
    expect(result.estimates.toCreate).toBe(1)
    expect(result.estimates.toUpdate).toBe(0)
  })

  it('creates an `unmatched` strategy in update mode only', async () => {
    const { db } = fakeDb()
    const result = await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: rows('M400L'),
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
      mode: 'update',
    })
    expect(result.strategies.map((s) => s.strategy)).toEqual([
      'create',
      'update',
      'skip',
      'unmatched',
    ])
    expect(result.estimates.toUnmatched).toBe(1)
    // Reported distinctly from a row error.
    expect(result.estimates.toSkip).toBe(0)
    expect(result.estimates.withErrors).toBe(0)
  })
})

describe('generatePlan, no row may leave the plan silently', () => {
  // The row-drop fix. A `continue` here meant: not created, not updated, not
  // counted, no error, no ImportPlanRow, the plan just showed fewer rows.
  it('RAISES when a row is classified into a strategy the plan lacks', async () => {
    const { db } = fakeDb()
    setMatches({ M400L: 'rec-1' })

    // Reproduce the old bug exactly: strategies built without `update` while the
    // analyzer is fully able to return it.
    createDefaultStrategiesMock.mockImplementationOnce(async (_db, planId) => [
      {
        id: 's-create',
        importPlanId: planId,
        strategy: 'create' as StrategyType,
        matchingFieldKey: null,
        matchingCustomFieldId: null,
        status: 'planning_queued' as const,
      },
      {
        id: 's-skip',
        importPlanId: planId,
        strategy: 'skip' as StrategyType,
        matchingFieldKey: null,
        matchingCustomFieldId: null,
        status: 'planning_queued' as const,
      },
    ])

    await expect(
      generatePlan({
        db,
        organizationId: ORG,
        jobId: 'job-1',
        entityDefinitionId: DEF,
        rawData: rows('M400L'),
        mappings: MAPPINGS,
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
      })
    ).rejects.toThrow(/classified "update"/)
  })

  it('conserves rows: sum(strategyCounts) === rawData.size', async () => {
    const { db, planRows } = fakeDb()
    setMatches({ M400L: 'rec-1', M400R: 'rec-2' })

    const result = await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      // two matches, one create, one in-file duplicate (⇒ skip)
      rawData: rows('M400L', 'NEW-1', 'M400R', 'M400L'),
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
    })

    const { totalRows, toCreate, toUpdate, toSkip, toUnmatched } = result.estimates
    expect(toCreate + toUpdate + toSkip + toUnmatched).toBe(4)
    expect(totalRows).toBe(4)
    // Every row also produced an ImportPlanRow.
    expect(planRows).toHaveLength(4)
  })

  it('conserves rows in update mode too (unmatched is a real bucket)', async () => {
    const { db, planRows } = fakeDb()
    setMatches({ M400L: 'rec-1' })

    const result = await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: rows('M400L', 'NOT-THERE', 'ALSO-NOT-THERE'),
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
      mode: 'update',
    })

    expect(result.estimates).toMatchObject({
      totalRows: 3,
      toCreate: 0,
      toUpdate: 1,
      toSkip: 0,
      toUnmatched: 2,
    })
    expect(planRows).toHaveLength(3)
  })
})

describe('generatePlan, in-file duplicate identifiers', () => {
  it('errors the later row and names both rows', async () => {
    const { db } = fakeDb()
    const analyzed: Array<{ strategy: string; errors: string[] }> = []

    await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: rows('M400L', 'M400L'),
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
      onRowAnalyzed: (row) => {
        analyzed.push({ strategy: row.strategy, errors: row.errors })
      },
    })

    expect(analyzed[0]!.strategy).toBe('create')
    expect(analyzed[1]!.strategy).toBe('skip')
    expect(analyzed[1]!.errors[0]).toContain('row 2')
    expect(analyzed[1]!.errors[0]).toContain('row 1')
  })
})

describe('generatePlan, idempotence', () => {
  // The whole point of `create-or-update`: run 1 creates, run 2 changes
  // nothing about how many records exist.
  it('creates on run 1 and creates NOTHING on run 2', async () => {
    const file = rows('M400L', 'M400R')

    // Run 1: an empty org, nothing matches.
    const first = fakeDb()
    setMatches({})
    const run1 = await generatePlan({
      db: first.db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: file,
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
    })
    expect(run1.estimates.toCreate).toBe(2)
    expect(run1.estimates.toUpdate).toBe(0)

    // Run 2: the same file against the records run 1 made.
    const second = fakeDb()
    setMatches({ M400L: 'rec-1', M400R: 'rec-2' })
    const run2 = await generatePlan({
      db: second.db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: file,
      mappings: MAPPINGS,
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
    })
    expect(run2.estimates.toCreate).toBe(0)
    expect(run2.estimates.toUpdate).toBe(2)
  })
})

describe('generatePlan, composite identifier', () => {
  it('resolves both keys, in the order given, and hands them to the matcher', async () => {
    const { db } = fakeDb()
    const seen: Array<Record<string, string>> = []
    createFindExistingRecordMock.mockReturnValue(async (values) => {
      seen.push(values)
      return { kind: 'none' }
    })

    await generatePlan({
      db,
      organizationId: ORG,
      jobId: 'job-1',
      entityDefinitionId: DEF,
      rawData: new Map([[0, { 0: 'M400L', 1: 'ACME' }]]),
      mappings: [
        mapping({}),
        mapping({
          id: 'prop-supplier',
          sourceColumnIndex: 1,
          sourceColumnName: 'Supplier',
          targetFieldKey: 'supplier',
        }),
      ],
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku', 'supplier'],
    })

    expect(createFindExistingRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identifierFields: [
          expect.objectContaining({ key: 'part_sku' }),
          expect.objectContaining({ key: 'supplier' }),
        ],
      })
    )
    expect(seen).toEqual([{ part_sku: 'M400L', supplier: 'ACME' }])
  })
})
