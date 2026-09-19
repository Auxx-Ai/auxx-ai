// packages/lib/src/sales/orders/__tests__/fulfill-posting.test.ts
//
// `fulfillOrder` end to end against the REAL poster (`postings/post-entry.ts`,
// `reverse-entry.ts`, `list-postings.ts`), never mocked: this is the one place
// that proves TARGET §1's claim - one `fulfillment` posting per shipment, with
// its subject/parent/counterparty links, and a reversal that frees the claim
// so the source can post again. Everything ELSE (the record layer, the order
// read, inventory relief) is mocked, since each has its own tests - what is
// under test here is the wiring between `fulfillOrder` and the ledger.
//
// The fake database is a trimmed version of `postings/__tests__/post-entry.test.ts`'s:
// no claim-race simulation, because that behaviour is already pinned there.

import { schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../accounting/ledger/post/accounting-commit-lock', () => ({
  withAccountingCommitLock: vi.fn(),
}))
vi.mock('../../../accounting/ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
// Gate 1 is on for this file: what is under test is the posting, not the draft.
vi.mock('../../../accounting/ledger/post/auto-post', () => ({
  readAutoPostMode: async () => 'post',
}))

const h = vi.hoisted(() => ({
  fields: new Map<string, string>([
    ['gl_account_code', 'fld_code'],
    ['gl_account_name', 'fld_name'],
    ['gl_account_type', 'fld_type'],
    ['gl_account_is_active', 'fld_active'],
  ]),
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.has(a) ? { id: h.fields.get(a) } : null])),
    }),
  }),
}))

vi.mock('../../../accounting/ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: async () => true,
}))

const ORDER = {
  orderId: 'ord_1',
  recordId: 'order:ord_1',
  number: 'ORD-0012',
  channel: 'dtc',
  currency: 'USD',
  subtotalMinor: 50_00,
  taxTotalMinor: 0,
  shippingTotalMinor: 0,
  totalMinor: 50_00,
  fulfillmentStatus: 'unfulfilled',
  fulfillments: [],
  lines: [
    {
      lineId: 'li_1',
      name: 'Widget',
      quantity: 5,
      shippedQuantity: 0,
      remainingQuantity: 5,
      unitPriceMinor: 10_00,
      sortOrder: 0,
    },
  ],
  nextSequence: 1,
  shippingOwed: true,
  contactInstanceId: 'contact_1',
  taxLines: [],
}

vi.mock('../reads', () => ({ readOrderForFulfillment: async () => ok(ORDER) }))
vi.mock('../../../accounting/money/customer-money/reads', () => ({
  readOrderSourceScope: async () => ({}),
}))
vi.mock('../../fulfillments', () => ({
  createFulfillment: async () => ({
    fulfillmentInstanceId: 'ful_1',
    recordId: 'fulfillment:ful_1',
    lineInstanceIds: ['fl_1'],
  }),
  defaultFulfillmentName: (number: string | null, sequence: number) => `${number}-F${sequence}`,
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async update() {}
  },
}))
vi.mock('../../../resources/crud/tx-write-scope', () => ({
  runInTxWrite: async (_input: unknown, fn: () => Promise<unknown>) => ({
    result: await fn(),
    scope: {},
    owned: true,
  }),
}))
vi.mock('../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: async () => {} }))
vi.mock('../../../inventory/relief', () => ({
  relieveFulfillmentLines: async () =>
    ok({
      movementIds: [],
      affectedPartIds: [],
      skippedNoPart: 0,
      skippedZeroDelta: 0,
      skippedNoCost: 0,
      negativeQoHPartIds: [],
    }),
}))

import { listPostingsForSource } from '../../../accounting/ledger/reads/list-postings'
import {
  __resetAccountingProvidersForTests,
  setConnectedProviderResolver,
} from '../../../accounting/providers/provider'
import { fulfillOrder, reverseFulfillmentPosting } from '../fulfill'

const ORG = 'org_1'
const USER = 'user_1'

const RAR: { id: string; code: string; name: string; accountType: string } = {
  id: 'acct_ar',
  code: '1200',
  name: 'Accounts Receivable',
  accountType: 'asset',
}
const REVENUE: { id: string; code: string; name: string; accountType: string } = {
  id: 'acct_rev',
  code: '4000',
  name: 'Product Revenue',
  accountType: 'revenue',
}
const CHART = [
  { role: 'accounts_receivable', account: RAR },
  { role: 'revenue_product', account: REVENUE },
]

/** Values a Drizzle condition bound, the same walk `post-entry.test.ts` uses. */
function boundValues(condition: unknown): string[] {
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (node == null) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node === 'string') {
      out.push(node)
      return
    }
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>
      if ('queryChunks' in record) visit(record.queryChunks)
      else if ('value' in record) visit(record.value)
    }
  }
  visit(condition)
  return out.filter((value) => /^[A-Za-z0-9_.:-]+$/.test(value))
}

