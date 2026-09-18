// packages/lib/src/postings/__tests__/month-activity.test.ts
//
// The ledger sidebar's "This month" read (brief 28 §6).
//
// 🔑 One property under test: the grouped aggregate comes back as one row per
// posting type with its count and latest txn date.
//
// `unpostedShipments` and `unpostedCreditMemos` are always `null` now - both
// avenues post eagerly (step 1b, TARGET §1), so there is no batch/effect
// backlog left to count. TODO(step-1b): recompute from live drafts once the
// per-avenue `accounting.autoPost` setting lands.
//
// The database is a hand-written stub answering a queue of row sets, the
// shape `rail-fee-status.test.ts` uses for the same reason: what is under
// test is the arithmetic between the reads, not the WHERE clause.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../errors'
import { readMonthActivity } from '../month-activity'

const ORG = 'org_1'
const MONTH = '2026-09'

/**
 * A `Database` that answers each `select()` chain with the next queued row set.
 * The module makes exactly one query: the grouped posting aggregate.
 */
function stubDb(...results: unknown[][]) {
  const queue = [...results]
  const select = vi.fn(() => {
    const rows = queue.shift() ?? []
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
      chain[method] = passthrough
    }
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return chain
  })
  return { db: { select } as unknown as Database, select }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readMonthActivity', () => {
  it('groups posted entries per type with their count and latest txn date', async () => {
    const { db } = stubDb([
      { postingType: 'fulfillment', count: 12, lastTxnDate: '2026-09-13' },
      { postingType: 'payout', count: 9, lastTxnDate: '2026-09-14' },
    ])

    const result = await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(result._unsafeUnwrap()).toEqual({
      month: MONTH,
      byType: [
        { postingType: 'fulfillment', count: 12, lastTxnDate: '2026-09-13' },
        { postingType: 'payout', count: 9, lastTxnDate: '2026-09-14' },
      ],
      unpostedShipments: null,
      unpostedCreditMemos: null,
    })
  })

  it('makes exactly one query', async () => {
    const { db, select } = stubDb([])

    await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(select).toHaveBeenCalledTimes(1)
  })

  it('answers an empty month with no rows and nothing countable, not a failure', async () => {
    const { db } = stubDb([])

    const result = await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(result._unsafeUnwrap()).toEqual({
      month: MONTH,
      byType: [],
      unpostedShipments: null,
      unpostedCreditMemos: null,
    })
  })

  it('drops a zero-count row the driver might hand back rather than listing it', async () => {
    const { db } = stubDb([{ postingType: 'write_off', count: 0, lastTxnDate: null }])

    const result = await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(result._unsafeUnwrap().byType).toEqual([])
  })

  it('refuses a day key: the read is about a month', async () => {
    const { db, select } = stubDb([])

    const result = await readMonthActivity(db, { organizationId: ORG, month: '2026-09-14' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(select).not.toHaveBeenCalled()
  })

  it('refuses a malformed month before touching the database', async () => {
    const { db, select } = stubDb([])

    const result = await readMonthActivity(db, { organizationId: ORG, month: '2026-13' })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(select).not.toHaveBeenCalled()
  })

  it('accepts December, whose next month is in the following year', async () => {
    const { db } = stubDb([{ postingType: 'payout', count: 1, lastTxnDate: '2026-12-31' }])

    const result = await readMonthActivity(db, { organizationId: ORG, month: '2026-12' })

    expect(result._unsafeUnwrap().month).toBe('2026-12')
    expect(result._unsafeUnwrap().byType).toHaveLength(1)
  })
})
