// packages/lib/src/custom-fields/__tests__/update-field-option-cascade.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` factories are hoisted above every top-level binding, so the mock's
// shared state has to be hoisted with them.
const mocks = vi.hoisted(() => ({
  customFieldTable: { table: 'CustomField' },
  fieldValueTable: { table: 'FieldValue' },
  /** The row `updateCustomField` reads before deciding what to write. */
  currentRow: undefined as Record<string, unknown> | undefined,
  /** Every `delete(table).where(cond)` the call made, in order. */
  deletes: [] as Array<{ table: unknown; cond: unknown }>,
  /** Every `selectDistinct(...).from(table).where(cond)`, in order. */
  distinctReads: [] as Array<{ table: unknown; cond: unknown }>,
  /** What the cascade's `DELETE … RETURNING "entityId"` yields. */
  deleteReturning: [] as Array<{ entityId: string }>,
  /** What the relabel arm's `SELECT DISTINCT "entityId"` yields. */
  distinctRows: [] as Array<{ entityId: string }>,
  /** What survives for the realtime re-read. */
  remainingRows: [] as Array<Record<string, unknown>>,
  /** Instance ids handed to `updateSearchTextForInstances`, per call. */
  searchTextCalls: [] as string[][],
  /** Entry batches handed to `publishFieldValueUpdates`, per call. */
  publishes: [] as Array<Array<{ key: string; value: unknown }>>,
}))

const FIELD_VALUE_TABLE = mocks.fieldValueTable

vi.mock('@auxx/database', () => ({
  database: {
    // Two shapes ride this builder: the current-field read terminates on
    // `.limit()`, the cascade's survivor re-read on `.orderBy()`.
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.currentRow ? [mocks.currentRow] : []),
          orderBy: () => Promise.resolve(mocks.remainingRows),
        }),
      }),
    }),
    selectDistinct: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          mocks.distinctReads.push({ table, cond })
          return Promise.resolve(mocks.distinctRows)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => ({
        returning: () => {
          mocks.deletes.push({ table, cond })
          return Promise.resolve(mocks.deleteReturning)
        },
      }),
    }),
    // The update terminal must be awaitable directly AND chainable with
    // `.returning()` — see update-field-ai-options.test.ts.
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: 'field_1', ...data }]),
          // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS a thenable; the mock has to be one too
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve, reject),
        }),
      }),
    }),
  },
  schema: { CustomField: mocks.customFieldTable, FieldValue: mocks.fieldValueTable },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, values: unknown[]) => ({ inArray: values }),
}))

vi.mock('../../field-values/search-text', () => ({
  updateSearchTextForInstances: (_db: unknown, _org: string, ids: readonly string[]) => {
    mocks.searchTextCalls.push([...ids])
    return Promise.resolve()
  },
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: (
    _svc: unknown,
    _org: string,
    entries: Array<{ key: string; value: unknown }>
  ) => {
    mocks.publishes.push(entries)
    return Promise.resolve()
  },
}))

import { updateCustomField } from '../update-field'

const BASE_INPUT = {
  resourceFieldId: 'def_1:field_1' as never,
  organizationId: 'org_1',
}

function setStoredField(options: Record<string, unknown>, type = 'TAGS') {
  mocks.currentRow = {
    type,
    options,
    isUnique: false,
    modelType: 'ENTITY_INSTANCE',
    entityDefinitionId: 'def_1',
    systemAttribute: null,
    appInstallationId: null,
  }
}

/** The option keys the cascade's DELETE targeted, or undefined if it never ran. */
function deletedOptionKeys(): string[] | undefined {
  const call = mocks.deletes.find((d) => d.table === FIELD_VALUE_TABLE)
  if (!call) return undefined
  return extractInArray(call.cond)
}

/** The option keys the relabel arm looked up, or undefined if it never ran. */
function relabeledOptionKeys(): string[] | undefined {
  const call = mocks.distinctReads.find((d) => d.table === FIELD_VALUE_TABLE)
  if (!call) return undefined
  return extractInArray(call.cond)
}

function extractInArray(cond: unknown): string[] | undefined {
  const arms = (cond as { and?: unknown[] }).and ?? []
  const arm = arms.find((a) => a && typeof a === 'object' && 'inArray' in a)
  return arm ? ((arm as { inArray: string[] }).inArray as string[]) : undefined
}

beforeEach(() => {
  mocks.currentRow = undefined
  mocks.deletes = []
  mocks.distinctReads = []
  mocks.deleteReturning = []
  mocks.distinctRows = []
  mocks.remainingRows = []
  mocks.searchTextCalls = []
  mocks.publishes = []
})

