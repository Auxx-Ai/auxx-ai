// packages/lib/src/accounting/ledger/reads/__tests__/latest-by-type.test.ts

import { describe, expect, it } from 'vitest'
import { readLatestPostingsByType } from '../latest-by-type'

/**
 * Brief 28 §3.2: one grouped read gives every Posting page section its
 * "Last posted" line. These pin the shape the page renders from and the two
 * things a caller could get wrong reading the rows back: a `Date` where the
 * page expects a day key, and a type nothing has posted yet.
 */

/** A `db` whose `selectDistinctOn` chain records its arguments and returns `rows`. */
function fakeDb(rows: unknown[]) {
  const calls: { distinctOn: unknown[]; orderBy: unknown[] } = { distinctOn: [], orderBy: [] }
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy(...columns: unknown[]) {
      calls.orderBy = columns
      return Promise.resolve(rows)
    },
  }
  return {
    db: {
      selectDistinctOn: (columns: unknown[]) => {
        calls.distinctOn = columns
        return builder
      },
    } as never,
    calls,
  }
}

describe('readLatestPostingsByType', () => {
  it('returns one row per type, as day keys', async () => {
    const { db } = fakeDb([
      {
        postingType: 'fulfillment',
        txnDate: '2026-09-13',
        docNumber: 'ORD-0012-F1',
        status: 'posted',
      },
      {
        postingType: 'payout',
        txnDate: new Date('2026-09-14T00:00:00.000Z'),
        docNumber: 'PAY-0042',
        status: 'posted',
      },
    ])

    const result = await readLatestPostingsByType(db, { organizationId: 'org-1' })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([
      {
        postingType: 'fulfillment',
        txnDate: '2026-09-13',
        docNumber: 'ORD-0012-F1',
        status: 'posted',
      },
      { postingType: 'payout', txnDate: '2026-09-14', docNumber: 'PAY-0042', status: 'posted' },
    ])
  })

  it('answers an empty ledger with an empty list, not an error', async () => {
    const { db } = fakeDb([])
    const result = await readLatestPostingsByType(db, { organizationId: 'org-1' })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('collapses on the posting type and orders newest first within it', async () => {
    // Postgres requires the DISTINCT ON column to lead the ORDER BY, and the
    // page's "latest" is by accounting date then creation time. Three ordering
    // terms, the first of which is the one distinct column.
    const { db, calls } = fakeDb([])
    await readLatestPostingsByType(db, { organizationId: 'org-1' })
    expect(calls.distinctOn).toHaveLength(1)
    expect(calls.orderBy).toHaveLength(3)
  })

  it('reports a failing read as an error result rather than throwing', async () => {
    const db = {
      selectDistinctOn: () => {
        throw new Error('connection reset')
      },
    } as never
    const result = await readLatestPostingsByType(db, { organizationId: 'org-1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('Internal error')
  })
})
