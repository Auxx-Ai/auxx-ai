// packages/lib/src/postings/__tests__/chart-write.test.ts
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
import { NotFoundError, UniqueValueConflictError, UnprocessableEntityError } from '../../errors'

const h = vi.hoisted(() => ({
  /** systemAttribute -> the CustomField row, or absent to model an unmigrated org. */
  fields: new Map<string, { id: string; entityDefinitionId: string | null }>(),
  /** What each handler call did, and what the next one should throw. */
  creates: [] as { defId: string; values: Record<string, unknown> }[],
  updates: [] as { recordId: string; values: Record<string, unknown> }[],
  archives: [] as string[],
  deletes: [] as string[],
  /** Set to make the next create/update throw. */
  writeError: null as Error | null,
  /** The instance id `create` hands back. */
  createdId: 'acct_new',
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.get(a) ?? null])),
    }),
  }),
}))

vi.mock('../../resources/crud/unified-handler', () => ({
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
    async delete(recordId: string) {
      h.deletes.push(recordId)
    }
  },
}))

import { createChartAccount, removeChartAccount, updateChartAccount } from '../chart-write'

const ORG = 'org_1'
const OTHER_ORG = 'org_2'
const DEF = 'def_gl_account'

const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

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
  const visibleFieldValues = () =>
    liveAccounts().flatMap((account) => {
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
      return rows
    })

  const rowsFor = (table: unknown, params: string[]): unknown[] => {
    if (table === schema.GlRoleAssignment) {
      return assignments
        .filter(
          (a) =>
            !a.markedUnused &&
            params.includes(a.organizationId ?? ORG) &&
            params.includes(a.glAccountId)
        )
        .map((a) => ({ role: a.role, glAccountId: a.glAccountId }))
    }
    if (table === schema.EntityInstance) {
      return liveAccounts()
        .filter((a) => params.includes(a.organizationId ?? ORG) && params.includes(a.id))
        .map((a) => ({ id: a.id }))
    }
    // `assertCodeIsFree` looks a code UP rather than reading rows for known ids,
    // so its where-params are (org, codeFieldId, code) with no entityId at all.
    // `readChartAccountValues` also carries CODE_FIELD, but alongside the other
    // three field ids - so the absence of NAME_FIELD is what tells them apart.
    if (params.includes(CODE_FIELD) && !params.includes(NAME_FIELD)) {
      return visibleFieldValues().filter(
        (row) => row.fieldId === CODE_FIELD && params.includes(row.valueText as string)
      )
    }
    return visibleFieldValues().filter((row) => params.includes(row.entityId as string))
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
  h.deletes = []
  h.writeError = null
  h.createdId = 'acct_new'
})

// ─────────────────────────────────────────────────────────────────────────────

describe('createChartAccount', () => {
  it('writes all four attributes and returns the row as the list renders it', async () => {
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
      },
    })
    expect(row).toEqual({
      id: 'acct_6410',
      code: '6410',
      name: 'Office Supplies',
      accountType: 'expense',
      isActive: true,
    })
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

  it('refuses a whitespace-only code without touching the handler', async () => {
    const result = await createChartAccount(stubDb([]), {
      organizationId: ORG,
      code: '   ',
      name: 'Office Supplies',
      accountType: 'expense',
      actorUserId: USER,
    })

    expect(result._unsafeUnwrapErr().message).toBe('An account needs a code.')
    expect(h.creates).toHaveLength(0)
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

  // ⚠️ `G7`: the chart is the org's document. A renumber detaches posted lines
  // from the row on screen, which is `P2` working as designed, and refusing it
  // would be this module deciding it knows better.
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
    const db = stubDb([cash], [{ role: 'cash', glAccountId: cash.id }])

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
    // `cash` wants an asset; 1000 is an asset and stays one.
    const cash: Account = {
      id: 'acct_cash',
      code: '1000',
      name: 'Cash',
      accountType: 'asset',
      isActive: true,
    }
    const db = stubDb([cash], [{ role: 'cash', glAccountId: cash.id }])

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
