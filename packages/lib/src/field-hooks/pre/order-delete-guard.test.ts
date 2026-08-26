// packages/lib/src/field-hooks/pre/order-delete-guard.test.ts
// The cascade that stops a deleted order from leaving its line items behind.
//
// Before this hook existed, deleting an order stripped only the `line_item_order`
// mirror row (via `sweepEntityFieldValues`) and the lines survived attached to no
// document at all — invisible in every surface, since each is document-scoped, but
// still rows every `line_item` query counts. Dev held 5 such orphans.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  listFiltered: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    listFiltered = h.listFiltered
    delete = h.del
  },
}))

import { cascadeOrderLinesOnDelete } from './order-delete-guard'

const ORDER_RECORD_ID = 'c62a43b54jinj532zfdlytc7:ou1drb01gv321lqe7pjnvkh8'

function event(): EntityPreDeleteEvent {
  return {
    recordId: ORDER_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: 'c62a43b54jinj532zfdlytc7',
    entityType: 'order',
    entitySlug: 'orders',
    values: {},
    organizationId: 'org_1',
    userId: 'usr_1',
    bypass: new Set(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.del.mockResolvedValue(undefined)
})

describe('cascadeOrderLinesOnDelete', () => {
  it('deletes every line the order owns', async () => {
    h.listFiltered.mockResolvedValue({
      ids: ['o3vn8p2yoi1idx949cgx4fls', 'gm6kggcpgn5o1bg7j9b0n6rg', 'hrdlsqkcrnt2xs1cprrzsz1h'],
    })

    await cascadeOrderLinesOnDelete(event())

    expect(h.del).toHaveBeenCalledTimes(3)
    expect(h.del.mock.calls.map((c) => c[0])).toEqual([
      'line_item:o3vn8p2yoi1idx949cgx4fls',
      'line_item:gm6kggcpgn5o1bg7j9b0n6rg',
      'line_item:hrdlsqkcrnt2xs1cprrzsz1h',
    ])
  })

  it('suppresses the line-level post-delete hook — it would re-project the dying order', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['o3vn8p2yoi1idx949cgx4fls'] })

    await cascadeOrderLinesOnDelete(event())

    expect(h.del).toHaveBeenCalledWith('line_item:o3vn8p2yoi1idx949cgx4fls', {
      suppressPostDeleteHooks: true,
    })
  })

  it('claims only lines with no work order — a WO-sourced line is never the order’s to delete', async () => {
    h.listFiltered.mockResolvedValue({ ids: [] })

    await cascadeOrderLinesOnDelete(event())

    const [query] = h.listFiltered.mock.calls[0]!
    expect(query.entityDefinitionId).toBe('line_item')
    expect(query.filters[0].conditions).toEqual([
      {
        id: 'order-own-lines-order',
        fieldId: 'line_item:order',
        operator: 'is',
        value: ORDER_RECORD_ID,
      },
      {
        id: 'order-own-lines-workorder',
        fieldId: 'line_item:workOrder',
        operator: 'empty',
        value: null,
      },
    ])
  })

  it('is a no-op for an order with no lines', async () => {
    h.listFiltered.mockResolvedValue({ ids: [] })

    await expect(cascadeOrderLinesOnDelete(event())).resolves.toBeUndefined()
    expect(h.del).not.toHaveBeenCalled()
  })
})
