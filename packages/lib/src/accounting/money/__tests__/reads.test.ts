// packages/lib/src/accounting/money/__tests__/reads.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { netApplied } from '../client'
import {
  listLiveApplications,
  selectLiveApplications,
  sumAppliedByMovement,
  sumAppliedToVendorBill,
} from '../reads'

vi.mock('drizzle-orm', () => ({
  and: () => undefined,
  asc: () => undefined,
  eq: () => undefined,
  inArray: () => undefined,
  or: () => undefined,
}))

const application = (overrides: Record<string, unknown>) => ({
  id: 'a1',
  moneyTransactionId: 'mt-1',
  operation: 'apply',
  amountMinor: 1_000n,
  discountMinor: 0n,
  invoiceInstanceId: null,
  reversesApplicationId: null,
  ...overrides,
})

const db = (rows: unknown[]) =>
  ({ query: { MoneyApplication: { findMany: async () => rows } } }) as unknown as Database

describe('netApplied', () => {
  it('subtracts unapply rows from apply rows', () => {
    expect(
      netApplied([
        { operation: 'apply', amountMinor: 1_000n },
        { operation: 'unapply', amountMinor: 400n },
      ])
    ).toBe(600n)
  })

  it('is zero for no rows at all', () => {
    expect(netApplied([])).toBe(0n)
  })
})

describe('selectLiveApplications', () => {
  it('drops an apply row an unapply already names', () => {
    const rows = [
      application({ id: 'a1' }),
      application({ id: 'a2', operation: 'unapply', reversesApplicationId: 'a1' }),
      application({ id: 'a3' }),
    ]
    expect(selectLiveApplications(rows).map((row) => row.id)).toEqual(['a3'])
  })

  it('keeps every apply row when nothing was taken back', () => {
    const rows = [application({ id: 'a1' }), application({ id: 'a2' })]
    expect(selectLiveApplications(rows)).toHaveLength(2)
  })
})

describe('listLiveApplications', () => {
  it('narrows to one invoice when asked', async () => {
    const rows = [
      application({ id: 'a1', invoiceInstanceId: 'inv-a' }),
      application({ id: 'a2', invoiceInstanceId: 'inv-b' }),
      application({ id: 'a3', operation: 'unapply', reversesApplicationId: 'a1' }),
    ]
    const live = await listLiveApplications(db(rows), 'org', 'mt-1', {
      invoiceInstanceId: 'inv-b',
    })
    expect(live.map((row) => row.id)).toEqual(['a2'])
  })
})

describe('sumAppliedByMovement', () => {
  it('nets each movement separately and omits movements with no rows', async () => {
    const rows = [
      application({ id: 'a1', moneyTransactionId: 'mt-1', amountMinor: 1_000n }),
      application({
        id: 'a2',
        moneyTransactionId: 'mt-1',
        operation: 'unapply',
        amountMinor: 400n,
        reversesApplicationId: 'a1',
      }),
      application({ id: 'a3', moneyTransactionId: 'mt-2', amountMinor: 250n }),
    ]
    const sums = await sumAppliedByMovement(db(rows), 'org', ['mt-1', 'mt-2', 'mt-3'])
    expect(sums.get('mt-1')).toBe(600n)
    expect(sums.get('mt-2')).toBe(250n)
    expect(sums.has('mt-3')).toBe(false)
  })

  it('asks nothing of the database for an empty id list', async () => {
    const findMany = vi.fn()
    const spy = { query: { MoneyApplication: { findMany } } } as unknown as Database
    expect((await sumAppliedByMovement(spy, 'org', [])).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('sumAppliedToVendorBill', () => {
  it('nets the money and the discount apart', async () => {
    const rows = [
      application({ id: 'a1', amountMinor: 9_000n, discountMinor: 1_000n }),
      application({
        id: 'a2',
        operation: 'unapply',
        amountMinor: 4_000n,
        discountMinor: 500n,
        reversesApplicationId: 'a1',
      }),
    ]
    expect(await sumAppliedToVendorBill(db(rows), 'org', 'vb-1')).toEqual({
      amountMinor: 5_000n,
      discountMinor: 500n,
    })
  })
})
