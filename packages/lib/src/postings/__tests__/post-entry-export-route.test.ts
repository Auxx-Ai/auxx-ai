// packages/lib/src/postings/__tests__/post-entry-export-route.test.ts
//
// 🛑 This is the only thing standing between a provider-sourced opening
// balance fill and a doubled general ledger (brief 19 §5.1). An opening entry
// is, by construction, a copy of a position an accounting provider may have
// supplied in the first place; exporting it back would double every account
// in it, and both books would still balance - nothing downstream can tell the
// difference. `postEntry` now reads `EXPORT_ROUTE_BY_POSTING_TYPE`
// (`regime.ts`) and routes `opening_balance` to `NONE_ACCOUNTING_PROVIDER`
// BEFORE it ever resolves the org's connected provider. This file asserts
// that branch directly, against a real connected provider, and must not
// regress quietly.
//
// Setup copied from `post-entry.test.ts`: the fake database is hand-written
// because this module issues several distinct reads and writes across three
// tables and each has to answer differently. Trimmed here to a single,
// non-concurrent post - no claim mutex, no collision modelling - since that is
// all these two cases need.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fields: new Map<string, string>() }))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.has(a) ? { id: h.fields.get(a) } : null])),
    }),
  }),
}))

import { ok } from 'neverthrow'
import { postEntry } from '../post-entry'
import {
  __resetAccountingProvidersForTests,
  registerAccountingProvider,
  setConnectedProviderResolver,
} from '../provider'
import type { BuiltEntry, PostEntryInput, PostEntryResult, PostingType } from '../types'

const ORG = 'org_1'
const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

const OPEN = { lockedThroughMonth: null }

interface Account {
  id: string
  code: string | null
  name: string
  accountType: string
}

interface Chart {
  role: string
  account?: Account
}

interface PostingRow extends Record<string, unknown> {
  id: string
  docNumber: string
  requestId: string
}

const CASH: Account = { id: 'acct_cash', code: '1000', name: 'Cash', accountType: 'asset' }
const OPENING_EQUITY: Account = {
  id: 'acct_oe',
  code: '3900',
  name: 'Opening Balance Equity',
  accountType: 'equity',
}
const RENT: Account = {
  id: 'acct_rent',
  code: '6200',
  name: 'Rent Expense',
  accountType: 'expense',
}
const ACCRUED: Account = {
  id: 'acct_accrued',
  code: '2100',
  name: 'Accrued Liabilities',
  accountType: 'liability',
}

const CHART: Chart[] = [
  { role: 'cash', account: CASH },
  { role: 'opening_balance_equity', account: OPENING_EQUITY },
  { role: 'unused_rent', account: RENT },
  { role: 'unused_accrued', account: ACCRUED },
]

// ── The fake database ──────────────────────────────────────────────────────