describe('updateCustomField — option cascade', () => {
  it('deletes only the removed option’s values', async () => {
    setStoredField({
      options: [
        { value: 'opt_a', label: 'Enterprise' },
        { value: 'opt_b', label: 'SMB' },
      ],
    })
    mocks.deleteReturning = [{ entityId: 'inst_1' }]
    mocks.remainingRows = [{ id: 'fv_1', entityId: 'inst_1', optionId: 'opt_a', sortKey: 'a' }]

    const result = await updateCustomField({
      ...BASE_INPUT,
      options: [{ value: 'opt_a', label: 'Enterprise' }] as never,
    })

    expect(result.isOk()).toBe(true)
    expect(deletedOptionKeys()).toEqual(['opt_b'])
    // The surviving option is never touched.
    expect(deletedOptionKeys()).not.toContain('opt_a')
    // Removed values are out of the corpus, and peers get the reduced array.
    expect(mocks.searchTextCalls).toEqual([['inst_1']])
    expect(mocks.publishes).toHaveLength(1)
    expect(mocks.publishes[0]?.[0]?.value).toEqual([
      expect.objectContaining({ type: 'option', optionId: 'opt_a' }),
    ])
  })

  it('publishes an EMPTY array when the cascade cleared the record’s only value', async () => {
    // A value-less publish is silently dropped, so the emptied array is what
    // lets a peer tab clear the cell instead of rendering a dead chip.
    setStoredField({ options: [{ value: 'opt_a', label: 'Enterprise' }] })
    mocks.deleteReturning = [{ entityId: 'inst_1' }]
    mocks.remainingRows = []

    await updateCustomField({ ...BASE_INPUT, options: [] as never })

    expect(deletedOptionKeys()).toEqual(['opt_a'])
    expect(mocks.publishes[0]?.[0]?.value).toEqual([])
  })

  it('deletes NOTHING on a rename but still rebuilds searchText', async () => {
    // The key is minted once and never rewritten, so a changed label is a
    // relabel — and `searchText` indexes the resolved LABEL, which is why the
    // rebuild is not optional.
    setStoredField({ options: [{ value: 'opt_a', label: 'Enterprise' }] })
    mocks.distinctRows = [{ entityId: 'inst_7' }]
    mocks.remainingRows = [{ id: 'fv_9', entityId: 'inst_7', optionId: 'opt_a', sortKey: 'a' }]

    await updateCustomField({
      ...BASE_INPUT,
      options: [{ value: 'opt_a', label: 'Enterprise Plan' }] as never,
    })

    expect(deletedOptionKeys()).toBeUndefined()
    expect(relabeledOptionKeys()).toEqual(['opt_a'])
    expect(mocks.searchTextCalls).toEqual([['inst_7']])
  })

  it('diffs an explicitly-keyed option on the id keyspace', async () => {
    // App/connector-provisioned option sets carry an `id`; matching only
    // `value` would read this unchanged option as removed and delete its
    // values.
    setStoredField({ options: [{ id: 'app_opt_1', value: 'ENTERPRISE', label: 'Enterprise' }] })

    await updateCustomField({
      ...BASE_INPUT,
      options: [{ id: 'app_opt_1', value: 'ENTERPRISE', label: 'Enterprise' }] as never,
    })

    expect(mocks.deletes).toHaveLength(0)
    expect(mocks.distinctReads).toHaveLength(0)
    expect(mocks.searchTextCalls).toHaveLength(0)
  })

  it('leaves an id-keyed option alone when only its value string moved', async () => {
    // Both keyspaces are indexed, so the option still matches on `id`.
    setStoredField({ options: [{ id: 'app_opt_1', value: 'ENTERPRISE', label: 'Enterprise' }] })

    await updateCustomField({
      ...BASE_INPUT,
      options: [{ id: 'app_opt_1', value: 'ENT', label: 'Enterprise' }] as never,
    })

    // `ENTERPRISE` genuinely left the keyspace, but `app_opt_1` did not.
    expect(deletedOptionKeys()).toEqual(['ENTERPRISE'])
  })

  it('touches no FieldValue rows when the patch carries no options', async () => {
    setStoredField({ options: [{ value: 'opt_a', label: 'Enterprise' }] })

    await updateCustomField({ ...BASE_INPUT, name: 'Segment' })

    expect(mocks.deletes).toHaveLength(0)
    expect(mocks.distinctReads).toHaveLength(0)
    expect(mocks.searchTextCalls).toHaveLength(0)
    expect(mocks.publishes).toHaveLength(0)
  })

  it('touches no FieldValue rows for a non-option field type', async () => {
    setStoredField({ options: [{ value: 'opt_a', label: 'Enterprise' }] }, 'TEXT')

    await updateCustomField({
      ...BASE_INPUT,
      options: [] as never,
    })

    expect(mocks.deletes).toHaveLength(0)
    expect(mocks.searchTextCalls).toHaveLength(0)
  })
})
