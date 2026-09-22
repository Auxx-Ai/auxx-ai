// packages/lib/src/accounting/ledger/roles/__tests__/resolve-roles-scope.test.ts
//
// Task 47 (store axis) and task 58 §5.1 (rail axis): an org may answer a
// posting role DIFFERENTLY PER SOURCE - per storefront for revenue, per rail
// for processing fees - and `resolveRoles` is the one place that decides
// which answer a given event gets.
//
// Three properties carry this file, and each is a way the books move silently
// when it is wrong:
//
//  1. **The no-op.** An org with no scoped rows resolves exactly as it did
//     before this brief. That is the acceptance test for the whole change: the
//     other ~1,700 tests in this package are the proof, and the first describe
//     below is the explicit statement of it.
//  2. **A miss falls back, it never fails.** Connecting a second store must not
//     stop the books, so an unmapped or archived source posts to the org default
//     and is surfaced by the settings screen rather than by a refusal (D6).
//  3. **The axes do not cross.** `payment_processing_fees` reads the RAIL
//     and `revenue_product` reads the STORE. Two stores sharing one Stripe
//     rail book fees to ONE account; one store on two rails books to TWO.
//     Crossing them produces an entry that balances perfectly.
//
// The stub answers by TABLE rather than by call order, unlike
// `resolve-roles.test.ts`'s: the scope chain issues its reads conditionally, and
// a positional stub would encode the very call count these tests exist to let
// change.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chartProviderDb } from '../../__tests__/support/chart-cache-stub'

const h = vi.hoisted(() => ({
  fields: new Map<string, string>(),
  /** What the `chartAccounts` provider computes from - see `chart-cache-stub.ts`. */
  chartDb: null as unknown,
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [
            a,
            h.fields.has(a) ? { id: h.fields.get(a), entityDefinitionId: 'def_gl_account' } : null,
          ])
        ),
    }),
    get: async (orgId: string, key: string) => {
      if (key !== 'chartAccounts') throw new Error(`unstubbed cache key ${key}`)
      const { computeChart } = await import('../../__tests__/support/chart-cache-stub')
      return computeChart(orgId, h.chartDb)
    },
  }),
}))

import type { GlPostingLineInput } from '../../types'
import { resolveAccountLines, resolveRoles } from '../resolve-roles'
import { MANUAL_SOURCE_EXTERNAL_ID, MANUAL_SOURCE_PROVIDER_KEY } from '../source-scope'

const ORG = 'org_1'
const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

const STORE_US = 'fsa_store_us'
const STORE_EU = 'fsa_store_eu'
const MANUAL = 'fsa_manual'
/** A `FinancialSourceAccount` id - store-axis filler, unrelated to the rail tests below. */
const STRIPE = 'fsa_stripe'
/** A `payment_gateway` `EntityInstance` id - the rail axis lives on this table, not `FinancialSourceAccount`. */
const STRIPE_GATEWAY = 'pg_stripe'

interface Assignment {
  role: string
  glAccountId: string
  markedUnused?: boolean
  /** Null (or absent) is the ORG DEFAULT. */
  sourceAccountId?: string | null
  /** A rail override (task 58 §5.1) - exclusive with `sourceAccountId`. */
  paymentGatewayId?: string | null
  currency?: string | null
}

