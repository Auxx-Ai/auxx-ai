// packages/lib/src/accounting/purchasing/bill-intake/__tests__/assign.test.ts
//
// The line matcher, with no db and no LLM anywhere in this file
// (plans/money/tasks/58-vendor-bill-from-the-invoice.md §3.3, §13's "done when").

import { toRecordId } from '@auxx/types/resource'
import { describe, expect, it } from 'vitest'
import { assignBillLines, descriptionTokens, diceSimilarity, foldKey } from '../assign'
import type { BillLineFacts, OrderLineFacts } from '../client'

function billLine(partial: Partial<BillLineFacts> = {}): BillLineFacts {
  return {
    lineId: 'line_1',
    vendorCode: null,
    customerCode: null,
    description: null,
    quantity: null,
    unitPriceCents: null,
    ...partial,
  }
}

function orderLine(id: string, partial: Partial<OrderLineFacts> = {}): OrderLineFacts {
  return {
    orderLineRecordId: toRecordId('purchase_order_line', id),
    partRecordId: null,
    partSku: null,
    partTitle: null,
    vendorSku: null,
    description: null,
    ordered: 0,
    received: 0,
    billed: 0,
    expectedUnitPriceCents: null,
    sortOrder: null,
    ...partial,
  }
}

describe('foldKey', () => {
  it('lowercases, trims, and strips everything but [a-z0-9]', () => {
    expect(foldKey('ABC-001 ')).toBe('abc001')
  })

  it('is null for an empty or whitespace-only input', () => {
    expect(foldKey(null)).toBeNull()
    expect(foldKey(undefined)).toBeNull()
    expect(foldKey('   ')).toBeNull()
    expect(foldKey('---')).toBeNull()
  })
})

describe('descriptionTokens', () => {
  it('splits on non-alphanumerics and keeps numeric-bearing tokens', () => {
    expect(descriptionTokens('1/4')).toEqual(['1', '4'])
    expect(descriptionTokens('M8')).toEqual(['m8'])
    expect(descriptionTokens('40')).toEqual(['40'])
  })

  it('splits a run like M8X40 into its two size-code chunks', () => {
    expect(descriptionTokens('M8X40')).toEqual(['m8', 'x40'])
  })

  it('is empty for no description', () => {
    expect(descriptionTokens(null)).toEqual([])
  })
})

describe('diceSimilarity', () => {
  it('clears 0.5 for a description printed with different spacing and case', () => {
    const a = descriptionTokens('HEX BOLT M8X40 SS')
    const b = descriptionTokens('Hex Bolt M8 x 40 stainless')
    expect(diceSimilarity(a, b)).toBeGreaterThanOrEqual(0.5)
  })

  it('is 0 when either side has no tokens', () => {
    expect(diceSimilarity([], ['hex'])).toBe(0)
    expect(diceSimilarity(['hex'], [])).toBe(0)
    expect(diceSimilarity([], [])).toBe(0)
  })
})