function createFakeDb(chart: Chart[]) {
  const postings: PostingRow[] = []
  const lines: Record<string, unknown>[] = []
  let seq = 0

  const accounts = chart.filter((entry) => entry.account).map((entry) => entry.account as Account)

  const thenable = (get: () => unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.where = () => chain
    chain.limit = () => chain
    chain.orderBy = () => chain
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => get())
        .then(resolve, reject)
    return chain
  }

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),

    select: () => ({
      from: (table: unknown) => {
        if (table === schema.GlRoleAssignment) {
          return thenable(() =>
            chart.map((entry) => ({
              role: entry.role,
              glAccountId: entry.account?.id ?? `missing_${entry.role}`,
              markedUnused: false,
            }))
          )
        }
        if (table === schema.EntityInstance) {
          return thenable(() => accounts.map((account) => ({ id: account.id })))
        }
        if (table === schema.FieldValue) {
          return thenable(() =>
            accounts.flatMap((account) => [
              { entityId: account.id, fieldId: CODE_FIELD, valueText: account.code },
              { entityId: account.id, fieldId: NAME_FIELD, valueText: account.name },
              { entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType },
              { entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: true },
            ])
          )
        }
        if (table === schema.GlPosting) return thenable(() => [...postings])
        if (table === schema.GlPostingLine) return thenable(() => [...lines])
        return thenable(() => [])
      },
    }),

    insert: (table: unknown) => {
      let captured: unknown
      const chain: Record<string, unknown> = {}
      chain.values = (value: unknown) => {
        captured = value
        return chain
      }
      chain.onConflictDoNothing = () => chain
      const run = async (): Promise<unknown[]> => {
        if (table === schema.GlPosting) {
          seq += 1
          const row = { ...(captured as Record<string, unknown>), id: `post_${seq}` } as PostingRow
          postings.push(row)
          return [{ id: row.id, docNumber: row.docNumber, requestId: row.requestId }]
        }
        lines.push(...(captured as Record<string, unknown>[]))
        return []
      }
      chain.returning = () => ({
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          run().then(resolve, reject),
      })
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        run().then(resolve, reject)
      return chain
    },

    update: (table: unknown) => {
      let values: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.set = (next: Record<string, unknown>) => {
        values = next
        return chain
      }
      chain.where = () => chain
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            if (table !== schema.GlPosting) return
            for (const row of postings) Object.assign(row, values)
          })
          .then(resolve, reject)
      return chain
    },
  }

  return { db: db as never, postings, lines }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function codedEntry(
  postingType: PostingType,
  codes: [string, string],
  overrides: Partial<BuiltEntry> = {}
): BuiltEntry {
  return {
    postingType,
    periodKey: '2025-12-31',
    txnDate: '2025-12-31',
    lines: [
      {
        accountCode: codes[0],
        direction: 'debit',
        amount: 50_000,
        sourceType: 'journal_entry',
        sourceId: 'je_1',
        sortOrder: 0,
      },
      {
        accountCode: codes[1],
        direction: 'credit',
        amount: 50_000,
        sourceType: 'journal_entry',
        sourceId: 'je_1',
        sortOrder: 1,
      },
    ],
    totalDebit: 50_000,
    totalCredit: 50_000,
    ...overrides,
  }
}

/** The account-map half of `AccountingProvider`, stubbed to "nothing mapped, nothing to map". */
const NO_ACCOUNT_MAP = {
  listProviderAccounts: async () => ok([]),
  readProviderOpeningBalances: async () => ok(null),
  listAccountMappings: async () => ok(new Map<string, string>()),
  setAccountMapping: async () => ok(undefined),
  clearAccountMapping: async () => ok(undefined),
}

function registerFakeProvider(
  id: string,
  postEntryFn: (input: PostEntryInput) => Promise<ReturnType<typeof ok<PostEntryResult>>>
) {
  registerAccountingProvider(id, async () => ({
    id,
    ...NO_ACCOUNT_MAP,
    resolveAccount: async (_org: string, code: string) => ok(code),
    postEntry: postEntryFn,
  }))
  setConnectedProviderResolver(async () => id)
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', CODE_FIELD],
    ['gl_account_name', NAME_FIELD],
    ['gl_account_type', TYPE_FIELD],
    ['gl_account_is_active', ACTIVE_FIELD],
  ])
  __resetAccountingProvidersForTests()
})

describe('opening_balance never reaches the connected provider', () => {
  it('routes opening_balance to NONE even with a provider connected and answering', async () => {
    const fake = createFakeDb(CHART)
    const fakePostEntry = vi.fn(async (_input: PostEntryInput) =>
      ok({ status: 'posted' as const, externalId: 'qb_1', providerId: 'stub' })
    )
    registerFakeProvider('stub', fakePostEntry)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: codedEntry('opening_balance', ['1000', '3900']),
      lock: OPEN,
    })

    expect(fakePostEntry).not.toHaveBeenCalled()
    expect(result.status).toBe('not_connected')
    expect(result.providerId).toBe('none')
    // The ledger still took the entry - only the export is skipped.
    expect(fake.postings).toHaveLength(1)
    expect(fake.lines).toHaveLength(2)
  })

  it('proves the branch: a manual_journal through the SAME fake provider IS called once', async () => {
    const fake = createFakeDb(CHART)
    const fakePostEntry = vi.fn(async (_input: PostEntryInput) =>
      ok({ status: 'posted' as const, externalId: 'qb_2', providerId: 'stub' })
    )
    registerFakeProvider('stub', fakePostEntry)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: codedEntry('manual_journal', ['6200', '2100'], { periodKey: 'JNL-0001' }),
      lock: OPEN,
    })

    expect(fakePostEntry).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('posted')
    expect(result.providerId).toBe('stub')
    expect(result.providerEntryId).toBe('qb_2')
  })
})
