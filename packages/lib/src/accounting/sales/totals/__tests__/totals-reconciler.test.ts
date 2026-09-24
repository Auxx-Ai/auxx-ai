// packages/lib/src/accounting/sales/totals/__tests__/totals-reconciler.test.ts
// The totals reconcilers are batch: uncapped, and one failing document does not stop the rest.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  recomputeTotals: vi.fn(async (_p: { documentType: string; documentInstanceId: string }) => {}),
  systemFieldMap: vi.fn(),
  readFieldRelations: vi.fn(),
}))

vi.mock('../totals-hooks', () => ({ recomputeTotals: h.recomputeTotals }))
vi.mock('../../../../resources/system-records', () => ({ systemFieldMap: h.systemFieldMap }))
vi.mock('../../../../field-values/read-field-scalars', () => ({
  readFieldRelations: h.readFieldRelations,
}))

import {
  __resetReconcilersForTest,
  MAX_DIRTY_PARENTS_PER_KEY,
  markParentDirty,
  runWithDirtyParents,
} from '../../../../reconcilers/dirty-parents'
import {
  MONEY_TOTALS_LINE_ITEM,
  moneyTotalsDocumentKey,
  registerMoneyTotalsReconcilers,
} from '../totals-reconciler'

const ORG = 'org_1'
const LINE_ORDER_FIELD = 'f-li-order'

beforeEach(() => {
  vi.clearAllMocks()
  __resetReconcilersForTest()
  registerMoneyTotalsReconcilers()
  h.systemFieldMap.mockResolvedValue({ line_item_order: { id: LINE_ORDER_FIELD } })
  h.readFieldRelations.mockImplementation(
    async (_db: unknown, _org: string, lineIds: string[]) =>
      new Map(lineIds.map((id) => [id, new Map([[LINE_ORDER_FIELD, `order_of_${id}`]])]))
  )
})

describe('money totals reconcilers — batch', () => {
  it('one failing document does not stop the other two', async () => {
    h.recomputeTotals.mockImplementation(async ({ documentInstanceId }) => {
      if (documentInstanceId === 'q2') throw new Error('boom')
    })

    await runWithDirtyParents(ORG, 'user_1', async () => {
      for (const id of ['q1', 'q2', 'q3']) markParentDirty(moneyTotalsDocumentKey('quote'), id)
    })

    expect(h.recomputeTotals.mock.calls.map(([p]) => p.documentInstanceId)).toEqual([
      'q1',
      'q2',
      'q3',
    ])
  })

  it('recomputes every order past the dirty-parent cap', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line_${i}`)
    expect(lines.length).toBeGreaterThan(MAX_DIRTY_PARENTS_PER_KEY)

    await runWithDirtyParents(ORG, 'user_1', async () => {
      for (const id of lines) markParentDirty(MONEY_TOTALS_LINE_ITEM, id)
    })

    expect(h.recomputeTotals).toHaveBeenCalledTimes(600)
    expect(new Set(h.recomputeTotals.mock.calls.map(([p]) => p.documentInstanceId)).size).toBe(600)
    expect(h.recomputeTotals.mock.calls[0]![0]).toMatchObject({ documentType: 'order' })
  })
})
