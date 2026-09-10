// packages/lib/src/seed/entity-migrations/migrations/145-retire-instance-roles.test.ts
//
// Migration 145 retires `cash` and `revenue_dealer` as roles, moves
// `revenue_dtc` onto `revenue_product`, renames "Payroll Clearing (ADP)" to
// "Payroll Clearing", and provisions the three new fields brief 13 §2/§5
// reads. What is pinned here:
//
//  - registration: unique id, between 144 and 146;
//  - `cash` and `revenue_dealer` GlRoleAssignment rows are deleted, an
//    unrelated role is left alone;
//  - `revenue_dtc` moves onto `revenue_product` in place when no
//    `revenue_product` row exists yet, and is deleted instead when one
//    already does (the unique-index collision `132`'s `moveRole` guards
//    against);
//  - the `gl_account` named EXACTLY "Payroll Clearing (ADP)" is renamed to
//    "Payroll Clearing", and an account a bookkeeper already renamed is left
//    alone;
//  - `bank_account.stripeExternalAccountId` and `payout.destination` /
//    `payout.blockedReason` are created when missing and skipped when an
//    earlier pass already created them;
//  - a second run over a fully-migrated org reports `alreadyUpToDate`.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const { migration145RetireInstanceRoles } = await import('./145-retire-instance-roles')
const { ALL_ENTITY_MIGRATIONS } = await import('../../entity-migrations')

const MIGRATION_ID = '145-retire-instance-roles'
const ORG = 'org_1'

const GL_ACCOUNT_DEF = 'def-gl_account'
const BANK_ACCOUNT_DEF = 'def-bank_account'
const PAYOUT_DEF = 'def-payout'

const NAME_FIELD = 'field-gl_account_name'
const BANK_STRIPE_FIELD = 'field-bank_account_stripe_external_account_id'
const PAYOUT_DESTINATION_FIELD = 'field-payout_destination'
const PAYOUT_BLOCKED_REASON_FIELD = 'field-payout_blocked_reason'

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
interface RoleAssignmentRow {
  id: string
  organizationId: string
  role: string
  glAccountId: string
}
interface FieldValueRow {
  id: string
  organizationId: string
  entityDefinitionId: string
  fieldId: string
  entityId: string
  valueText: string | null
}

type Row = Record<string, unknown>

/** Every scalar the module put into a `where` clause, flattened. See role-map.test.ts. */
function whereValues(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) whereValues(child, out, depth + 1)
    return out
  }
  const obj = node as Record<string, unknown>
  if ('value' in obj) whereValues(obj.value, out, depth + 1)
  if (Array.isArray(obj.queryChunks)) whereValues(obj.queryChunks, out, depth + 1)
  return out
}

/**
 * An in-memory `Database`, modelled on `144-gl-account-code-optional-and-
 * subtype.test.ts`'s `makeStore`: `EntityDefinition` and `CustomField` are
 * whole-table-for-org reads (`loadExistingState`'s own shape, unfiltered by
 * anything but org). `GlRoleAssignment` and `FieldValue` are filtered for
 * real, by `id` or by `(organizationId, role)` / `(organizationId, fieldId,
 * entityId-or-valueText)` respectively - this migration issues several
 * distinct queries against each of those two tables in one run, and an
 * unfiltered stub would let one answer leak into another.
 */
