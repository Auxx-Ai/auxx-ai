// packages/lib/src/accounting/money/customer-money/__tests__/order-evidence-reconciler.test.ts
//
// LIB-LAYOUT §3f: the router this replaced ran the assessment inline on every
// rule fire, so a twenty-line order edit assessed the same order twenty times.
// Nothing in the old suite could see that — it asserted which orders were passed,
// never how many times. The witness here is `reconcileOrderPaymentEvidence`
// itself, mocked and counted.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithDirtyParents } from '../../../../reconcilers/dirty-parents'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  rebuild: vi.fn(),
  relationRows: vi.fn(),
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../record-evidence', () => ({ reconcileOrderPaymentEvidence: h.rebuild }))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  return {
    schema,
    database: { select: () => ({ from: () => ({ where: () => h.relationRows() }) }) },
  }
})

import {
  markOrderEvidence,
  reconcileOrderEvidenceFromSync,
  registerOrderEvidenceReconciler,
} from '../order-evidence-reconciler'

const ORG = 'org_1'
const USER = 'usr_1'

const FIELDS: Record<string, { id: string }> = {
  line_item_order: { id: 'f-li-order' },
  customer_transaction_order: { id: 'f-ct-order' },
}

/** A child pointing at an order, as the set-based relation read sees it. */
const childOnOrder = (fieldId: string, childId: string, orderId: string) => ({
  entityId: childId,
  fieldId,
  relatedEntityId: orderId,
})

/** The orders one rebuild was handed. */
const rebuiltOrders = (call = 0): string[] =>
  [...(h.rebuild.mock.calls[call]?.[1].orderInstanceIds ?? [])].sort()

beforeAll(() => {
  registerOrderEvidenceReconciler()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.rebuild.mockResolvedValue({ examined: 0 })
  h.relationRows.mockResolvedValue([])
})

describe('order payment evidence rebuilds once per write', () => {
  it('collapses 30 line fires on one order into ONE assessment', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `li-${i}`)
    h.relationRows.mockResolvedValue(lines.map((id) => childOnOrder('f-li-order', id, 'order-1')))

    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of lines) {
        // The three attributes one line write moves.
        await markOrderEvidence(ORG, USER, 'line_item', id)
        await markOrderEvidence(ORG, USER, 'line_item', id)
        await markOrderEvidence(ORG, USER, 'line_item', id)
      }
    })

    expect(h.rebuild).toHaveBeenCalledOnce()
    expect(rebuiltOrders()).toEqual(['order-1'])
    expect(h.relationRows).toHaveBeenCalledTimes(1)
  })

  it('merges an order marked directly with its own dirtied line', async () => {
    h.relationRows.mockResolvedValue([childOnOrder('f-li-order', 'li-1', 'order-1')])

    await runWithDirtyParents(ORG, USER, async () => {
      await markOrderEvidence(ORG, USER, 'order', 'order-1')
      await markOrderEvidence(ORG, USER, 'line_item', 'li-1')
    })

    expect(h.rebuild).toHaveBeenCalledOnce()
    expect(rebuiltOrders()).toEqual(['order-1'])
  })

  it('resolves a customer transaction through its own relation', async () => {
    h.relationRows.mockResolvedValue([childOnOrder('f-ct-order', 'ct-1', 'order-2')])

    await runWithDirtyParents(ORG, USER, async () => {
      await markOrderEvidence(ORG, USER, 'customer_transaction', 'ct-1')
    })

    expect(rebuiltOrders()).toEqual(['order-2'])
  })

  it('still assesses each distinct order', async () => {
    h.relationRows.mockResolvedValue([
      childOnOrder('f-li-order', 'li-1', 'order-1'),
      childOnOrder('f-li-order', 'li-2', 'order-2'),
    ])

    await runWithDirtyParents(ORG, USER, async () => {
      await markOrderEvidence(ORG, USER, 'line_item', 'li-1')
      await markOrderEvidence(ORG, USER, 'line_item', 'li-2')
    })

    expect(h.rebuild).toHaveBeenCalledOnce()
    expect(rebuiltOrders()).toEqual(['order-1', 'order-2'])
  })

  it('assesses nothing for a line that hangs off no order', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await markOrderEvidence(ORG, USER, 'line_item', 'orphan')
    })

    expect(h.rebuild).not.toHaveBeenCalled()
  })

  it('assesses inline when nothing will drain', async () => {
    await markOrderEvidence(ORG, USER, 'order', 'order-3')

    expect(h.rebuild).toHaveBeenCalledOnce()
    expect(rebuiltOrders()).toEqual(['order-3'])
  })

  it('takes the whole batch on the sync-finalize seam, in one assessment', async () => {
    h.relationRows.mockResolvedValue([childOnOrder('f-li-order', 'li-1', 'order-1')])
    const db = {} as never

    await reconcileOrderEvidenceFromSync(db, ORG, ['order:order-1', 'line_item:li-1', 'order:o-2'])

    expect(h.rebuild).toHaveBeenCalledOnce()
    expect(h.rebuild.mock.calls[0]![0]).toBe(db)
    expect(rebuiltOrders()).toEqual(['o-2', 'order-1'])
  })
})
