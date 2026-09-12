// packages/lib/src/returns/__tests__/returnable-lines.test.ts

/**
 * `returns/returnable-lines.ts` - plan section 4.6's "Add from order" read.
 *
 * `readReturnCeiling` and `readReturnedQuantityClaims` are mocked rather than
 * driven through a fake `FieldValue` join: they already carry their own tests
 * in `over-return-guard.test.ts` and this module's whole job is to call them
 * per line and shape the result, not to re-derive the ceiling. What matters
 * here is the fan-out over the order's lines, the part-name lookup, and the
 * HARD RULE that `ceilingSource: 'unknown'` never collapses to a zero ceiling.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))
vi.mock('../reads', () => ({ readReturnCeiling: vi.fn(), readReturnedQuantityClaims: vi.fn() }))

import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { readReturnCeiling, readReturnedQuantityClaims } from '../reads'
import { readReturnableLinesForOrder } from '../returnable-lines'

const LINE_ITEM_FIELDS = {
  line_item_order: { id: 'f_order' },
  line_item_name: { id: 'f_name' },
  line_item_part: { id: 'f_part' },
  line_item_qty: { id: 'f_qty' },
  line_item_sort_order: { id: 'f_sort' },
  part_title: { id: 'f_part_title' },
}

interface InstanceRow {
  id: string
  createdAt: Date
}

interface FieldValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  relatedEntityId: string | null
}

/**
 * A `db` double for the three query shapes this module issues, in the order
 * it issues them: the order's `line_item` instances, then their batched
 * `FieldValue` rows, then the batched part-name lookup (also `FieldValue`,
 * distinguished by call order since both select from the same table).
 */
function buildDb(
  instanceRows: InstanceRow[],
  lineItemValueRows: FieldValueRow[],
  partRows: { partId: string; title: string }[]
) {
  const entityChain: Record<string, unknown> = {}
  Object.assign(entityChain, {
    innerJoin: () => entityChain,
    where: () => entityChain,
    orderBy: async () => instanceRows,
  })

  let fieldValueCalls = 0
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.EntityInstance) return entityChain
        fieldValueCalls += 1
        const rows = fieldValueCalls === 1 ? lineItemValueRows : partRows
        return { where: async () => rows }
      },
    }),
  } as unknown as Database

  return db
}

beforeEach(() => {
  vi.mocked(getCachedEntityDefId).mockResolvedValue('def_line_item')
  vi.mocked(getOrgCache).mockReturnValue({
    from: () => ({ bySystemAttributes: async () => LINE_ITEM_FIELDS }),
  } as unknown as ReturnType<typeof getOrgCache>)
})

describe('readReturnableLinesForOrder', () => {
  it('returns an empty list for an order with no lines', async () => {
    const db = buildDb([], [], [])
    const result = await readReturnableLinesForOrder(db, 'org_1', 'order_1')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toEqual([])
    expect(readReturnCeiling).not.toHaveBeenCalled()
  })

  it('carries each line’s ceiling and claim total, and never zeroes an unknown ceiling', async () => {
    const instanceRows: InstanceRow[] = [
      { id: 'li_1', createdAt: new Date('2026-01-01') },
      { id: 'li_2', createdAt: new Date('2026-01-02') },
      { id: 'li_3', createdAt: new Date('2026-01-03') },
    ]
    const lineItemValueRows: FieldValueRow[] = [
      {
        entityId: 'li_1',
        fieldId: 'f_name',
        valueText: 'Widget',
        valueNumber: null,
        relatedEntityId: null,
      },
      {
        entityId: 'li_1',
        fieldId: 'f_part',
        valueText: null,
        valueNumber: null,
        relatedEntityId: 'part_1',
      },
      {
        entityId: 'li_1',
        fieldId: 'f_qty',
        valueText: null,
        valueNumber: 5,
        relatedEntityId: null,
      },
      {
        entityId: 'li_2',
        fieldId: 'f_name',
        valueText: 'Gadget',
        valueNumber: null,
        relatedEntityId: null,
      },
      {
        entityId: 'li_2',
        fieldId: 'f_part',
        valueText: null,
        valueNumber: null,
        relatedEntityId: 'part_2',
      },
      {
        entityId: 'li_2',
        fieldId: 'f_qty',
        valueText: null,
        valueNumber: 2,
        relatedEntityId: null,
      },
      {
        entityId: 'li_3',
        fieldId: 'f_name',
        valueText: 'Gizmo',
        valueNumber: null,
        relatedEntityId: null,
      },
      {
        entityId: 'li_3',
        fieldId: 'f_qty',
        valueText: null,
        valueNumber: 1,
        relatedEntityId: null,
      },
      // li_3 names no part at all.
    ]
    const db = buildDb(instanceRows, lineItemValueRows, [
      { partId: 'part_1', title: 'Widget Part' },
      { partId: 'part_2', title: 'Gadget Part' },
    ])

    vi.mocked(readReturnCeiling).mockImplementation(async (_db, _org, lineItemId) => {
      if (lineItemId === 'li_1') return { ceiling: 5, ceilingSource: 'shipped' }
      if (lineItemId === 'li_2') return { ceiling: 2, ceilingSource: 'sold' }
      return { ceiling: null, ceilingSource: 'unknown' }
    })

    // li_1 has two prior claims, across two different returns.
    vi.mocked(readReturnedQuantityClaims).mockImplementation(async (_db, _org, lineItemId) => {
      if (lineItemId === 'li_1') {
        return [
          { returnLineId: 'rl_return_a_line', quantity: 1 },
          { returnLineId: 'rl_return_b_line', quantity: 1 },
        ]
      }
      return []
    })

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
})