interface SourceAccount {
  id: string
  providerKey?: string
  externalAccountId?: string
  /** Archived rows are excluded by the query, so this models "not returned". */
  archived?: boolean
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

/** The four revenue/fee accounts these tests point roles at. */
const ACCOUNTS = [
  { id: 'acct_4000', code: '4000', name: 'Product Revenue', accountType: 'revenue' },
  { id: 'acct_4001', code: '4001', name: 'Revenue - US', accountType: 'revenue' },
  { id: 'acct_4002', code: '4002', name: 'Revenue - EU', accountType: 'revenue' },
  { id: 'acct_4010', code: '4010', name: 'Manual Sales', accountType: 'revenue' },
  { id: 'acct_6100', code: '6100', name: 'Processing Fees', accountType: 'expense' },
  { id: 'acct_6101', code: '6101', name: 'Stripe Fees', accountType: 'expense' },
  { id: 'acct_1100', code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
  { id: 'acct_1101', code: '1101', name: 'A/R - US', accountType: 'asset' },
  { id: 'acct_2200', code: '2200', name: 'Sales Tax Payable', accountType: 'liability' },
  { id: 'acct_2201', code: '2201', name: 'Sales Tax - US', accountType: 'liability' },
]

interface Stub {
  db: Database
  /** How many times `FinancialSourceAccount` was read. The no-op proof counts it. */
  sourceReads: number
}

function stubDb(
  assignments: Assignment[],
  sources: SourceAccount[] = [],
  gateways: readonly string[] = []
): Stub {
  const state = { sourceReads: 0 }
  const values = ACCOUNTS.flatMap((account) => [
    { entityId: account.id, fieldId: CODE_FIELD, valueText: account.code },
    { entityId: account.id, fieldId: NAME_FIELD, valueText: account.name },
    { entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType },
    { entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: true },
  ])
  h.chartDb = chartProviderDb(ACCOUNTS, values)

  const rowsFor = (table: unknown, params: string[]): unknown[] => {
    if (table === schema.GlRoleAssignment) {
      return assignments.map((a) => ({
        role: a.role,
        glAccountId: a.glAccountId,
        markedUnused: a.markedUnused ?? false,
        sourceAccountId: a.sourceAccountId ?? null,
        paymentGatewayId: a.paymentGatewayId ?? null,
        currency: a.currency ?? null,
      }))
    }
    if (table === schema.FinancialSourceAccount) {
      state.sourceReads++
      // Both reads this module makes, told apart by what they asked for: the
      // manual lookup names the sentinel's identity, the liveness check names
      // ids. Archived rows are excluded by the query in both.
      const live = sources.filter((s) => !s.archived)
      if (params.includes(MANUAL_SOURCE_PROVIDER_KEY)) {
        return live
          .filter(
            (s) =>
              s.providerKey === MANUAL_SOURCE_PROVIDER_KEY &&
              s.externalAccountId === MANUAL_SOURCE_EXTERNAL_ID
          )
          .map((s) => ({ id: s.id }))
      }
      return live.filter((s) => params.includes(s.id)).map((s) => ({ id: s.id }))
    }
    if (table === schema.EntityInstance) {
      // Shared by the chart-account liveness check AND the rail (gateway)
      // liveness check (task 58 §5.1) - both read `EntityInstance`, told apart
      // only by which ids they asked for.
      const ids = [...ACCOUNTS.map((a) => a.id), ...gateways]
      return ids.filter((id) => params.includes(id)).map((id) => ({ id }))
    }
    return values.filter((row) => params.includes(row.entityId as string))
  }

  const db = {
    select: () => ({
      from: (table: unknown) => {
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
      },
    }),
  } as unknown as Database

  return {
    db,
    get sourceReads() {
      return state.sourceReads
    },
  }
}

const LIVE_SOURCES: SourceAccount[] = [
  { id: STORE_US },
  { id: STORE_EU },
  { id: STRIPE },
  {
    id: MANUAL,
    providerKey: MANUAL_SOURCE_PROVIDER_KEY,
    externalAccountId: MANUAL_SOURCE_EXTERNAL_ID,
  },
]

const DEFAULT_REVENUE: Assignment = { role: 'revenue_product', glAccountId: 'acct_4000' }

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', CODE_FIELD],
    ['gl_account_name', NAME_FIELD],
    ['gl_account_type', TYPE_FIELD],
    ['gl_account_is_active', ACTIVE_FIELD],
  ])
})

// §10.1 - the acceptance test for the whole brief.
describe('an org that has scoped nothing behaves exactly as it did before', () => {
  it('resolves to the org default with a scope in hand, and reads no source at all', async () => {
    const stub = stubDb([DEFAULT_REVENUE], LIVE_SOURCES)

    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: STORE_US })

    expect(result._unsafeUnwrap().get('revenue_product')?.glAccountId).toBe('acct_4000')
    // 🛑 Not merely the same ANSWER - the same QUERIES. The scope chain
    // short-circuits on "this org holds no scoped row for these roles", so a
    // settled org pays nothing for a feature it does not use.
    expect(stub.sourceReads).toBe(0)
  })

  it('resolves to the org default with no scope at all', async () => {
    const stub = stubDb([DEFAULT_REVENUE], LIVE_SOURCES)

    const result = await resolveRoles(stub.db, ORG, ['revenue_product'])

    expect(result._unsafeUnwrap().get('revenue_product')?.glAccountId).toBe('acct_4000')
    expect(stub.sourceReads).toBe(0)
  })
})

