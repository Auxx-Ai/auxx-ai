// packages/lib/src/accounting/purchasing/__tests__/create-purchase-order.test.ts

import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  creates: [] as { def: string; values: Record<string, unknown>; options?: unknown }[],
  constructed: 0,
  failOn: null as string | null,
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    constructor() {
      h.constructed += 1
    }
    async create(def: string, values: Record<string, unknown>, options?: unknown) {
      if (h.failOn === def) throw new Error('create failed')
      h.creates.push({ def, values, options })
      const id = `inst_${h.creates.length}`
      return {
        instance: { id },
        recordId: `def_${def}:${id}`,
        values: def === 'purchase_order' ? { purchase_order_number: 'PO-7' } : {},
      }
    }
  },
}))

import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { createPurchaseOrder } from '../create-purchase-order'

const VENDOR = 'def_company:v1' as RecordId
const PART = 'def_part:p1' as RecordId

beforeEach(() => {
  h.creates.length = 0
  h.constructed = 0
  h.failOn = null
})

describe('createPurchaseOrder', () => {
  it('writes the header, then each line absorbed into it, dropping null values', async () => {
    const result = await createPurchaseOrder({} as never, 'org_1', 'u_1', {
      header: { purchase_order_vendor: VENDOR, purchase_order_notes: null },
      lines: [
        { purchase_order_line_part: PART, purchase_order_line_quantity_ordered: 3 },
        {
          purchase_order_line_part: PART,
          purchase_order_line_quantity_ordered: 1,
          purchase_order_line_expected_unit_price: 250,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toEqual({
      purchaseOrderId: 'inst_1',
      purchaseOrderRecordId: 'def_purchase_order:inst_1',
      number: 'PO-7',
      lineIds: ['inst_2', 'inst_3'],
    })
    expect(h.creates[0]).toEqual({
      def: 'purchase_order',
      values: { purchase_order_vendor: VENDOR },
      options: undefined,
    })
    expect(h.creates[2]).toEqual({
      def: 'purchase_order_line',
      values: {
        purchase_order_line_part: PART,
        purchase_order_line_quantity_ordered: 1,
        purchase_order_line_expected_unit_price: 250,
        purchase_order_line_purchase_order: 'def_purchase_order:inst_1',
        purchase_order_line_sort_order: 1,
      },
      options: { absorbInto: 'def_purchase_order:inst_1' },
    })
  })

  it("reuses the caller's handler instead of building one", async () => {
    const handler = new UnifiedCrudHandler('org_1', 'u_1')
    h.constructed = 0
    await createPurchaseOrder(
      {} as never,
      'org_1',
      'u_1',
      { header: { purchase_order_vendor: VENDOR }, lines: [] },
      { handler }
    )
    expect(h.constructed).toBe(0)
  })

  it('returns an err rather than throwing when a create fails', async () => {
    h.failOn = 'purchase_order_line'
    const result = await createPurchaseOrder({} as never, 'org_1', 'u_1', {
      header: { purchase_order_vendor: VENDOR },
      lines: [{ purchase_order_line_part: PART, purchase_order_line_quantity_ordered: 1 }],
    })
    expect(result.isErr()).toBe(true)
  })
})
