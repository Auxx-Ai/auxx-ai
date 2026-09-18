// packages/lib/src/returns/__tests__/returnable-lines.test.ts

/**
 * `returns/returnable-lines.ts` - plan section 4.6's "Add from order" read.
 *
 * `readReturnCeilings` and `readReturnedQuantityClaimsBatch` are mocked rather
 * than driven through a fake `FieldValue` join: they already carry their own
 * tests in `over-return-guard.test.ts` and this module's whole job is to call
 * them ONCE for the order and shape the result, not to re-derive the ceiling.
 * What matters here is that the fan-out is gone (one batched call, not one per
 * line), the part-name lookup, and the HARD RULE that `ceilingSource:
 * 'unknown'` never collapses to a zero ceiling.
 */

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../resources/system-records', () => ({
  systemFields: vi.fn(),
  readSystemRecords: vi.fn(),
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  batchGetRelatedDisplayNames: vi.fn(),
}))
vi.mock('../reads', () => ({
  readReturnCeilings: vi.fn(),
  readReturnedQuantityClaimsBatch: vi.fn(),
}))

import { batchGetRelatedDisplayNames } from '../../field-values/field-value-helpers'
import { readSystemRecords, systemFields } from '../../resources/system-records'
import { readReturnCeilings, readReturnedQuantityClaimsBatch } from '../reads'
import { readReturnableLinesForOrder } from '../returnable-lines'

const db = {} as Database

const CTX = {
  defId: 'def_line_item',
  fields: {
    line_item_order: { id: 'f_order' },
    line_item_name: { id: 'f_name' },
    line_item_part: { id: 'f_part' },
    line_item_qty: { id: 'f_qty' },
    line_item_sort_order: { id: 'f_sort' },
  },
}

/** A `SystemRecord` stand-in: only the accessors this module calls. */
function record(
  id: string,
  cells: { name?: string; partId?: string; qty?: number; sortOrder?: number }
) {
  const part = cells.partId ?? null
  return {
    id,
    text: (attribute: string) => (attribute === 'line_item_name' ? (cells.name ?? null) : null),
    number: (attribute: string) => {
      if (attribute === 'line_item_qty') return cells.qty ?? null
      if (attribute === 'line_item_sort_order') return cells.sortOrder ?? null
      return null
    },
    related: (attribute: string) => (attribute === 'line_item_part' ? part : null),
    cell: (attribute: string) =>
      attribute === 'line_item_part' && part
        ? { type: 'relationship' as const, recordId: `def_part:${part}` }
        : undefined,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // biome-ignore lint/suspicious/noExplicitAny: a SystemFieldContext stand-in
  vi.mocked(systemFields).mockResolvedValue(CTX as any)
  vi.mocked(batchGetRelatedDisplayNames).mockResolvedValue(new Map())
  vi.mocked(readReturnCeilings).mockResolvedValue(new Map())
  vi.mocked(readReturnedQuantityClaimsBatch).mockResolvedValue(new Map())
})

describe('readReturnableLinesForOrder', () => {
  it('returns an empty list for an order with no lines', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([])
    const result = await readReturnableLinesForOrder(db, 'org_1', 'order_1')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toEqual([])
    expect(readReturnCeilings).not.toHaveBeenCalled()
  })

  it('carries each line’s ceiling and claim total, and never zeroes an unknown ceiling', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([
      record('li_1', { name: 'Widget', partId: 'part_1', qty: 5 }),
      record('li_2', { name: 'Gadget', partId: 'part_2', qty: 2 }),
      // li_3 names no part at all.
      record('li_3', { name: 'Gizmo', qty: 1 }),
      // biome-ignore lint/suspicious/noExplicitAny: a SystemRecord stand-in
    ] as any)
    vi.mocked(batchGetRelatedDisplayNames).mockResolvedValue(
      new Map([
        ['part_1', 'Widget Part'],
        ['part_2', 'Gadget Part'],
      ])
    )
    vi.mocked(readReturnCeilings).mockResolvedValue(
      new Map([
        ['li_1', { ceiling: 5, ceilingSource: 'shipped' }],
        ['li_2', { ceiling: 2, ceilingSource: 'sold' }],
        ['li_3', { ceiling: null, ceilingSource: 'unknown' }],
      ])
    )
    // li_1 has two prior claims, across two different returns.
    vi.mocked(readReturnedQuantityClaimsBatch).mockResolvedValue(
      new Map([
        [
          'li_1',
          [
            { returnLineId: 'rl_return_a_line', quantity: 1 },
            { returnLineId: 'rl_return_b_line', quantity: 1 },
          ],
        ],
      ])
    )

    const result = await readReturnableLinesForOrder(db, 'org_1', 'order_1')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    const [lineWithClaims, lineWithNone, lineUnknown] = result.value
    if (!lineWithClaims || !lineWithNone || !lineUnknown) {
      throw new Error(`expected three lines, got ${result.value.length}`)
    }

    expect(lineWithClaims).toMatchObject({
      lineItemId: 'li_1',
      recordId: 'def_line_item:li_1',
      name: 'Widget',
      partId: 'part_1',
      partName: 'Widget Part',
      quantitySold: 5,
      ceiling: 5,
      alreadyReturned: 2,
      remaining: 3,
      ceilingSource: 'shipped',
    })

    expect(lineWithNone).toMatchObject({
      lineItemId: 'li_2',
      partName: 'Gadget Part',
      ceiling: 2,
      alreadyReturned: 0,
      remaining: 2,
      ceilingSource: 'sold',
    })

    // HARD RULE (plan section 4.6): 'unknown' never collapses to a zero
    // ceiling, and is never blocking. It must render as "no ceiling
    // recorded", which is what ceiling: null / remaining: null encodes.
    expect(lineUnknown).toMatchObject({
      lineItemId: 'li_3',
      partId: null,
      partName: null,
      ceiling: null,
      alreadyReturned: 0,
      remaining: null,
      ceilingSource: 'unknown',
    })
    expect(lineUnknown.ceiling).not.toBe(0)
    expect(lineUnknown.remaining).not.toBe(0)
  })

  it('reads the order’s lines and their ceilings ONCE, not once per line', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([
      record('li_1', { qty: 1 }),
      record('li_2', { qty: 1 }),
      record('li_3', { qty: 1 }),
      // biome-ignore lint/suspicious/noExplicitAny: a SystemRecord stand-in
    ] as any)

    await readReturnableLinesForOrder(db, 'org_1', 'order_1')

    expect(readSystemRecords).toHaveBeenCalledTimes(1)
    expect(readReturnCeilings).toHaveBeenCalledTimes(1)
    expect(readReturnedQuantityClaimsBatch).toHaveBeenCalledTimes(1)
    expect(readReturnCeilings).toHaveBeenCalledWith(db, 'org_1', ['li_1', 'li_2', 'li_3'], {
      // The quantities already read with the lines: no line is measured twice.
      soldQuantities: new Map([
        ['li_1', 1],
        ['li_2', 1],
        ['li_3', 1],
      ]),
    })
  })

  it('asks the order for its lines by the relationship, not by a hand-written join', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([])
    await readReturnableLinesForOrder(db, 'org_1', 'order_1')
    expect(readSystemRecords).toHaveBeenCalledWith(db, 'org_1', CTX, {
      by: { attribute: 'line_item_order', in: ['order_1'] },
    })
  })
})
