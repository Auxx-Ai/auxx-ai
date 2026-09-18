// packages/lib/src/accounting/ledger/chart/__tests__/chart-write.test.ts
//
// One property carries this file, and it is the reason `chart-write.ts` exists
// at all:
//
// 🛑 **`mapRole` validates the pair (role, account) from the ROLE's side. Every
// one of its checks is bypassable from the ACCOUNT's side.** Map `grni` to a
// liability account, then retype that account to `revenue`: two legal-looking
// writes, and the entry that results still BALANCES, so nothing downstream can
// detect it. The tests below induce exactly that, and the deactivate and remove
// variants of it, rather than asserting against a switch statement.
//
// The second property is narrower but has a body count: a write whose field the
// crud handler cannot resolve is DROPPED SILENTLY - the failure that once wrote
// 784 accounts across 28 orgs with the one field that mattered missing, and
// logged success. `readBack` is the guard, and it gets a test.
//
// The database is a hand-written stub rather than a mock chain, for the reason
// `role-map.test.ts` gives: this module reads three different tables and each has
// to answer differently. Tables are identified by REFERENCE (`src/test/setup.ts`
// memoizes `schema.*`) and filters are applied by the stub out of the parameters
// the module actually passed.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotFoundError,
  UniqueValueConflictError,
  UnprocessableEntityError,
} from '../../../../errors'

const h = vi.hoisted(() => ({
  /** systemAttribute -> the CustomField row, or absent to model an unmigrated org. */
  fields: new Map<string, { id: string; entityDefinitionId: string | null }>(),
  /** What each handler call did, and what the next one should throw. */
  creates: [] as { defId: string; values: Record<string, unknown> }[],
  updates: [] as { recordId: string; values: Record<string, unknown> }[],
  archives: [] as string[],
  restores: [] as string[],
  deletes: [] as string[],
  /** Set to make the next create/update throw. */
  writeError: null as Error | null,
  /** The instance id `create` hands back. */
  createdId: 'acct_new',
  /**
   * What `findGlAccountPointers` (the I4 guard) finds. Empty by default: the
   * ROLE cases below are about roles, and a fixture that silently carried a
   * payment gateway would be testing the wrong refusal.
   */
  pointers: [] as { attribute: string; entityId: string; glAccountId: string }[],
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.get(a) ?? null])),
    }),
  }),
}))

vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      if (h.writeError) throw h.writeError
      h.creates.push({ defId, values })
      return { instance: { id: h.createdId }, recordId: `${defId}:${h.createdId}`, values }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      if (h.writeError) throw h.writeError
      h.updates.push({ recordId, values })
      return { values }
    }
    async archive(recordId: string) {
      h.archives.push(recordId)
    }
    async restore(recordId: string) {
      h.restores.push(recordId)
    }
    async delete(recordId: string) {
      h.deletes.push(recordId)
    }
  },
}))

import {
  createChartAccount,
  removeChartAccount,
  restoreChartAccount,
  updateChartAccount,
} from '../chart-write'

const ORG = 'org_1'
const OTHER_ORG = 'org_2'
const DEF = 'def_gl_account'

const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'
const PARENT_FIELD = 'fld_parent'

const USER = 'usr_bookkeeper'

interface Account {
  id: string
  organizationId?: string
  code?: string
  name?: string
  accountType?: string
  isActive?: boolean
  /** Archived rows are excluded by the query, so this models "not returned". */
  archived?: boolean
  /** CHART-HIERARCHY §4: the parent's instance id, or absent for top level. */
  parentId?: string
}

/** Adds `gl_account_parent` to the field map - most hierarchy tests opt in. */
function provisionParentField(): void {
  h.fields.set('gl_account_parent', { id: PARENT_FIELD, entityDefinitionId: DEF })
}

interface Assignment {
  role: string
  glAccountId: string
  organizationId?: string
  markedUnused?: boolean
}

/** Every scalar the module put into a `where` clause, flattened. */
function whereValues(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || node === null || node === undefined) return out
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
 * A stub answering the three reads by table.
 *
 * `markedUnused` is filtered HERE rather than through `params`, because the real
 * query compares it against a boolean and only strings survive `whereValues`.
 * That is the same modelling `role-map.test.ts` uses for `archivedAt IS NULL`,
 * and it is what makes "the role was marked unused" a real test rather than a
 * fixture returning what it was told to.
 */
