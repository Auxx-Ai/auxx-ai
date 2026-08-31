// packages/lib/src/field-hooks/pre/purchase-order-delete-guard.test.ts
// The guard that stops a purchase order being hard-deleted out from under its
// receipts or a vendor's bill.
//
// plans/money/tasks/21-money-parent-delete-safety.md §4. Note the two-hop read
// the cases exercise: a `stock_movement` names the LINE, never the order, which
// is why `sweepEntityFieldValues` never touched receipts and why an unguarded
// delete looked harmless.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  listFiltered: vi.fn(),
  del: vi.fn(),
  getCachedEntityDefId: vi.fn(),
  bySystemAttributes: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  movementRows: vi.fn(),
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    listFiltered = h.listFiltered
    delete = h.del
  },
}))

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

/** `listFiltered` answers per entity, so a test cannot confuse the two reads. */
function children({ bills = [], lines = [] }: { bills?: string[]; lines?: string[] }): void {
  h.listFiltered.mockImplementation(
    async ({ entityDefinitionId }: { entityDefinitionId: string }) =>
      entityDefinitionId === 'vendor_bill' ? { ids: bills } : { ids: lines }
  )
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
  children({})
  settings({})
})

describe('guardPurchaseOrderDelete — refusals', () => {
  it('refuses when a vendor bill is billed against the order', async () => {
    children({ bills: ['bill-1'], lines: ['line-1'] })

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/three-way match/i)
  })

  it('refuses on the bill before deleting anything at all', async () => {
    children({ bills: ['bill-1'], lines: ['line-1'] })
    h.movementRows.mockResolvedValue([movement('m1', '2026-09-01')])

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow()
    expect(h.del).not.toHaveBeenCalled()
  })

  it('refuses when a receipt sits in a locked month', async () => {
    children({ lines: ['line-1'] })
    h.movementRows.mockResolvedValue([movement('m1', '2026-07-10')])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/2026-07/)
    expect(h.del).not.toHaveBeenCalled()
  })

  it('refuses when a receipt sits in a month holding a standing posted entry', async () => {
    children({ lines: ['line-1'] })
    h.movementRows.mockResolvedValue([movement('m1', '2026-08-15')])
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('counts receipts, not stock movements, in the message', async () => {
    children({ lines: ['line-1'] })
    h.movementRows.mockResolvedValue([movement('m1', '2026-08-15')])
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(guardPurchaseOrderDelete(event())).rejects.toThrow(/1 receipt in 2026-08/)
  })
})

describe('guardPurchaseOrderDelete — cascade', () => {
  it('deletes the receipts BEFORE the lines', async () => {
    children({ lines: ['line-1', 'line-2'] })
    h.movementRows.mockResolvedValue([movement('m1', '2026-09-01')])

    await guardPurchaseOrderDelete(event())

    expect(h.del.mock.calls.map((call) => call[0])).toEqual([
      'stock_movement:m1',
      'purchase_order_line:line-1',
      'purchase_order_line:line-2',
    ])
  })

  it('never suppresses the movement delete — QoH lands on a surviving part', async () => {
    children({ lines: ['line-1'] })
    h.movementRows.mockResolvedValue([movement('m1', '2026-09-01')])

    await guardPurchaseOrderDelete(event())

    expect(h.del.mock.calls[0]).toEqual(['stock_movement:m1'])
  })

  it('cascades the lines even when the order never received anything', async () => {
    children({ lines: ['line-1'] })

    await guardPurchaseOrderDelete(event())

    expect(h.del).toHaveBeenCalledExactlyOnceWith('purchase_order_line:line-1')
  })

  it('does nothing for an order with no lines and no bills', async () => {
    await guardPurchaseOrderDelete(event())
    expect(h.del).not.toHaveBeenCalled()
  })

  it('settles nothing for an org with no accounting setup', async () => {
    children({ lines: ['line-1'] })
    h.movementRows.mockResolvedValue([movement('m1', '2020-01-01')])

    await guardPurchaseOrderDelete(event())

    expect(h.del).toHaveBeenCalledWith('stock_movement:m1')
  })
})
