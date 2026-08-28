// packages/lib/src/builds/__tests__/drift-hooks.test.ts
//
// The trigger vocabulary is the whole of what this feature reacts to, and both
// ways of getting it wrong are quiet: too narrow and an edit changes the demand
// without moving the fingerprint (the defect plan 13 §0 is about, wearing a new
// field); too wide and the fingerprint moves on an edit that asks the floor for
// nothing different, so drift stops meaning anything.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent, EntityPostDeleteEvent } from '../../field-hooks/types'

const h = vi.hoisted(() => ({ markOrder: vi.fn(), markLine: vi.fn() }))

vi.mock('../drift-reconciler', () => ({
  markOrStampOrder: h.markOrder,
  markOrStampOrderLine: h.markLine,
}))

import {
  LINE_DEMAND_TRIGGER_ATTRS,
  ORDER_DEMAND_TRIGGER_ATTRS,
  stampOrderAfterLineDelete,
  stampOrderOnLineChange,
  stampOrderOnOrderChange,
} from '../drift-hooks'

const ORG = 'org_1'

const lineEvent = (systemAttribute: string, oldValue: unknown = null) =>
  ({
    recordId: 'line_item:li-1',
    organizationId: ORG,
    userId: 'usr_1',
    field: { id: 'f', systemAttribute, type: 'NUMBER' },
    oldValue,
  }) as unknown as EntityFieldChangeEvent

const orderEvent = (systemAttribute: string) =>
  ({
    recordId: 'order:ord-1',
    organizationId: ORG,
    userId: 'usr_1',
    field: { id: 'f', systemAttribute, type: 'DATETIME' },
  }) as unknown as EntityFieldChangeEvent

beforeEach(() => {
  vi.clearAllMocks()
  h.markOrder.mockResolvedValue(undefined)
  h.markLine.mockResolvedValue(undefined)
})

describe('the line trigger vocabulary', () => {
  it('names exactly the three attributes that move DEMAND', () => {
    expect([...LINE_DEMAND_TRIGGER_ATTRS].sort()).toEqual([
      'line_item_order',
      'line_item_part',
      'line_item_qty',
    ])
  })

  it('excludes the money vocabulary — a price change asks the floor for nothing new', () => {
    for (const attr of ['line_item_unit_price', 'line_item_discount', 'line_item_taxable']) {
      expect(LINE_DEMAND_TRIGGER_ATTRS.has(attr as never)).toBe(false)
    }
  })

  it.each(['line_item_part', 'line_item_qty', 'line_item_order'])('marks on %s', async (attr) => {
    await stampOrderOnLineChange(lineEvent(attr))
    expect(h.markLine).toHaveBeenCalledWith(ORG, 'li-1')
  })

  it('ignores an attribute outside the set', async () => {
    await stampOrderOnLineChange(lineEvent('line_item_unit_price'))
    expect(h.markLine).not.toHaveBeenCalled()
    expect(h.markOrder).not.toHaveBeenCalled()
  })
})

describe('a reparented line changes TWO orders', () => {
  it('marks the order it left as well as the one it joined', async () => {
    await stampOrderOnLineChange(
      lineEvent('line_item_order', { type: 'relationship', recordId: 'order:ord-old' })
    )

    // The new parent comes from the line itself; the old one is reachable only
    // through `oldValue`, and without it the order it left keeps claiming demand
    // that walked away.
    expect(h.markLine).toHaveBeenCalledWith(ORG, 'li-1')
    expect(h.markOrder).toHaveBeenCalledWith(ORG, 'ord-old')
  })

  it('marks only the line when it had no previous order', async () => {
    await stampOrderOnLineChange(lineEvent('line_item_order', null))
    expect(h.markLine).toHaveBeenCalledTimes(1)
    expect(h.markOrder).not.toHaveBeenCalled()
  })

  it('does not look for a previous order on a part or quantity edit', async () => {
    await stampOrderOnLineChange(
      lineEvent('line_item_qty', { type: 'relationship', recordId: 'order:ord-old' })
    )
    expect(h.markOrder).not.toHaveBeenCalled()
  })
})

describe('the order trigger vocabulary', () => {
  it('is cancellation and nothing else', () => {
    expect([...ORDER_DEMAND_TRIGGER_ATTRS]).toEqual(['order_cancelled_at'])
  })

  it('marks the order when it is cancelled', async () => {
    await stampOrderOnOrderChange(orderEvent('order_cancelled_at'))
    expect(h.markOrder).toHaveBeenCalledWith(ORG, 'ord-1')
  })

  it('ignores the money and status header fields', async () => {
    for (const attr of ['order_tax_rate', 'order_financial_status', 'order_placed_at']) {
      await stampOrderOnOrderChange(orderEvent(attr))
    }
    expect(h.markOrder).not.toHaveBeenCalled()
  })
})

describe('a deleted line', () => {
  const deleteEvent = (value: unknown) =>
    ({
      organizationId: ORG,
      userId: 'usr_1',
      values: { line_item_order: value },
    }) as unknown as EntityPostDeleteEvent

  it('marks the order the line hung off, read from the captured values', async () => {
    // Deletes fire no field-change hook and the row is already gone, so the
    // parent has to come off the event — the same way `rematchAfterBillLineDelete`
    // reads its own.
    await stampOrderAfterLineDelete(deleteEvent('order:ord-1'))
    expect(h.markOrder).toHaveBeenCalledWith(ORG, 'ord-1')
  })

  it('accepts a bare instance id as well as a RecordId', async () => {
    await stampOrderAfterLineDelete(deleteEvent('ord-1'))
    expect(h.markOrder).toHaveBeenCalledWith(ORG, 'ord-1')
  })

  it('no-ops when the delete captured no parent', async () => {
    await stampOrderAfterLineDelete(deleteEvent(undefined))
    expect(h.markOrder).not.toHaveBeenCalled()
  })
})