function makeStore(seed: {
  entityDefs?: EntityDefRow[]
  customFields?: CustomFieldRow[]
  roleAssignments?: RoleAssignmentRow[]
  fieldValues?: FieldValueRow[]
}) {
  const state = {
    entityDefs: seed.entityDefs ?? [],
    customFields: seed.customFields ?? [],
    roleAssignments: seed.roleAssignments ?? [],
    fieldValues: seed.fieldValues ?? [],
  }
  let nextCustomFieldId = 1

  const matchesRole = (r: RoleAssignmentRow, params: string[]) =>
    params.includes(r.id) || (params.includes(r.organizationId) && params.includes(r.role))

  const matchesFieldValue = (fv: FieldValueRow, params: string[]) =>
    params.includes(fv.id) ||
    (params.includes(fv.organizationId) &&
      params.includes(fv.fieldId) &&
      (params.includes(fv.entityId) || (fv.valueText != null && params.includes(fv.valueText))))

  const rowsFor = (table: unknown, params: string[]): Row[] => {
    if (table === schema.EntityDefinition) {
      return state.entityDefs.filter((d) => params.includes(d.organizationId)) as unknown as Row[]
    }
    if (table === schema.CustomField) {
      return state.customFields.filter((f) => params.includes(f.organizationId)) as unknown as Row[]
    }
    if (table === schema.GlRoleAssignment) {
      return state.roleAssignments.filter((r) => matchesRole(r, params)) as unknown as Row[]
    }
    if (table === schema.FieldValue) {
      return state.fieldValues.filter((fv) => matchesFieldValue(fv, params)) as unknown as Row[]
    }
    throw new Error('Unknown table in test stub')
  }

  /** Awaitable directly, and also `.returning()`-able - the migration uses both shapes. */
  function awaitableReturning(matched: Row[]) {
    return {
      returning: async () => matched.map((row) => ({ id: row.id })),
      // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve, reject),
    }
  }

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => {
        let params: string[] = []
        const chain: any = {
          where: (cond: unknown) => {
            params = whereValues(cond)
            return chain
          },
          limit: () => chain,
          // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(rowsFor(table, params)).then(resolve, reject),
        }
        return chain
      },
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const params = whereValues(cond)
        const matched = rowsFor(table, params)
        if (table === schema.GlRoleAssignment) {
          const ids = new Set(matched.map((r) => r.id))
          state.roleAssignments = state.roleAssignments.filter((r) => !ids.has(r.id))
        }
        return awaitableReturning(matched)
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: (cond: unknown) => {
          const params = whereValues(cond)
          const matched = rowsFor(table, params)
          for (const row of matched) Object.assign(row, values)
          return awaitableReturning(matched)
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Row) => {
        if (table !== schema.CustomField) throw new Error('unexpected insert table')
        const created = { id: `new_field_${nextCustomFieldId++}`, organizationId: ORG, ...v }
        state.customFields.push(created as unknown as CustomFieldRow)
        return { returning: async () => [created] }
      },
    }),
  }

  return { db: db as never, state }
}

function role(r: string, glAccountId: string): RoleAssignmentRow {
  return { id: `assign_${r}`, organizationId: ORG, role: r, glAccountId }
}

function nameField(): CustomFieldRow {
  return {
    id: NAME_FIELD,
    organizationId: ORG,
    entityDefinitionId: GL_ACCOUNT_DEF,
    systemAttribute: 'gl_account_name',
    options: {},
  }
}

function nameValue(entityId: string, name: string): FieldValueRow {
  return {
    id: `name_${entityId}`,
    organizationId: ORG,
    entityDefinitionId: GL_ACCOUNT_DEF,
    fieldId: NAME_FIELD,
    entityId,
    valueText: name,
  }
}

function bankStripeField(): CustomFieldRow {
  return {
    id: BANK_STRIPE_FIELD,
    organizationId: ORG,
    entityDefinitionId: BANK_ACCOUNT_DEF,
    systemAttribute: 'bank_account_stripe_external_account_id',
    options: {},
  }
}

function payoutFields(): CustomFieldRow[] {
  return [
    {
      id: PAYOUT_DESTINATION_FIELD,
      organizationId: ORG,
      entityDefinitionId: PAYOUT_DEF,
      systemAttribute: 'payout_destination',
      options: {},
    },
    {
      id: PAYOUT_BLOCKED_REASON_FIELD,
      organizationId: ORG,
      entityDefinitionId: PAYOUT_DEF,
      systemAttribute: 'payout_blocked_reason',
      options: {},
    },
  ]
}

beforeEach(() => {
  invalidateAndRecompute.mockClear()
})

describe('migration 145 registration', () => {
  it('is registered exactly once, with a unique id, between 144 and 146', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf('144-gl-account-code-optional-and-subtype')
    )
    expect(ids.indexOf(MIGRATION_ID)).toBeLessThan(ids.indexOf('146-payment-gateway'))
    expect(migration145RetireInstanceRoles.id).toBe(MIGRATION_ID)
  })
})

