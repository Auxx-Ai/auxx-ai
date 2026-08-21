// packages/lib/src/import/__tests__/execute-strategy.test.ts
//
// The UPDATE-path write policy, end to end through `executeStrategy`:
//   • a blank cell is an ABSENCE on update, for every field, create unaffected
//   • `mergeStrategy: 'overwrite'` re-enables clearing (the only way to empty a
//     field by import)
//   • `mergeStrategy: 'ignore'` makes a column create-only
//   • `mergeStrategy: 'fill_blank'` withholds the write when the TARGET is set
//   • an update row whose payload empties out writes NOTHING and is not counted

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Compiles a drizzle `sql` template back to text + params for assertions. */
const dialect = new PgDialect()

// The org field cache is the `fill_blank` key-space resolver. Mock the barrel
// WHOLESALE, partial-mocking it walks its real import graph first.
vi.mock('../../cache', () => ({
  getCachedCustomFields: vi.fn(),
  // `ImportMapping.entityDefinitionId` may be an entityType slug while the field
  // cache is CUID-keyed; the resolver is identity here since the fixture def id
  // is already canonical.
  canonicalizeEntityDefinitionId: vi.fn(async (_org: string, id: string) => id),
}))
vi.mock('../raw-data/get-row-data', () => ({ getBatchRowData: vi.fn() }))

const { getCachedCustomFields } = await import('../../cache')
const { getBatchRowData } = await import('../raw-data/get-row-data')
const { executeStrategy } = await import('../execution/execute-strategy')

import { UniqueValueConflictError } from '../../errors'
import type { BatchRecordData } from '../execution/execute-batch'
import type { ImportMappingProperty } from '../types/mapping'
import type { ImportPlanStrategy, StrategyType } from '../types/plan'

const getCachedCustomFieldsMock = vi.mocked(getCachedCustomFields)
const getBatchRowDataMock = vi.mocked(getBatchRowData)

/** Mirrors the module-private constant in `execute-strategy.ts`. */
const NO_OP_WARNING = 'No changes, every mapped value was blank or withheld by its merge strategy'

const SKU_FIELD_ID = 'cf-sku'
const NOTES_FIELD_ID = 'cf-notes'
const LEAD_TIME_FIELD_ID = 'cf-lead-time'