function stubDb(accounts: Account[], assignments: Assignment[] = []): Database {
  // A create fixture seeds the row the create is ABOUT to write, so `readBack`
  // can find it afterwards. That row must not be visible BEFORE the write, or
  // `assertCodeIsFree` sees the account colliding with its own future self.
  // The stub cannot model time in general; it only has to model this one edge,
  // and `h.creates` is exactly the signal for it.
  const notYetCreated = (a: Account) => a.id === h.createdId && h.creates.length === 0
  const liveAccounts = () =>
    accounts.filter((a) => !a.archived && (a.organizationId ?? ORG) === ORG && !notYetCreated(a))
  // Archived-INCLUSIVE, matching production: `readChartAccountValues` is a bare
  // `FieldValue` read with no join to `EntityInstance`, so liveness is always a
  // SEPARATE query (`liveAccounts()` above) layered on top by the caller - see
  // `loadLiveAccount` and `assertParentNotArchived`'s two-step read.
  const allFieldValues = () =>
    accounts
      .filter((a) => (a.organizationId ?? ORG) === ORG && !notYetCreated(a))
      .flatMap((account) => {
        const rows: Record<string, unknown>[] = []
        if (account.code !== undefined) {
          rows.push({ entityId: account.id, fieldId: CODE_FIELD, valueText: account.code })
        }
        if (account.name !== undefined) {
          rows.push({ entityId: account.id, fieldId: NAME_FIELD, valueText: account.name })
        }
        if (account.accountType !== undefined) {
          rows.push({ entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType })
        }
        if (account.isActive !== undefined) {
          rows.push({ entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: account.isActive })
        }
        if (account.parentId !== undefined) {
          rows.push({
            entityId: account.id,
            fieldId: PARENT_FIELD,
            relatedEntityId: account.parentId,
          })
        }
        return rows
      })

  // `findGlAccountPointers` (the I4 guard) reads the org's pointer fields, then
  // their values. `h.pointers` models both; empty means no TEXT pointer at all,
  // which is the right default here - these cases are about ROLES.
  const pointerFieldId = (attribute: string) => `pointer_field_${attribute}`
  const pointerFields = () =>
    [...new Set(h.pointers.map((p) => p.attribute))].map((attribute) => ({
      id: pointerFieldId(attribute),
      attribute,
    }))

  const rowsFor = (table: unknown, params: string[]): unknown[] => {
    if (table === schema.CustomField) return pointerFields()
    if (params.some((p) => p.startsWith('pointer_field_'))) {
      return h.pointers.map((p) => ({
        fieldId: pointerFieldId(p.attribute),
        entityId: p.entityId,
        glAccountId: p.glAccountId,
      }))
    }
    if (table === schema.GlRoleAssignment) {
      // `liveRolesFor` reads the whole org through `readRoleAssignments`
      // (task 58 §4.9) and filters by account id and `markedUnused` itself, so
      // the stub returns every row for the org rather than pre-filtering.
      return assignments
        .filter((a) => params.includes(a.organizationId ?? ORG))
        .map((a) => ({
          role: a.role,
          glAccountId: a.glAccountId,
          markedUnused: a.markedUnused ?? false,
          sourceAccountId: null,
          paymentGatewayId: null,
          currency: null,
          source: 'human',
          confirmedAt: null,
        }))
    }
    if (table === schema.EntityInstance) {
      // `loadLiveChart` (assertParentAllowed's cycle/depth checks) reads EVERY
      // live account of the def, with no id filter at all - `entityDefinitionId`
      // in its `where` is what distinguishes it from every id-keyed lookup below,
      // none of which filter on the def.
      if (params.includes(DEF)) {
        return liveAccounts().map((a) => ({ id: a.id }))
      }
      return liveAccounts()
        .filter((a) => params.includes(a.organizationId ?? ORG) && params.includes(a.id))
        .map((a) => ({ id: a.id }))
    }
    // `assertCodeIsFree` looks a code UP rather than reading rows for known ids,
    // so its where-params are (org, codeFieldId, code) with no entityId at all.
    // `readChartAccountValues` also carries CODE_FIELD, but alongside the other
    // three field ids - so the absence of NAME_FIELD is what tells them apart.
    if (params.includes(CODE_FIELD) && !params.includes(NAME_FIELD)) {
      return allFieldValues().filter(
        (row) => row.fieldId === CODE_FIELD && params.includes(row.valueText as string)
      )
    }
    // `findLiveChildren` looks up who points AT an account - where-params are
    // (org, PARENT_FIELD, accountId), no NAME_FIELD, same trick as the code
    // lookup above.
    if (params.includes(PARENT_FIELD) && !params.includes(NAME_FIELD)) {
      return allFieldValues().filter(
        (row) => row.fieldId === PARENT_FIELD && params.includes(row.relatedEntityId as string)
      )
    }
    return allFieldValues().filter((row) => params.includes(row.entityId as string))
  }

  return {
    select: () => ({
      from: (table: unknown) => {
        let params: string[] = []
        const chain: any = {
          where: (condition: unknown) => {
            params = whereValues(condition)
            return chain
          },
          limit: () => chain,
          orderBy: () => chain,
          groupBy: () => chain,
          // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(rowsFor(table, params)).then(resolve, reject),
        }
        return chain
      },
    }),
  } as unknown as Database
}

const GRNI_ACCOUNT: Account = {
  id: 'acct_grni',
  code: '2160',
  name: 'Goods Received Not Invoiced',
  accountType: 'liability',
  isActive: true,
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', { id: CODE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_name', { id: NAME_FIELD, entityDefinitionId: DEF }],
    ['gl_account_type', { id: TYPE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_is_active', { id: ACTIVE_FIELD, entityDefinitionId: DEF }],
  ])
  h.creates = []
  h.updates = []
  h.archives = []
  h.restores = []
  h.deletes = []
  h.writeError = null
  h.createdId = 'acct_new'
  h.pointers = []
})

