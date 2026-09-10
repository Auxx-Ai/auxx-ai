// packages/lib/src/seed/entity-migrations/migrations/143-gl-pointers-hold-ids.test.ts
//
// Migration 143 rewrites `FieldValue.valueText` on six registry pointers from a
// chart CODE to the `gl_account` instance id. What is pinned here:
//
//  - `TARGET_FIELDS` names exactly the six pairs task 15 §4 converts, and
//    excludes `stock_movement.glAccount` (a `G8` ROLE, not a code);
//  - `buildCodeIndex` and `partitionPointerValues` (pure, no db) do the actual
//    matching: already-an-id, resolve-one-live-code (grouped for one bulk
//    UPDATE), no match, and an ambiguous code shared by two accounts;
//  - `up()` against a stub `Database` modelled on
//    `142-wipe-seeded-charts.test.ts`'s `stubDb` (fixed rows per table,
//    `.where()` unevaluated - the schema's own column objects carry no usable
//    data in this test environment, the same reason that file's stub never
//    interprets a condition either): converts a resolvable code, nulls an
//    unresolvable one (the ordinary case once migration 142 has wiped every
//    chart), leaves an already-converted id alone and is a no-op on a second
//    run - verified by inspecting the store's own `fieldValues` afterward,
//    never through the log line.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `getOrgCache` is a Redis round trip the stub `Database` below has nothing to
// back - the same reason `142-wipe-seeded-charts.test.ts` stubs it.
const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const { migration143GlPointersHoldIds, TARGET_FIELDS, buildCodeIndex, partitionPointerValues } =
  await import('./143-gl-pointers-hold-ids')
const { ALL_ENTITY_MIGRATIONS } = await import('../../entity-migrations')

const MIGRATION_ID = '143-gl-pointers-hold-ids'
const ORG = 'org_1'

// ─── The stub store ────────────────────────────────────────────────────────

interface EntityDefRow {
  id: string
  organizationId: string
  entityType: string
}
interface CustomFieldRow {
  id: string
  organizationId: string
  entityDefinitionId: string
  systemAttribute: string
  options: Record<string, unknown>
}
interface EntityInstanceRow {
  id: string
  organizationId: string
  entityDefinitionId: string
  archivedAt: Date | null
}
interface FieldValueRow {
  id: string
  organizationId: string
  fieldId: string
  entityId: string
  valueText: string | null
}

type Row = Record<string, unknown>

/**
 * An in-memory `Database`, modelled directly on
 * `142-wipe-seeded-charts.test.ts`'s `stubDb`: `.select().from(table).where()`
 * resolves the pre-seeded row set for that TABLE, ignoring the condition
 * object entirely (the schema's column exports carry no usable data in this
 * package's test environment - `142`'s own stub takes the identical posture,
 * one row set per table, and callers configure it already scoped to the
 * query under test). `.update()` finds the id list from the real `inArray()`
 * condition's VALUE, which is a plain array this migration built itself and
 * needs no column resolution to read back, and mutates matching rows in
 * place so the test can inspect the store afterward.
 */
function makeStore(seed: {
  entityDefs?: EntityDefRow[]
  customFields?: CustomFieldRow[]
  entityInstances?: EntityInstanceRow[]
  fieldValues?: FieldValueRow[]
}) {
  const state = {
    entityDefs: seed.entityDefs ?? [],
    customFields: seed.customFields ?? [],
    entityInstances: seed.entityInstances ?? [],
    fieldValues: seed.fieldValues ?? [],
  }
  const updateCalls: { table: string; values: Row; matched: number }[] = []

  const rowsFor = (table: unknown): Row[] => {
    if (table === schema.EntityDefinition) return state.entityDefs as unknown as Row[]
    if (table === schema.CustomField) return state.customFields as unknown as Row[]
    if (table === schema.EntityInstance) return state.entityInstances as unknown as Row[]
    if (table === schema.FieldValue) return state.fieldValues as unknown as Row[]
    throw new Error('Unknown table in test stub')
  }
  const tableName = (table: unknown): string => {
    if (table === schema.EntityDefinition) return 'EntityDefinition'
    if (table === schema.CustomField) return 'CustomField'
    if (table === schema.EntityInstance) return 'EntityInstance'
    if (table === schema.FieldValue) return 'FieldValue'
    return 'unknown'
  }

  /** Find the array `inArray(FieldValue.id, ids)` was built with, wherever it sits in the tree. */
  const idsFromCondition = (cond: unknown): string[] => {
    const chunks = (cond as { queryChunks?: unknown[] } | null)?.queryChunks
    if (!Array.isArray(chunks)) return []
    if (chunks.length === 5) {
      const op = chunks[2] as { value?: unknown[] } | undefined
      if (Array.isArray(op?.value) && op.value[0] === ' in ' && Array.isArray(chunks[3])) {
        return chunks[3] as string[]
      }
    }
    for (const chunk of chunks) {
      const found = idsFromCondition(chunk)
      if (found.length > 0) return found
    }
    return []
  }

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(rowsFor(table)),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: (cond: unknown) => {
          const ids = idsFromCondition(cond)
          let matched = 0
          for (const row of rowsFor(table)) {
            if (ids.includes(row.id as string)) {
              Object.assign(row, values)
              matched++
            }
          }
          updateCalls.push({ table: tableName(table), values, matched })
          return Promise.resolve({ rowCount: matched })
        },
      }),
    }),
  }

  return { db: db as never, state, updateCalls }
}