// §10.2 and §10.3 - the chain itself.
describe('the scope chain: the source, then the default', () => {
  const SCOPED = [
    DEFAULT_REVENUE,
    { role: 'revenue_product', glAccountId: 'acct_4001', sourceAccountId: STORE_US },
    { role: 'revenue_product', glAccountId: 'acct_4010', sourceAccountId: MANUAL },
  ]

  it('prefers the store that sold it', async () => {
    const stub = stubDb(SCOPED, LIVE_SOURCES)
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: STORE_US })
    expect(result._unsafeUnwrap().get('revenue_product')?.code).toBe('4001')
  })

  // 🛑 A store nobody mapped falls back. Connecting a second store must never
  // stop the books (D6) - the unmapped state is a warning on a screen, not a
  // refusal in the ledger.
  it('falls back to the default for a store with no account of its own', async () => {
    const stub = stubDb(SCOPED, LIVE_SOURCES)
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: STORE_EU })
    expect(result._unsafeUnwrap().get('revenue_product')?.code).toBe('4000')
  })

  // §10.3. `null` is "this record had no connected source", and it resolves
  // through the MANUAL bucket - a real `FinancialSourceAccount` row, never a
  // second meaning for a null column.
  it('resolves a record with no connected source through the manual bucket', async () => {
    const stub = stubDb(SCOPED, LIVE_SOURCES)
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: null })
    expect(result._unsafeUnwrap().get('revenue_product')?.code).toBe('4010')
  })

  // ⚠️ `undefined` is NOT `null`. A caller that does not know the axis gets the
  // org default; only a caller that KNOWS there was no source gets manual.
  it('does not reach the manual bucket when the caller simply did not say', async () => {
    const stub = stubDb(SCOPED, LIVE_SOURCES)
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { rail: STRIPE_GATEWAY })
    expect(result._unsafeUnwrap().get('revenue_product')?.code).toBe('4000')
  })

  // The five refusals are unchanged and apply to whichever row wins.
  it('still fails closed when neither the scope nor the default is mapped', async () => {
    const stub = stubDb(
      [{ role: 'revenue_product', glAccountId: 'acct_4001', sourceAccountId: STORE_US }],
      LIVE_SOURCES
    )
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: STORE_EU })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain("'revenue_product' (Product Revenue)")
  })

  // §10.8. The assignment row survives the archive - the FK is to a
  // soft-archived table - and must not be used.
  it('ignores an override whose source has been archived', async () => {
    const stub = stubDb(SCOPED, [
      { id: STORE_US, archived: true },
      { id: STORE_EU },
      { id: STRIPE },
      {
        id: MANUAL,
        providerKey: MANUAL_SOURCE_PROVIDER_KEY,
        externalAccountId: MANUAL_SOURCE_EXTERNAL_ID,
      },
    ])
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: STORE_US })
    expect(result._unsafeUnwrap().get('revenue_product')?.code).toBe('4000')
  })

  // An org whose chart was never provisioned has no manual bucket. That is an
  // ordinary state, not an error: the role resolves to the default, which is
  // what it did before the bucket existed.
  it('falls back to the default when no manual bucket has been minted', async () => {
    const stub = stubDb(SCOPED, [{ id: STORE_US }, { id: STORE_EU }, { id: STRIPE }])
    const result = await resolveRoles(stub.db, ORG, ['revenue_product'], { store: null })
    expect(result._unsafeUnwrap().get('revenue_product')?.code).toBe('4000')
  })
})

