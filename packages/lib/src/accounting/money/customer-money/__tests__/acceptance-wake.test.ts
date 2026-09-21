// packages/lib/src/accounting/money/customer-money/__tests__/acceptance-wake.test.ts
//
// 79 §4.2: the two marks that re-queue an acceptance parked with `nextAttemptAt = null`,
// and the reason classifier that decides which rows park in the first place.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldChangeRef } from '../../../../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  readFieldRelations: vi.fn(),
  requeueAcceptancesForOrders: vi.fn(),
}))

// Real `defineParentReconciler` + real `resolveParentsByRelation`; only the two queries
// underneath and the one write are stubbed; `database` comes from the suite-wide mock.
vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../../field-values/read-field-scalars', () => ({
  readFieldRelations: h.readFieldRelations,
}))
vi.mock('../source-writes', () => ({
  requeueAcceptancesForOrders: h.requeueAcceptancesForOrders,
}))

import { runWithDirtyParents } from '../../../../reconcilers/dirty-parents'
import {
  registerMoneyAcceptanceWakeReconcilers,
  wakeAcceptancesOnCreditMemoChange,
  wakeAcceptancesOnOrderChange,
} from '../acceptance-wake'
import { nextAttemptForReason } from '../ingest'

const ORG = 'org_1'
const USER = 'usr_1'
const CREDIT_MEMO_ORDER_FIELD = { id: 'f-credit-memo-order' }

/** `creditMemoInstanceId -> orderInstanceId`, set per test. */
let orderOfMemo: Record<string, string> = {}

function event(
  entitySlug: string,
  entityType: string,
  instanceId: string,
  systemAttribute: string
): FieldChangeRef {
  return {
    recordId: `${entityType}_def:${instanceId}`,
    entityDefinitionId: `${entityType}_def`,
    entityType,
    entitySlug,
    field: { id: 'f', systemAttribute } as FieldChangeRef['field'],
    organizationId: ORG,
    userId: USER,
  } as FieldChangeRef
}

const orderEvent = (id: string, attr: string) => event('orders', 'order', id, attr)
const memoEvent = (id: string, attr: string) => event('credit-memos', 'credit_memo', id, attr)

beforeAll(() => {
  registerMoneyAcceptanceWakeReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  orderOfMemo = {}
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    attrs.includes('credit_memo_order') ? { credit_memo_order: CREDIT_MEMO_ORDER_FIELD } : {}
  )
  h.readFieldRelations.mockImplementation(
    async (_db: unknown, _org: string, childIds: string[], fieldIds: string[]) => {
      const out = new Map<string, Map<string, string>>()
      for (const childId of childIds) {
        const parent = orderOfMemo[childId]
        if (parent) out.set(childId, new Map([[fieldIds[0]!, parent]]))
      }
      return out
    }
  )
  h.requeueAcceptancesForOrders.mockResolvedValue(undefined)
})

describe('wakeAcceptancesOnOrderChange', () => {
  for (const attr of ['order_contact', 'order_currency', 'order_total'])
    it(`re-queues the order's acceptances on a ${attr} write`, async () => {
      await runWithDirtyParents(ORG, USER, async () => {
        await wakeAcceptancesOnOrderChange(orderEvent('order_1', attr))
      })

      expect(h.requeueAcceptancesForOrders).toHaveBeenCalledTimes(1)
      expect(h.requeueAcceptancesForOrders).toHaveBeenCalledWith(expect.anything(), ORG, [
        'order_1',
      ])
    })

  it('coalesces two writes on one order into one drain', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await wakeAcceptancesOnOrderChange(orderEvent('order_1', 'order_contact'))
      await wakeAcceptancesOnOrderChange(orderEvent('order_1', 'order_total'))
    })

    expect(h.requeueAcceptancesForOrders).toHaveBeenCalledTimes(1)
  })

  it('ignores a field no parked reason reads', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await wakeAcceptancesOnOrderChange(orderEvent('order_1', 'order_status'))
    })

    expect(h.requeueAcceptancesForOrders).not.toHaveBeenCalled()
  })
})

describe('wakeAcceptancesOnCreditMemoChange', () => {
  it('resolves the memo to its order and wakes that order', async () => {
    orderOfMemo = { memo_1: 'order_1' }

    await runWithDirtyParents(ORG, USER, async () => {
      await wakeAcceptancesOnCreditMemoChange(memoEvent('memo_1', 'credit_memo_order'))
    })

    expect(h.requeueAcceptancesForOrders).toHaveBeenCalledWith(expect.anything(), ORG, ['order_1'])
  })

  it('ignores a write to any other credit-memo field', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await wakeAcceptancesOnCreditMemoChange(memoEvent('memo_1', 'credit_memo_total'))
    })

    expect(h.requeueAcceptancesForOrders).not.toHaveBeenCalled()
  })
})

describe('nextAttemptForReason', () => {
  it('parks a wake-on-change reason with no next attempt', () => {
    expect(
      nextAttemptForReason('Order customer or currency is unresolved or incompatible', 1)
    ).toBe(null)
    expect(
      nextAttemptForReason('Refund original receipt or credit document is unresolved', 9)
    ).toBe(null)
  })

  it('doubles a backoff reason from 60 s and caps it at 6 h', () => {
    const at = (attempts: number) =>
      nextAttemptForReason('Transaction success is not yet confirmed', attempts)!.getTime() -
      Date.now()

    expect(at(1)).toBeCloseTo(60_000, -3)
    expect(at(2)).toBeCloseTo(120_000, -3)
    expect(at(3)).toBeCloseTo(240_000, -3)
    expect(at(9)).toBeCloseTo(15_360_000, -3)
    expect(at(10)).toBeCloseTo(21_600_000, -3)
    expect(at(97)).toBeCloseTo(21_600_000, -3)
  })
})
