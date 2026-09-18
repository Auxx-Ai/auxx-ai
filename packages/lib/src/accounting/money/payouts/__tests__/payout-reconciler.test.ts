// packages/lib/src/accounting/money/payouts/__tests__/payout-reconciler.test.ts
//
// The degenerate half of LIB-LAYOUT §3f: the marked record IS the parent, so what
// this pins is the coalescing and the batch shape — N fires on the same write
// produce ONE `assessPayouts` call holding every distinct owner.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithDirtyParents } from '../../../../reconcilers/dirty-parents'

const h = vi.hoisted(() => ({
  assess: vi.fn(),
  bridge: vi.fn(),
  owners: vi.fn(),
  order: [] as string[],
  db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => h.owners() }) }) }) },
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  return { schema, database: h.db }
})
vi.mock('../assess-payouts', () => ({ assessPayouts: h.assess }))
vi.mock('../../customer-money/bridge', () => ({ bridgeFinancialRecords: h.bridge }))

import { markPayoutForAssessment, registerPayoutReconciler } from '../payout-reconciler'

const ORG = 'org_1'
const USER = 'usr_1'

/** The owners one assessment was handed. */
const assessed = (call = 0): string[] => [...(h.assess.mock.calls[call]?.[2] ?? [])].sort()

beforeAll(() => {
  registerPayoutReconciler()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.order = []
  h.owners.mockResolvedValue([])
  h.bridge.mockImplementation(async () => {
    h.order.push('bridge')
  })
  h.assess.mockImplementation(async () => {
    h.order.push('assess')
    return 0
  })
})

describe('payout assessment runs once per write', () => {
  it('collapses repeated fires on three payouts into ONE assessment', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of ['p1', 'p2', 'p3', 'p1', 'p2']) {
        await markPayoutForAssessment(ORG, USER, id)
      }
    })

    expect(h.assess).toHaveBeenCalledOnce()
    expect(h.assess.mock.calls[0]![0]).toBe(h.db)
    expect(h.assess.mock.calls[0]![1]).toBe(ORG)
    expect(assessed()).toEqual(['p1', 'p2', 'p3'])
  })

  it('assesses inline when nothing will drain', async () => {
    await markPayoutForAssessment(ORG, USER, 'p9')

    expect(h.assess).toHaveBeenCalledOnce()
    expect(assessed()).toEqual(['p9'])
  })

  it('does nothing for an empty id', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await markPayoutForAssessment(ORG, USER, '')
    })

    expect(h.assess).not.toHaveBeenCalled()
  })

  it('bridges the marked owners before it assesses them', async () => {
    h.owners.mockResolvedValue([
      { id: 'p1', entityType: 'payout' },
      { id: 'e1', entityType: 'processor_balance_entry' },
    ])

    await markPayoutForAssessment(ORG, USER, 'p1')

    expect(h.order).toEqual(['bridge', 'assess'])
    expect(h.bridge.mock.calls[0]![1].records).toEqual([
      { id: 'p1', kind: 'payout' },
      { id: 'e1', kind: 'processor_balance_entry' },
    ])
  })
})