type Row = Record<string, unknown>

function createFakeDb() {
  const postings: Row[] = []
  const lines: Row[] = []
  let sources: Row[] = []
  let seq = 0

  const accounts = CHART.map((entry) => entry.account)

  const thenable = (get: () => unknown[], filtered = false) => {
    let condition: unknown
    const chain: Record<string, unknown> = {}
    chain.where = (next: unknown) => {
      condition = next
      return chain
    }
    chain.limit = () => chain
    chain.orderBy = () => chain
    chain.for = () => chain
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          if (!filtered) return get()
          const named = boundValues(condition)
          return get().filter((row) => matches(row as Row, named))
        })
        .then(resolve, reject)
    return chain
  }

  function matches(row: Row, named: string[]): boolean {
    if (named.length === 0) return true
    const own = new Set(Object.values(row).filter((v) => typeof v === 'string') as string[])
    return named.every((value) => own.has(value) || value === ORG)
  }

  type Journal = Array<{ table: Row[]; row: Row }>

  const makeDb = (journal: Journal | null): Record<string, unknown> => {
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const own: Journal = []
        try {
          const result = await fn(makeDb(own))
          // A nested call is a SAVEPOINT: its rows survive its own release and
          // are still the OUTER transaction's to roll back.
          if (journal) journal.push(...own)
          return result
        } catch (error) {
          for (const { table, row } of own) {
            const at = table.indexOf(row)
            if (at >= 0) table.splice(at, 1)
          }
          throw error
        }
      },
      execute: async () => ({ rows: [] }),

      select: () => ({
        from: (table: unknown) => {
          if (table === schema.GlRoleAssignment) {
            return thenable(() =>
              CHART.map((entry) => ({
                role: entry.role,
                glAccountId: entry.account.id,
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
                { entityId: account.id, fieldId: 'fld_code', valueText: account.code },
                { entityId: account.id, fieldId: 'fld_name', valueText: account.name },
                { entityId: account.id, fieldId: 'fld_type', optionId: account.accountType },
                { entityId: account.id, fieldId: 'fld_active', valueBoolean: true },
              ])
            )
          }
          if (table === schema.GlPosting) return thenable(() => [...postings], true)
          if (table === schema.GlPostingLine) return thenable(() => [...lines], true)
          if (table === schema.GlPostingSource) return thenable(() => [...sources], true)
          return thenable(() => [])
        },
      }),

      insert: (table: unknown) => {
        let captured: unknown
        const chain: Record<string, unknown> = {}
        let conflictGuarded = false
        chain.values = (value: unknown) => {
          captured = value
          return chain
        }
        chain.onConflictDoNothing = () => {
          conflictGuarded = true
          return chain
        }
        const run = async (): Promise<unknown[]> => {
          if (table === schema.GlPosting) {
            seq += 1
            const row: Row = { ...(captured as Row), id: `post_${seq}` }
            postings.push(row)
            journal?.push({ table: postings, row })
            return [{ id: row.id, docNumber: row.docNumber, requestId: row.requestId }]
          }
          if (table === schema.GlPostingSource) {
            const values = Array.isArray(captured) ? (captured as Row[]) : [captured as Row]
            const written: unknown[] = []
            for (const value of values) {
              const row: Row = { occurrence: 'original', ...value }
              if (conflictGuarded) {
                const holder = sources.find(
                  (existing) =>
                    existing.linkRole === 'subject' &&
                    existing.organizationId === row.organizationId &&
                    existing.sourceKind === row.sourceKind &&
                    existing.sourceId === row.sourceId &&
                    existing.occurrence === row.occurrence
                )
                if (holder) continue
              }
              seq += 1
              row.id = `src_${seq}`
              sources.push(row)
              journal?.push({ table: sources, row })
              written.push({ id: row.id })
            }
            return written
          }
          for (const row of captured as Row[]) {
            lines.push(row)
            journal?.push({ table: lines, row })
          }
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
        let values: Row = {}
        let condition: unknown
        const chain: Record<string, unknown> = {}
        chain.set = (next: Row) => {
          values = next
          return chain
        }
        chain.where = (next: unknown) => {
          condition = next
          return chain
        }
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (table !== schema.GlPosting) return
              const named = boundValues(condition)
              for (const row of postings) {
                if (!named.includes(row.id as string)) continue
                for (const [key, value] of Object.entries(values)) {
                  row[key] = key === 'built' ? row.built : value
                }
              }
            })
            .then(resolve, reject)
        return chain
      },

      delete: (table: unknown) => {
        const chain: Record<string, unknown> = {}
        let condition: unknown
        chain.where = (next: unknown) => {
          condition = next
          return chain
        }
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (table !== schema.GlPostingSource) return
              const named = boundValues(condition)
              sources = sources.filter(
                (row) =>
                  !(
                    named.includes(row.glPostingId as string) &&
                    named.includes(row.linkRole as string)
                  )
              )
            })
            .then(resolve, reject)
        return chain
      },
    }
    return db
  }

  return {
    db: makeDb(null) as never,
    get sources() {
      return sources
    },
  }
}

