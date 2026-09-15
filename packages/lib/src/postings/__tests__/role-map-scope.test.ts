// packages/lib/src/postings/__tests__/role-map-scope.test.ts
//
// The WRITE side of task 47: which role-map edits may name a connection, and
// which are refused before anything is written.
//
// Every refusal here exists because the alternative is silent. A role scoped
// that should not be, or a revenue role pointed at a Stripe account, produces an
// entry that BALANCES - so the first anybody would learn of it is a report that
// does not add up, months later, with no edit to blame. `setRoleAssignment`
// catching it is the difference between a validation message and a restatement.
//
// 🛑 The picker's filter in `role-map-editor.tsx` is a CONVENIENCE, not an
// authority. These tests are the authority.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../accounting-commit-lock', () => ({ withAccountingCommitLock: vi.fn() }))

const h = vi.hoisted(() => ({ fields: new Map<string, { id: string }>() }))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.get(a) ?? null])),
    }),
  }),
}))

import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { setRoleAssignment } from '../role-map'
import { MANUAL_SOURCE_EXTERNAL_ID, MANUAL_SOURCE_PROVIDER_KEY } from '../source-scope'

const ORG = 'org_1'
const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

const STORE = 'fsa_store_us'
const STRIPE = 'fsa_stripe'
const MANUAL = 'fsa_manual'

const ACCOUNTS = [
  { id: 'acct_4001', code: '4001', name: 'Revenue - US', accountType: 'revenue' },
  { id: 'acct_6101', code: '6101', name: 'Stripe Fees', accountType: 'expense' },
  { id: 'acct_1100', code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
]

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

interface Stub {
  db: Database
  inserts: Record<string, unknown>[]
  deletes: string[][]
}

/**
 * A stub whose `FinancialSourceAccount` evidence decides each source's AXIS, the
 * way `listRoleSources` derives it from the real tables: a row reached through
 * `FinancialSourceObject` is a store, a row carrying processor balance entries
 * or transfers is a merchant account, the sentinel is a store, and a row with no
 * evidence at all is neither and is not offered.
 */
function stubDb(options: { storeIds?: string[]; processorIds?: string[] } = {}): Stub {
  const inserts: Record<string, unknown>[] = []
  const deletes: string[][] = []
  const sources = [
    { id: STORE, providerKey: 'shopify', externalAccountId: 'auxx-lift.myshopify.com' },
    { id: STRIPE, providerKey: 'stripe', externalAccountId: 'acct_1ABC' },
    {
      id: MANUAL,
      providerKey: MANUAL_SOURCE_PROVIDER_KEY,
      externalAccountId: MANUAL_SOURCE_EXTERNAL_ID,
    },
  ]
  const storeIds = options.storeIds ?? [STORE]
  const processorIds = options.processorIds ?? [STRIPE]

  const values = ACCOUNTS.flatMap((account) => [
    { entityId: account.id, fieldId: CODE_FIELD, valueText: account.code },
    { entityId: account.id, fieldId: NAME_FIELD, valueText: account.name },
    { entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType },
    { entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: true },
  ])

  const rowsFor = (table: unknown, params: string[]): unknown[] => {
    if (table === schema.GlRoleAssignment) return []
    if (table === schema.FinancialSourceAccount) return sources
    if (table === schema.FinancialSourceObject) return storeIds.map((id) => ({ id }))
    if (table === schema.ProcessorBalanceEntry) return processorIds.map((id) => ({ id }))
    if (table === schema.MoneyTransfer) return []
    if (table === schema.EntityInstance) {
      return ACCOUNTS.filter((a) => params.includes(a.id)).map((a) => ({ id: a.id }))
    }
    return values.filter((row) => params.includes(row.entityId as string))
  }

  // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
  const makeChain = (table: unknown): any => {
    let params: string[] = []
    // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
    const chain: any = {
      where: (condition: unknown) => {
        params = whereValues(condition)
        return chain
      },
      limit: () => chain,
      orderBy: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table, params)).then(resolve, reject),
    }
    return chain
  }

  const db = {
    transaction: async function <T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(this)
    },
    select: () => ({ from: (table: unknown) => makeChain(table) }),
    selectDistinct: () => ({ from: (table: unknown) => makeChain(table) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
        const chain: any = {
          onConflictDoUpdate: () => {
            inserts.push(v)
            return chain
          },
          onConflictDoNothing: () => chain,
          returning: async () => [v],
        }
        return chain
      },
    }),
    delete: () => {
      // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
      const chain: any = {
        where: (condition: unknown) => {
          deletes.push(whereValues(condition))
          return Promise.resolve([])
        },
      }
      return chain
    },
  } as unknown as Database

  return { db, inserts, deletes }
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', { id: CODE_FIELD }],
    ['gl_account_name', { id: NAME_FIELD }],
    ['gl_account_type', { id: TYPE_FIELD }],
    ['gl_account_is_active', { id: ACTIVE_FIELD }],
  ])
})

