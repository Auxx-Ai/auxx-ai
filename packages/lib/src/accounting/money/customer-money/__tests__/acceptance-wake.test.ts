// packages/lib/src/accounting/money/customer-money/__tests__/acceptance-wake.test.ts
//
// 79 §4.2: the two marks that make a parked acceptance's work item due again.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldChangeRef } from '../../../../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  readFieldRelations: vi.fn(),
  requeueAcceptancesForOrders: vi.fn(),
  repointGuestReceiptsForOrders: vi.fn(),
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
vi.mock('../repoint-guest-party', () => ({
  repointGuestReceiptsForOrders: h.repointGuestReceiptsForOrders,
}))

import { runWithDirtyParents } from '../../../../reconcilers/dirty-parents'
import {
  registerMoneyAcceptanceWakeReconcilers,
  wakeAcceptancesOnCreditMemoChange,
  wakeAcceptancesOnOrderChange,
} from '../acceptance-wake'

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
  h.repointGuestReceiptsForOrders.mockResolvedValue(0)
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
      // Accepted receipts have no work item to wake; their guest party is repointed directly.
      expect(h.repointGuestReceiptsForOrders).toHaveBeenCalledWith(expect.anything(), ORG, [
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
