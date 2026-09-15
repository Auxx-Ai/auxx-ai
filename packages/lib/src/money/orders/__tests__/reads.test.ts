// packages/lib/src/money/orders/__tests__/reads.test.ts
//
// The single-order read behind the fulfil dialog. One property carries the
// file: the rate a line is recognised at is the line NET
// (`line_item_net_total / line_item_qty`, falling back to `line_item_line_total`,
// 29 §1.7, §2.3), and that only holds if both totals are among the fields the
// read actually asks the org cache for. Drop either from `LINE_ATTRIBUTES` and
// nothing fails - every line silently falls back a rung and the discount is
// recognised as revenue again. So the first test here is about the request, not
// the arithmetic.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every system attribute the read asked the org cache for. */
  requested: [] as string[],
  /** Row sets the stubbed `db.select()` serves, in call order. */
  selects: [] as unknown[][],
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: async () => 'def_order',
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) => {
        h.requested.push(...attrs)
        // No `tax_line` def on this org, so `readOrderTaxLines` returns
        // before it selects anything.
        return Object.fromEntries(
          attrs.map((attr) => [attr, attr.startsWith('tax_line_') ? null : { id: `f_${attr}` }])
        )
      },
    }),
  }),
}))

vi.mock('../../fulfillments', () => ({
  requireFulfillmentFieldContext: async () => ({}),
  readFulfillmentsForOrder: async () => [],
}))

import type { Database } from '@auxx/database'
import { readOrderForFulfillment } from '../reads'

const ORG = 'org_1'

/** A drizzle query-builder stub: each `select()` resolves the next queued row set. */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'innerJoin']) {
      self[method] = () => self
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.selects[index++] ?? []).then(resolve, reject)
    return self
  }
  return {
    select: () => chain(),
    query: { EntityInstance: { findFirst: async () => ({ id: 'ord_1' }) } },
  } as unknown as Database
}

/** One `FieldValue` row, in the columns the read selects. */
function value(
  entityId: string,
  attribute: string,
  columns: Partial<{
    valueText: string | null
    valueNumber: number | null
    relatedEntityId: string | null
  }> = {}
) {
  return {
    entityId,
    fieldId: `f_${attribute}`,
    valueText: null,
    valueNumber: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    sortKey: 0,
    ...columns,
  }
}

function orderRows() {
  return [
    value('ord_1', 'order_number', { valueText: 'ORD-0012' }),
    value('ord_1', 'order_subtotal', { valueNumber: 180 }),
    value('ord_1', 'order_line_items', { relatedEntityId: 'li_1' }),
  ]
}

/** Two units listed at 100. `extra` is where a test adds the line total. */
function lineRows(extra: ReturnType<typeof value>[]) {
  return [
    value('li_1', 'line_item_name', { valueText: 'Widget' }),
    value('li_1', 'line_item_qty', { valueNumber: 2 }),
    value('li_1', 'line_item_unit_price', { valueNumber: 100 }),
    ...extra,
  ]
}

async function readLine(extra: ReturnType<typeof value>[]) {
  // Two selects: the order pivot, then the line pivot. The fulfillments come
  // from the mocked reader and the tax-line read returns before selecting.
  h.selects = [orderRows(), [{ id: 'li_1' }], lineRows(extra)]
  const result = await readOrderForFulfillment(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
  return result._unsafeUnwrap().lines[0]
}

beforeEach(() => {
  h.requested = []
  h.selects = []
})

describe('readOrderForFulfillment', () => {
  it('asks the org cache for both totals, so the net basis is actually fetched', async () => {
    await readLine([])

    expect(h.requested).toContain('line_item_net_total')
    expect(h.requested).toContain('line_item_line_total')
    expect(h.requested).toContain('line_item_qty')
    expect(h.requested).toContain('line_item_unit_price')
    expect(h.requested).toContain('line_item_order')
  })

  it('recognises a line at its NET rate: the line total over the ordered quantity', async () => {
    // 20 off a line of two at 100: the customer paid 180, so 90 a unit.
    const line = await readLine([value('li_1', 'line_item_line_total', { valueNumber: 180 })])

    expect(line?.unitPriceMinor).toBe(90)
    expect(line?.quantity).toBe(2)
    expect(line?.remainingQuantity).toBe(2)
  })

  it('keeps a zero total at zero - a fully discounted line is not an unpriced one', async () => {
    const line = await readLine([value('li_1', 'line_item_line_total', { valueNumber: 0 })])

    expect(line?.unitPriceMinor).toBe(0)
  })

  it('falls back to line_item_unit_price only when the line carries no total at all', async () => {
    const line = await readLine([])

    expect(line?.unitPriceMinor).toBe(100)
  })

  // 29 §12 item 6: the builder allocates the line total by units across a
  // split line, so the raw total rides alongside the derived rate.
  it('carries the raw line total alongside the rate, and null when there is none', async () => {
    const withTotal = await readLine([value('li_1', 'line_item_line_total', { valueNumber: 181 })])
    expect(withTotal?.lineTotalMinor).toBe(181)
    expect(withTotal?.unitPriceMinor).toBe(90.5)

    const without = await readLine([])
    expect(without?.lineTotalMinor).toBeNull()
  })

  // 29 §2.3: `line_item_line_total` is GROSS and the allocated net lives in
  // `line_item_net_total`. Both the rate and the allocation basis the builder
  // gets must come from the same column.
  describe('the net column wins over the gross total (29 §2.3)', () => {
    it('reads the rate AND the allocation basis from line_item_net_total when present', async () => {
      const line = await readLine([
        value('li_1', 'line_item_line_total', { valueNumber: 200 }),
        value('li_1', 'line_item_net_total', { valueNumber: 180 }),
      ])

      expect(line?.unitPriceMinor).toBe(90)
      expect(line?.lineTotalMinor).toBe(180)
    })

    it('keeps a zero net at zero rather than falling back to the gross', async () => {
      const line = await readLine([
        value('li_1', 'line_item_line_total', { valueNumber: 200 }),
        value('li_1', 'line_item_net_total', { valueNumber: 0 }),
      ])

      expect(line?.unitPriceMinor).toBe(0)
      expect(line?.lineTotalMinor).toBe(0)
    })

    it('falls back to line_item_line_total for both when the net is null', async () => {
      // A connector org before its remap still holds the net in line_total.
      const line = await readLine([value('li_1', 'line_item_line_total', { valueNumber: 180 })])

      expect(line?.unitPriceMinor).toBe(90)
      expect(line?.lineTotalMinor).toBe(180)
    })

    it('falls back to the price, with no allocation basis, when both totals are null', async () => {
      const line = await readLine([])

      expect(line?.unitPriceMinor).toBe(100)
      expect(line?.lineTotalMinor).toBeNull()
    })
  })
})
