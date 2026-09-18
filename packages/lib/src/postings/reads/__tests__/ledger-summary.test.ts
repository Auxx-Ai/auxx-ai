// packages/lib/src/postings/reads/__tests__/ledger-summary.test.ts
//
// A fake db in `post-entry.test.ts`'s style: the interesting behaviour is the
// BUCKETING and NETTING this file does in memory, not Postgres's own filtering,
// so the fake hands back fixed rows per call rather than re-implementing SQL.
// `excludePostingIds` is the one option Postgres itself applies (a `notInArray`)
// - proved by walking the captured `WHERE` for the excluded id's literal,
// the same walk `post-entry.test.ts` uses to read a fake condition's bound values.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { readLedgerSummary } from '../ledger-summary'

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
  currency?: string
  totalMinor: number
}) {
  return {
    postingType: 'fulfillment',
    storeId: 'store_1',
    railId: null,
    currency: 'USD',
    ...overrides,
  }
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
  receipt: 'day' as const,
  refund: 'day' as const,
  creditMemo: 'day' as const,
  invoice: 'day' as const,
  expenseBill: 'day' as const,
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

  it('nets an account that took both a debit and a credit inside one group down to one line', async () => {
    const { db } = fakeDb([
      [posting({ id: 'p1', txnDate: '2026-09-10', totalMinor: 1000 })],
      [
        // A clearing account debited by one leg and credited by another within
        // the same posting - the net is a single line, not two.
        line('p1', 'acct_clearing', 'debit', 1000),
        line('p1', 'acct_clearing', 'credit', 400),
        line('p1', 'acct_rev', 'credit', 600),
      ],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows[0]!.lines).toEqual(
      expect.arrayContaining([
        {
          glAccountId: 'acct_clearing',
          accountCode: 'acct_clearing',
          direction: 'debit',
          amountMinor: 600,
        },
        { glAccountId: 'acct_rev', accountCode: 'acct_rev', direction: 'credit', amountMinor: 600 },
      ])
    )
    expect(rows[0]!.lines).toHaveLength(2)
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

  it('filters to one avenue when asked', async () => {
    const { db } = fakeDb([
      [
        posting({ id: 'p1', postingType: 'fulfillment', txnDate: '2026-09-10', totalMinor: 1000 }),
        posting({ id: 'p2', postingType: 'payout', txnDate: '2026-09-10', totalMinor: 500 }),
      ],
      [line('p1', 'acct_a', 'debit', 1000)],
    ])

    const result = await readLedgerSummary(db, {
      organizationId: ORG,
      from: '2026-09-01',
      to: '2026-09-30',
      avenue: 'fulfillment',
      grainByAvenue: DAY_GRAIN,
    })

    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.avenue).toBe('fulfillment')
  })
})
