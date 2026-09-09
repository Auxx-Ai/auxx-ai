// packages/lib/src/field-hooks/pre/purchase-order-delete-guard.test.ts
// The guard that stops a purchase order being hard-deleted out from under a
// receipt in a settled month.
//
// plans/money/tasks/21-money-parent-delete-safety.md §4. Note the two-hop read
// the cases exercise: a `stock_movement` names the LINE, never the order, which
// is why `sweepEntityFieldValues` never touched receipts and why an unguarded
// delete looked harmless.
//
// The vendor-bill refusal and the line/receipt cascades are no longer here: they
// are `onDelete: 'restrict'` on `purchase_order_bills` and `onDelete: 'cascade'`
// on `purchase_order_lines` / `purchase_order_line_stock_movements`, run by the
// delete engine.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  findRelated: vi.fn(),
  getCachedEntityDefId: vi.fn(),
  bySystemAttributes: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  movementRows: vi.fn(),
}))

vi.mock('./related-rows', () => ({ findRelatedInstanceIds: h.findRelated }))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

vi.mock('../../postings/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const movementChain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', '$dynamic']) {
    movementChain[method] = () => movementChain
  }
  movementChain.where = async () => h.movementRows()

  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  return {
    ...actual,
    database: { select: () => movementChain, selectDistinct: () => postedChain },
  }
})

import { guardPurchaseOrderDelete } from './purchase-order-delete-guard'

const PO_DEF = 'q5hzr4xbn1fhznih3u74gtza'
const PO_ID = 'p00rd0000000000000000001'
const PO_RECORD_ID = `${PO_DEF}:${PO_ID}`
const ORG = 'abgwpa1l81reht2zmwrcihfu'

function event(): EntityPreDeleteEvent {
  return {
    recordId: PO_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: PO_DEF,
    entityType: 'purchase_order',
    entitySlug: 'purchase-orders',
    values: {},
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

/** The order's lines, as `findRelatedInstanceIds` answers. */
function lines(...ids: string[]): void {
  h.findRelated.mockResolvedValue(ids)
}

function movement(id: string, occurredAt: string | null, createdAt = new Date('2026-08-15')) {
  return { id, occurredAt, createdAt }
}

function settings(values: Record<string, string | null>): void {
  h.getOrganizationSetting.mockImplementation(
    async ({ key }: { key: string }) => values[key] ?? null
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockResolvedValue('movement-def')
  h.bySystemAttributes.mockResolvedValue({
    stock_movement_purchase_order_line: { id: 'f-line' },
    stock_movement_occurred_at: { id: 'f-occurred' },
  })
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postedPeriodRows.mockResolvedValue([])
  h.movementRows.mockResolvedValue([])
  lines()
  settings({})
})

describe('guardPurchaseOrderDelete: refusals', () => {
  it('refuses when a receipt sits in a locked month', async () => {
    lines('line-1')
    h.movementRows.mockResolvedValue([movement('m1', '2026-07-10')])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/2026-07/)
  })

  it('refuses when a receipt sits in a month holding a standing posted entry', async () => {
    lines('line-1')
    h.movementRows.mockResolvedValue([movement('m1', '2026-08-15')])
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('counts receipts, not stock movements, in the message', async () => {
    lines('line-1')
    h.movementRows.mockResolvedValue([movement('m1', '2026-08-15')])
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/1 receipt in 2026-08/)
  })

  it('reads the lines through the archive-aware path, keyed on the order', async () => {
    await guardPurchaseOrderDelete(event())

    expect(h.findRelated).toHaveBeenCalledExactlyOnceWith(
      ORG,
      'purchase_order_line',
      'purchase_order_line_purchase_order',
      [PO_ID]
    )
  })
})

describe('guardPurchaseOrderDelete: open books', () => {
  it('passes when every receipt is in an open period', async () => {
    lines('line-1', 'line-2')
    h.movementRows.mockResolvedValue([movement('m1', '2026-09-01')])

    await expect(guardPurchaseOrderDelete(event())).resolves.toBeUndefined()
  })

  it('passes an order that never received anything', async () => {
    lines('line-1')

    await expect(guardPurchaseOrderDelete(event())).resolves.toBeUndefined()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
  })

  it('does not read movements for an order with no lines', async () => {
    await expect(guardPurchaseOrderDelete(event())).resolves.toBeUndefined()
    // `readMovementsByRelation` short-circuits on an empty id list.
    expect(h.movementRows).not.toHaveBeenCalled()
  })

  it('settles nothing for an org with no accounting setup', async () => {
    lines('line-1')
    h.movementRows.mockResolvedValue([movement('m1', '2020-01-01')])

    await expect(guardPurchaseOrderDelete(event())).resolves.toBeUndefined()
  })
})