function mapping(
  index: number,
  customFieldId: string,
  name: string,
  mergeStrategy?: string
): ImportMappingProperty {
  return {
    id: `prop-${index}`,
    importMappingId: 'mapping-1',
    sourceColumnIndex: index,
    sourceColumnName: name,
    targetType: 'particle',
    targetFieldKey: name,
    customFieldId,
    resolutionType: 'text:value',
    resolutionConfig: mergeStrategy ? JSON.stringify({ mergeStrategy }) : undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/** SKU + Notes + Lead Time, the price-list shape. */
const MAPPINGS = [
  mapping(0, SKU_FIELD_ID, 'sku'),
  mapping(1, NOTES_FIELD_ID, 'notes'),
  mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
]

const STRATEGY = (strategy: StrategyType): ImportPlanStrategy => ({
  id: 'strat-1',
  importPlanId: 'plan-1',
  strategy,
  matchingFieldKey: 'sku',
  matchingCustomFieldId: null,
  status: 'planned',
})

/** One captured raw statement, compiled to SQL text plus bound params. */
interface CapturedStatement {
  sql: string
  params: unknown[]
}

/**
 * Fake db: plan rows come back from `query.ImportPlanRow.findMany`, updates
 * resolve, `select()` serves the `fill_blank` current-value read, and
 * `execute()` captures the batched `ImportPlanRow` write so a test can read the
 * bound params back.
 */
function fakeDb(
  planRows: Array<{ id: string; rowIndex: number; existingRecordId: string | null }>,
  fieldValueRows: Array<Record<string, unknown>> = [],
  executed: CapturedStatement[] = []
) {
  const db = {
    query: { ImportPlanRow: { findMany: async () => planRows } },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    execute: async (query: SQL) => {
      executed.push(dialect.sqlToQuery(query))
      return { rows: [] }
    },
    select: () => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = () => Promise.resolve(fieldValueRows)
      return chain
    },
  }
  return db as never
}

function run(
  strategy: StrategyType,
  options: {
    mappings?: ImportMappingProperty[]
    rows?: Array<{ id: string; rowIndex: number; existingRecordId: string | null }>
    fieldValueRows?: Array<Record<string, unknown>>
    rowData?: Map<number, Record<number, string>>
    createRecord?: (data: BatchRecordData) => Promise<{ id: string }>
  } = {}
) {
  const planRows = options.rows ?? [{ id: 'pr-1', rowIndex: 0, existingRecordId: 'inst-1' }]
  getBatchRowDataMock.mockResolvedValue(
    options.rowData ?? new Map([[0, { 0: 'M400L', 1: '', 2: '' }]])
  )

  const createRecord = vi.fn(
    options.createRecord ?? (async (_data: BatchRecordData) => ({ id: 'new-1' }))
  )
  const updateRecord = vi.fn(async (id: string, _data: BatchRecordData) => ({ id }))
  const executed: CapturedStatement[] = []

  return {
    createRecord,
    updateRecord,
    executed,
    result: executeStrategy(STRATEGY(strategy), {
      db: fakeDb(planRows, options.fieldValueRows, executed),
      organizationId: 'org-1',
      userId: 'user-1',
      jobId: 'job-1',
      entityDefinitionId: 'def-part',
      mappings: options.mappings ?? MAPPINGS,
      resolutions: new Map(),
      createRecord,
      updateRecord,
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getCachedCustomFieldsMock.mockResolvedValue([
    { id: SKU_FIELD_ID, systemAttribute: null },
    { id: NOTES_FIELD_ID, systemAttribute: null },
    { id: LEAD_TIME_FIELD_ID, systemAttribute: null },
  ] as never)
})

describe('executeStrategy, a blank cell is an ABSENCE on update', () => {
  // The partial-file case, which is the COMMON case for a re-import: a
  // supplier list that leaves `Lead Time` empty on half its rows used to blank
  // out lead times someone had entered by hand.
  it('updates ONLY the columns the file actually carries', async () => {
    const { updateRecord, result } = run('update', {
      rowData: new Map([[0, { 0: 'M400L', 1: 'restocked', 2: '' }]]),
    })
    await result

    expect(updateRecord).toHaveBeenCalledTimes(1)
    const [id, data] = updateRecord.mock.calls[0]!
    expect(id).toBe('inst-1')
    expect(data.customFields).toEqual({
      [SKU_FIELD_ID]: 'M400L',
      [NOTES_FIELD_ID]: 'restocked',
    })
    expect(data.customFields).not.toHaveProperty(LEAD_TIME_FIELD_ID)
  })

  // Create is unaffected: a blank on create is just an unset field.
  it('still writes the blanks on the CREATE path', async () => {
    const { createRecord, result } = run('create', {
      rows: [{ id: 'pr-1', rowIndex: 0, existingRecordId: null }],
      rowData: new Map([[0, { 0: 'M400L', 1: 'restocked', 2: '' }]]),
    })
    await result

    const [data] = createRecord.mock.calls[0]!
    expect(data.customFields).toEqual({
      [SKU_FIELD_ID]: 'M400L',
      [NOTES_FIELD_ID]: 'restocked',
      [LEAD_TIME_FIELD_ID]: '',
    })
  })
})

describe('executeStrategy, merge strategies', () => {
  // Without an `overwrite` opt-in, absence-by-default becomes "you can't
  // empty a field via import at all".
  it('overwrite lets a blank cell CLEAR the stored value', async () => {
    const { updateRecord, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku'),
        mapping(1, NOTES_FIELD_ID, 'notes', 'overwrite'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rowData: new Map([[0, { 0: 'M400L', 1: '', 2: '' }]]),
    })
    await result

    const [, data] = updateRecord.mock.calls[0]!
    expect(data.customFields).toEqual({ [SKU_FIELD_ID]: 'M400L', [NOTES_FIELD_ID]: '' })
  })

  it('ignore makes a column create-only', async () => {
    const { updateRecord, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku'),
        mapping(1, NOTES_FIELD_ID, 'notes', 'ignore'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rowData: new Map([[0, { 0: 'M400L', 1: 'from csv', 2: '' }]]),
    })
    await result

    const [, data] = updateRecord.mock.calls[0]!
    expect(data.customFields).toEqual({ [SKU_FIELD_ID]: 'M400L' })
  })

  // `fill_blank` asks whether the TARGET is empty; the blank rule asks
  // whether the SOURCE is. They compose.
  it('fill_blank does NOT clobber a non-empty stored value', async () => {
    const { updateRecord, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku'),
        mapping(1, NOTES_FIELD_ID, 'notes', 'fill_blank'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rowData: new Map([[0, { 0: 'M400L', 1: 'from csv', 2: '' }]]),
      fieldValueRows: [
        {
          entityId: 'inst-1',
          fieldId: NOTES_FIELD_ID,
          valueText: 'a human wrote this',
          valueNumber: null,
          valueBoolean: null,
          valueDate: null,
          valueJson: null,
          optionId: null,
          relatedEntityId: null,
          actorId: null,
        },
      ],
    })
    await result

    const [, data] = updateRecord.mock.calls[0]!
    expect(data.customFields).toEqual({ [SKU_FIELD_ID]: 'M400L' })
  })

  it('fill_blank DOES write when the stored value is empty', async () => {
    const { updateRecord, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku'),
        mapping(1, NOTES_FIELD_ID, 'notes', 'fill_blank'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rowData: new Map([[0, { 0: 'M400L', 1: 'from csv', 2: '' }]]),
      fieldValueRows: [],
    })
    await result

    const [, data] = updateRecord.mock.calls[0]!
    expect(data.customFields).toEqual({
      [SKU_FIELD_ID]: 'M400L',
      [NOTES_FIELD_ID]: 'from csv',
    })
  })
})

describe('executeStrategy, no-op update rows', () => {
  // A row whose payload empties out changed nothing. Calling `updateRecord`
  // anyway would produce an empty write, a manifest entry and an `updated`
  // count for a row that did nothing.
  it('does not call updateRecord and is not counted as executed', async () => {
    const { updateRecord, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku', 'ignore'),
        mapping(1, NOTES_FIELD_ID, 'notes'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rowData: new Map([[0, { 0: 'M400L', 1: '', 2: '' }]]),
    })
    const outcome = await result

    expect(updateRecord).not.toHaveBeenCalled()
    expect(outcome.executed).toBe(0)
    expect(outcome.failed).toBe(0)
    expect(outcome.noops).toBe(1)
  })

  it('writes the no-op warning in ONE statement carrying every no-op row id', async () => {
    const { executed, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku', 'ignore'),
        mapping(1, NOTES_FIELD_ID, 'notes'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rows: [
        { id: 'pr-1', rowIndex: 0, existingRecordId: 'inst-1' },
        { id: 'pr-2', rowIndex: 1, existingRecordId: 'inst-2' },
      ],
      rowData: new Map([
        [0, { 0: 'M400L', 1: '', 2: '' }],
        [1, { 0: 'M400R', 1: '', 2: '' }],
      ]),
    })
    await result

    expect(executed).toHaveLength(1)
    const [statement] = executed
    expect(statement!.params).toContain('pr-1')
    expect(statement!.params).toContain('pr-2')
    expect(statement!.params.filter((p) => p === NO_OP_WARNING)).toHaveLength(2)
    // Appended, never replaced: a planning warning already on the row survives.
    expect(statement!.sql).toContain(`|| '; ' ||`)
  })

  it('executes the rows that DO write, alongside the no-ops', async () => {
    const { updateRecord, result } = run('update', {
      mappings: [
        mapping(0, SKU_FIELD_ID, 'sku', 'ignore'),
        mapping(1, NOTES_FIELD_ID, 'notes'),
        mapping(2, LEAD_TIME_FIELD_ID, 'lead_time'),
      ],
      rows: [
        { id: 'pr-1', rowIndex: 0, existingRecordId: 'inst-1' },
        { id: 'pr-2', rowIndex: 1, existingRecordId: 'inst-2' },
      ],
      rowData: new Map([
        [0, { 0: 'M400L', 1: '', 2: '' }],
        [1, { 0: 'M400R', 1: 'restocked', 2: '' }],
      ]),
    })
    const outcome = await result

    expect(updateRecord).toHaveBeenCalledTimes(1)
    expect(updateRecord.mock.calls[0]![0]).toBe('inst-2')
    expect(outcome.executed).toBe(1)
    expect(outcome.noops).toBe(1)
  })
})

describe('executeStrategy, batched ImportPlanRow write-back', () => {
  // One statement per batch instead of one per row (5,000 rows used to mean
  // 5,000 extra round trips). The risk a batch introduces is a value landing on
  // the WRONG row, so this pins each row id to its own outcome tuple.
  it('lands each row status, result id, error and warning on its own row', async () => {
    const createRecord = async (data: BatchRecordData) => {
      const sku = data.customFields[SKU_FIELD_ID]
      if (sku === 'BOOM') throw new Error('create exploded')
      if (sku === 'DUP' && data.customFields[NOTES_FIELD_ID] === 'taken@example.com') {
        throw new UniqueValueConflictError({
          message: 'value already used',
          conflictingValue: 'taken@example.com',
        })
      }
      return { id: `inst-${String(sku).toLowerCase()}` }
    }

    const { executed, result } = run('create', {
      createRecord,
      rows: [
        { id: 'pr-1', rowIndex: 0, existingRecordId: null },
        { id: 'pr-2', rowIndex: 1, existingRecordId: null },
        { id: 'pr-3', rowIndex: 2, existingRecordId: null },
      ],
      rowData: new Map([
        [0, { 0: 'OK', 1: 'fine', 2: '' }],
        [1, { 0: 'BOOM', 1: '', 2: '' }],
        [2, { 0: 'DUP', 1: 'taken@example.com', 2: '' }],
      ]),
    })
    const outcome = await result

    expect(outcome.executed).toBe(2)
    expect(outcome.failed).toBe(1)
    expect(outcome.warnings).toBe(1)

    // All three rows go out in ONE statement.
    expect(executed).toHaveLength(1)
    const { params } = executed[0]!

    // Each id opens its own 5-value tuple: (id, status, resultRecordId,
    // errorMessage, warningMessage).
    const tuple = (id: string) => params.slice(params.indexOf(id), params.indexOf(id) + 5)

    expect(tuple('pr-1')).toEqual(['pr-1', 'completed', 'inst-ok', null, null])
    expect(tuple('pr-2')).toEqual(['pr-2', 'failed', null, 'create exploded', null])
    expect(tuple('pr-3')).toEqual([
      'pr-3',
      'completed',
      'inst-dup',
      null,
      'Dropped "taken@example.com" — already used by another record',
    ])
  })

  // Drizzle's `.set()` skips undefined keys, so the per-row form left
  // `resultRecordId` / `errorMessage` untouched when an outcome had nothing to
  // say. The batched form has to say something for every column, so the
  // statement COALESCEs back to the stored value rather than writing NULL.
  it('never stomps a column the outcome is silent about', async () => {
    const { executed, result } = run('create', {
      rows: [{ id: 'pr-1', rowIndex: 0, existingRecordId: null }],
      rowData: new Map([[0, { 0: 'M400L', 1: 'fine', 2: '' }]]),
    })
    await result

    const { sql: text } = executed[0]!
    expect(text).toContain('UPDATE "ImportPlanRow" AS r')
    expect(text).toContain('"resultRecordId" = COALESCE(v."resultRecordId", r."resultRecordId")')
    expect(text).toContain('"errorMessage" = COALESCE(v."errorMessage", r."errorMessage")')
    expect(text).toContain('FROM (VALUES')
    expect(text).toContain('WHERE r.id = v.id')
  })
})