describe('setRoleAssignment - which roles may name a connection', () => {
  // §10.5. The vocabulary of what may be scoped is as closed as the role
  // vocabulary itself, and the refusal names the role so the message is
  // actionable rather than a shrug.
  it('refuses a connection on a role that is not scopable, naming the role', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'accounts_receivable',
      glAccountId: 'acct_1100',
      sourceAccountId: STORE,
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toContain("'accounts_receivable'")
    expect(stub.inserts).toHaveLength(0)
  })

  it('accepts a connection on a scopable role', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_product',
      glAccountId: 'acct_4001',
      sourceAccountId: STORE,
    })

    expect(result.isOk()).toBe(true)
    expect(stub.inserts).toEqual([expect.objectContaining({ sourceAccountId: STORE })])
  })

  // The org default is unchanged by all of this: no `sourceAccountId` writes the
  // row every call wrote before task 47.
  it('writes a null scope when no connection is named', async () => {
    const stub = stubDb()
    await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_product',
      glAccountId: 'acct_4001',
    })

    expect(stub.inserts).toEqual([expect.objectContaining({ sourceAccountId: null })])
  })
})

describe('setRoleAssignment - a connection must carry the role AXIS', () => {
  // §10.10. 🛑 The one that matters. A revenue role pointed at a merchant
  // account would split revenue by the rail the money settled through rather
  // than by the storefront that sold it - and the entry balances either way.
  it('refuses a revenue role pointed at a merchant account', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_product',
      glAccountId: 'acct_4001',
      sourceAccountId: STRIPE,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(result._unsafeUnwrapErr().message).toContain('acct_1ABC')
    expect(stub.inserts).toHaveLength(0)
  })

  it('refuses the fee role pointed at a storefront', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'payment_processing_fees',
      glAccountId: 'acct_6101',
      sourceAccountId: STORE,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('auxx-lift.myshopify.com')
  })

  it('accepts the fee role on a merchant account', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'payment_processing_fees',
      glAccountId: 'acct_6101',
      sourceAccountId: STRIPE,
    })

    expect(result.isOk()).toBe(true)
  })

  // ⚠️ A source that is BOTH - Shopify is a storefront and Shopify Payments is a
  // processor - appears on both axes and may carry either role.
  it('accepts either axis on a connection that carries both', async () => {
    const stub = stubDb({ storeIds: [STORE], processorIds: [STORE] })
    expect(
      (
        await setRoleAssignment(stub.db, {
          organizationId: ORG,
          role: 'revenue_product',
          glAccountId: 'acct_4001',
          sourceAccountId: STORE,
        })
      ).isOk()
    ).toBe(true)
    expect(
      (
        await setRoleAssignment(stub.db, {
          organizationId: ORG,
          role: 'payment_processing_fees',
          glAccountId: 'acct_6101',
          sourceAccountId: STORE,
        })
      ).isOk()
    ).toBe(true)
  })

  // 🛑 Manual is a STORE and only a store. A manual order has no processor, so
  // `payment_processing_fees` is never emitted for one and an account chosen
  // for it would sit at zero forever.
  it('accepts a revenue role on the manual bucket and refuses the fee role', async () => {
    const stub = stubDb()
    expect(
      (
        await setRoleAssignment(stub.db, {
          organizationId: ORG,
          role: 'revenue_product',
          glAccountId: 'acct_4001',
          sourceAccountId: MANUAL,
        })
      ).isOk()
    ).toBe(true)
    expect(
      (
        await setRoleAssignment(stub.db, {
          organizationId: ORG,
          role: 'payment_processing_fees',
          glAccountId: 'acct_6101',
          sourceAccountId: MANUAL,
        })
      ).isErr()
    ).toBe(true)
  })

  it('refuses a connection that is not this organization’s', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_product',
      glAccountId: 'acct_4001',
      sourceAccountId: 'fsa_somebody_elses',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('setRoleAssignment - giving an override back', () => {
  // 🛑 A DELETE, not a write of the default's account id. Inheriting is the
  // ABSENCE of a row; an override copied from the default would silently stop
  // following it the next time somebody repointed the role.
  it('deletes the row rather than copying the default into it', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_product',
      sourceAccountId: STORE,
      useDefault: true,
    })

    expect(result.isOk()).toBe(true)
    expect(stub.inserts).toHaveLength(0)
    expect(stub.deletes).toEqual([expect.arrayContaining([ORG, 'revenue_product', STORE])])
  })

  it('refuses useDefault with no connection to apply it to', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_product',
      useDefault: true,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })
})

describe('setRoleAssignment - "unused" stays on the role', () => {
  // "We do not sell shipping" is a fact about the BUSINESS. It cannot be true of
  // one store and false of another, so there is no per-connection version of it
  // and the settings tree offers none.
  it('refuses to mark a role unused for one connection', async () => {
    const stub = stubDb()
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'revenue_shipping',
      markedUnused: true,
      sourceAccountId: STORE,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(result._unsafeUnwrapErr().message).toContain('whole organization')
  })
})
