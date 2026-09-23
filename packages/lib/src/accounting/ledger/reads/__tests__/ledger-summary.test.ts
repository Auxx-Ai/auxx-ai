// packages/lib/src/accounting/ledger/reads/__tests__/ledger-summary.test.ts
//
// A fake db in `post-entry.test.ts`'s style: the interesting behaviour is the
// BUCKETING and per-side SUMMING this file does in memory, not Postgres's own filtering,
// so the fake hands back fixed rows per call rather than re-implementing SQL.
// `excludePostingIds` is the one option Postgres itself applies (a `notInArray`)
// - proved by walking the captured `WHERE` for the excluded id's literal,
// the same walk `post-entry.test.ts` uses to read a fake condition's bound values.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { avenueOfPostingType } from '../../setup/export-settings'
import type { PostingType } from '../../types'
import { readLedgerSummary, sumSummaryLines } from '../ledger-summary'

/** Walk a Drizzle condition tree and collect the literal values it binds. */
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
  return out
}

/** One `select()` call per response, in order: the posting headers, then their lines. */
function fakeDb(responses: unknown[][]): { db: Database; wheres: unknown[] } {
  const wheres: unknown[] = []
  let call = 0
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'orderBy', 'limit']) chain[method] = passthrough
  chain.where = (condition: unknown) => {
    wheres.push(condition)
    return chain
  }
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const rows = responses[call] ?? []
    call += 1
    return Promise.resolve(rows).then(resolve, reject)
  }
  return { db: { select: () => chain } as unknown as Database, wheres }
}

const ORG = 'org_1'

function posting(overrides: {
  id: string
  postingType?: string
  txnDate: string
  storeId?: string | null
  railId?: string | null
  payoutId?: string | null
  currency?: string
  totalMinor: number
}) {
  const row = {
    postingType: 'fulfillment',
    storeId: 'store_1',
    railId: null,
    payoutId: null,
    currency: 'USD',
    ...overrides,
  }
  // The read groups on the stored column, which the poster derives the same way.
  return { ...row, avenue: avenueOfPostingType(row.postingType as PostingType) }
}

function line(
  glPostingId: string,
  glAccountId: string,
  direction: 'debit' | 'credit',
  amountMinor: number,
  accountCode = glAccountId
) {
  return { glPostingId, glAccountId, accountCode, direction, amountMinor }
}

const DAY_GRAIN = {
  fulfillment: 'day' as const,
  invoice: 'day' as const,
  receipt: 'day' as const,
  refund: 'day' as const,
  creditMemo: 'day' as const,
  expenseBill: 'day' as const,
  vendorPayment: 'day' as const,
  vendorCredit: 'day' as const,
  inventory: 'day' as const,
}