beforeEach(() => {
  __resetAccountingProvidersForTests()
  setConnectedProviderResolver(async () => null)
})

describe('fulfillOrder against the real poster', () => {
  it('posts one fulfillment entry with subject, parent and counterparty links', async () => {
    const fake = createFakeDb()

    const result = await fulfillOrder(fake.db, {
      organizationId: ORG,
      actorUserId: USER,
      orderId: 'ord_1',
      shippedLines: [{ lineId: 'li_1', quantity: 3 }],
      shippedAt: '2026-09-03',
    })

    expect(result.isOk()).toBe(true)
    const { fulfillment, post } = result._unsafeUnwrap()
    expect(post.status).toBe('posted')
    expect(post.glPostingId).toBeDefined()
    expect(fulfillment.glPosting).toBe(post.glPostingId)

    const bySubject = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: 'fulfillment',
      sourceId: 'ful_1',
    })
    expect(bySubject._unsafeUnwrap()).toHaveLength(1)
    expect(bySubject._unsafeUnwrap()[0]).toMatchObject({ linkRole: 'subject', status: 'posted' })

    const byOrder = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: 'order',
      sourceId: 'ord_1',
    })
    expect(byOrder._unsafeUnwrap()[0]).toMatchObject({ linkRole: 'parent' })

    const byContact = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: 'contact',
      sourceId: 'contact_1',
    })
    expect(byContact._unsafeUnwrap()[0]).toMatchObject({ linkRole: 'counterparty' })

    // One posting only - the claim is the SUBJECT row, and there is one.
    expect(fake.sources.filter((s) => s.linkRole === 'subject')).toHaveLength(1)
  })

  it('reversing the posting frees the fulfillment claim', async () => {
    const fake = createFakeDb()
    await fulfillOrder(fake.db, {
      organizationId: ORG,
      actorUserId: USER,
      orderId: 'ord_1',
      shippedLines: [{ lineId: 'li_1', quantity: 3 }],
      shippedAt: '2026-09-03',
    })

    const reversal = await reverseFulfillmentPosting(fake.db, {
      organizationId: ORG,
      fulfillmentInstanceId: 'ful_1',
      actorUserId: USER,
    })
    expect(reversal?.status).toBe('posted')

    const bySubject = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: 'fulfillment',
      sourceId: 'ful_1',
    })
    // The subject claim is gone - the fulfillment can post again.
    expect(bySubject._unsafeUnwrap()).toHaveLength(0)
  })

  it('is a no-op when the fulfillment never posted', async () => {
    const fake = createFakeDb()
    const reversal = await reverseFulfillmentPosting(fake.db, {
      organizationId: ORG,
      fulfillmentInstanceId: 'ful_never_posted',
    })
    expect(reversal).toBeNull()
  })
})