describe('up() against a stub store', () => {
  it('is a no-op over an org with nothing to change', async () => {
    const { db } = makeStore({ entityDefs: [], customFields: [], roleAssignments: [] })
    const result = await migration145RetireInstanceRoles.up(db, ORG)
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('deletes cash and revenue_dealer, leaving an unrelated role alone', async () => {
    const { db, state } = makeStore({
      roleAssignments: [
        role('cash', 'acct_1000'),
        role('revenue_dealer', 'acct_4000'),
        role('grni', 'acct_2160'),
      ],
    })

    const result = await migration145RetireInstanceRoles.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(state.roleAssignments.map((r) => r.role).sort()).toEqual(['grni'])
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['resources', 'customFields'])
  })

  it('moves revenue_dtc onto revenue_product, keeping the same account', async () => {
    const { db, state } = makeStore({
      roleAssignments: [role('revenue_dtc', 'acct_4000')],
    })

    await migration145RetireInstanceRoles.up(db, ORG)

    expect(state.roleAssignments).toHaveLength(1)
    expect(state.roleAssignments[0]).toMatchObject({
      role: 'revenue_product',
      glAccountId: 'acct_4000',
    })
  })

  it('deletes the stale revenue_dtc row rather than colliding when revenue_product already exists', async () => {
    const { db, state } = makeStore({
      roleAssignments: [role('revenue_dtc', 'acct_old'), role('revenue_product', 'acct_new')],
    })

    await migration145RetireInstanceRoles.up(db, ORG)

    expect(state.roleAssignments).toHaveLength(1)
    expect(state.roleAssignments[0]).toMatchObject({
      role: 'revenue_product',
      glAccountId: 'acct_new',
    })
  })

  it('renames "Payroll Clearing (ADP)" to "Payroll Clearing"', async () => {
    const { db, state } = makeStore({
      entityDefs: [{ id: GL_ACCOUNT_DEF, organizationId: ORG, entityType: 'gl_account' }],
      customFields: [nameField()],
      fieldValues: [nameValue('acct_2110', 'Payroll Clearing (ADP)')],
    })

    const result = await migration145RetireInstanceRoles.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(state.fieldValues.find((fv) => fv.entityId === 'acct_2110')?.valueText).toBe(
      'Payroll Clearing'
    )
  })

  it('leaves an account a bookkeeper already renamed untouched', async () => {
    const { db, state } = makeStore({
      entityDefs: [{ id: GL_ACCOUNT_DEF, organizationId: ORG, entityType: 'gl_account' }],
      customFields: [nameField()],
      fieldValues: [nameValue('acct_2110', 'Payroll (renamed by us)')],
    })

    const result = await migration145RetireInstanceRoles.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(state.fieldValues[0]?.valueText).toBe('Payroll (renamed by us)')
  })

  it('creates the three new fields when the defs exist and the fields do not', async () => {
    const { db, state } = makeStore({
      entityDefs: [
        { id: BANK_ACCOUNT_DEF, organizationId: ORG, entityType: 'bank_account' },
        { id: PAYOUT_DEF, organizationId: ORG, entityType: 'payout' },
      ],
      customFields: [],
    })

    const result = await migration145RetireInstanceRoles.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(result.fieldsCreated).toBe(3)
    expect(
      state.customFields.find(
        (f) => f.systemAttribute === 'bank_account_stripe_external_account_id'
      )
    ).toBeDefined()
    expect(state.customFields.find((f) => f.systemAttribute === 'payout_destination')).toBeDefined()
    expect(
      state.customFields.find((f) => f.systemAttribute === 'payout_blocked_reason')
    ).toBeDefined()
  })

  it('is a no-op on the fields when a def does not exist yet', async () => {
    const { db, state } = makeStore({ entityDefs: [], customFields: [] })
    const result = await migration145RetireInstanceRoles.up(db, ORG)
    expect(result.fieldsCreated).toBe(0)
    expect(state.customFields).toHaveLength(0)
  })

  it('is idempotent: a second run over a fully-migrated org reports alreadyUpToDate', async () => {
    const { db } = makeStore({
      entityDefs: [
        { id: GL_ACCOUNT_DEF, organizationId: ORG, entityType: 'gl_account' },
        { id: BANK_ACCOUNT_DEF, organizationId: ORG, entityType: 'bank_account' },
        { id: PAYOUT_DEF, organizationId: ORG, entityType: 'payout' },
      ],
      customFields: [nameField(), bankStripeField(), ...payoutFields()],
      roleAssignments: [role('grni', 'acct_2160'), role('revenue_product', 'acct_4000')],
      fieldValues: [nameValue('acct_2110', 'Payroll Clearing')],
    })

    const result = await migration145RetireInstanceRoles.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('runs every change together and reports it once', async () => {
    const { db, state } = makeStore({
      entityDefs: [
        { id: GL_ACCOUNT_DEF, organizationId: ORG, entityType: 'gl_account' },
        { id: BANK_ACCOUNT_DEF, organizationId: ORG, entityType: 'bank_account' },
        { id: PAYOUT_DEF, organizationId: ORG, entityType: 'payout' },
      ],
      customFields: [nameField()],
      roleAssignments: [role('cash', 'acct_1000'), role('revenue_dtc', 'acct_4000')],
      fieldValues: [nameValue('acct_2110', 'Payroll Clearing (ADP)')],
    })

    const result = await migration145RetireInstanceRoles.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(result.fieldsCreated).toBe(3)
    expect(state.roleAssignments.map((r) => r.role).sort()).toEqual(['revenue_product'])
    expect(state.fieldValues.find((fv) => fv.entityId === 'acct_2110')?.valueText).toBe(
      'Payroll Clearing'
    )
    expect(invalidateAndRecompute).toHaveBeenCalledTimes(1)
  })
})
