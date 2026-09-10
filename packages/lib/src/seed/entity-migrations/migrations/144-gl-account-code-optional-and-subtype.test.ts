// packages/lib/src/seed/entity-migrations/migrations/144-gl-account-code-optional-and-subtype.test.ts
//
// Migration 144 makes `gl_account_code` optional and backfills
// `gl_account.subtype` onto every existing COGS account. What is pinned here:
//
//  - registration: unique id, last in `ALL_ENTITY_MIGRATIONS`;
//  - `CustomField.required` flips to `false` on `gl_account_code` only when it
//    is still `true`, and a re-run is a no-op;
//  - `ensureCustomFields` creates `gl_account.subtype` when missing and skips
//    it when an earlier pass already created it;
//  - the backfill (`backfillCogsSubtype`, exercised through `up()` against a
//    stub `Database` modelled on `143-gl-pointers-hold-ids.test.ts`'s store -
//    fixed rows per table, real `inArray`/insert plumbing, `.where()`
//    otherwise unevaluated) stamps `cost_of_goods_sold` on a non-archived
//    `expense` account coded `5xxx`, and leaves alone: an account already
//    carrying a subtype, a non-expense account, an expense account coded
//    outside `5xxx`, and an archived `5xxx` expense account;
//  - a second run over a fully-migrated org reports `alreadyUpToDate`.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const { migration144GlAccountCodeOptionalAndSubtype } = await import(
  './144-gl-account-code-optional-and-subtype'
)
const { ALL_ENTITY_MIGRATIONS } = await import('../../entity-migrations')
const { GL_ACCOUNT_FIELDS } = await import(
  '../../../resources/registry/resources/gl-account-fields'
)

const MIGRATION_ID = '144-gl-account-code-optional-and-subtype'
const ORG = 'org_1'
const GL_ACCOUNT_DEF = 'def-gl_account'
const CODE_FIELD = 'field-gl_account_code'
const TYPE_FIELD = 'field-gl_account_type'
const SUBTYPE_FIELD = 'field-gl_account_subtype'

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
  required: boolean
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
  entityDefinitionId: string
  fieldId: string
  entityId: string
  valueText: string | null
  optionId: string | null
}

type Row = Record<string, unknown>