describe('readLedgerSummary', () => {
  it('combines two postings on the same day and store into one row, summed by account', async () => {
    const { db } = fakeDb([
      [
        posting({ id: 'p1', txnDate: '2026-09-10', totalMinor: 1000 }),
        posting({ id: 'p2', txnDate: '2026-09-10', totalMinor: 500 }),
      ],
      [
        line('p1', 'acct_ar', 'debit', 1000),
        line('p1', 'acct_rev', 'credit', 1000),
        line('p2', 'acct_ar', 'debit', 500),
        line('p2', 'acct_rev', 'credit', 500),
      ],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      avenue: 'fulfillment',
      grainKey: '2026-09-10',
      storeId: 'store_1',
      railId: null,
      currency: 'USD',
      totalMinor: 1500,
      txnDateFrom: '2026-09-10',
      txnDateTo: '2026-09-10',
    })
    expect(rows[0]!.postingIds.sort()).toEqual(['p1', 'p2'])
    expect(rows[0]!.lines).toEqual(
      expect.arrayContaining([
        { glAccountId: 'acct_ar', accountCode: 'acct_ar', direction: 'debit', amountMinor: 1500 },
        {
          glAccountId: 'acct_rev',
          accountCode: 'acct_rev',
          direction: 'credit',
          amountMinor: 1500,
        },
      ])
    )
  })

  it('keeps the debit and credit sides of one account as two lines, so Σdebit equals the total', async () => {
    const { db } = fakeDb([
      [
        posting({ id: 'p1', postingType: 'payment', txnDate: '2026-09-10', totalMinor: 1000 }),
        posting({ id: 'p2', postingType: 'payment', txnDate: '2026-09-10', totalMinor: 400 }),
      ],
      [
        // A/R in on one posting and out on another - two lines, never a 600 residual.
        line('p1', 'acct_ar', 'debit', 1000),
        line('p1', 'acct_rev', 'credit', 1000),
        line('p2', 'acct_clearing', 'debit', 400),
        line('p2', 'acct_ar', 'credit', 400),
      ],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    const lines = rows[0]!.lines
    expect(lines).toHaveLength(4)
    expect(lines).toEqual(
      expect.arrayContaining([
        { glAccountId: 'acct_ar', accountCode: 'acct_ar', direction: 'debit', amountMinor: 1000 },
        { glAccountId: 'acct_ar', accountCode: 'acct_ar', direction: 'credit', amountMinor: 400 },
      ])
    )
    const debit = lines
      .filter((l) => l.direction === 'debit')
      .reduce((a, l) => a + l.amountMinor, 0)
    const credit = lines
      .filter((l) => l.direction === 'credit')
      .reduce((a, l) => a + l.amountMinor, 0)
    expect(debit).toBe(rows[0]!.totalMinor)
    expect(credit).toBe(rows[0]!.totalMinor)
  })

  it('buckets by payout under the payout grain, with the day as the catch-all', async () => {
    const { db } = fakeDb([
      [
        posting({
          id: 'p1',
          postingType: 'payment',
          txnDate: '2026-09-10',
          payoutId: 'po_1',
          totalMinor: 100,
        }),
        posting({
          id: 'p2',
          postingType: 'payment',
          txnDate: '2026-09-11',
          payoutId: 'po_1',
          totalMinor: 200,
        }),
        posting({
          id: 'p3',
          postingType: 'payment',
          txnDate: '2026-09-11',
          payoutId: 'po_2',
          totalMinor: 300,
        }),
        posting({ id: 'p4', postingType: 'payment', txnDate: '2026-09-11', totalMinor: 400 }),
        posting({ id: 'p5', postingType: 'payment', txnDate: '2026-09-11', totalMinor: 500 }),
      ],
      [],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: { ...DAY_GRAIN, receipt: 'payout' },
    })

    const rows = result._unsafeUnwrap()
    const byGrain = new Map(rows.map((row) => [row.grainKey, row]))
    expect([...byGrain.keys()].sort()).toEqual(['2026-09-11', 'po_1', 'po_2'])
    // One payout spans two days and stays one row.
    expect(byGrain.get('po_1')).toMatchObject({
      payoutId: 'po_1',
      totalMinor: 300,
      txnDateFrom: '2026-09-10',
      txnDateTo: '2026-09-11',
    })
    expect(byGrain.get('po_2')).toMatchObject({ payoutId: 'po_2', totalMinor: 300 })
    expect(byGrain.get('2026-09-11')).toMatchObject({ payoutId: null, totalMinor: 900 })
  })

  it('ignores the payout id under the day grain', async () => {
    const { db } = fakeDb([
      [
        posting({
          id: 'p1',
          postingType: 'payment',
          txnDate: '2026-09-10',
          payoutId: 'po_1',
          totalMinor: 100,
        }),
        posting({
          id: 'p2',
          postingType: 'payment',
          txnDate: '2026-09-10',
          payoutId: 'po_2',
          totalMinor: 200,
        }),
      ],
      [],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ grainKey: '2026-09-10', payoutId: null, totalMinor: 300 })
  })

  it('keeps two postings on the same day and store as two rows when their rail differs', async () => {
    const { db } = fakeDb([
      [
        posting({
          id: 'p1',
          postingType: 'payment',
          railId: 'rail_a',
          txnDate: '2026-09-10',
          totalMinor: 1000,
        }),
        posting({
          id: 'p2',
          postingType: 'payment',
          railId: 'rail_b',
          txnDate: '2026-09-10',
          totalMinor: 500,
        }),
      ],
      [line('p1', 'acct_a', 'debit', 1000), line('p2', 'acct_b', 'debit', 500)],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.railId).sort()).toEqual(['rail_a', 'rail_b'])
    expect(rows.every((row) => row.avenue === 'receipt')).toBe(true)
  })

  it('buckets by month when the avenue grain is month, spanning the whole range', async () => {
    const { db } = fakeDb([
      [
        posting({ id: 'p1', txnDate: '2026-09-05', totalMinor: 1000 }),
        posting({ id: 'p2', txnDate: '2026-09-20', totalMinor: 500 }),
      ],
      [line('p1', 'acct_a', 'debit', 1000), line('p2', 'acct_a', 'debit', 500)],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: { ...DAY_GRAIN, fulfillment: 'month' },
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.grainKey).toBe('2026-09')
    expect(rows[0]!.txnDateFrom).toBe('2026-09-05')
    expect(rows[0]!.txnDateTo).toBe('2026-09-20')
    expect(rows[0]!.totalMinor).toBe(1500)
  })

  it('never combines a grain-less avenue across postings - the posting id is its own grain', async () => {
    const { db } = fakeDb([
      [
        posting({
          id: 'j1',
          postingType: 'manual_journal',
          txnDate: '2026-09-10',
          totalMinor: 100,
        }),
        posting({
          id: 'j2',
          postingType: 'manual_journal',
          txnDate: '2026-09-10',
          totalMinor: 200,
        }),
      ],
      [line('j1', 'acct_a', 'debit', 100), line('j2', 'acct_a', 'debit', 200)],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.grainKey).sort()).toEqual(['j1', 'j2'])
  })

  it('passes excludePostingIds to the query as a notInArray over GlPosting.id', async () => {
    // The excluded posting never comes back from Postgres - simulated here by
    // simply not including it in the fixture the fake hands back.
    const { db, wheres } = fakeDb([
      [posting({ id: 'p1', txnDate: '2026-09-10', totalMinor: 1000 })],
      [line('p1', 'acct_a', 'debit', 1000)],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
      excludePostingIds: ['p2_batched'],
    })

    expect(boundValues(wheres[0])).toContain('p2_batched')
    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.postingIds).toEqual(['p1'])
  })

  it('filters to one avenue when asked, in the query', async () => {
    const { db, wheres } = fakeDb([
      [posting({ id: 'p1', postingType: 'fulfillment', txnDate: '2026-09-10', totalMinor: 1000 })],
      [line('p1', 'acct_a', 'debit', 1000)],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      avenue: 'fulfillment',
      grainByAvenue: DAY_GRAIN,
    })

    expect(boundValues(wheres[0])).toContain('fulfillment')
    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.avenue).toBe('fulfillment')
  })
})

describe('sumSummaryLines', () => {
  it('sums per account and side, never nets, and drops zero lines', () => {
    const lines = sumSummaryLines([
      { glAccountId: 'ar', accountCode: '1200', direction: 'debit', amountMinor: 500 },
      { glAccountId: 'ar', accountCode: '1200', direction: 'debit', amountMinor: '250' },
      { glAccountId: 'ar', accountCode: '1200', direction: 'credit', amountMinor: 300 },
      { glAccountId: 'rev', accountCode: null, direction: 'credit', amountMinor: 0 },
    ])
    expect(lines).toEqual([
      { glAccountId: 'ar', accountCode: '1200', direction: 'debit', amountMinor: 750 },
      { glAccountId: 'ar', accountCode: '1200', direction: 'credit', amountMinor: 300 },
    ])
  })
})