const GL_ACCOUNT_DEF = 'def-gl_account'
const BANK_ACCOUNT_DEF = 'def-bank_account'
const BANK_TRANSACTION_DEF = 'def-bank_transaction'

const CODE_FIELD = 'field-gl_account_code'
const BANK_ACCOUNT_GL_FIELD = 'field-bank_account_gl_account'
const BANK_TX_GL_FIELD = 'field-bank_transaction_gl_account'
const BANK_TX_SUGGESTED_FIELD = 'field-bank_transaction_suggested_gl_account'

function baseDefs(): EntityDefRow[] {
  return [
    { id: GL_ACCOUNT_DEF, organizationId: ORG, entityType: 'gl_account' },
    { id: BANK_ACCOUNT_DEF, organizationId: ORG, entityType: 'bank_account' },
    { id: BANK_TRANSACTION_DEF, organizationId: ORG, entityType: 'bank_transaction' },
  ]
}

function baseFields(): CustomFieldRow[] {
  return [
    {
      id: CODE_FIELD,
      organizationId: ORG,
      entityDefinitionId: GL_ACCOUNT_DEF,
      systemAttribute: 'gl_account_code',
      options: {},
    },
    {
      id: BANK_ACCOUNT_GL_FIELD,
      organizationId: ORG,
      entityDefinitionId: BANK_ACCOUNT_DEF,
      systemAttribute: 'bank_account_gl_account',
      options: {},
    },
    {
      id: BANK_TX_GL_FIELD,
      organizationId: ORG,
      entityDefinitionId: BANK_TRANSACTION_DEF,
      systemAttribute: 'bank_transaction_gl_account',
      options: {},
    },
    {
      id: BANK_TX_SUGGESTED_FIELD,
      organizationId: ORG,
      entityDefinitionId: BANK_TRANSACTION_DEF,
      systemAttribute: 'bank_transaction_suggested_gl_account',
      options: {},
    },
  ]
}

beforeEach(() => {
  invalidateAndRecompute.mockClear()
})

describe('migration 143 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration143GlPointersHoldIds.id).toBe(MIGRATION_ID)
  })
})

describe('TARGET_FIELDS', () => {
  it('names exactly the six converted pairs', () => {
    expect(TARGET_FIELDS).toEqual([
      { entityType: 'bank_account', systemAttribute: 'bank_account_gl_account' },
      { entityType: 'bank_rule', systemAttribute: 'bank_rule_gl_account' },
      { entityType: 'bank_transaction', systemAttribute: 'bank_transaction_gl_account' },
      { entityType: 'bank_transaction', systemAttribute: 'bank_transaction_suggested_gl_account' },
      { entityType: 'vendor_bill_line', systemAttribute: 'vendor_bill_line_gl_account' },
      { entityType: 'bank_deposit', systemAttribute: 'bank_deposit_bank_account' },
    ])
  })

  // Corrected 2026-09-10: stock_movement.glAccount stores a G8 ROLE, not a
  // code (stock-movement-fields.ts:333-360), and is not converted.
  it('excludes stock_movement.glAccount', () => {
    expect(TARGET_FIELDS.some((f) => f.entityType === 'stock_movement')).toBe(false)
  })
})

describe('buildCodeIndex', () => {
  const CODE_FIELD_ID = 'fld_code'

  it('indexes a live account by its code', () => {
    const index = buildCodeIndex(
      [{ id: 'fv_1', fieldId: CODE_FIELD_ID, entityId: 'acct_1', valueText: '1000' }],
      CODE_FIELD_ID,
      new Set(['acct_1'])
    )
    expect(index.get('1000')).toEqual(['acct_1'])
  })

  it('excludes an archived account even though it carries the code', () => {
    const index = buildCodeIndex(
      [{ id: 'fv_1', fieldId: CODE_FIELD_ID, entityId: 'acct_archived', valueText: '1000' }],
      CODE_FIELD_ID,
      new Set() // nothing live
    )
    expect(index.has('1000')).toBe(false)
  })

  it('ignores rows on a different field', () => {
    const index = buildCodeIndex(
      [{ id: 'fv_1', fieldId: 'some_other_field', entityId: 'acct_1', valueText: '1000' }],
      CODE_FIELD_ID,
      new Set(['acct_1'])
    )
    expect(index.size).toBe(0)
  })

  it('collects two live accounts sharing one code, for the ambiguity check downstream', () => {
    const index = buildCodeIndex(
      [
        { id: 'fv_1', fieldId: CODE_FIELD_ID, entityId: 'acct_1', valueText: '1000' },
        { id: 'fv_2', fieldId: CODE_FIELD_ID, entityId: 'acct_2', valueText: '1000' },
      ],
      CODE_FIELD_ID,
      new Set(['acct_1', 'acct_2'])
    )
    expect(index.get('1000')).toEqual(['acct_1', 'acct_2'])
  })
})