/**
 * An in-memory `Database`, modelled on `143-gl-pointers-hold-ids.test.ts`'s
 * `makeStore`: one fixed row set per table, `.where()` unevaluated for reads
 * (the caller already scoped the seed to the query under test), and a small
 * amount of real behaviour where the migration's own logic depends on it -
 * the `CustomField` update targets the row this migration actually targets
 * (`systemAttribute === 'gl_account_code' && required === true`), and both
 * inserts append to the store and hand back what `ensureCustomFields` and the
 * migration itself read back.
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

  const rowsFor = (table: unknown): Row[] => {
    if (table === schema.EntityDefinition) return state.entityDefs as unknown as Row[]
    if (table === schema.CustomField) return state.customFields as unknown as Row[]
    // The migration's only `EntityInstance` read is scoped to non-archived
    // rows (`isNull(archivedAt)`), and the archived-vs-live distinction is
    // exactly what this file tests - so, unlike every other table here, this
    // one filter is real rather than ignored.
    if (table === schema.EntityInstance) {
      return state.entityInstances.filter((row) => row.archivedAt == null) as unknown as Row[]
    }
    if (table === schema.FieldValue) return state.fieldValues as unknown as Row[]
    throw new Error('Unknown table in test stub')
  }

  let nextFieldId = 1
  let nextFieldValueId = 1

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(rowsFor(table)),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: () => {
          if (table !== schema.CustomField) throw new Error('unexpected update table')
          const matched = state.customFields.filter(
            (row) => row.systemAttribute === 'gl_account_code' && row.required === true
          )
          for (const row of matched) Object.assign(row, values)
          return {
            returning: async () => matched.map((row) => ({ id: row.id })),
          }
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Row | Row[]) => {
        if (table === schema.CustomField) {
          const created = { id: `new_field_${nextFieldId++}`, ...(v as Row) }
          state.customFields.push(created as unknown as CustomFieldRow)
          return { returning: async () => [created] }
        }
        if (table === schema.FieldValue) {
          const rows = (v as Row[]).map((row) => ({ id: `new_fv_${nextFieldValueId++}`, ...row }))
          state.fieldValues.push(...(rows as unknown as FieldValueRow[]))
          return Promise.resolve(undefined)
        }
        throw new Error('unexpected insert table')
      },
    }),
  }

  return { db: db as never, state }
}

function baseDefs(): EntityDefRow[] {
  return [{ id: GL_ACCOUNT_DEF, organizationId: ORG, entityType: 'gl_account' }]
}

function baseFields(opts: { codeRequired: boolean; withSubtype?: boolean }): CustomFieldRow[] {
  const fields: CustomFieldRow[] = [
    {
      id: CODE_FIELD,
      organizationId: ORG,
      entityDefinitionId: GL_ACCOUNT_DEF,
      systemAttribute: 'gl_account_code',
      options: {},
      required: opts.codeRequired,
    },
    {
      id: TYPE_FIELD,
      organizationId: ORG,
      entityDefinitionId: GL_ACCOUNT_DEF,
      systemAttribute: 'gl_account_type',
      options: {},
      required: true,
    },
  ]
  if (opts.withSubtype) {
    fields.push({
      id: SUBTYPE_FIELD,
      organizationId: ORG,
      entityDefinitionId: GL_ACCOUNT_DEF,
      systemAttribute: 'gl_account_subtype',
      options: {},
      required: false,
    })
  }
  return fields
}

function account(id: string, opts: { archived?: boolean } = {}): EntityInstanceRow {
  return {
    id,
    organizationId: ORG,
    entityDefinitionId: GL_ACCOUNT_DEF,
    archivedAt: opts.archived ? new Date('2026-01-01') : null,
  }
}

function typeValue(entityId: string, optionId: string): FieldValueRow {
  return {
    id: `type_${entityId}`,
    organizationId: ORG,
    entityDefinitionId: GL_ACCOUNT_DEF,
    fieldId: TYPE_FIELD,
    entityId,
    valueText: null,
    optionId,
  }
}

function codeValue(entityId: string, code: string): FieldValueRow {
  return {
    id: `code_${entityId}`,
    organizationId: ORG,
    entityDefinitionId: GL_ACCOUNT_DEF,
    fieldId: CODE_FIELD,
    entityId,
    valueText: code,
    optionId: null,
  }
}

function subtypeValue(entityId: string, optionId: string): FieldValueRow {
  return {
    id: `subtype_${entityId}`,
    organizationId: ORG,
    entityDefinitionId: GL_ACCOUNT_DEF,
    fieldId: SUBTYPE_FIELD,
    entityId,
    valueText: null,
    optionId,
  }
}

beforeEach(() => {
  invalidateAndRecompute.mockClear()
})

describe('migration 144 registration', () => {
  it('is registered exactly once, with a unique id, after 143', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('143-gl-pointers-hold-ids'))
    expect(migration144GlAccountCodeOptionalAndSubtype.id).toBe(MIGRATION_ID)
  })
})

describe('the subtype field in the registry', () => {
  it('exists, is nullable, and carries the eight subtypes as options', () => {
    const field = GL_ACCOUNT_FIELDS.subtype
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('gl_account_subtype')
    expect(field?.nullable).toBe(true)
    expect(field?.capabilities?.required).toBe(false)
    expect((field?.options?.options as unknown[] | undefined)?.length).toBe(8)
  })
})

describe('up() against a stub store', () => {
  it('is a no-op when the org has no gl_account def', async () => {
    const { db } = makeStore({})
    const result = await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('relaxes a required gl_account_code and creates the subtype field', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: true }),
      entityInstances: [],
      fieldValues: [],
    })

    const result = await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(state.customFields.find((f) => f.id === CODE_FIELD)?.required).toBe(false)
    const created = state.customFields.find((f) => f.systemAttribute === 'gl_account_subtype')
    expect(created).toBeDefined()
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('backfills cost_of_goods_sold onto a non-archived 5xxx expense account with no subtype yet', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: false, withSubtype: true }),
      entityInstances: [account('acct_5000')],
      fieldValues: [typeValue('acct_5000', 'expense'), codeValue('acct_5000', '5000')],
    })

    const result = await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    const written = state.fieldValues.find(
      (fv) => fv.entityId === 'acct_5000' && fv.fieldId === SUBTYPE_FIELD
    )
    expect(written?.optionId).toBe('cost_of_goods_sold')
  })

  it('leaves a non-expense account alone even when coded 5xxx', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: false, withSubtype: true }),
      entityInstances: [account('acct_5500')],
      fieldValues: [typeValue('acct_5500', 'asset'), codeValue('acct_5500', '5500')],
    })

    await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)

    expect(
      state.fieldValues.some((fv) => fv.entityId === 'acct_5500' && fv.fieldId === SUBTYPE_FIELD)
    ).toBe(false)
  })

  it('leaves an expense account outside 5xxx alone', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: false, withSubtype: true }),
      entityInstances: [account('acct_6100')],
      fieldValues: [typeValue('acct_6100', 'expense'), codeValue('acct_6100', '6100')],
    })

    await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)

    expect(
      state.fieldValues.some((fv) => fv.entityId === 'acct_6100' && fv.fieldId === SUBTYPE_FIELD)
    ).toBe(false)
  })

  it('leaves an archived 5xxx expense account alone', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: false, withSubtype: true }),
      entityInstances: [account('acct_5001', { archived: true })],
      fieldValues: [typeValue('acct_5001', 'expense'), codeValue('acct_5001', '5001')],
    })

    await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)

    expect(
      state.fieldValues.some((fv) => fv.entityId === 'acct_5001' && fv.fieldId === SUBTYPE_FIELD)
    ).toBe(false)
  })

  it('never overwrites a subtype the account already carries', async () => {
    const { db, state } = makeStore({
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: false, withSubtype: true }),
      entityInstances: [account('acct_5000')],
      fieldValues: [
        typeValue('acct_5000', 'expense'),
        codeValue('acct_5000', '5000'),
        subtypeValue('acct_5000', 'other'),
      ],
    })

    const result = await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(
      state.fieldValues.find((fv) => fv.entityId === 'acct_5000' && fv.fieldId === SUBTYPE_FIELD)
        ?.optionId
    ).toBe('other')
  })

  it('reports alreadyUpToDate and touches nothing on a second run', async () => {
    const seed = {
      entityDefs: baseDefs(),
      customFields: baseFields({ codeRequired: false, withSubtype: true }),
      entityInstances: [account('acct_5000')],
      fieldValues: [typeValue('acct_5000', 'expense'), codeValue('acct_5000', '5000')],
    }
    const { db, state } = makeStore(seed)

    const first = await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)
    expect(first.alreadyUpToDate).toBe(false)

    invalidateAndRecompute.mockClear()
    const second = await migration144GlAccountCodeOptionalAndSubtype.up(db, ORG)
    expect(second.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
    expect(state.fieldValues.filter((fv) => fv.fieldId === SUBTYPE_FIELD)).toHaveLength(1)
  })
})