// ─────────────────────────────────────────────────────────────────────────────

describe('createChartAccount', () => {
  it('writes every attribute and returns the row as the list renders it', async () => {
    h.createdId = 'acct_6410'
    const db = stubDb([
      {
        id: 'acct_6410',
        code: '6410',
        name: 'Office Supplies',
        accountType: 'expense',
        isActive: true,
      },
    ])

    const row = (
      await createChartAccount(db, {
        organizationId: ORG,
        code: '6410',
        name: 'Office Supplies',
        accountType: 'expense',
        actorUserId: USER,
      })
    )._unsafeUnwrap()

    expect(h.creates).toHaveLength(1)
    expect(h.creates[0]).toEqual({
      defId: DEF,
      values: {
        gl_account_code: '6410',
        gl_account_name: 'Office Supplies',
        gl_account_type: 'expense',
        // Defaulted, matching the field's registry default.
        gl_account_is_active: true,
        // Defaulted when no subtype is given.
        gl_account_subtype: null,
      },
    })
    expect(row).toEqual({
      id: 'acct_6410',
      code: '6410',
      name: 'Office Supplies',
      accountType: 'expense',
      isActive: true,
      subtype: null,
      parentId: null,
    })
  })

  // 🛑 Task 15 §5's own regression: `code` used to be a third requirement and
  // is not one any longer. A chart imported from a provider that ships with
  // numbering off, or a person who keeps a chart by name alone, needs this.
  it('creates an account with no code at all', async () => {
    h.createdId = 'acct_imported'
    const db = stubDb([
      { id: 'acct_imported', name: 'Sales:Product Income', accountType: 'revenue' },
    ])

    const row = (
      await createChartAccount(db, {
        organizationId: ORG,
        name: 'Sales:Product Income',
        accountType: 'revenue',
        actorUserId: USER,
      })
    )._unsafeUnwrap()

    expect(h.creates[0]?.values.gl_account_code).toBeNull()
    expect(row.code).toBeNull()
  })

  // A blank string means the same thing as omitting `code` entirely.
  it('treats a whitespace-only code the same as no code, rather than refusing', async () => {
    h.createdId = 'acct_blank_code'
    const db = stubDb([{ id: 'acct_blank_code', name: 'Office Supplies', accountType: 'expense' }])

    const result = await createChartAccount(db, {
      organizationId: ORG,
      code: '   ',
      name: 'Office Supplies',
      accountType: 'expense',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.creates[0]?.values.gl_account_code).toBeNull()
  })

  it('writes a subtype when one is given', async () => {
    h.createdId = 'acct_cogs'
    const db = stubDb([
      { id: 'acct_cogs', code: '5100', name: 'Product Cost', accountType: 'expense' },
    ])

    await createChartAccount(db, {
      organizationId: ORG,
      code: '5100',
      name: 'Product Cost',
      accountType: 'expense',
      subtype: 'cost_of_goods_sold',
      actorUserId: USER,
    })

    expect(h.creates[0]?.values.gl_account_subtype).toBe('cost_of_goods_sold')
  })

  it('refuses a blank name without touching the handler', async () => {
    const result = await createChartAccount(stubDb([]), {
      organizationId: ORG,
      code: '6410',
      name: '   ',
      accountType: 'expense',
      actorUserId: USER,
    })

    expect(result._unsafeUnwrapErr().message).toBe('An account needs a name.')
    expect(h.creates).toHaveLength(0)
  })

  it('trims the code and the name before writing', async () => {
    h.createdId = 'acct_6410'
    const db = stubDb([
      {
        id: 'acct_6410',
        code: '6410',
        name: 'Office Supplies',
        accountType: 'expense',
        isActive: true,
      },
    ])

    await createChartAccount(db, {
      organizationId: ORG,
      code: '  6410  ',
      name: '  Office Supplies  ',
      accountType: 'expense',
      actorUserId: USER,
    })

    expect(h.creates[0]?.values.gl_account_code).toBe('6410')
    expect(h.creates[0]?.values.gl_account_name).toBe('Office Supplies')
  })

  // 🛑 I4. `validateUniqueFields` says "Code must be unique: value already
  // exists", and only the MESSAGE crosses tRPC. The code that collided is the
  // whole of what the person needs.
  it('re-messages a unique-code conflict so it names the code', async () => {
    h.writeError = new UniqueValueConflictError({
      message: 'Code must be unique: value already exists',
      conflictingValue: '1310',
      fieldId: CODE_FIELD,
    })

    const error = (
      await createChartAccount(stubDb([]), {
        organizationId: ORG,
        code: '1310',
        name: 'Raw Materials',
        accountType: 'asset',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UniqueValueConflictError)
    expect(error.message).toBe('1310 is already in use by another account in this chart.')
  })

  // ⚠️ The silent-drop guard. A create whose `gl_account_type` never landed
  // decodes as malformed and VANISHES from the list it was just created in.
  it('refuses when the written account cannot be read back with a code and a type', async () => {
    h.createdId = 'acct_broken'
    // The instance exists but carries no type - exactly what a dropped value
    // looks like from the read side.
    const db = stubDb([{ id: 'acct_broken', code: '6410', name: 'Office Supplies' }])

    const error = (
      await createChartAccount(db, {
        organizationId: ORG,
        code: '6410',
        name: 'Office Supplies',
        accountType: 'expense',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('could not be read back')
  })

  it('refuses an unprovisioned chart before writing anything', async () => {
    h.fields.delete('gl_account_type')

    const error = (
      await createChartAccount(stubDb([]), {
        organizationId: ORG,
        code: '6410',
        name: 'Office Supplies',
        accountType: 'expense',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.creates).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CHART-HIERARCHY.md §4 - sub-accounts
// ─────────────────────────────────────────────────────────────────────────────

describe('createChartAccount: parentId (CHART-HIERARCHY §4)', () => {
  const SALES: Account = {
    id: 'acct_sales',
    code: '4000',
    name: 'Sales',
    accountType: 'revenue',
    isActive: true,
  }

  it('writes the parent as a RecordId through the RELATIONSHIP field', async () => {
    provisionParentField()
    h.createdId = 'acct_product_income'
    const db = stubDb([
      SALES,
      {
        id: 'acct_product_income',
        code: '4010',
        name: 'Product Income',
        accountType: 'revenue',
        parentId: SALES.id,
      },
    ])

    const row = (
      await createChartAccount(db, {
        organizationId: ORG,
        code: '4010',
        name: 'Product Income',
        accountType: 'revenue',
        parentId: SALES.id,
        actorUserId: USER,
      })
    )._unsafeUnwrap()

    // The RELATIONSHIP shape: a RecordId ("defId:instanceId"), the same as
    // `bank_deposit_bank_account_record` takes - never a bare instance id.
    expect(h.creates[0]?.values.gl_account_parent).toBe(`${DEF}:${SALES.id}`)
    // readBack decodes it straight back through the shared decoder.
    expect(row.parentId).toBe(SALES.id)
  })

  it('refuses a parentId when the org has no gl_account_parent field', async () => {
    // No `provisionParentField()` - the default, unstamped state.
    const db = stubDb([SALES])

    const error = (
      await createChartAccount(db, {
        organizationId: ORG,
        name: 'Product Income',
        accountType: 'revenue',
        parentId: SALES.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('gl_account_parent')
    expect(h.creates).toHaveLength(0)
  })

  it('refuses a parent that does not exist', async () => {
    provisionParentField()
    const db = stubDb([])

    const error = (
      await createChartAccount(db, {
        organizationId: ORG,
        name: 'Product Income',
        accountType: 'revenue',
        parentId: 'acct_ghost',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('does not exist')
    expect(h.creates).toHaveLength(0)
  })

  it('refuses an archived parent', async () => {
    provisionParentField()
    const archivedSales: Account = { ...SALES, archived: true }
    const db = stubDb([archivedSales])

    const error = (
      await createChartAccount(db, {
        organizationId: ORG,
        name: 'Product Income',
        accountType: 'revenue',
        parentId: SALES.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    // Archived accounts are excluded from `loadLiveChart`'s query, so they
    // read the same as "does not exist" - the collapse every reader makes.
    expect(error.message).toContain('does not exist')
    expect(h.creates).toHaveLength(0)
  })

  it('refuses a parent of a different accountType (D3)', async () => {
    provisionParentField()
    const db = stubDb([SALES])

    const error = (
      await createChartAccount(db, {
        organizationId: ORG,
        name: 'Office Supplies',
        accountType: 'expense',
        parentId: SALES.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('Sales')
    expect(error.message).toContain('a revenue account')
    expect(error.message).toContain('an expense account')
    expect(h.creates).toHaveLength(0)
  })

  // D4: five levels, zero-based depths 0-4. A chain of five already fills the
  // cap, so a sixth level - a child of the depth-4 account - refuses.
  it('refuses when the resulting depth would exceed five levels', async () => {
    provisionParentField()
    const chain: Account[] = [
      { id: 'acct_l0', code: '1', name: 'L0', accountType: 'asset' },
      { id: 'acct_l1', code: '2', name: 'L1', accountType: 'asset', parentId: 'acct_l0' },
      { id: 'acct_l2', code: '3', name: 'L2', accountType: 'asset', parentId: 'acct_l1' },
      { id: 'acct_l3', code: '4', name: 'L3', accountType: 'asset', parentId: 'acct_l2' },
      { id: 'acct_l4', code: '5', name: 'L4', accountType: 'asset', parentId: 'acct_l3' },
    ]
    const db = stubDb(chain)

    const error = (
      await createChartAccount(db, {
        organizationId: ORG,
        name: 'L5',
        accountType: 'asset',
        parentId: 'acct_l4',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('six levels deep')
    expect(error.message).toContain("chart's five-level limit")
    expect(h.creates).toHaveLength(0)
  })

  // The boundary right below the cap must still be allowed.
  it('allows a parent at depth 3, landing the new account at depth 4', async () => {
    provisionParentField()
    h.createdId = 'acct_l4_new'
    const chain: Account[] = [
      { id: 'acct_l0', code: '1', name: 'L0', accountType: 'asset' },
      { id: 'acct_l1', code: '2', name: 'L1', accountType: 'asset', parentId: 'acct_l0' },
      { id: 'acct_l2', code: '3', name: 'L2', accountType: 'asset', parentId: 'acct_l1' },
      { id: 'acct_l3', code: '4', name: 'L3', accountType: 'asset', parentId: 'acct_l2' },
    ]
    const db = stubDb([
      ...chain,
      { id: 'acct_l4_new', code: '5', name: 'L4', accountType: 'asset', parentId: 'acct_l3' },
    ])

    const result = await createChartAccount(db, {
      organizationId: ORG,
      name: 'L4',
      accountType: 'asset',
      parentId: 'acct_l3',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
  })
})

describe('updateChartAccount: parentId (CHART-HIERARCHY §4)', () => {
  const SALES: Account = {
    id: 'acct_sales',
    code: '4000',
    name: 'Sales',
    accountType: 'revenue',
    isActive: true,
  }
  const PRODUCT_INCOME: Account = {
    id: 'acct_product_income',
    code: '4010',
    name: 'Product Income',
    accountType: 'revenue',
    isActive: true,
  }

  it('sets a parent after the same D3/D4 checks a create runs', async () => {
    provisionParentField()
    const db = stubDb([SALES, PRODUCT_INCOME])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: PRODUCT_INCOME.id,
      parentId: SALES.id,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toEqual({ gl_account_parent: `${DEF}:${SALES.id}` })
  })

  it('clears the parent when sent null', async () => {
    provisionParentField()
    const child: Account = { ...PRODUCT_INCOME, parentId: SALES.id }
    const db = stubDb([SALES, child])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: child.id,
      parentId: null,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toEqual({ gl_account_parent: null })
  })

  it('refuses an account naming itself as its own parent', async () => {
    provisionParentField()
    const db = stubDb([SALES])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: SALES.id,
        parentId: SALES.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('own parent')
    expect(h.updates).toHaveLength(0)
  })

  // A cycle: `PRODUCT_INCOME` is already `SALES`'s child, so making `SALES`
  // report to its own descendant would loop the tree.
  it('refuses making an account a descendant of its own subtree', async () => {
    provisionParentField()
    const child: Account = { ...PRODUCT_INCOME, parentId: SALES.id }
    const db = stubDb([SALES, child])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: SALES.id,
        parentId: child.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('sub-account of this account')
    expect(h.updates).toHaveLength(0)
  })

  it('refuses changing the type of an account that currently has a parent (D3)', async () => {
    provisionParentField()
    const child: Account = { ...PRODUCT_INCOME, parentId: SALES.id }
    const db = stubDb([SALES, child])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: child.id,
        accountType: 'asset',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('Sales')
    expect(error.message).toContain('sub-account')
    expect(h.updates).toHaveLength(0)
  })

  it('refuses changing the type of an account that has live children (D3)', async () => {
    provisionParentField()
    const child: Account = { ...PRODUCT_INCOME, parentId: SALES.id }
    const db = stubDb([SALES, child])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: SALES.id,
        accountType: 'asset',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('1 sub-account')
    expect(error.message).toContain('Product Income')
    expect(h.updates).toHaveLength(0)
  })

  it('allows a type change once the account has no parent and no live children', async () => {
    provisionParentField()
    const db = stubDb([SALES])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: SALES.id,
      accountType: 'asset',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
  })
})

describe('removeChartAccount: D6 - live sub-accounts', () => {
  const SALES: Account = {
    id: 'acct_sales',
    code: '4000',
    name: 'Sales',
    accountType: 'revenue',
    isActive: true,
  }

  it('refuses while a live sub-account still sits under it', async () => {
    provisionParentField()
    const child: Account = {
      id: 'acct_product_income',
      code: '4010',
      name: 'Product Income',
      accountType: 'revenue',
      parentId: SALES.id,
    }
    const db = stubDb([SALES, child])

    const error = (
      await removeChartAccount(db, {
        organizationId: ORG,
        accountId: SALES.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('1 sub-account')
    expect(error.message).toContain('Sales')
    expect(h.archives).toEqual([])
  })

  it('allows removal once the sub-account has been moved or removed', async () => {
    provisionParentField()
    const db = stubDb([SALES])

    const result = await removeChartAccount(db, {
      organizationId: ORG,
      accountId: SALES.id,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.archives).toHaveLength(1)
  })
})

describe('restoreChartAccount: D6 - an archived parent', () => {
  const ARCHIVED_SALES: Account = {
    id: 'acct_sales',
    code: '4000',
    name: 'Sales',
    accountType: 'revenue',
    isActive: true,
    archived: true,
  }

  it('refuses restoring an account whose parent is still archived', async () => {
    provisionParentField()
    const child: Account = {
      id: 'acct_product_income',
      code: '4010',
      name: 'Product Income',
      accountType: 'revenue',
      archived: true,
      parentId: ARCHIVED_SALES.id,
    }
    const db = stubDb([ARCHIVED_SALES, child])

    const error = (
      await restoreChartAccount(db, {
        organizationId: ORG,
        accountId: child.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('Sales')
    expect(error.message).toContain('archived')
    expect(h.restores).toEqual([])
  })

  it('allows restoring once the parent is live', async () => {
    provisionParentField()
    const liveSales: Account = { ...ARCHIVED_SALES, archived: false }
    const child: Account = {
      id: 'acct_product_income',
      code: '4010',
      name: 'Product Income',
      accountType: 'revenue',
      archived: true,
      parentId: liveSales.id,
    }
    const db = stubDb([liveSales, child])

    const result = await restoreChartAccount(db, {
      organizationId: ORG,
      accountId: child.id,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.restores).toHaveLength(1)
  })

  it('allows restoring a top-level account regardless of the field', async () => {
    const db = stubDb([ARCHIVED_SALES])

    const result = await restoreChartAccount(db, {
      organizationId: ORG,
      accountId: ARCHIVED_SALES.id,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.restores).toHaveLength(1)
  })
})

// ─── I4: a code another live account holds ───────────────────────────────────
//
// 🛑 Neither gate below this module stops a duplicate, which is why a collision
// used to return HTTP 200 carrying the OLD code with no message anywhere:
// `validateUniqueFields` reads `values[field.id]` while this module keys by
// systemAttribute, and the field-value layer's throw is swallowed by
// `setValuesForEntity`'s per-field catch. `readBack` cannot cover for either -
// a dropped code leaves a perfectly well-formed account. So the refusal has to
// happen HERE, before the handler is called at all.
describe('I4: a code another live account already holds', () => {
  const RAW_MATERIALS: Account = {
    id: 'acct_1310',
    code: '1310',
    name: 'Raw Materials / Parts',
    accountType: 'asset',
    isActive: true,
  }

  it('refuses a create whose code is taken, naming the code, and writes nothing', async () => {
    const error = (
      await createChartAccount(stubDb([RAW_MATERIALS]), {
        organizationId: ORG,
        code: '1310',
        name: 'Something Else',
        accountType: 'asset',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UniqueValueConflictError)
    expect(error.message).toBe('1310 is already in use by another account in this chart.')
    expect(h.creates).toHaveLength(0)
  })

  it('refuses a RENUMBER onto a taken code, and writes nothing', async () => {
    const mine: Account = {
      id: 'acct_mine',
      code: '1350',
      name: 'Test Scrap Inventory',
      accountType: 'asset',
      isActive: true,
    }

    const error = (
      await updateChartAccount(stubDb([RAW_MATERIALS, mine]), {
        organizationId: ORG,
        accountId: mine.id,
        code: '1310',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UniqueValueConflictError)
    expect(error.message).toBe('1310 is already in use by another account in this chart.')
    // 🛑 The whole point. Before this guard the handler was called, dropped the
    // field, and the caller was told it succeeded.
    expect(h.updates).toHaveLength(0)
  })

  it('lets an account keep its own code, so any other edit still saves', async () => {
    const result = await updateChartAccount(stubDb([RAW_MATERIALS]), {
      organizationId: ORG,
      accountId: RAW_MATERIALS.id,
      code: '1310',
      name: 'Raw Materials',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(1)
  })

  it('still writes a renumber onto a free code', async () => {
    const mine: Account = {
      id: 'acct_mine',
      code: '1350',
      name: 'Test Scrap Inventory',
      accountType: 'asset',
      isActive: true,
    }

    const result = await updateChartAccount(stubDb([RAW_MATERIALS, mine]), {
      organizationId: ORG,
      accountId: mine.id,
      code: '1355',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toMatchObject({ gl_account_code: '1355' })
  })

  // Removal IS archival, and every reader of this chart excludes archived rows.
  // A code held only by a removed account is free, or removing an account would
  // burn its number forever.
  it('lets an ARCHIVED account release its code', async () => {
    const removed: Account = { ...RAW_MATERIALS, id: 'acct_old', archived: true }
    // `h.createdId`'s row, seeded so `readBack` finds it; the stub keeps it
    // invisible until the create actually runs.
    const written: Account = { ...RAW_MATERIALS, id: h.createdId, name: 'Raw Materials, again' }

    const result = await createChartAccount(stubDb([removed, written]), {
      organizationId: ORG,
      code: '1310',
      name: 'Raw Materials, again',
      accountType: 'asset',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.creates).toHaveLength(1)
  })

  it('does not see a code held in ANOTHER organization', async () => {
    const theirs: Account = { ...RAW_MATERIALS, id: 'acct_theirs', organizationId: OTHER_ORG }
    const written: Account = { ...RAW_MATERIALS, id: h.createdId }

    const result = await createChartAccount(stubDb([theirs, written]), {
      organizationId: ORG,
      code: '1310',
      name: 'Raw Materials',
      accountType: 'asset',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.creates).toHaveLength(1)
  })
})

describe('updateChartAccount', () => {
  it('writes only the keys it was sent', async () => {
    const db = stubDb([GRNI_ACCOUNT])

    await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      name: 'GRNI',
      actorUserId: USER,
    })

    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]?.values).toEqual({ gl_account_name: 'GRNI' })
    expect(h.updates[0]?.recordId).toBe(`${DEF}:${GRNI_ACCOUNT.id}`)
  })

  // ⚠️ `G7`: the chart is the org's document. Since task 15 a renumber no
  // longer detaches anything at all - `GlPostingLine.glAccountId` is the
  // identity - and refusing it anyway would be this module deciding it knows
  // better than the org about its own numbering.
  it('renumbers without complaint, even with a role pointing at the account', async () => {
    const db = stubDb([GRNI_ACCOUNT], [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id }])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      code: '2155',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toEqual({ gl_account_code: '2155' })
  })

  // Task 15 §5: the account id is the identity, so removing the label leaves
  // a perfectly postable account. `null` and a blank string mean the same thing.
  it.each([
    ['null', null],
    ['a blank string', '   '],
  ])('clears the code when sent %s', async (_label, sent) => {
    const db = stubDb([GRNI_ACCOUNT])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      code: sent,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toEqual({ gl_account_code: null })
  })

  it('writes a subtype', async () => {
    const db = stubDb([GRNI_ACCOUNT])

    await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      subtype: 'accounts_payable',
      actorUserId: USER,
    })

    expect(h.updates[0]?.values).toEqual({ gl_account_subtype: 'accounts_payable' })
  })

  it('makes no call at all when nothing actually changes', async () => {
    const db = stubDb([GRNI_ACCOUNT])

    const row = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        accountType: 'liability',
        isActive: true,
        actorUserId: USER,
      })
    )._unsafeUnwrap()

    expect(h.updates).toHaveLength(0)
    expect(row.code).toBe('2160')
  })

  it('is a NotFoundError for an account in another organization', async () => {
    const db = stubDb([{ ...GRNI_ACCOUNT, organizationId: OTHER_ORG }])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        name: 'GRNI',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.updates).toHaveLength(0)
  })

  it('is a NotFoundError for an archived account', async () => {
    const db = stubDb([{ ...GRNI_ACCOUNT, archived: true }])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        name: 'GRNI',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(NotFoundError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// I1 - the guard the module exists for
// ─────────────────────────────────────────────────────────────────────────────

describe('I1: a type change may not break a role that posts here', () => {
  // 🛑 THE test. Without this guard, `mapRole`'s type check is bypassable by
  // mapping first and retyping second, and the entry that results BALANCES.
  it('refuses, naming the role and both types', async () => {
    const db = stubDb([GRNI_ACCOUNT], [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id }])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        accountType: 'revenue',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain("'grni'")
    expect(error.message).toContain('revenue')
    expect(error.message).toContain('liability')
    expect(h.updates).toHaveLength(0)
  })

  // Three of the five account types start with a vowel, so a hardcoded "a"
  // rendered "a asset account" on the sentence a person is meant to act on.
  it('picks the article from the type, so it reads "an asset" and "a revenue"', async () => {
    const cash: Account = {
      id: 'acct_cash',
      code: '1000',
      name: 'Cash',
      accountType: 'asset',
      isActive: true,
    }
    const db = stubDb([cash], [{ role: 'undeposited_funds', glAccountId: cash.id }])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: cash.id,
        accountType: 'revenue',
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('a revenue account')
    expect(error.message).toContain('an asset account')
  })

  it('allows a type change the role still accepts', async () => {
    // `undeposited_funds` wants an asset; 1050 is an asset and stays one.
    const cash: Account = {
      id: 'acct_cash',
      code: '1000',
      name: 'Cash',
      accountType: 'asset',
      isActive: true,
    }
    const db = stubDb([cash], [{ role: 'undeposited_funds', glAccountId: cash.id }])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: cash.id,
      accountType: 'asset',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
  })

  // ⚠️ A role the org has explicitly said it does not use is not a reason to
  // refuse anything. `markedUnused` is the only state that exempts.
  it('allows the change once the role is marked unused', async () => {
    const db = stubDb(
      [GRNI_ACCOUNT],
      [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id, markedUnused: true }]
    )

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      accountType: 'revenue',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toEqual({ gl_account_type: 'revenue' })
  })

  it('allows any type change on an account no role points at', async () => {
    const db = stubDb([GRNI_ACCOUNT], [])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      accountType: 'revenue',
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
  })
})

describe('I2: deactivating an account a role still posts to', () => {
  it('refuses, naming the role', async () => {
    const db = stubDb([GRNI_ACCOUNT], [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id }])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        isActive: false,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain("'grni'")
    expect(h.updates).toHaveLength(0)
  })

  // Reactivating is what `resolveRoles`' own refusal tells the reader to do, so
  // it can never be the thing that is blocked.
  it('always allows REACTIVATING, role or no role', async () => {
    const inactive = { ...GRNI_ACCOUNT, isActive: false }
    const db = stubDb([inactive], [{ role: 'grni', glAccountId: inactive.id }])

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: inactive.id,
      isActive: true,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates[0]?.values).toEqual({ gl_account_is_active: true })
  })

  it('allows deactivating once the role is marked unused', async () => {
    const db = stubDb(
      [GRNI_ACCOUNT],
      [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id, markedUnused: true }]
    )

    const result = await updateChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      isActive: false,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
  })
})

/**
 * I4 - the guard that `assertNoLiveRole` is not.
 *
 * 🛑 This became reachable on 2026-09-10. `clearing_affirm` had been doing
 * double duty: routing Affirm money AND, through `assertNoLiveRole`, keeping
 * `1210 Affirm Clearing` from being removed. Deleting the role moved the
 * routing to a `payment_gateway` record and silently dropped the protection -
 * so the Chart tab would happily archive an account a live gateway named, and
 * the next Affirm posting would refuse with "no active account with id ...".
 */
describe('I4: removing or deactivating an account a TEXT pointer still names', () => {
  // A bank account rather than the gateway's clearing account: task 58 moved a
  // rail's accounts onto `GlRoleAssignment`, so they are no longer TEXT pointers.
  const gatewayPointer = {
    attribute: 'bank_account_gl_account',
    entityId: 'ba_chase',
    glAccountId: GRNI_ACCOUNT.id,
  }

  it('refuses removal, naming WHAT points there rather than only that something does', async () => {
    h.pointers = [gatewayPointer]
    const db = stubDb([GRNI_ACCOUNT], [])

    const error = (
      await removeChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('a bank account')
    expect(error.message).toContain('still points at it')
    // 🛑 Refused means NOTHING was archived. A guard that refuses after the
    // write is not a guard.
    expect(h.archives).toEqual([])
  })

  it('refuses deactivation too - every chart reader treats inactive as unusable', async () => {
    h.pointers = [gatewayPointer]
    const db = stubDb([GRNI_ACCOUNT], [])

    const error = (
      await updateChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        actorUserId: USER,
        isActive: false,
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('a bank account')
    expect(h.updates).toEqual([])
  })

  it('allows removal once nothing points there', async () => {
    h.pointers = []
    const db = stubDb([GRNI_ACCOUNT], [])

    expect(
      (
        await removeChartAccount(db, {
          organizationId: ORG,
          accountId: GRNI_ACCOUNT.id,
          actorUserId: USER,
        })
      ).isOk()
    ).toBe(true)
    expect(h.archives).toHaveLength(1)
  })

  // A RENUMBER or a RENAME is safe by construction - the pointer holds the
  // INSTANCE id, which is the whole point of task 15 - so the guard must not
  // fire on one. Firing here would make a pointed-at account uneditable.
  it('does not fire on a renumber, a rename or a reactivation', async () => {
    h.pointers = [gatewayPointer]
    const db = stubDb([GRNI_ACCOUNT], [])

    expect(
      (
        await updateChartAccount(db, {
          organizationId: ORG,
          accountId: GRNI_ACCOUNT.id,
          actorUserId: USER,
          code: '2165',
          name: 'GRNI renamed',
        })
      ).isOk()
    ).toBe(true)
    expect(h.updates).toHaveLength(1)
  })
})

describe('I3: removing an account a role still posts to', () => {
  it('refuses, naming the role', async () => {
    const db = stubDb([GRNI_ACCOUNT], [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id }])

    const error = (
      await removeChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain("'grni'")
    expect(h.archives).toHaveLength(0)
  })

  // 🛑 ARCHIVE, never delete. A hard delete forfeits the seeder's "someone who
  // archived an account did not ask for it back" rule, and cascades away any
  // `RecordIdentity` carrying a connected provider's own account id (`P2`).
  it('ARCHIVES and never deletes', async () => {
    const db = stubDb([GRNI_ACCOUNT], [])

    const result = await removeChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      actorUserId: USER,
    })

    expect(result._unsafeUnwrap()).toEqual({ id: GRNI_ACCOUNT.id })
    expect(h.archives).toEqual([`${DEF}:${GRNI_ACCOUNT.id}`])
    expect(h.deletes).toHaveLength(0)
  })

  it('allows removal once the role is marked unused', async () => {
    const db = stubDb(
      [GRNI_ACCOUNT],
      [{ role: 'grni', glAccountId: GRNI_ACCOUNT.id, markedUnused: true }]
    )

    const result = await removeChartAccount(db, {
      organizationId: ORG,
      accountId: GRNI_ACCOUNT.id,
      actorUserId: USER,
    })

    expect(result.isOk()).toBe(true)
    expect(h.archives).toHaveLength(1)
  })

  it('is a NotFoundError for an account in another organization', async () => {
    const db = stubDb([{ ...GRNI_ACCOUNT, organizationId: OTHER_ORG }])

    const error = (
      await removeChartAccount(db, {
        organizationId: ORG,
        accountId: GRNI_ACCOUNT.id,
        actorUserId: USER,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.archives).toHaveLength(0)
  })
})
