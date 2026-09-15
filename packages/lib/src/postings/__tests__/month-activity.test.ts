// packages/lib/src/postings/__tests__/month-activity.test.ts
//
// The ledger sidebar's "This month" read (brief 28 §6).
//
// 🔑 Two properties. The grouped aggregate comes back as one row per posting
// type with its count and latest txn date, and the two unposted counts are the
// SAME functions `verify-balance.ts` calls for `books-health.tsx`, so the
// sidebar and the sweep cannot disagree about what is waiting for a dialog.
//
// 🛑 The third property is a NEGATIVE one: a count that could not be read is
// `null`, never zero and never a failure of the whole read. "Nothing waiting"
// and "nobody could tell" must stay different answers, and a courtesy read
// from another module must not take the posted counts off the screen.
//
// The two counts are stubbed at the module boundary - each has its own suite -
// and the database is a hand-written stub answering a queue of row sets, the
// shape `rail-fee-status.test.ts` uses for the same reason: what is under test
// is the arithmetic between the reads, not the WHERE clause.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const countUnpostedShipments = vi.fn()
const countUnpostedCreditMemos = vi.fn()
vi.mock('../../money/fulfillment-posting/reads', () => ({
  countUnpostedShipments: (...args: unknown[]) => countUnpostedShipments(...args),
}))
vi.mock('../../money/credit-memo-posting/reads', () => ({
  countUnpostedCreditMemos: (...args: unknown[]) => countUnpostedCreditMemos(...args),
}))

import type { Database } from '@auxx/database'
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
  countUnpostedShipments.mockResolvedValue(ok(0))
  countUnpostedCreditMemos.mockResolvedValue(ok(0))
})

describe('readMonthActivity', () => {
  it('groups posted entries per type with their count and latest txn date', async () => {
    const { db } = stubDb([
      { postingType: 'fulfillment', count: 12, lastTxnDate: '2026-09-13' },
      { postingType: 'payout', count: 9, lastTxnDate: '2026-09-14' },
    ])
    countUnpostedShipments.mockResolvedValue(ok(2))
    countUnpostedCreditMemos.mockResolvedValue(ok(1))

    const result = await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(result._unsafeUnwrap()).toEqual({
      month: MONTH,
      byType: [
        { postingType: 'fulfillment', count: 12, lastTxnDate: '2026-09-13' },
        { postingType: 'payout', count: 9, lastTxnDate: '2026-09-14' },
      ],
      unpostedShipments: 2,
      unpostedCreditMemos: 1,
    })
  })

  it('asks the same two count reads books-health uses, for the same org and month', async () => {
    const { db, select } = stubDb([])

    await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(select).toHaveBeenCalledTimes(1)
    expect(countUnpostedShipments).toHaveBeenCalledWith(db, { organizationId: ORG, month: MONTH })
    expect(countUnpostedCreditMemos).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      month: MONTH,
    })
  })

  it('answers an empty month with no rows and zero waiting, not a failure', async () => {
    const { db } = stubDb([])

    const result = await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    expect(result._unsafeUnwrap()).toEqual({
      month: MONTH,
      byType: [],
      unpostedShipments: 0,
      unpostedCreditMemos: 0,
    })
  })

  it('reports a count that could not be read as null, never zero, and keeps the rows', async () => {
    const { db } = stubDb([{ postingType: 'payout', count: 3, lastTxnDate: '2026-09-02' }])
    countUnpostedShipments.mockResolvedValue(err(new Error('subledger unavailable')))

    const result = await readMonthActivity(db, { organizationId: ORG, month: MONTH })

    const value = result._unsafeUnwrap()
    expect(value.byType).toEqual([{ postingType: 'payout', count: 3, lastTxnDate: '2026-09-02' }])
    expect(value.unpostedShipments).toBeNull()
    expect(value.unpostedCreditMemos).toBe(0)
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
    expect(countUnpostedShipments).not.toHaveBeenCalled()
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