describe('partitionPointerValues', () => {
  it('leaves a value alone that already looks like a gl_account id', () => {
    const result = partitionPointerValues(
      [{ id: 'fv_1', valueText: 'acct_1' }],
      new Map(),
      new Set(['acct_1'])
    )
    expect(result.alreadyIds).toBe(1)
    expect(result.convertGroups.size).toBe(0)
    expect(result.toNullIds).toEqual([])
  })

  it('converts a value that matches exactly one live code', () => {
    const result = partitionPointerValues(
      [{ id: 'fv_1', valueText: '1000' }],
      new Map([['1000', ['acct_1']]]),
      new Set()
    )
    expect(result.convertGroups.get('acct_1')).toEqual(['fv_1'])
    expect(result.toNullIds).toEqual([])
    expect(result.alreadyIds).toBe(0)
  })

  it('groups every row that resolves to the same account into one bulk conversion', () => {
    const result = partitionPointerValues(
      [
        { id: 'fv_1', valueText: '6100' },
        { id: 'fv_2', valueText: '6100' },
        { id: 'fv_3', valueText: '6100' },
      ],
      new Map([['6100', ['acct_office']]]),
      new Set()
    )
    expect(result.convertGroups.size).toBe(1)
    expect(result.convertGroups.get('acct_office')).toEqual(['fv_1', 'fv_2', 'fv_3'])
  })

  it('nulls a value with no matching code', () => {
    const result = partitionPointerValues(
      [{ id: 'fv_1', valueText: '9999' }],
      new Map([['1000', ['acct_1']]]),
      new Set()
    )
    expect(result.toNullIds).toEqual(['fv_1'])
    expect(result.convertGroups.size).toBe(0)
  })

  it('nulls a code shared by two live accounts rather than guessing', () => {
    const result = partitionPointerValues(
      [{ id: 'fv_1', valueText: '1000' }],
      new Map([['1000', ['acct_1', 'acct_2']]]),
      new Set()
    )
    expect(result.toNullIds).toEqual(['fv_1'])
    expect(result.convertGroups.size).toBe(0)
  })

  it('skips a null valueText defensively', () => {
    const result = partitionPointerValues([{ id: 'fv_1', valueText: null }], new Map(), new Set())
    expect(result.alreadyIds).toBe(0)
    expect(result.toNullIds).toEqual([])
    expect(result.convertGroups.size).toBe(0)
  })
})