describe('assignBillLines', () => {
  it('tier 1 (vendor_sku) outranks tier 2 (sku) when both hit', () => {
    const printed = [billLine({ vendorCode: 'AF-4420' })]
    const order = [
      orderLine('vendor_hit', { vendorSku: 'AF-4420' }),
      orderLine('sku_hit', { partSku: 'AF-4420' }),
    ]

    const [result] = assignBillLines(printed, order)

    expect(result?.tier).toBe('vendor_sku')
    expect(result?.linkedOrderLineRecordId).toBe(order[0]?.orderLineRecordId)
    expect(result?.candidates[0]?.reasons).toContain('vendor code matches')
  })

  it('🛑 fuzzy never links, even with quantity and price corroboration', () => {
    const printed = [
      billLine({
        description: 'Hex Bolt M8 x 40 stainless',
        quantity: 100,
        unitPriceCents: 500,
      }),
    ]
    const order = [
      orderLine('fuzzy_hit', {
        description: 'HEX BOLT M8X40 SS',
        ordered: 100,
        expectedUnitPriceCents: 500,
      }),
    ]

    const [result] = assignBillLines(printed, order)

    expect(result?.tier).toBe('fuzzy')
    expect(result?.linkedOrderLineRecordId).toBeNull()
    expect(result?.candidates[0]?.reasons).toEqual(
      expect.arrayContaining(['price matches', 'qty 100 = ordered'])
    )
  })

  it('a backorder split links both printed lines to the one order line', () => {
    const printed = [billLine({ vendorCode: 'AF-4420' }), billLine({ vendorCode: 'AF-4420' })]
    const order = [orderLine('the_one_line', { vendorSku: 'AF-4420' })]

    const result = assignBillLines(printed, order)

    expect(result[0]?.linkedOrderLineRecordId).toBe(order[0]?.orderLineRecordId)
    expect(result[1]?.linkedOrderLineRecordId).toBe(order[0]?.orderLineRecordId)
  })

  it('a freight line is none with hint charge', () => {
    const printed = [billLine({ description: 'Freight charges' })]
    const order = [orderLine('unrelated', { description: 'Widget assembly' })]

    const [result] = assignBillLines(printed, order)

    expect(result?.tier).toBe('none')
    expect(result?.candidates).toEqual([])
    expect(result?.linkedOrderLineRecordId).toBeNull()
    expect(result?.hint).toBe('charge')
  })

  it('a plain goods line with no candidate gets hint goods', () => {
    const printed = [billLine({ description: 'Assorted widgets' })]
    const [result] = assignBillLines(printed, [])

    expect(result?.hint).toBe('goods')
  })

  it('quantity corroboration reorders two equally-fuzzy candidates without linking either', () => {
    const description = 'Hex Bolt M8 x 40 stainless'
    const printed = [billLine({ description, quantity: 100 })]
    const order = [
      // Ranked first so `sortOrder` cannot accidentally favour either candidate below.
      orderLine('decoy', { description: 'Something else entirely', sortOrder: -1 }),
      orderLine('no_qty_match', { description, ordered: 50, sortOrder: 5 }),
      orderLine('qty_match', { description, ordered: 100, sortOrder: 6 }),
    ]

    const [result] = assignBillLines(printed, order)

    expect(result?.tier).toBe('fuzzy')
    expect(result?.linkedOrderLineRecordId).toBeNull()
    expect(result?.candidates[0]?.orderLineRecordId).toBe(order[2]?.orderLineRecordId)
    expect(result?.candidates[0]?.reasons).toContain('qty 100 = ordered')
  })

  it('the descriptionThreshold option is respected', () => {
    const printed = [billLine({ description: 'Hex Bolt M8 x 40 stainless' })]
    const order = [orderLine('fuzzy_hit', { description: 'HEX BOLT M8X40 SS' })]

    const loose = assignBillLines(printed, order)
    expect(loose[0]?.tier).toBe('fuzzy')

    const strict = assignBillLines(printed, order, { descriptionThreshold: 0.95 })
    expect(strict[0]?.tier).toBe('none')
  })

  it('every line is none when the order pool is empty', () => {
    const printed = [billLine({ vendorCode: 'AF-4420', description: 'Hex bolt' })]
    const result = assignBillLines(printed, [])

    expect(result[0]?.tier).toBe('none')
    expect(result[0]?.candidates).toEqual([])
    expect(result[0]?.linkedOrderLineRecordId).toBeNull()
  })

  it('candidates are capped at 5', () => {
    const printed = [billLine({ vendorCode: 'AF-4420' })]
    const order = Array.from({ length: 8 }, (_, i) =>
      orderLine(`ol_${i}`, { vendorSku: 'AF-4420' })
    )

    const [result] = assignBillLines(printed, order)

    expect(result?.candidates).toHaveLength(5)
  })
})