// §10.9 - the axis separation, which is the whole of decision D12. Task 58
// moved `payment_processing_fees` from the (retired) processor axis onto the
// rail axis - a `payment_gateway` `EntityInstance`, not a `FinancialSourceAccount`.
describe('a role reads its OWN axis and no other', () => {
  const BOTH_AXES = [
    DEFAULT_REVENUE,
    { role: 'revenue_product', glAccountId: 'acct_4001', sourceAccountId: STORE_US },
    { role: 'payment_processing_fees', glAccountId: 'acct_6100' },
    { role: 'payment_processing_fees', glAccountId: 'acct_6101', paymentGatewayId: STRIPE_GATEWAY },
  ]

  it('reads the fee role from the rail, never from the store', async () => {
    const stub = stubDb(BOTH_AXES, LIVE_SOURCES, [STRIPE_GATEWAY])
    const resolved = (
      await resolveRoles(stub.db, ORG, ['revenue_product', 'payment_processing_fees'], {
        store: STORE_US,
        rail: STRIPE_GATEWAY,
      })
    )._unsafeUnwrap()

    expect(resolved.get('revenue_product')?.code).toBe('4001')
    expect(resolved.get('payment_processing_fees')?.code).toBe('6101')
  })

  // 🛑 Two stores sharing one Stripe rail book fees to ONE account. The fees
  // arrive on a single statement and reconcile as one number, so splitting them
  // by storefront would make the rail impossible to tie out.
  it('books two stores on one rail to one fee account', async () => {
    const stub = stubDb(BOTH_AXES, LIVE_SOURCES, [STRIPE_GATEWAY])
    const us = (
      await resolveRoles(stub.db, ORG, ['payment_processing_fees'], {
        store: STORE_US,
        rail: STRIPE_GATEWAY,
      })
    )._unsafeUnwrap()
    const eu = (
      await resolveRoles(stub.db, ORG, ['payment_processing_fees'], {
        store: STORE_EU,
        rail: STRIPE_GATEWAY,
      })
    )._unsafeUnwrap()

    expect(us.get('payment_processing_fees')?.code).toBe('6101')
    expect(eu.get('payment_processing_fees')?.code).toBe('6101')
  })

  it('leaves the fee role on the default when the store is scoped and the rail is not', async () => {
    const stub = stubDb(BOTH_AXES, LIVE_SOURCES, [STRIPE_GATEWAY])
    const resolved = (
      await resolveRoles(stub.db, ORG, ['payment_processing_fees'], { store: STORE_US })
    )._unsafeUnwrap()
    expect(resolved.get('payment_processing_fees')?.code).toBe('6100')
  })

  // The currency chain (§3 rule 2): a currencied rail row wins over its rail's
  // no-currency row, which wins over the org default.
  it('walks currency, then rail, then the org default', async () => {
    const withCurrency = [
      { role: 'payment_processing_fees', glAccountId: 'acct_6100' },
      {
        role: 'payment_processing_fees',
        glAccountId: 'acct_6101',
        paymentGatewayId: STRIPE_GATEWAY,
      },
      {
        role: 'payment_processing_fees',
        glAccountId: 'acct_6100',
        paymentGatewayId: STRIPE_GATEWAY,
        currency: 'EUR',
      },
    ]
    const stub = stubDb(withCurrency, LIVE_SOURCES, [STRIPE_GATEWAY])

    const eur = (
      await resolveRoles(stub.db, ORG, ['payment_processing_fees'], {
        rail: STRIPE_GATEWAY,
        currency: 'EUR',
      })
    )._unsafeUnwrap()
    const usd = (
      await resolveRoles(stub.db, ORG, ['payment_processing_fees'], {
        rail: STRIPE_GATEWAY,
        currency: 'USD',
      })
    )._unsafeUnwrap()

    expect(eur.get('payment_processing_fees')?.code).toBe('6100')
    expect(usd.get('payment_processing_fees')?.code).toBe('6101')
  })

  // §3 rule 3: `bank` has no org-wide default, so a rail with no bank row of
  // its own is unresolved rather than reaching the org default.
  it('fails closed for a rail-scoped role with no default to fall to', async () => {
    const stub = stubDb([], LIVE_SOURCES, [STRIPE_GATEWAY])
    const result = await resolveRoles(stub.db, ORG, ['bank'], { rail: STRIPE_GATEWAY })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain("'bank'")
  })

  // A role with no axis is invisible to the whole mechanism.
  it('never scopes a role outside SCOPABLE_ROLES', async () => {
    const stub = stubDb(
      [
        { role: 'sales_tax_payable', glAccountId: 'acct_2200' },
        // A row that should be unreachable - `setRoleAssignment` refuses to
        // write it - and is ignored even so.
        { role: 'sales_tax_payable', glAccountId: 'acct_2201', sourceAccountId: STORE_US },
      ],
      LIVE_SOURCES
    )
    const resolved = (
      await resolveRoles(stub.db, ORG, ['sales_tax_payable'], { store: STORE_US })
    )._unsafeUnwrap()
    expect(resolved.get('sales_tax_payable')?.code).toBe('2200')
  })

  // 91 §4.3: a store's receivable resolves to its own account; other stores keep the default.
  it('resolves accounts_receivable through the store scope', async () => {
    const stub = stubDb(
      [
        { role: 'accounts_receivable', glAccountId: 'acct_1100' },
        { role: 'accounts_receivable', glAccountId: 'acct_1101', sourceAccountId: STORE_US },
      ],
      LIVE_SOURCES
    )
    const us = (
      await resolveRoles(stub.db, ORG, ['accounts_receivable'], { store: STORE_US })
    )._unsafeUnwrap()
    const eu = (
      await resolveRoles(stub.db, ORG, ['accounts_receivable'], { store: STORE_EU })
    )._unsafeUnwrap()
    expect(us.get('accounts_receivable')?.code).toBe('1101')
    expect(eu.get('accounts_receivable')?.code).toBe('1100')
  })
})

