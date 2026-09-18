// packages/lib/src/returns/__tests__/return-ceilings.test.ts

/**
 * The two numbers the over-return guard is fed from, now batched (plan §3d
 * item 1): `readReturnCeilings` and `readReturnedQuantityClaimsBatch` take a
 * list, and the single-line functions the guard calls are derived from them.
 *
 * What is pinned here is the pair of distinctions the guard breaks without:
 * absent shipped data falls back to sold, a provisioned `line_item_qty` with no
 * row is a ceiling of ZERO, and only a missing FIELD reads as unknown.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fieldMap: vi.fn(),
  systemFields: vi.fn(),
  readSystemRecords: vi.fn(),
  lineCtx: vi.fn(),
  rows: vi.fn(),
}))

vi.mock('@auxx/database', async () => ({
  schema: await import('../../../../database/src/db/schema/index'),
}))

vi.mock('../../resources/system-records', async () => ({
  systemFieldMap: h.fieldMap,
  systemFields: h.systemFields,
  readSystemRecords: h.readSystemRecords,
  systemValueJoin: () => undefined,
}))

vi.mock('../fields', () => ({
  loadReturnLineFieldContext: h.lineCtx,
}))

import type { Database } from '@auxx/database'
import {
  readReturnCeiling,
  readReturnCeilings,
  readReturnedQuantityClaims,
  readReturnedQuantityClaimsBatch,
} from '../reads'

/** A query-builder stand-in: every chained shape ends at `h.rows()`. */
const db = {
  select: () => chain(),
} as unknown as Database

function chain() {
  const node: Record<string, unknown> = {}
  const self = () => node
  Object.assign(node, {
    from: self,
    innerJoin: self,
    leftJoin: self,
    $dynamic: self,
    where: async () => h.rows(),
  })
  return node
}

const FULFILLMENT_FIELDS = {
  fulfillment_line_line_item: { id: 'f_fl_li' },
  fulfillment_line_quantity: { id: 'f_fl_qty' },
  fulfillment_line_fulfillment: { id: 'f_fl_f' },
  fulfillment_status: { id: 'f_f_status' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldMap.mockResolvedValue(FULFILLMENT_FIELDS)
  h.rows.mockResolvedValue([])
  h.systemFields.mockResolvedValue({ defId: 'def_li', fields: { line_item_qty: { id: 'f_qty' } } })
  h.readSystemRecords.mockResolvedValue([])
})

describe('readReturnCeilings', () => {
  it('sums the dispatch quantities per line and calls the fallback for nobody else', async () => {
    h.rows.mockResolvedValue([
      { lineItemId: 'li_1', quantity: 2 },
      { lineItemId: 'li_1', quantity: 1 },
      { lineItemId: 'li_2', quantity: 0 },
    ])

    const ceilings = await readReturnCeilings(db, 'org_1', ['li_1', 'li_2'])

    expect(ceilings.get('li_1')).toEqual({ ceiling: 3, ceilingSource: 'shipped' })
    // Zero shipped is a real ceiling that refuses every return, not an absence.
    expect(ceilings.get('li_2')).toEqual({ ceiling: 0, ceilingSource: 'shipped' })
    expect(h.readSystemRecords).not.toHaveBeenCalled()
  })

  it('falls back to the sold quantity only for the lines with no dispatch data', async () => {
    h.rows.mockResolvedValue([{ lineItemId: 'li_1', quantity: 4 }])
    h.readSystemRecords.mockResolvedValue([
      { id: 'li_2', number: () => 7 },
      { id: 'li_3', number: () => null },
    ])

    const ceilings = await readReturnCeilings(db, 'org_1', ['li_1', 'li_2', 'li_3'])

    expect(h.readSystemRecords.mock.calls[0]?.[3]).toMatchObject({ ids: ['li_2', 'li_3'] })
    expect(ceilings.get('li_1')).toEqual({ ceiling: 4, ceilingSource: 'shipped' })
    expect(ceilings.get('li_2')).toEqual({ ceiling: 7, ceilingSource: 'sold' })
    // 🛑 A provisioned field with no row is a ceiling of zero, not unknown.
    expect(ceilings.get('li_3')).toEqual({ ceiling: 0, ceilingSource: 'sold' })
  })

  it('answers unknown - never zero - when the org has no line_item_qty field', async () => {
    h.systemFields.mockResolvedValue({ defId: 'def_li', fields: { line_item_qty: null } })

    const ceilings = await readReturnCeilings(db, 'org_1', ['li_1'])

    expect(ceilings.get('li_1')).toEqual({ ceiling: null, ceilingSource: 'unknown' })
  })

  it('takes the sold quantities the caller already read rather than reading them again', async () => {
    const ceilings = await readReturnCeilings(db, 'org_1', ['li_1'], {
      soldQuantities: new Map([['li_1', 9]]),
    })

    expect(ceilings.get('li_1')).toEqual({ ceiling: 9, ceilingSource: 'sold' })
    expect(h.systemFields).not.toHaveBeenCalled()
  })

  it('derives the single-line read from the batch', async () => {
    h.rows.mockResolvedValue([{ lineItemId: 'li_1', quantity: 2 }])
    expect(await readReturnCeiling(db, 'org_1', 'li_1')).toEqual({
      ceiling: 2,
      ceilingSource: 'shipped',
    })
  })
})

describe('readReturnedQuantityClaimsBatch', () => {
  beforeEach(() => {
    h.lineCtx.mockResolvedValue({
      defId: 'def_rl',
      fields: {
        return_line_line_item: { id: 'f_rl_li' },
        return_line_quantity: { id: 'f_rl_qty' },
      },
    })
  })

  it('groups every claim by the line it points at, across returns', async () => {
    h.rows.mockResolvedValue([
      { id: 'rl_a', lineItemId: 'li_1', quantity: 1 },
      { id: 'rl_b', lineItemId: 'li_1', quantity: 2 },
      { id: 'rl_c', lineItemId: 'li_2', quantity: null },
    ])

    const claims = await readReturnedQuantityClaimsBatch(db, 'org_1', ['li_1', 'li_2', 'li_3'])

    expect(claims.get('li_1')).toEqual([
      { returnLineId: 'rl_a', quantity: 1 },
      { returnLineId: 'rl_b', quantity: 2 },
    ])
    expect(claims.get('li_2')).toEqual([{ returnLineId: 'rl_c', quantity: 0 }])
    expect(claims.get('li_3')).toBeUndefined()
  })

  it('answers an empty list, never a refusal, when returns are not provisioned', async () => {
    h.lineCtx.mockResolvedValue(null)
    expect(await readReturnedQuantityClaimsBatch(db, 'org_1', ['li_1'])).toEqual(new Map())
  })

  it('derives the single-line read from the batch', async () => {
    h.rows.mockResolvedValue([{ id: 'rl_a', lineItemId: 'li_1', quantity: 3 }])
    expect(await readReturnedQuantityClaims(db, 'org_1', 'li_1')).toEqual([
      { returnLineId: 'rl_a', quantity: 3 },
    ])
    expect(await readReturnedQuantityClaims(db, 'org_1', 'li_9')).toEqual([])
  })
})
