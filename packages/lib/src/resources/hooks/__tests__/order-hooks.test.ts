// packages/lib/src/resources/hooks/__tests__/order-hooks.test.ts
//
// The order number was declared in phase 1 (`order_number`, creatable:false /
// updatable:false, "the hook is the ONLY writer") but the hook itself landed in
// phase 2 — so for the whole of phase 1 every native order was created with no
// number at all, and being non-creatable a human could not fill it either.
// These tests pin the three halves that failure needed: the scope exists, the
// hook is registered under the entity type, and it only fires on create.

import { describe, expect, it, vi } from 'vitest'
import type { SystemHookContext } from '../types'

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: vi.fn() },
}))

const { recordNumbering } = await import('../../../records/record-numbering')
const createMock = vi.mocked(recordNumbering.create)

const { ORDER_HOOKS } = await import('../order-hooks')
const { getSystemHooks, getHooksForAttribute } = await import('../system-hooks')

const FIELD_ID = 'field-order-number-1'

function buildContext(overrides: Partial<SystemHookContext> = {}): SystemHookContext {
  return {
    operation: 'create',
    entityDef: { id: 'def-order', entityType: 'order' },
    field: { id: FIELD_ID, type: 'TEXT', systemAttribute: 'order_number' },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [],
    ...overrides,
  } as unknown as SystemHookContext
}

describe('order_number issuance', () => {
  it('stamps a RecordSequence number on create', async () => {
    createMock.mockResolvedValue({ recordNumber: 'ORD-0001', sequenceNumber: 1 })

    const values = await ORDER_HOOKS.order_number![0]!(buildContext())

    expect(createMock).toHaveBeenCalledWith('org-1', 'order')
    expect(values[FIELD_ID]).toBe('ORD-0001')
  })

  it('does not re-issue on update — the number is stable for the record’s life', async () => {
    createMock.mockClear()

    const values = await ORDER_HOOKS.order_number![0]!(
      buildContext({ operation: 'update', values: { other: 1 } })
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ other: 1 })
  })
})

describe('order hook registration', () => {
  // The miss that made phase 1 ship numberless orders: HOOKS_BY_ENTITY_TYPE is
  // keyed by EntityDefinition.entityType, and an absent key returns {} silently.
  it('is reachable through the entity-type registry, not just the module export', () => {
    expect(getSystemHooks('order')).toBe(ORDER_HOOKS)
    expect(getHooksForAttribute('order', 'order_number')).toHaveLength(1)
  })

  it('registers no lifecycle guard — order statuses have no sanctioned action', () => {
    expect(Object.keys(ORDER_HOOKS)).toEqual(['order_number'])
  })
})