describe('up() against a stub store', () => {
  it('reports alreadyUpToDate when none of the six fields are provisioned', async () => {
    const { db } = makeStore({})
    const result = await migration143GlPointersHoldIds.up(db, ORG)
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('converts a stored code to the one live account holding it', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields(),
      entityInstances: [
        { id: 'acct_1', organizationId: ORG, entityDefinitionId: GL_ACCOUNT_DEF, archivedAt: null },
      ],
      fieldValues: [
        {
          id: 'code_fv',
          organizationId: ORG,
          fieldId: CODE_FIELD,
          entityId: 'acct_1',
          valueText: '1000',
        },
        {
          id: 'ba_fv',
          organizationId: ORG,
          fieldId: BANK_ACCOUNT_GL_FIELD,
          entityId: 'bank_1',
          valueText: '1000',
        },
      ],
    })

    const result = await migration143GlPointersHoldIds.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(state.fieldValues.find((r) => r.id === 'ba_fv')?.valueText).toBe('acct_1')
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  // The ordinary case on the database this ships against: migration 142 wiped
  // every chart first, so every stored code resolves to nothing.
  it('nulls a stored code when the org has no chart to resolve it against', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields(),
      fieldValues: [
        {
          id: 'tx_fv',
          organizationId: ORG,
          fieldId: BANK_TX_GL_FIELD,
          entityId: 'txn_1',
          valueText: '6100',
        },
      ],
    })

    const result = await migration143GlPointersHoldIds.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(state.fieldValues.find((r) => r.id === 'tx_fv')?.valueText).toBeNull()
  })

  it('leaves an already-converted id alone, and a second run is a no-op', async () => {
    const seed = {
      entityDefs: baseDefs(),
      customFields: baseFields(),
      entityInstances: [
        { id: 'acct_1', organizationId: ORG, entityDefinitionId: GL_ACCOUNT_DEF, archivedAt: null },
      ],
      fieldValues: [
        {
          id: 'rule_fv',
          organizationId: ORG,
          fieldId: BANK_ACCOUNT_GL_FIELD,
          entityId: 'bank_1',
          valueText: 'acct_1',
        },
      ],
    }
    const { db, state } = makeStore(seed)

    const first = await migration143GlPointersHoldIds.up(db, ORG)
    expect(first.alreadyUpToDate).toBe(true)
    expect(state.fieldValues.find((r) => r.id === 'rule_fv')?.valueText).toBe('acct_1')

    const second = await migration143GlPointersHoldIds.up(db, ORG)
    expect(second.alreadyUpToDate).toBe(true)
  })

  it('excludes an archived account from code resolution, but still recognises its id', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields(),
      entityInstances: [
        {
          id: 'acct_archived',
          organizationId: ORG,
          entityDefinitionId: GL_ACCOUNT_DEF,
          archivedAt: new Date('2026-01-01'),
        },
      ],
      fieldValues: [
        {
          id: 'code_fv',
          organizationId: ORG,
          fieldId: CODE_FIELD,
          entityId: 'acct_archived',
          valueText: '1000',
        },
        // Still carries the CODE - the archived account cannot be resolved TO.
        {
          id: 'by_code_fv',
          organizationId: ORG,
          fieldId: BANK_ACCOUNT_GL_FIELD,
          entityId: 'bank_1',
          valueText: '1000',
        },
        // Already holds the archived account's ID - left alone.
        {
          id: 'by_id_fv',
          organizationId: ORG,
          fieldId: BANK_TX_GL_FIELD,
          entityId: 'txn_1',
          valueText: 'acct_archived',
        },
      ],
    })

    await migration143GlPointersHoldIds.up(db, ORG)

    expect(state.fieldValues.find((r) => r.id === 'by_code_fv')?.valueText).toBeNull()
    expect(state.fieldValues.find((r) => r.id === 'by_id_fv')?.valueText).toBe('acct_archived')
  })

  it('converts across more than one target field in the same run', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields(),
      entityInstances: [
        { id: 'acct_1', organizationId: ORG, entityDefinitionId: GL_ACCOUNT_DEF, archivedAt: null },
      ],
      fieldValues: [
        {
          id: 'code_fv',
          organizationId: ORG,
          fieldId: CODE_FIELD,
          entityId: 'acct_1',
          valueText: '4000',
        },
        {
          id: 'tx_fv',
          organizationId: ORG,
          fieldId: BANK_TX_GL_FIELD,
          entityId: 'txn_1',
          valueText: '4000',
        },
        {
          id: 'suggested_fv',
          organizationId: ORG,
          fieldId: BANK_TX_SUGGESTED_FIELD,
          entityId: 'txn_1',
          valueText: '4000',
        },
      ],
    })

    const result = await migration143GlPointersHoldIds.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(state.fieldValues.find((r) => r.id === 'tx_fv')?.valueText).toBe('acct_1')
    expect(state.fieldValues.find((r) => r.id === 'suggested_fv')?.valueText).toBe('acct_1')
  })

  it('issues one bulk UPDATE for a whole group, never one per row', async () => {
    const fieldValues: FieldValueRow[] = [
      {
        id: 'code_fv',
        organizationId: ORG,
        fieldId: CODE_FIELD,
        entityId: 'acct_1',
        valueText: '6100',
      },
    ]
    for (let i = 0; i < 25; i++) {
      fieldValues.push({
        id: `tx_fv_${i}`,
        organizationId: ORG,
        fieldId: BANK_TX_GL_FIELD,
        entityId: `txn_${i}`,
        valueText: '6100',
      })
    }
    const { db, state, updateCalls } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields(),
      entityInstances: [
        { id: 'acct_1', organizationId: ORG, entityDefinitionId: GL_ACCOUNT_DEF, archivedAt: null },
      ],
      fieldValues,
    })

    await migration143GlPointersHoldIds.up(db, ORG)

    // The 25 bank_transaction rows converted; the chart's own code row (on a
    // field this migration never writes) is untouched.
    expect(state.fieldValues.filter((r) => r.valueText === 'acct_1')).toHaveLength(25)
    expect(state.fieldValues.find((r) => r.id === 'code_fv')?.valueText).toBe('6100')
    // One UPDATE call converting the whole group of 25, not 25 calls.
    const conversionCalls = updateCalls.filter((c) => c.values.valueText === 'acct_1')
    expect(conversionCalls).toHaveLength(1)
    expect(conversionCalls[0]?.matched).toBe(25)
  })
})