// 🔑 One entry, two stores. The fulfillment group merges a day's shipments into
// one journal, so this is the shape that forced the scope onto the LINE.
describe('one entry spanning two stores', () => {
  const line = (
    glAccountIdless: Pick<GlPostingLineInput, 'accountRole' | 'amount' | 'sortOrder'> & {
      sourceScope?: { store?: string | null }
    }
  ): GlPostingLineInput =>
    ({
      direction: 'credit',
      sourceType: 'fulfillment_batch',
      sourceId: '2026-09-15',
      ...glAccountIdless,
    }) as GlPostingLineInput

  it('resolves each line through its own store', async () => {
    const stub = stubDb(
      [
        DEFAULT_REVENUE,
        { role: 'revenue_product', glAccountId: 'acct_4001', sourceAccountId: STORE_US },
        { role: 'revenue_product', glAccountId: 'acct_4002', sourceAccountId: STORE_EU },
      ],
      LIVE_SOURCES
    )

    const resolved = (
      await resolveAccountLines(stub.db, ORG, [
        line({
          accountRole: 'revenue_product',
          amount: 100,
          sortOrder: 0,
          sourceScope: { store: STORE_US },
        }),
        line({
          accountRole: 'revenue_product',
          amount: 200,
          sortOrder: 1,
          sourceScope: { store: STORE_EU },
        }),
      ])
    )._unsafeUnwrap()

    expect(resolved.map((account) => account.code)).toEqual(['4001', '4002'])
  })

  // ⚠️ Precedence, stated once: the LINE wins, the entry-level scope is the
  // fallback for the lines that carry none.
  it('lets a line override the entry-level scope, and inherits it otherwise', async () => {
    const stub = stubDb(
      [
        DEFAULT_REVENUE,
        { role: 'revenue_product', glAccountId: 'acct_4001', sourceAccountId: STORE_US },
        { role: 'revenue_shipping', glAccountId: 'acct_4002', sourceAccountId: STORE_EU },
        { role: 'revenue_shipping', glAccountId: 'acct_4000' },
      ],
      LIVE_SOURCES
    )

    const resolved = (
      await resolveAccountLines(
        stub.db,
        ORG,
        [
          line({
            accountRole: 'revenue_product',
            amount: 100,
            sortOrder: 0,
            sourceScope: { store: STORE_US },
          }),
          line({ accountRole: 'revenue_shipping', amount: 20, sortOrder: 1 }),
        ],
        { store: STORE_EU }
      )
    )._unsafeUnwrap()

    expect(resolved.map((account) => account.code)).toEqual(['4001', '4002'])
  })
})

// A reversal reverses by `glAccountId` and carries the original's role as a
// snapshot only. The role door must not be asked about a line that already
// names its account, or a rail-scoped `bank` refuses at org scope and the
// reversal of every rail posting is stuck.
describe('a line that names its account does not go through the role door', () => {
  const railBank: Assignment = {
    role: 'bank',
    glAccountId: 'acct_1101',
    paymentGatewayId: STRIPE_GATEWAY,
  }

  it('resolves an id line by its id even when its snapshot role is unmapped at this scope', async () => {
    const stub = stubDb([railBank], LIVE_SOURCES, [STRIPE_GATEWAY])
    const resolved = (
      await resolveAccountLines(stub.db, ORG, [
        {
          glAccountId: 'acct_1101',
          accountRole: 'bank',
          direction: 'credit',
          amount: 3145,
          sortOrder: 0,
          sourceType: 'gl_posting',
          sourceId: 'post_1',
        } as GlPostingLineInput,
      ])
    )._unsafeUnwrap()
    expect(resolved.map((account) => account.code)).toEqual(['1101'])
  })

  it('still refuses the same role when the line has nothing but the role', async () => {
    const stub = stubDb([railBank], LIVE_SOURCES, [STRIPE_GATEWAY])
    const result = await resolveAccountLines(stub.db, ORG, [
      {
        accountRole: 'bank',
        direction: 'credit',
        amount: 3145,
        sortOrder: 0,
        sourceType: 'gl_posting',
        sourceId: 'post_1',
      } as GlPostingLineInput,
    ])
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain("'bank'")
  })
})
